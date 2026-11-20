import { Router } from "express";
import crypto from "node:crypto";
import {
  CONCEPT_TAG_MAP,
  tradePostMortemAgent,
} from "../agents/tradePostMortemAgent.js";
import { createSession } from "../db/firestore.js";

const router = Router();

/**
 * Server-side PII & currency-amount guard.
 * Never trusts client-side redaction alone — rejects any request containing
 * PII-bearing keys (client_id, pan, order_id, trade_id, account, email, phone)
 * or absolute ₹/capital/price fields, WITHOUT logging the rejected payload.
 */
const FORBIDDEN_KEY_RE =
  /^(client[_-]?id|pan|pan[_-]?no|order[_-]?id|order[_-]?no|trade[_-]?id|account[_-]?no|account|isin|ucc|email|phone|mobile|capital|balance|net[_-]?worth|pnl[_-]?rs|rupee|inr|amount|price|quantity|qty|symbol|scrip|tradingsymbol)$/i;

const PAN_VALUE_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
const RUPEE_VALUE_RE = /(?:₹\s*\d|\b(?:rs\.?|inr)\s*\d)/i;

export function findPiiViolation(value, pathPrefix = "") {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    if (PAN_VALUE_RE.test(value)) return `PAN-like identifier detected at ${pathPrefix || "payload"}`;
    if (RUPEE_VALUE_RE.test(value)) return `Absolute ₹ currency amount detected at ${pathPrefix || "payload"}`;
    return null;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findPiiViolation(value[i], `${pathPrefix}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (FORBIDDEN_KEY_RE.test(key)) {
        return `Forbidden confidential field "${key}" is not accepted by Samajh`;
      }
      const hit = findPiiViolation(val, pathPrefix ? `${pathPrefix}.${key}` : key);
      if (hit) return hit;
    }
  }

  return null;
}

/**
 * POST /api/trade-profile/review
 * Input: { ratios, risk_tags, trade, note? } (strictly anonymized — rejects PII server-side)
 * Output: { diagnosis, concept_tag, concept_name, grounding }
 */
router.post("/review", async (req, res, next) => {
  try {
    const piiError = findPiiViolation(req.body);
    if (piiError) {
      // Intentionally do NOT log req.body so rejected PII is never written to logs
      return res.status(400).json({
        error: `Privacy guard rejected request: ${piiError}. Strip all identifying fields and ₹ amounts before submitting.`,
      });
    }

    const { ratios, risk_tags, trade, note } = req.body || {};
    if (!trade || typeof trade !== "object" || !trade.instrument_type) {
      return res.status(400).json({ error: "Select an anonymized past trade to diagnose." });
    }

    const safeTrade = {
      date: trade.date ? String(trade.date).slice(0, 16) : null,
      instrument_type: String(trade.instrument_type).slice(0, 30),
      segment: String(trade.segment || "F&O").slice(0, 16),
      direction: String(trade.direction || "BUY").slice(0, 10),
      holding_bucket: String(trade.holding_bucket || "Intraday").slice(0, 20),
      outcome_bucket: String(trade.outcome_bucket || "loss").slice(0, 16),
      expiry_day: Boolean(trade.expiry_day),
      had_stop_loss:
        trade.had_stop_loss === null || trade.had_stop_loss === undefined
          ? null
          : Boolean(trade.had_stop_loss),
    };

    const safeRatios = ratios
      ? {
          fno_pct: Math.max(0, Math.min(100, Math.round(Number(ratios.fno_pct) || 0))),
          overnight_pct: Math.max(0, Math.min(100, Math.round(Number(ratios.overnight_pct) || 0))),
          expiry_day_pct: Math.max(
            0,
            Math.min(100, Math.round(Number(ratios.expiry_day_pct) || 0))
          ),
          total_trades: Math.max(0, Math.round(Number(ratios.total_trades) || 0)),
        }
      : null;

    const safeTags = Array.isArray(risk_tags)
      ? risk_tags.slice(0, 6).map((t) => String(t).slice(0, 80))
      : [];

    const result = await tradePostMortemAgent({
      trade: safeTrade,
      ratios: safeRatios,
      risk_tags: safeTags,
      note: typeof note === "string" ? note.slice(0, 400) : "",
    });

    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/trade-profile/start-teachback
 * Loop-back endpoint: skips ingestAgent and conceptAgent completely and seeds a
 * fresh Firestore session directly for socraticAgent using `concept_tag`.
 */
router.post("/start-teachback", async (req, res, next) => {
  try {
    const conceptTag = req.body?.concept_tag?.toString().trim();
    const mapped = CONCEPT_TAG_MAP[conceptTag];
    if (!mapped) {
      return res.status(400).json({ error: "Unknown concept_tag for teach-back loop-back." });
    }

    const uid = req.headers["x-firebase-uid"]?.toString().trim() || null;
    const userEmail = req.headers["x-firebase-email"]?.toString().trim() || null;
    const sessionId = crypto.randomUUID();

    await createSession({
      sessionId,
      uid,
      userEmail,
      rawText: mapped.concept,
      concept: mapped.concept,
      analogy: mapped.analogy,
      turns: [],
    });

    return res.status(200).json({
      sessionId,
      concept_tag: conceptTag,
      concept_name: mapped.concept_name,
      concept: mapped.concept,
      analogy: mapped.analogy,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
