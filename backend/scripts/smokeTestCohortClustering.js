import assert from "node:assert/strict";
import {
  initDatabase,
  createSession,
  createApiKeyRecord,
} from "../src/db/firestore.js";
import { generateApiKey } from "../src/tools/apiKeys.js";
import {
  runCohortClusteringBatch,
  startCohortClusteringSchedule,
  stopCohortClusteringSchedule,
} from "../src/jobs/cohortClusteringJob.js";
import partnerV1Router from "../src/routes/partnerV1.js";

function invokePartnerGet(path, apiKey) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method: "GET",
      url: path,
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      query: {},
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: statusCode, body });
        return this;
      },
      setHeader() {},
      end() {},
    };
    partnerV1Router(req, res, (err) => {
      if (err) return reject(err);
      resolve({ status: 404, body: { error: "Not found" } });
    });
  });
}

async function runCohortProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  await initDatabase();

  // Create a partner API key
  const { fullKey: plaintextKey, keyHash, keyPrefix } = generateApiKey();
  await createApiKeyRecord({
    id: "ak_cohort_partner_1",
    userId: "partner_broker_x",
    keyHash,
    keyPrefix,
    label: "Partner Cohort Insights Key",
  });

  // Seed 6 sessions for partner_broker_x WITH sensitive user identifiers attached
  const seedSessions = [
    {
      uid: "secret_uid_001",
      userEmail: "alice@example.com",
      partnerId: "partner_broker_x",
      weakSubtopic: "overnight_gap_stoploss_risk",
      examinerRationale: "Thought stop-loss guarantees exact fill price on overnight gap-down.",
    },
    {
      uid: "secret_uid_002",
      userEmail: "bob@example.com",
      partnerId: "partner_broker_x",
      weakSubtopic: "overnight_gap_stoploss_risk",
      examinerRationale: "Confused trigger price with limit execution during opening gap.",
    },
    {
      uid: "secret_uid_003",
      userEmail: "charlie@example.com",
      partnerId: "partner_broker_x",
      weakSubtopic: "overnight_gap_stoploss_risk",
      examinerRationale: "Ignored overnight slippage risk in futures positions.",
    },
    {
      uid: "secret_uid_004",
      userEmail: "dave@example.com",
      partnerId: "partner_broker_x",
      weakSubtopic: "circuit_breaker_margin_risk",
      examinerRationale: "Underestimated forced square-off during lower circuit MTM shortfall.",
    },
    {
      uid: "secret_uid_005",
      userEmail: "eve@example.com",
      partnerId: "partner_broker_x",
      weakSubtopic: "circuit_breaker_margin_risk",
      examinerRationale: "Assumed MTM margin calls wait until monthly expiry.",
    },
    {
      uid: "secret_uid_006",
      userEmail: "frank@example.com",
      partnerId: "partner_broker_x",
      weakSubtopic: "event_volatility_option_writing_risk",
      examinerRationale: "Ignored vega expansion on election day short straddle.",
    },
  ];

  for (const s of seedSessions) {
    await createSession(s);
  }

  // 1. Confirm GET BEFORE batch job does NOT trigger clustering per-request
  const beforeBatch = await invokePartnerGet("/cohort-insights/partner_broker_x", plaintextKey);
  assert.equal(beforeBatch.status, 200);
  assert.equal(
    beforeBatch.body.clusters.length,
    0,
    "Endpoint must NOT trigger clustering per-request"
  );

  // 2. Run the scheduled batch job
  const batchRes = await runCohortClusteringBatch({ partnerId: "partner_broker_x" });
  assert.equal(batchRes.cohorts_processed, 1);
  assert.equal(batchRes.total_sessions_clustered, 6);

  // 3. Query GET /api/partner/v1/cohort-insights/partner_broker_x
  const afterBatch = await invokePartnerGet("/cohort-insights/partner_broker_x", plaintextKey);
  assert.equal(afterBatch.status, 200);
  assert.equal(afterBatch.body.aggregate_only, true);
  assert.equal(afterBatch.body.total_sessions_analyzed, 6);
  assert.equal(afterBatch.body.clusters.length, 3);
  assert.equal(afterBatch.body.clusters[0].primary_subtopic, "overnight_gap_stoploss_risk");
  assert.equal(afterBatch.body.clusters[0].session_count, 3);
  assert.equal(afterBatch.body.clusters[0].pct_of_cohort, 50);
  assert.equal(afterBatch.body.clusters[1].primary_subtopic, "circuit_breaker_margin_risk");
  assert.equal(afterBatch.body.clusters[1].session_count, 2);

  // 4. Verify ZERO individual-level / user-identifiable data in response
  const rawJson = JSON.stringify(afterBatch.body);
  assert.ok(!rawJson.includes("secret_uid_"), "Must never leak uid");
  assert.ok(!rawJson.includes("@example.com"), "Must never leak email");
  assert.ok(!rawJson.includes("sessionId"), "Must never leak sessionId");

  // 5. Verify schedule registration & cleanup works cleanly
  const timer = startCohortClusteringSchedule({ intervalMs: 60_000 });
  assert.ok(timer);
  stopCohortClusteringSchedule();

  console.log("✅ Cohort Weak-Topic Clustering smoke test passed!");
  console.log("   - GET /api/partner/v1/cohort-insights/:partner_id never triggers per-request clustering");
  console.log("   - Scheduled batch job produces ranked aggregate misconception clusters");
  console.log("   - Zero individual user identifiers (uid, email, sessionId) in response");
}

runCohortProof().catch((err) => {
  console.error("❌ Cohort Weak-Topic Clustering smoke test failed:", err);
  process.exit(1);
});
