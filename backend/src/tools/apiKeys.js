import crypto from "node:crypto";

export const API_KEY_PREFIX = "sk_live_";

/**
 * Generate a cryptographically random Samajh API key:
 *   sk_live_<base64url(32 random bytes)>
 * Returns { fullKey, keyHash, keyPrefix }.
 * `fullKey` MUST only be returned once in the POST /api/developer/keys response
 * and NEVER persisted to any database, log, or file.
 */
export function generateApiKey() {
  const entropy = crypto.randomBytes(32).toString("base64url");
  const fullKey = `${API_KEY_PREFIX}${entropy}`;
  const keyHash = hashApiKey(fullKey);
  const keyPrefix = fullKey.slice(0, 12); // e.g. "sk_live_a1b2"
  return { fullKey, keyHash, keyPrefix };
}

/**
 * Deterministic SHA-256 hex digest for fast, indexed exact-match lookup.
 * (256-bit random API keys do not need slow per-call bcrypt salting.)
 */
export function hashApiKey(plaintextKey) {
  return crypto.createHash("sha256").update(String(plaintextKey), "utf8").digest("hex");
}
