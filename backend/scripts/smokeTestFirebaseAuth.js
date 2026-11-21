import assert from "node:assert/strict";
import { initDatabase } from "../src/db/firestore.js";
import { setIdTokenVerifierForTests } from "../src/firebaseAdmin.js";
import { optionalAuth, requireAuth } from "../src/middleware/authGuard.js";

function runMiddleware(middleware, headers = {}) {
  return new Promise((resolve) => {
    let statusCode = 200;
    const req = { headers };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        resolve({ calledNext: false, status: statusCode, body, req });
        return this;
      },
    };
    middleware(req, res, (err) => {
      if (err) {
        resolve({ calledNext: false, status: 500, body: { error: err.message }, req });
      } else {
        resolve({ calledNext: true, status: 200, body: null, req });
      }
    });
  });
}

async function runFirebaseAuthProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  await initDatabase();

  // Configure deterministic verifier simulating admin.auth().verifyIdToken()
  setIdTokenVerifierForTests(async (token) => {
    if (token === "valid_signed_in_token") {
      return {
        uid: "real_uid_ananya",
        email: "ananya@samajh.in",
        name: "Ananya Verma",
        picture: "https://example.com/ananya.png",
        firebase: { sign_in_provider: "google.com" },
      };
    }
    if (token === "valid_anonymous_guest_token") {
      return {
        uid: "anon_guest_uid_777",
        firebase: { sign_in_provider: "anonymous" },
      };
    }
    throw new Error("Firebase ID token has expired or is invalid.");
  });

  // 1. Fabricated X-Firebase-Uid header with NO valid Bearer token -> MUST be rejected with 401
  const spoofedRes = await runMiddleware(requireAuth, {
    "x-firebase-uid": "victim_uid_admin",
    "x-firebase-email": "victim@samajh.in",
  });
  assert.equal(spoofedRes.calledNext, false);
  assert.equal(spoofedRes.status, 401, "Fabricated X-Firebase-Uid without Bearer token must return 401");
  assert.match(spoofedRes.body.error, /Authentication required/i);

  // 2. Invalid / expired Bearer token -> MUST be rejected with 401
  const expiredRes = await runMiddleware(requireAuth, {
    authorization: "Bearer expired_or_forged_jwt",
  });
  assert.equal(expiredRes.calledNext, false);
  assert.equal(expiredRes.status, 401, "Invalid/expired Bearer token must return 401");
  assert.match(expiredRes.body.error, /Invalid or expired Firebase ID token/i);

  // 3. Real signed-in user with valid Bearer token -> derives uid/email/name strictly from decoded claims
  //    (even if a spoofed X-Firebase-Uid header is also sent, it is completely ignored)
  const validRes = await runMiddleware(requireAuth, {
    authorization: "Bearer valid_signed_in_token",
    "x-firebase-uid": "spoofed_attacker_uid",
    "x-firebase-email": "attacker@evil.com",
  });
  assert.equal(validRes.calledNext, true);
  assert.equal(validRes.req.user.uid, "real_uid_ananya");
  assert.equal(validRes.req.user.email, "ananya@samajh.in");
  assert.equal(validRes.req.user.displayName, "Ananya Verma");
  assert.equal(validRes.req.user.isAnonymous, false);

  // 4a. Firebase Anonymous Auth guest token verifies cleanly
  const anonTokenRes = await runMiddleware(optionalAuth, {
    authorization: "Bearer valid_anonymous_guest_token",
  });
  assert.equal(anonTokenRes.calledNext, true);
  assert.equal(anonTokenRes.req.user.uid, "anon_guest_uid_777");
  assert.equal(anonTokenRes.req.user.displayName, "Guest");
  assert.equal(anonTokenRes.req.user.isAnonymous, true);

  // 4b. Unauthenticated Guest (no Authorization header) passes optionalAuth cleanly with req.user = null
  //     AND any spoofed X-Firebase-Uid header is completely ignored
  const localGuestRes = await runMiddleware(optionalAuth, {
    "x-firebase-uid": "spoofed_uid_ignored",
  });
  assert.equal(localGuestRes.calledNext, true);
  assert.equal(localGuestRes.req.user, null, "Spoofed X-Firebase-Uid must be ignored on optionalAuth");

  setIdTokenVerifierForTests(null);

  console.log("✅ Firebase ID Token Verification smoke test passed!");
  console.log("   - Fabricated X-Firebase-Uid header rejected with 401 on protected routes & ignored on optional routes");
  console.log("   - Invalid/expired Bearer token rejected with 401");
  console.log("   - Verified signed-in token derives uid, email, and name strictly from decoded claims");
  console.log("   - Guest/anonymous sign-in (both Firebase Anonymous Auth token and unauthenticated Guest) works end to end");
}

runFirebaseAuthProof().catch((err) => {
  console.error("❌ Firebase ID Token Verification smoke test failed:", err);
  process.exit(1);
});
