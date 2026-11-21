import { examinerAgent } from "../agents/examinerAgent.js";
import { tradePostMortemAgent } from "../agents/tradePostMortemAgent.js";
import { getCredentialBySlug } from "../db/firestore.js";
import { verifyCredentialSignature } from "../tools/credentialSigning.js";

/**
 * Single internal implementation of every core Samajh capability.
 * Shared across internal routes, Public REST API v1 (/api/public/v1/*),
 * and the Streamable HTTP MCP server (/mcp) — never duplicated.
 */

const FORBIDDEN_KEY_RE =
  /^(client[_-]?id|pan|pan[_-]?no|order[_-]?id|order[_-]?no|trade[_-]?id|account[_-]?no|account|isin|ucc|email|phone|mobile|capital|balance|net[_-]?worth|pnl[_-]?rs|rupee|inr|amount|price|quantity|qty|symbol|scrip|tradingsymbol)$/i;

const PAN_VALUE_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
const RUPEE_VALUE_RE = /(?:₹\s*\d|\b(?:rs\.?|inr)\s*\d)/i;

export function findPiiViolation(value, pathPrefix = "") {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    if (PAN_VALUE_RE.test(value)) {
      return `PAN-like identifier detected at ${pathPrefix || "payload"}`;
    }
    if (RUPEE_VALUE_RE.test(value)) {
      return `Absolute ₹ currency amount detected at ${pathPrefix || "payload"}`;
    }
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
 * Capability 1: Verify Understanding
 * Calls examinerAgent directly with the provided concept and learner explanation.
 */
export async function verifyUnderstandingCapability({ concept, explanation } = {}) {
  const cleanConcept = typeof concept === "string" ? concept.trim() : "";
  const cleanExplanation = typeof explanation === "string" ? explanation.trim() : "";

  if (!cleanConcept || !cleanExplanation) {
    const err = new Error("Both 'concept' and 'explanation' (non-empty strings) are required.");
    err.statusCode = 400;
    throw err;
  }

  return examinerAgent({
    concept: cleanConcept,
    turns: [{ speaker: "user", text: cleanExplanation }],
  });
}

/**
 * Capability 2: Verify Credential
 * Shared verbatim by public GET /api/verify/:credentialId, GET /api/public/v1/verify-credential/:credentialId,
 * and MCP tool `verify_credential`. Discloses only public verification fields — nothing additional.
 */
export async function verifyCredentialCapability(credentialId) {
  const slug = typeof credentialId === "string" ? credentialId.trim() : "";
  if (!slug) {
    const err = new Error("credentialId is required.");
    err.statusCode = 400;
    throw err;
  }

  const doc = await getCredentialBySlug(slug);
  if (!doc) {
    const err = new Error("No verifiable credential found for this ID.");
    err.statusCode = 404;
    throw err;
  }

  const verified = verifyCredentialSignature(doc);
  return {
    verified,
    credential: {
      credentialId: doc.credentialId,
      displayName: doc.displayName || "Verified Candidate",
      concepts: doc.concepts || [],
      overall_score: doc.overall_score,
      verificationHash: doc.verificationHash,
      updatedAt: doc.updatedAt,
      isSeedData: Boolean(doc.isSeedData),
      onchain_status: doc.onchain_status || "unanchored",
      onchain_network: doc.onchain_network || "polygon-amoy",
      onchain_holder: doc.onchain_holder || null,
      txHash: doc.txHash || null,
      tokenId: doc.tokenId || null,
      explorerUrl:
        doc.explorerUrl || (doc.txHash ? `https://amoy.polygonscan.com/tx/${doc.txHash}` : null),
    },
  };
}

/**
 * Capability 3: Diagnose Trade Patterns
 * Shared verbatim by POST /api/trade-profile/review, POST /api/public/v1/diagnose-trade-patterns,
 * and MCP tool `diagnose_trade_patterns` — including the exact server-side PII guard and
 * risk-literacy-only (zero investment advice) prompt rules.
 */
export async function diagnoseTradePatternsCapability(body = {}) {
  const piiError = findPiiViolation(body);
  if (piiError) {
    const err = new Error(
      `Privacy guard rejected request: ${piiError}. Strip all identifying fields and ₹ amounts before submitting.`
    );
    err.statusCode = 400;
    throw err;
  }

  const { ratios, risk_tags, trade, note } = body || {};
  if (!trade || typeof trade !== "object" || !trade.instrument_type) {
    const err = new Error("Valid anonymized 'trade' object with 'instrument_type' is required.");
    err.statusCode = 400;
    throw err;
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

  return tradePostMortemAgent({
    trade: safeTrade,
    ratios: safeRatios,
    risk_tags: safeTags,
    note: typeof note === "string" ? note.slice(0, 400) : "",
  });
}
