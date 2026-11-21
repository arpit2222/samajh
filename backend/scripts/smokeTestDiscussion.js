import assert from "node:assert/strict";
import { initDatabase, createSession } from "../src/db/firestore.js";
import discussionRouter from "../src/routes/discussion.js";

function runDiscussionRoute({ method = "GET", path, headers = {}, body = {} }) {
  return new Promise((resolve, reject) => {
    const [pathname, queryStr = ""] = path.split("?");
    const query = Object.fromEntries(new URLSearchParams(queryStr));
    let statusCode = 200;

    const req = {
      method,
      url: pathname + (queryStr ? `?${queryStr}` : ""),
      headers,
      query,
      body,
    };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
      setHeader() {},
      end() {},
    };

    discussionRouter(req, res, (err) => {
      if (err) return reject(err);
      resolve({ status: 404, body: { error: "Not found" } });
    });
  });
}

async function runDiscussionProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  await initDatabase();

  const subtopic = "circuit_breaker_margin_risk";
  const unattemptedUid = "trader_unattempted_001";
  const attemptedUid = "trader_attempted_002";

  // 1. User who has NOT attempted "circuit_breaker_margin_risk" is blocked with 403 locked
  const lockedGet = await runDiscussionRoute({
    method: "GET",
    path: `/${subtopic}?page=1&limit=10`,
    headers: { "x-firebase-uid": unattemptedUid },
  });
  assert.equal(lockedGet.status, 403, "Unattempted user must receive 403 on GET");
  assert.equal(lockedGet.body.locked, true, "Response must indicate locked: true");

  const lockedPost = await runDiscussionRoute({
    method: "POST",
    path: `/${subtopic}/post`,
    headers: { "x-firebase-uid": unattemptedUid },
    body: { text: "Trying to post before attempting the subtopic verification." },
  });
  assert.equal(lockedPost.status, 403, "Unattempted user must receive 403 on POST");

  // 2. Seed an attempted session for attemptedUid on circuit_breaker_margin_risk
  await createSession({
    uid: attemptedUid,
    concept: "Circuit Breaker & MTM Margin Calls",
    stressScenarioTag: subtopic,
    weakSubtopic: "margin_call_mtm",
  });

  const unlockedGet = await runDiscussionRoute({
    method: "GET",
    path: `/${subtopic}?page=1&limit=10`,
    headers: { "x-firebase-uid": attemptedUid },
  });
  assert.equal(unlockedGet.status, 200, "Attempted user must unlock the circle with 200");
  assert.deepEqual(unlockedGet.body.posts, []);

  // 3. Reject stock ticker with 400
  const tickerRes = await runDiscussionRoute({
    method: "POST",
    path: `/${subtopic}/post`,
    headers: { "x-firebase-uid": attemptedUid },
    body: {
      text: "I got trapped in INDUSINDBK futures when the lower circuit froze bids.",
    },
  });
  assert.equal(tickerRes.status, 400, "Post containing stock ticker must be rejected with 400");

  // 4. Reject F&O contract symbol with 400
  const contractRes = await runDiscussionRoute({
    method: "POST",
    path: `/${subtopic}/post`,
    headers: { "x-firebase-uid": attemptedUid },
    body: {
      text: "Shorting NIFTY 24000 CE before an event can trigger sudden margin spikes.",
    },
  });
  assert.equal(contractRes.status, 400, "Post containing F&O contract symbol must be rejected with 400");

  // 5. Reject ₹ amount with 400
  const rupeeRes = await runDiscussionRoute({
    method: "POST",
    path: `/${subtopic}/post`,
    headers: { "x-firebase-uid": attemptedUid },
    body: {
      text: "My mark-to-market shortfall crossed ₹45,000 before the broker squared off.",
    },
  });
  assert.equal(rupeeRes.status, 400, "Post containing ₹ amount must be rejected with 400");

  // 6. Reject image/file uploads in v1 with 400
  const imageRes = await runDiscussionRoute({
    method: "POST",
    path: `/${subtopic}/post`,
    headers: { "x-firebase-uid": attemptedUid },
    body: {
      text: "Here is my pattern diagram explaining margin waterfall.",
      image: "data:image/png;base64,iVBORw0KGgo=",
    },
  });
  assert.equal(imageRes.status, 400, "Image/file upload must be rejected with 400 in v1");

  // Confirm none of the rejected posts were stored
  const afterRejections = await runDiscussionRoute({
    method: "GET",
    path: `/${subtopic}?page=1&limit=10`,
    headers: { "x-firebase-uid": attemptedUid },
  });
  assert.equal(afterRejections.body.total_posts, 0, "Rejected posts must never be stored");

  // 7. Accept clean pattern-level post
  const validRes = await runDiscussionRoute({
    method: "POST",
    path: `/${subtopic}/post`,
    headers: { "x-firebase-uid": attemptedUid },
    body: {
      text: "The key realization for me was that during a lower circuit halt, limit orders cannot fill while MTM obligations still accumulate against collateral.",
    },
  });
  assert.equal(validRes.status, 201, "Valid pattern-level post must return 201");
  assert.equal(validRes.body.post.author_label, "Anonymous Learner");
  assert.equal(validRes.body.post.flagged, false);
  const postId = validRes.body.post.id;

  // 8. Report post -> sets flagged: true, report_count: 1, does NOT auto-delete
  const reportRes = await runDiscussionRoute({
    method: "POST",
    path: `/${subtopic}/posts/${postId}/report`,
    headers: { "x-firebase-uid": attemptedUid },
  });
  assert.equal(reportRes.status, 200, "Report endpoint must return 200");
  assert.equal(reportRes.body.post.flagged, true, "Reported post must have flagged: true");
  assert.equal(reportRes.body.post.report_count, 1, "report_count must increment to 1");
  assert.ok(reportRes.body.post.flagged_at, "flagged_at timestamp must be set");

  // Verify post still exists in GET (not auto-deleted) and visibly carries flagged: true
  const finalGet = await runDiscussionRoute({
    method: "GET",
    path: `/${subtopic}?page=1&limit=10`,
    headers: { "x-firebase-uid": attemptedUid },
  });
  assert.equal(finalGet.status, 200);
  assert.equal(finalGet.body.total_posts, 1, "Flagged post must NOT be auto-deleted");
  assert.equal(finalGet.body.posts[0].id, postId);
  assert.equal(finalGet.body.posts[0].flagged, true);

  console.log("✅ Discussion Circles smoke test passed!");
  console.log("   - Unattempted user gated with 403 { locked: true }");
  console.log("   - Stock ticker, F&O contract, ₹ figure, and image upload rejected with 400 (0 stored)");
  console.log("   - Valid pattern-level post stored anonymously and returned via paginated GET");
  console.log("   - Report button flags post (flagged: true, report_count: 1) without auto-deleting");
}

runDiscussionProof().catch((err) => {
  console.error("❌ Discussion Circles smoke test failed:", err);
  process.exit(1);
});
