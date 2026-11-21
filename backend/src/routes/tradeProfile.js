import { Router } from "express";
import crypto from "node:crypto";
import { CONCEPT_TAG_MAP } from "../agents/tradePostMortemAgent.js";
import { createSession } from "../db/firestore.js";
import {
  diagnoseTradePatternsCapability,
  findPiiViolation,
} from "../services/capabilities.js";

export { findPiiViolation };

const router = Router();

/**
 * POST /api/trade-profile/review
 * Delegates to the single shared diagnoseTradePatternsCapability function
 * (includes server-side PII guard + risk-literacy-only NISM RAG diagnosis).
 */
router.post("/review", async (req, res, next) => {
  try {
    const result = await diagnoseTradePatternsCapability(req.body);
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
