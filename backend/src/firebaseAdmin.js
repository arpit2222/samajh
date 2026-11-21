import admin from "firebase-admin";

let initialized = false;
let testVerifierOverride = null;

/**
 * Initialize Firebase Admin SDK once at server startup using Application Default Credentials
 * (automatically picks up GOOGLE_APPLICATION_CREDENTIALS).
 */
export function initFirebaseAdmin() {
  if (initialized) return admin;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
  initialized = true;
  return admin;
}

/**
 * Test-only hook for unit/smoke tests running without live GCP network access.
 * Never exposed to HTTP routes.
 */
export function setIdTokenVerifierForTests(verifierFn) {
  testVerifierOverride = typeof verifierFn === "function" ? verifierFn : null;
}

/**
 * Verifies a Firebase ID token (including Firebase Anonymous Auth tokens) via
 * `admin.auth().verifyIdToken(token)`.
 * Throws on invalid, expired, revoked, or malformed tokens.
 */
export async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== "string" || !idToken.trim()) {
    const err = new Error("Missing Firebase ID token.");
    err.statusCode = 401;
    throw err;
  }

  if (testVerifierOverride) {
    return testVerifierOverride(idToken.trim());
  }

  initFirebaseAdmin();
  return admin.auth().verifyIdToken(idToken.trim());
}
