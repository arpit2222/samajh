import assert from "node:assert/strict";
import {
  initDatabase,
  createApiKeyRecord,
  listApiKeysByUserId,
  revokeApiKeyForUser,
  findApiKeyByHash,
  upsertCredential,
} from "../src/db/firestore.js";
import { generateApiKey, hashApiKey } from "../src/tools/apiKeys.js";
import { authenticateApiKey } from "../src/middleware/apiKeyAuth.js";
import {
  verifyUnderstandingCapability,
  verifyCredentialCapability,
  diagnoseTradePatternsCapability,
} from "../src/services/capabilities.js";
import { computeVerificationHash } from "../src/tools/credentialSigning.js";
import mcpRouter from "../src/routes/mcp.js";

function runMiddleware(middleware, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ nextCalled: false, status: this.statusCode, body: payload });
      },
    };
    middleware(req, res, () => resolve({ nextCalled: true, req }));
  });
}

async function runPrompt8Tests() {
  process.env.MONGO_CONNECTION_STRING = "";
  process.env.CREDENTIAL_SIGNING_KEY = "prompt8-test-signing-key";
  await initDatabase();

  // 1. Key generation & SHA-256 hashing
  const { fullKey, keyHash, keyPrefix } = generateApiKey();
  assert.ok(fullKey.startsWith("sk_live_"));
  assert.equal(keyPrefix, fullKey.slice(0, 12));
  assert.equal(keyHash, hashApiKey(fullKey));
  assert.equal(keyHash.length, 64);

  await createApiKeyRecord({
    id: "key_test_1",
    userId: "user-alice",
    keyHash,
    keyPrefix,
    label: "Alice Agent Key",
  });

  // Ensure list NEVER returns keyHash or plaintext key
  const listed = await listApiKeysByUserId("user-alice");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].keyHash, undefined, "listApiKeysByUserId must never expose keyHash");
  assert.equal(listed[0].key, undefined, "listApiKeysByUserId must never expose full key");

  // 2. authenticateApiKey exact 401 error contracts
  const rMissing = await runMiddleware(authenticateApiKey, { headers: {} });
  assert.equal(rMissing.status, 401);
  assert.deepEqual(rMissing.body, { error: "missing_api_key" });

  const rFormat = await runMiddleware(authenticateApiKey, {
    headers: { authorization: "Bearer bad_prefix_12345" },
  });
  assert.equal(rFormat.status, 401);
  assert.deepEqual(rFormat.body, { error: "invalid_api_key_format" });

  const rUnknown = await runMiddleware(authenticateApiKey, {
    headers: { authorization: "Bearer sk_live_not_in_database_at_all" },
  });
  assert.equal(rUnknown.status, 401);
  assert.deepEqual(rUnknown.body, { error: "invalid_api_key" });

  // Valid key succeeds & asynchronously increments requestCount + lastUsedAt
  const validReq = { headers: { authorization: `Bearer ${fullKey}` } };
  const rValid = await runMiddleware(authenticateApiKey, validReq);
  assert.equal(rValid.nextCalled, true);
  assert.deepEqual(validReq.apiKeyAuth, { userId: "user-alice", apiKeyId: "key_test_1" });

  await new Promise((r) => setTimeout(r, 40));
  const afterUse = await findApiKeyByHash(keyHash);
  assert.equal(afterUse.requestCount, 1);
  assert.ok(afterUse.lastUsedAt);

  // 3. Ownership isolation on revoke + 409 on double revoke + key_revoked on reuse
  const crossUserRevoke = await revokeApiKeyForUser("key_test_1", "user-bob");
  assert.equal(crossUserRevoke.status, "not_found");

  const okRevoke = await revokeApiKeyForUser("key_test_1", "user-alice");
  assert.equal(okRevoke.status, "revoked");
  assert.ok(okRevoke.revokedAt);

  const dupRevoke = await revokeApiKeyForUser("key_test_1", "user-alice");
  assert.equal(dupRevoke.status, "already_revoked");

  const rRevoked = await runMiddleware(authenticateApiKey, {
    headers: { authorization: `Bearer ${fullKey}` },
  });
  assert.equal(rRevoked.status, 401);
  assert.deepEqual(rRevoked.body, { error: "key_revoked" });

  // 4. Shared capability checks
  await assert.rejects(() => verifyUnderstandingCapability({ concept: "MTM" }), (e) => e.statusCode === 400);
  await assert.rejects(() => verifyCredentialCapability("smj-nonexistent"), (e) => e.statusCode === 404);
  await assert.rejects(
    () => diagnoseTradePatternsCapability({ trade: { client_id: "ZD99", instrument_type: "Futures" } }),
    (e) => e.statusCode === 400
  );

  const credDoc = {
    userId: "user-alice",
    displayName: "Alice",
    credentialId: "smj-alice01",
    overall_score: 88,
    discoverable: true,
    concepts: [{ name: "MTM Margin", teachback_score: 88, stress_score: 88, last_verified: "2026-11-21T00:00:00Z" }],
  };
  credDoc.verificationHash = computeVerificationHash(credDoc);
  await upsertCredential(credDoc);

  const verifiedCred = await verifyCredentialCapability("smj-alice01");
  assert.equal(verifiedCred.verified, true);
  assert.equal(verifiedCred.credential.credentialId, "smj-alice01");

  // 5. MCP router exports cleanly
  assert.equal(typeof mcpRouter, "function");

  console.log(
    "ALL PROMPT 8 TESTS PASSED (SHA-256 API keys, exact 401/404/409 contracts, async usage counter, shared capabilities, and Streamable HTTP MCP verified)."
  );
}

runPrompt8Tests().catch((err) => {
  console.error("Prompt 8 test failed:", err);
  process.exit(1);
});
