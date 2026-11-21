import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

function getEncryptionKey() {
  const secret =
    process.env.KITE_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.CREDENTIAL_SIGNING_KEY?.trim() ||
    "samajh-local-dev-kite-encryption-key";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a plaintext broker token using AES-256-GCM.
 * Returns { alg, iv, authTag, ciphertext } (all base64) — never plaintext.
 */
export function encryptBrokerToken(plaintext) {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Cannot encrypt an empty broker token.");
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    alg: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted token blob in memory.
 */
export function decryptBrokerToken(blob) {
  if (!blob || !blob.ciphertext || !blob.iv || !blob.authTag) {
    throw new Error("Invalid encrypted broker token payload.");
  }
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
