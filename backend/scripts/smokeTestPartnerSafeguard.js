import assert from "node:assert/strict";
import express from "express";
import {
  initDatabase,
  createApiKeyRecord,
} from "../src/db/firestore.js";
import { generateApiKey } from "../src/tools/apiKeys.js";
import partnerV1Router from "../src/routes/partnerV1.js";
import tradeProfileRouter from "../src/routes/tradeProfile.js";
import teachbackRouter from "../src/routes/teachback.js";
import examineRouter from "../src/routes/examine.js";
import stresstestRouter from "../src/routes/stresstest.js";
import { verifyCredentialCapability } from "../src/services/capabilities.js";

/**
 * End-to-end proof script for B2B Broker Safeguard Webhook + Clearance API:
 *   1. PII / ₹ currency field in POST /api/partner/v1/risk-flag -> rejected 400
 *   2. Partner trying to spoof cleared=true -> rejected 400
 *   3. Valid risk-flag -> 201 cleared:false -> clearance-status returns cleared:false
 *   4. Linked user passes Teach-Back + Examiner + Stress-Test (50/50 Combined Mastery)
 *      via the real ADK SequentialAgent pipeline -> clearance-status flips to cleared:true
 *      with a real HMAC-SHA256 verified credential_id!
 */
async function runPartnerSafeguardProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  process.env.GEMINI_API_KEY = "test-key-partner-safeguard";
  process.env.GEMINI_MODEL = "gemini-4-hydrogen";
  process.env.CREDENTIAL_SIGNING_KEY = "test-signing-key-partner-safeguard";
  process.env.DISABLE_ADK_REMOTE_CODE_EXEC = "1";

  await initDatabase();

  // Create a real API key for our test broker partner
  const { fullKey, keyHash, keyPrefix } = generateApiKey();
  await createApiKeyRecord({
    id: "key_broker_demo",
    userId: "broker-partner-groww-demo",
    keyHash,
    keyPrefix,
    label: "Broker Safeguard Key",
  });

  // Mount the real Express routers on an ephemeral local port
  const app = express();
  app.use(express.json());
  app.use("/api/partner/v1", partnerV1Router);
  app.use("/api/trade-profile", tradeProfileRouter);
  app.use("/api/teachback", teachbackRouter);
  app.use("/api/examine", examineRouter);
  app.use("/api/stresstest", stresstestRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });

  // Mock Gemini REST responses deterministically for the Teach-Back -> Examiner -> Stress-Test loop
  const originalFetch = global.fetch;
  const geminiResponses = [
    { reply: "Wait, during a 10% lower-circuit halt I can just place a market order to exit right?" },
    { reply: "Got it, exits freeze. What happens to my margin requirement when trading resumes?" },
    { reply: "So the broker can square me off right on reopen?" },
    {
      score: 84,
      weak_subtopic: "circuit_breaker_margin_risk",
      rationale: "Learner accurately explained frozen exits during halts and margin spike on reopen.",
    },
    {
      stress_score: 88,
      feedback: "Strong causal reasoning matching the 23 Mar 2020 45-minute circuit halt mechanics.",
    },
  ];
  let geminiIdx = 0;

  global.fetch = async (url, options) => {
    if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
      const payload = geminiResponses[geminiIdx++];
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
          };
        },
      };
    }
    return originalFetch(url, options);
  };

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const authHeaders = {
    Authorization: `Bearer ${fullKey}`,
    "Content-Type": "application/json",
  };

  try {
    // 0. Unauthenticated request rejected with 401 via shared authenticateApiKey
    const unauth = await originalFetch(`${baseUrl}/api/partner/v1/risk-flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        external_user_ref: "brk_hash_001",
        flagged_subtopic: "circuit_breaker_margin_risk",
      }),
    });
    assert.equal(unauth.status, 401);

    // 1. PII / ₹ amount payload rejected with 400
    const piiRes1 = await originalFetch(`${baseUrl}/api/partner/v1/risk-flag`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        external_user_ref: "brk_hash_001",
        flagged_subtopic: "circuit_breaker_margin_risk",
        loss_amount: "₹75000",
      }),
    });
    assert.equal(piiRes1.status, 400, "Payload with ₹ amount must be rejected with 400");

    const piiRes2 = await originalFetch(`${baseUrl}/api/partner/v1/risk-flag`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        external_user_ref: "ABCDE1234F",
        flagged_subtopic: "circuit_breaker_margin_risk",
      }),
    });
    assert.equal(piiRes2.status, 400, "Payload with PAN-shaped ref must be rejected with 400");

    // 2. Partner attempting to set cleared:true directly rejected with 400
    const spoofRes = await originalFetch(`${baseUrl}/api/partner/v1/risk-flag`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        external_user_ref: "brk_hash_001",
        flagged_subtopic: "circuit_breaker_margin_risk",
        cleared: true,
      }),
    });
    assert.equal(spoofRes.status, 400, "Partner must never be allowed to set cleared=true");

    // 3. Valid risk-flag accepted -> 201 { cleared: false }
    const extRef = "brk_anon_trader_98a7f";
    const flagRes = await originalFetch(`${baseUrl}/api/partner/v1/risk-flag`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        external_user_ref: extRef,
        flagged_subtopic: "circuit_breaker_margin_risk",
        flagged_at: "2026-11-22T00:00:00.000Z",
      }),
    });
    assert.equal(flagRes.status, 201);
    const flagData = await flagRes.json();
    assert.equal(flagData.cleared, false);

    // Poll clearance-status before user completes verification -> cleared: false
    const statusBeforeRes = await originalFetch(
      `${baseUrl}/api/partner/v1/clearance-status/${extRef}`,
      { headers: { Authorization: `Bearer ${fullKey}` } }
    );
    assert.equal(statusBeforeRes.status, 200);
    const statusBefore = await statusBeforeRes.json();
    assert.equal(statusBefore.cleared, false);
    assert.equal(statusBefore.cleared_at, null);
    assert.equal(statusBefore.credential_id, null);

    // 4. Linked user completes Teach-Back + Examiner + Stress-Test on the flagged subtopic
    const startRes = await originalFetch(`${baseUrl}/api/trade-profile/start-teachback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concept_tag: "circuit_breaker_margin_risk",
        external_user_ref: extRef,
      }),
    });
    assert.equal(startRes.status, 200);
    const { sessionId } = await startRes.json();

    // 3-turn Teach-Back
    await originalFetch(`${baseUrl}/api/teachback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    for (let i = 1; i <= 3; i++) {
      await originalFetch(`${baseUrl}/api/teachback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          userText: `Turn ${i}: During a circuit halt you cannot exit, margin stays marked at LTP, and spikes on reopen.`,
        }),
      });
    }

    // Examine (examinerScore = 84)
    const examRes = await originalFetch(`${baseUrl}/api/examine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    assert.equal(examRes.status, 200);

    // Stress-Test (stressScore = 88 -> 50/50 Combined Mastery = 86 >= 70 -> clears flag!)
    const stressRes = await originalFetch(`${baseUrl}/api/stresstest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        user_reasoning:
          "During the 45-minute circuit halt no exit orders can fill while margin stays marked at last traded price, causing a sudden margin spike on reopen.",
      }),
    });
    assert.equal(stressRes.status, 200);
    const stressData = await stressRes.json();
    assert.equal(stressData.combined_mastery_score, 86);
    assert.equal(stressData.safeguard_cleared, true);
    assert.ok(stressData.cleared_credential_id?.startsWith("smj-"));

    // 5. Partner polls GET /api/partner/v1/clearance-status/:external_user_ref -> cleared: true!
    const statusAfterRes = await originalFetch(
      `${baseUrl}/api/partner/v1/clearance-status/${extRef}`,
      { headers: { Authorization: `Bearer ${fullKey}` } }
    );
    assert.equal(statusAfterRes.status, 200);
    const statusAfter = await statusAfterRes.json();
    assert.equal(statusAfter.cleared, true);
    assert.ok(statusAfter.cleared_at);
    assert.equal(statusAfter.credential_id, stressData.cleared_credential_id);

    // Verify that the clearing credential_id independently passes HMAC-SHA256 verification
    const credCheck = await verifyCredentialCapability(statusAfter.credential_id);
    assert.equal(credCheck.verified, true);

    console.log(
      `PARTNER SAFEGUARD END-TO-END PROOF PASSED (PII rejected 400, spoof rejected 400, risk-flag -> 50/50 mastery ${stressData.combined_mastery_score} -> cleared:true with verified credential ${statusAfter.credential_id}).`
    );
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
}

runPartnerSafeguardProof().catch((err) => {
  console.error("Partner safeguard test failed:", err);
  process.exit(1);
});
