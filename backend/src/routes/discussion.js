import { Router } from "express";
import crypto from "node:crypto";
import {
  appendDiscussionPost,
  flagDiscussionPost,
  getCredentialByUserId,
  getDiscussionPostsPaginated,
  getSession,
  listSessionsByUid,
} from "../db/firestore.js";
import { findPiiViolation } from "../services/capabilities.js";
import { VALID_SAFEGUARD_SUBTOPICS } from "../services/safeguardClearance.js";
import { CONCEPT_TAG_MAP } from "../agents/tradePostMortemAgent.js";
import { optionalAuth } from "../middleware/authGuard.js";

const router = Router();
router.use(optionalAuth);

/**
 * Pattern-level discussion guard:
 * Rejects any PII, PAN, ₹/Rs/INR currency figures, OR specific stock tickers /
 * F&O contract symbols so discussions stay strictly educational and anonymous.
 */
const KNOWN_INDIAN_TICKERS_RE =
  /\b(INDUSINDBK|RELIANCE|HDFCBANK|ICICIBANK|SBIN|INFY|TCS|YESBANK|ADANIENT|ADANIPORTS|TATAMOTORS|TATASTEEL|BAJFINANCE|KOTAKBANK|AXISBANK|BHARTIARTL|ITC|LT|MARUTI|SUNPHARMA|WIPRO|HCLTECH|ZOMATO|PAYTM|NYKAA|IRCTC|HAL|BEL|ONGC|NTPC|POWERGRID|COALINDIA|HINDALCO|JSWSTEEL|M&M|ASIANPAINT|TITAN|ULTRACEMCO|NESTLEIND)\b/i;

const SYMBOL_CONTRACT_RE =
  /(?:\$[A-Z]{2,12}\b|\b(?:NSE|BSE|MCX):[A-Z0-9_-]{2,15}\b|\b(?:NIFTY|BANKNIFTY|FINNIFTY|SENSEX)\s*\d{4,5}\s*(?:CE|PE)\b|\b[A-Z]{3,12}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+FUT\b)/i;

export function findDiscussionContentViolation(text) {
  const pii = findPiiViolation({ text });
  if (pii) return pii;

  if (KNOWN_INDIAN_TICKERS_RE.test(text) || SYMBOL_CONTRACT_RE.test(text)) {
    return "Specific stock tickers or F&O contract symbols are not allowed — keep discussion at the risk-pattern level";
  }
  return null;
}

function sessionMatchesSubtopic(session, subtopic) {
  if (!session) return false;
  if (session.stressScenarioTag === subtopic) return true;
  if (session.weakSubtopic === subtopic) return true;
  const conceptName = CONCEPT_TAG_MAP[subtopic]?.concept_name?.toLowerCase();
  const hay = `${session.concept || ""} ${session.weakSubtopic || ""}`.toLowerCase();
  if (conceptName && hay.includes(conceptName.slice(0, 14))) return true;
  if (subtopic === "circuit_breaker_margin_risk" && /margin|mtm|circuit|halt/.test(hay)) return true;
  if (subtopic === "overnight_gap_stoploss_risk" && /stop[\s-]?loss|gap|overnight/.test(hay)) return true;
  if (subtopic === "event_volatility_option_writing_risk" && /option|vix|writer|expiry/.test(hay)) return true;
  if (subtopic === "regulatory_moratorium_liquidity_risk" && /moratorium|liquidity|collateral/.test(hay)) return true;
  if (subtopic === "general_market_risk" && typeof session.examinerScore === "number") return true;
  return false;
}

/**
 * Gate check: user must have attempted this weak_subtopic at least once
 * (verified via existing Firestore sessions or credentials, or current Guest sessionId).
 */
async function hasUserAttemptedSubtopic({ uid, sessionId, weak_subtopic }) {
  if (sessionId) {
    const sess = await getSession(sessionId);
    if (sessionMatchesSubtopic(sess, weak_subtopic)) return true;
  }

  if (uid) {
    const sessions = await listSessionsByUid(uid, 50);
    if (sessions.some((s) => sessionMatchesSubtopic(s, weak_subtopic))) {
      return true;
    }

    const cred = await getCredentialByUserId(uid);
    const conceptName = CONCEPT_TAG_MAP[weak_subtopic]?.concept_name?.toLowerCase();
    if (
      cred &&
      conceptName &&
      (cred.concepts || []).some((c) => c.name.toLowerCase().includes(conceptName.slice(0, 14)))
    ) {
      return true;
    }
  }

  return false;
}

