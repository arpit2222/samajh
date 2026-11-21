import { Router } from "express";
import { authenticateApiKey } from "../middleware/apiKeyAuth.js";
import {
  verifyUnderstandingCapability,
  verifyCredentialCapability,
  diagnoseTradePatternsCapability,
} from "../services/capabilities.js";

const router = Router();

// Every route under /api/public/v1/ requires a valid, non-revoked API key
router.use(authenticateApiKey);

/**
 * POST /api/public/v1/verify-understanding
 * Body: { concept: string, explanation: string }
 */
router.post("/verify-understanding", async (req, res, next) => {
  try {
    const result = await verifyUnderstandingCapability(req.body);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/public/v1/verify-credential/:credentialId
 */
router.get("/verify-credential/:credentialId", async (req, res, next) => {
  try {
    const result = await verifyCredentialCapability(req.params.credentialId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/public/v1/diagnose-trade-patterns
 * Body matches internal POST /api/trade-profile/review exactly.
 */
router.post("/diagnose-trade-patterns", async (req, res, next) => {
  try {
    const result = await diagnoseTradePatternsCapability(req.body);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

// Scoped error handler: returns clean 400/404 for client errors, and strict
// 500 { error: "internal_error" } (zero stack traces or internals) for unexpected failures.
router.use((err, _req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: err.message || "Bad request" });
  }
  console.error("[Samajh Public API v1 Error]", err);
  return res.status(500).json({ error: "internal_error" });
});

export default router;
