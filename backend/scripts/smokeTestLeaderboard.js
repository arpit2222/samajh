import assert from "node:assert/strict";
import express from "express";
import {
  initDatabase,
  createGauntletRunRecord,
  upsertCredential,
  updateCredentialDiscoverable,
} from "../src/db/firestore.js";
import { computeVerificationHash } from "../src/tools/credentialSigning.js";
import gauntletRouter from "../src/routes/gauntlet.js";

function runRouteGet(router, urlPath) {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use("/api/gauntlet", router);
    const req = {
      method: "GET",
      url: urlPath,
      headers: {},
    };
    // Lightweight mock request/response through Express router directly (no TCP port needed)
    let statusCode = 200;
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
    const [pathname, queryStr = ""] = urlPath.replace(/^\/api\/gauntlet/, "").split("?");
    const query = Object.fromEntries(new URLSearchParams(queryStr));
    req.url = pathname + (queryStr ? `?${queryStr}` : "");
    req.query = query;
    router(req, res, (err) => (err ? reject(err) : resolve({ status: 404, body: null })));
  });
}

async function runLeaderboardProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  process.env.CREDENTIAL_SIGNING_KEY = "test-leaderboard-signing-key";
  await initDatabase();

  // Seed 4 gauntlet runs (including a guest run + a score tie at 88!)
  // 1. Guest run (score 91) -> must appear anonymously by default
  await createGauntletRunRecord({
    id: "gr_guest_1",
    userId: "guest_anon_9911",
    isGuest: true,
    composite_score: 91,
    scenario_set_id: "nism-viii-gauntlet",
    total_scenarios: 4,
    completed_at: "2026-11-22T00:05:00.000Z",
  });

  // 2. Signed-in trader A (score 88, EARLIER timestamp, opted-in discoverable: true)
  const credA = {
    userId: "uid-trader-ananya",
    displayName: "Ananya Deshmukh",
    credentialId: "smj-ananya88",
    discoverable: true,
    overall_score: 88,
    concepts: [],
  };
  credA.verificationHash = computeVerificationHash(credA);
  await upsertCredential(credA);
  await createGauntletRunRecord({
    id: "gr_ananya_tie_early",
    userId: "uid-trader-ananya",
    isGuest: false,
    composite_score: 88,
    scenario_set_id: "nism-viii-gauntlet",
    total_scenarios: 4,
    completed_at: "2026-11-22T00:01:00.000Z",
  });

  // 3. Signed-in trader B (score 88, LATER timestamp, default discoverable: false)
  const credB = {
    userId: "uid-trader-rohan",
    displayName: "Rohan Kulkarni",
    credentialId: "smj-rohan88",
    discoverable: false,
    overall_score: 88,
    concepts: [],
  };
  credB.verificationHash = computeVerificationHash(credB);
  await upsertCredential(credB);
  await createGauntletRunRecord({
    id: "gr_rohan_tie_late",
    userId: "uid-trader-rohan",
    isGuest: false,
    composite_score: 88,
    scenario_set_id: "nism-viii-gauntlet",
    total_scenarios: 4,
    completed_at: "2026-11-22T00:03:00.000Z",
  });

  // 4. Signed-in trader C (score 76, opted-in)
  const credC = {
    userId: "uid-trader-diya",
    displayName: "Diya Nair",
    credentialId: "smj-diya76",
    discoverable: true,
    overall_score: 76,
    concepts: [],
  };
  credC.verificationHash = computeVerificationHash(credC);
  await upsertCredential(credC);
  await createGauntletRunRecord({
    id: "gr_diya_4",
    userId: "uid-trader-diya",
    isGuest: false,
    composite_score: 76,
    scenario_set_id: "nism-viii-gauntlet",
    total_scenarios: 4,
    completed_at: "2026-11-22T00:02:00.000Z",
  });

  // Check leaderboard ordering, tie-break, anonymity, and zero userId leakage
  const res1 = await runRouteGet(
    gauntletRouter,
    "/api/gauntlet/leaderboard?scenario_set_id=nism-viii-gauntlet&limit=10"
  );
  assert.equal(res1.status, 200);
  const lb = res1.body.leaderboard;
  assert.equal(lb.length, 4);

  // Rank #1: Guest (91) -> Anonymous Learner, no userId exposed
  assert.equal(lb[0].rank, 1);
  assert.equal(lb[0].composite_score, 91);
  assert.equal(lb[0].display_name, "Anonymous Learner");
  assert.equal(lb[0].opted_in, false);
  assert.equal(lb[0].userId, undefined);

  // Rank #2 vs #3: Both scored 88 -> Ananya (00:01) MUST beat Rohan (00:03)
  assert.equal(lb[1].run_id, "gr_ananya_tie_early");
  assert.equal(lb[1].display_name, "Ananya Deshmukh");
  assert.equal(lb[1].opted_in, true);
  assert.equal(lb[1].credential_id, "smj-ananya88");

  assert.equal(lb[2].run_id, "gr_rohan_tie_late");
  assert.equal(lb[2].display_name, "Anonymous Learner", "Non-opted-in user must stay anonymous");
  assert.equal(lb[2].opted_in, false);
  assert.equal(lb[2].credential_id, null);

  // Rank #4: Diya (76)
  assert.equal(lb[3].display_name, "Diya Nair");

  // Confirm raw userIds never appear anywhere in serialized JSON response
  const rawJson = JSON.stringify(res1.body);
  assert.equal(rawJson.includes("uid-trader-"), false, "Raw userId must never appear in response");
  assert.equal(rawJson.includes("guest_anon_9911"), false, "Raw guest ID must never appear in response");

  // Opt Ananya OUT -> must immediately become Anonymous Learner!
  await updateCredentialDiscoverable("uid-trader-ananya", false);
  // Opt Rohan IN -> must immediately show Rohan Kulkarni!
  await updateCredentialDiscoverable("uid-trader-rohan", true);

  const res2 = await runRouteGet(
    gauntletRouter,
    "/api/gauntlet/leaderboard?scenario_set_id=nism-viii-gauntlet"
  );
  assert.equal(res2.body.leaderboard[1].display_name, "Anonymous Learner");
  assert.equal(res2.body.leaderboard[1].opted_in, false);
  assert.equal(res2.body.leaderboard[2].display_name, "Rohan Kulkarni");
  assert.equal(res2.body.leaderboard[2].opted_in, true);

  console.log(
    "ALL LEADERBOARD TESTS PASSED (guest anonymity, opt-in/opt-out privacy toggle, 4-run tie-break sorting, and zero userId leakage verified)."
  );
}

runLeaderboardProof().catch((err) => {
  console.error("Leaderboard test failed:", err);
  process.exit(1);
});