function validateSubtopicParam(req, res) {
  const subtopic = req.params.weak_subtopic?.toString().trim();
  if (!VALID_SAFEGUARD_SUBTOPICS.includes(subtopic)) {
    res.status(400).json({
      error: `Invalid weak_subtopic "${subtopic}". Must be one of: ${VALID_SAFEGUARD_SUBTOPICS.join(", ")}.`,
    });
    return null;
  }
  return subtopic;
}

/**
 * GET /api/discussion/:weak_subtopic?page=1&limit=10&sessionId=...
 * Paginated thread view, gated behind the user having attempted that subtopic at least once.
 */
router.get("/:weak_subtopic", async (req, res, next) => {
  try {
    const subtopic = validateSubtopicParam(req, res);
    if (!subtopic) return;

    const uid = req.user?.uid || null;
    const sessionId = req.query.sessionId?.toString().trim() || null;

    const allowed = await hasUserAttemptedSubtopic({ uid, sessionId, weak_subtopic: subtopic });
    if (!allowed) {
      return res.status(403).json({
        locked: true,
        weak_subtopic: subtopic,
        error: `Attempt "${subtopic}" in Teach-Back or Stress-Test at least once to unlock this Discussion Circle.`,
      });
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const data = await getDiscussionPostsPaginated({ weak_subtopic: subtopic, page, limit });

    return res.status(200).json({
      ...data,
      concept_name: CONCEPT_TAG_MAP[subtopic]?.concept_name || "General Market Volatility & Liquidity",
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/discussion/:weak_subtopic/post
 * Text-only v1 (no file/image uploads). Runs PII, ₹ amount, and stock-ticker guard.
 */
router.post("/:weak_subtopic/post", async (req, res, next) => {
  try {
    const subtopic = validateSubtopicParam(req, res);
    if (!subtopic) return;

    const uid = req.user?.uid || null;
    const sessionId = req.body?.sessionId?.toString().trim() || null;

    const allowed = await hasUserAttemptedSubtopic({ uid, sessionId, weak_subtopic: subtopic });
    if (!allowed) {
      return res.status(403).json({
        locked: true,
        error: `Attempt "${subtopic}" at least once before posting in this Discussion Circle.`,
      });
    }

    if (req.body?.image || req.body?.file || req.body?.attachment) {
      return res.status(400).json({
        error: "Discussion Circles are text-only in v1 — image and file uploads are not allowed.",
      });
    }

    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (text.length < 10 || text.length > 1000) {
      return res.status(400).json({
        error: "Post text must be between 10 and 1,000 characters.",
      });
    }

    // Do NOT log rejected content
    const violation = findDiscussionContentViolation(text);
    if (violation) {
      return res.status(400).json({
        error: `Post rejected by privacy & pattern guard: ${violation}.`,
      });
    }

    // Reuse opt-in discoverable privacy rule: default Anonymous Learner
    let authorLabel = "Anonymous Learner";
    if (uid) {
      const cred = await getCredentialByUserId(uid);
      if (cred?.discoverable === true && cred.displayName) {
        authorLabel = cred.displayName;
      }
    }

    const post = {
      id: `dp_${crypto.randomUUID().slice(0, 12)}`,
      author_label: authorLabel,
      body: text,
      created_at: new Date().toISOString(),
      flagged: false,
      flagged_at: null,
      report_count: 0,
    };

    await appendDiscussionPost({ weak_subtopic: subtopic, post });
    return res.status(201).json({ post });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/discussion/:weak_subtopic/posts/:postId/report
 * Flags a post for human review (`flagged: true`) — NEVER auto-deletes.
 */
router.post("/:weak_subtopic/posts/:postId/report", async (req, res, next) => {
  try {
    const subtopic = validateSubtopicParam(req, res);
    if (!subtopic) return;

    const postId = req.params.postId?.toString().trim();
    if (!postId) {
      return res.status(400).json({ error: "postId is required." });
    }

    const flaggedPost = await flagDiscussionPost({ weak_subtopic: subtopic, postId });
    if (!flaggedPost) {
      return res.status(404).json({ error: "Post not found in this discussion circle." });
    }

    return res.status(200).json({
      post: flaggedPost,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
