import { Router } from "express";
import {
  getCredentialByUserId,
  getCredentialBySlug,
  listSessionsByUid,
  updateCredentialDiscoverable,
  upsertCredential,
} from "../db/firestore.js";
import { requireAuth, requireRole } from "../middleware/authGuard.js";
import {
  computeVerificationHash,
  generateCredentialSlug,
  verifyCredentialSignature,
} from "../tools/credentialSigning.js";
import {
  deriveCustodialAddress,
  triggerOnChainAnchorFireAndForget,
} from "../tools/sbtRelayer.js";
import { verifyCredentialCapability } from "../services/capabilities.js";

export const credentialRouter = Router();
export const verifyRouter = Router();

/**
 * Extract a clean concept display name from a session's `concept` field
 * (e.g. "Mark-to-Market (MTM) Margin: Daily cash settlement..." -> "Mark-to-Market (MTM) Margin")
 */
function normalizeConceptName(rawConcept) {
  const s = String(rawConcept || "").trim();
  if (!s) return "Financial Concept";
  const colonIdx = s.indexOf(":");
  if (colonIdx > 3 && colonIdx < 70) {
    return s.slice(0, colonIdx).trim();
  }
  return s.length > 64 ? `${s.slice(0, 61).trim()}...` : s;
}

/**
 * GET /api/credential/me (auth required, trader only)
 */
credentialRouter.get("/me", requireAuth, requireRole("trader"), async (req, res, next) => {
  try {
    const credential = await getCredentialByUserId(req.user.uid);
    return res.status(200).json({
      credential,
      verified: credential ? verifyCredentialSignature(credential) : false,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/credential/generate (auth required, trader only)
 * Aggregates the calling trader's existing sessions + stress-test results into their
 * credentials doc, computes HMAC-SHA256 verificationHash, creates credentialId if none exists.
 * Idempotent: re-running updates scores while keeping the same credentialId & discoverable setting.
 */
credentialRouter.post("/generate", requireAuth, requireRole("trader"), async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const sessions = await listSessionsByUid(uid, 100);
    const scoredSessions = sessions.filter((s) => typeof s.examinerScore === "number");

    if (scoredSessions.length === 0) {
      return res.status(400).json({
        error:
          "Complete at least one Teach-Back verification (Score screen) before generating your verifiable credential.",
      });
    }

    // Aggregate per concept (keeping highest/latest verified scores per concept name)
    const byConcept = new Map();
    for (const s of scoredSessions) {
      const name = normalizeConceptName(s.concept);
      const prev = byConcept.get(name);
      const teachbackScore = Math.round(Number(s.examinerScore));
      const stressScore =
        typeof s.stressScore === "number" ? Math.round(Number(s.stressScore)) : null;
      const lastVerified = s.updatedAt || s.timestamp || new Date().toISOString();

      if (!prev || lastVerified >= prev.last_verified) {
        byConcept.set(name, {
          name,
          teachback_score: teachbackScore,
          stress_score: stressScore ?? prev?.stress_score ?? null,
          last_verified: lastVerified,
        });
      }
    }

    const concepts = [...byConcept.values()];
    const conceptAverages = concepts.map((c) =>
      c.stress_score !== null
        ? Math.round((c.teachback_score + c.stress_score) / 2)
        : c.teachback_score
    );
    const overall_score = Math.round(
      conceptAverages.reduce((a, b) => a + b, 0) / conceptAverages.length
    );

    const existing = await getCredentialByUserId(uid);
    const credentialId = existing?.credentialId || generateCredentialSlug();
    const discoverable = existing ? Boolean(existing.discoverable) : false;

    const walletAddress =
      typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : null;

    const draft = {
      userId: uid,
      displayName: req.user.displayName || "Verified Trader",
      concepts,
      overall_score,
      credentialId,
      discoverable,
      isSeedData: false,
      onchain_status: "pending",
      onchain_network: "polygon-amoy",
      onchain_holder: walletAddress || deriveCustodialAddress(uid),
      txHash: existing?.txHash || null,
      tokenId: existing?.tokenId || null,
      explorerUrl: existing?.explorerUrl || null,
    };

    draft.verificationHash = computeVerificationHash(draft);
    const saved = await upsertCredential(draft);

    // Fire-and-forget Polygon Amoy SBT anchor — NEVER blocks the HTTP response
    if (process.env.DISABLE_ONCHAIN_ANCHOR !== "1") {
      triggerOnChainAnchorFireAndForget({
        userId: uid,
        credentialId,
        verificationHash: draft.verificationHash,
        walletAddress,
      });
    }

    return res.status(200).json({
      credential: saved,
      verified: true,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /api/credential/discoverable ({ discoverable: boolean })
 * Privacy opt-in/out for employer searches (default false).
 */
credentialRouter.patch(
  "/discoverable",
  requireAuth,
  requireRole("trader"),
  async (req, res, next) => {
    try {
      if (typeof req.body?.discoverable !== "boolean") {
        return res.status(400).json({ error: "discoverable (boolean) is required." });
      }
      const updated = await updateCredentialDiscoverable(req.user.uid, req.body.discoverable);
      if (!updated) {
        return res.status(404).json({
          error: "Generate your verified credential first before changing discoverability.",
        });
      }
      return res.status(200).json({
        credential: updated,
        verified: verifyCredentialSignature(updated),
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/credential/:credentialId/onchain-status — PUBLIC polling endpoint
 * Frontend polls this every ~3s (up to 30s) without blocking the primary signature verification.
 */
credentialRouter.get("/:credentialId/onchain-status", async (req, res, next) => {
  try {
    const slug = req.params.credentialId?.toString().trim();
    if (!slug) {
      return res.status(400).json({ error: "credentialId is required." });
    }
    const doc = await getCredentialBySlug(slug);
    if (!doc) {
      return res.status(404).json({ error: "Credential not found." });
    }

    return res.status(200).json({
      credentialId: doc.credentialId,
      onchain_status: doc.onchain_status || "unanchored",
      onchain_network: doc.onchain_network || "polygon-amoy",
      onchain_holder: doc.onchain_holder || null,
      txHash: doc.txHash || null,
      tokenId: doc.tokenId || null,
      explorerUrl: doc.explorerUrl || (doc.txHash ? `https://amoy.polygonscan.com/tx/${doc.txHash}` : null),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/verify/:credentialId — PUBLIC, NO AUTH.
 * Recomputes HMAC-SHA256 from stored Firestore data and compares against stored verificationHash.
 * If someone tampers with the stored doc directly, verified flips to false.
 */
verifyRouter.get("/:credentialId", async (req, res, next) => {
  try {
    const result = await verifyCredentialCapability(req.params.credentialId);
    return res.status(200).json(result);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message, verified: false });
    }
    return next(err);
  }
});
