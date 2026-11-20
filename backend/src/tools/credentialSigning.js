import crypto from "node:crypto";

const DEV_FALLBACK_KEY = "samajh-dev-only-signing-key-set-CREDENTIAL_SIGNING_KEY-in-env";

function getSigningKey() {
  const key = process.env.CREDENTIAL_SIGNING_KEY?.trim();
  if (key && key !== "your_random_32_byte_hex_secret_here") {
    return key;
  }
  return DEV_FALLBACK_KEY;
}

/**
 * Deterministic canonical payload for HMAC-SHA256 signing.
 * Any direct tampering with userId, credentialId, overall_score, or concept scores
 * in Firestore will cause verification to flip to verified:false.
 */
export function buildCanonicalCredentialPayload(doc) {
  const normalizedConcepts = (Array.isArray(doc.concepts) ? doc.concepts : [])
    .map((c) => ({
      name: String(c.name || "").trim(),
      teachback_score: Number(c.teachback_score ?? 0),
      stress_score: c.stress_score === null || c.stress_score === undefined ? null : Number(c.stress_score),
      last_verified: String(c.last_verified || ""),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return JSON.stringify({
    credentialId: String(doc.credentialId || ""),
    userId: String(doc.userId || ""),
    overall_score: Number(doc.overall_score ?? 0),
    concepts: normalizedConcepts,
  });
}

export function computeVerificationHash(doc) {
  const payload = buildCanonicalCredentialPayload(doc);
  return crypto.createHmac("sha256", getSigningKey()).update(payload).digest("hex");
}

export function verifyCredentialSignature(doc) {
  if (!doc || typeof doc.verificationHash !== "string" || !doc.verificationHash) {
    return false;
  }
  const expected = computeVerificationHash(doc);
  const actualBuf = Buffer.from(doc.verificationHash, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function generateCredentialSlug() {
  return `smj-${crypto.randomBytes(4).toString("hex")}`;
}
