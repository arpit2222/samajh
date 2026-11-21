import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/authGuard.js";
import { generateApiKey } from "../tools/apiKeys.js";
import {
  createApiKeyRecord,
  listApiKeysByUserId,
  revokeApiKeyForUser,
} from "../db/firestore.js";

const router = Router();

// All developer key-management endpoints require normal Firebase session auth
router.use(requireAuth);

/**
 * POST /api/developer/keys
 * Body: { label?: string }
 * 201: { id, key: "sk_live_...", keyPrefix, label, createdAt }
 * This is the ONLY response that ever includes the plaintext key.
 */
router.post("/keys", async (req, res, next) => {
  try {
    const rawLabel = typeof req.body?.label === "string" ? req.body.label.trim() : "";
    const label = rawLabel ? rawLabel.slice(0, 80) : "Unnamed key";

    const id = `key_${crypto.randomUUID()}`;
    const { fullKey, keyHash, keyPrefix } = generateApiKey();

    const record = await createApiKeyRecord({
      id,
      userId: req.user.uid,
      keyHash,
      keyPrefix,
      label,
    });

    return res.status(201).json({
      id: record.id,
      key: fullKey,
      keyPrefix: record.keyPrefix,
      label: record.label,
      createdAt: record.createdAt,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/developer/keys
 * Returns { keys: [{ id, keyPrefix, label, createdAt, lastUsedAt, revokedAt, requestCount }] }.
 * Never includes keyHash or the full key.
 */
router.get("/keys", async (req, res, next) => {
  try {
    const keys = await listApiKeysByUserId(req.user.uid);
    return res.status(200).json({ keys });
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /api/developer/keys/:id
 * Sets revokedAt to now. Returns { id, revokedAt }.
 * 404 if key doesn't exist OR belongs to another user (identical response).
 * 409 if already revoked.
 */
router.delete("/keys/:id", async (req, res, next) => {
  try {
    const id = req.params.id?.toString().trim();
    const outcome = await revokeApiKeyForUser(id, req.user.uid);

    if (outcome.status === "not_found") {
      return res.status(404).json({ error: "API key not found." });
    }
    if (outcome.status === "already_revoked") {
      return res.status(409).json({ error: "API key is already revoked." });
    }

    return res.status(200).json({
      id: outcome.id,
      revokedAt: outcome.revokedAt,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
