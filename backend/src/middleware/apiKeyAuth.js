import { API_KEY_PREFIX, hashApiKey } from "../tools/apiKeys.js";
import { findApiKeyByHash, recordApiKeyUsage } from "../db/firestore.js";

/**
 * Shared API Key Authentication Middleware.
 * Used unmodified by BOTH /api/public/v1/* REST routes AND /mcp Streamable HTTP.
 *
 * Reads key from `Authorization: Bearer <key>`.
 * Error codes:
 *   401 { error: "missing_api_key" }
 *   401 { error: "invalid_api_key_format" }
 *   401 { error: "invalid_api_key" }
 *   401 { error: "key_revoked" }
 */
export async function authenticateApiKey(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const rawKey = match ? match[1].trim() : "";

    if (!rawKey) {
      return res.status(401).json({ error: "missing_api_key" });
    }

    if (!rawKey.startsWith(API_KEY_PREFIX)) {
      return res.status(401).json({ error: "invalid_api_key_format" });
    }

    const keyHash = hashApiKey(rawKey);
    const keyDoc = await findApiKeyByHash(keyHash);

    if (!keyDoc) {
      return res.status(401).json({ error: "invalid_api_key" });
    }

    if (keyDoc.revokedAt) {
      return res.status(401).json({ error: "key_revoked" });
    }

    req.apiKeyAuth = {
      userId: keyDoc.userId,
      apiKeyId: keyDoc.id,
    };

    // Fire-and-forget usage tracking — never blocks the response
    recordApiKeyUsage(keyDoc.id).catch(() => {});

    return next();
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
}
