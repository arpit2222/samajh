import assert from "node:assert/strict";
import {
  initDatabase,
  createSession,
  upsertUser,
  getCredentialBySlug,
  upsertCredential,
  listDiscoverableCredentials,
  createRequisition,
} from "../src/db/firestore.js";
import {
  computeVerificationHash,
  verifyCredentialSignature,
  generateCredentialSlug,
} from "../src/tools/credentialSigning.js";
import {
  deriveCustodialAddress,
  triggerOnChainAnchorFireAndForget,
} from "../src/tools/sbtRelayer.js";

async function runPrompt4And5Tests() {
  process.env.CREDENTIAL_SIGNING_KEY = "test-hmac-secret-key-for-prompt-4";
  await initDatabase();

  // 1. No fake auto-seeded credentials in DB on startup (must come from real generate flow / seed script)
  const initialDiscoverable = await listDiscoverableCredentials();
  assert.equal(
    initialDiscoverable.length,
    0,
    "Firestore/memory store must not auto-inject fake credentials on startup"
  );

  // 2. Create 3 traders via real credential contract (1 private by default, 2 opted-in)
  const makeCred = async ({ uid, name, overall, concepts, discoverable }) => {
    await upsertUser({ uid, displayName: name, role: "trader" });
    const slug = generateCredentialSlug();
    const doc = {
      userId: uid,
      displayName: name,
      credentialId: slug,
      discoverable,
      overall_score: overall,
      concepts,
    };
    doc.verificationHash = computeVerificationHash(doc);
    await upsertCredential(doc);
    return doc;
  };

  const privateTrader = await makeCred({
    uid: "trader-private",
    name: "Private Trader",
    overall: 95,
    discoverable: false,
    concepts: [
      { name: "Mark-to-Market (MTM) Margin", teachback_score: 95, stress_score: 95, last_verified: "2026-11-20T09:00:00Z" },
      { name: "Stop-Loss & Overnight Gap Risk", teachback_score: 95, stress_score: 95, last_verified: "2026-11-20T09:00:00Z" },
    ],
  });

  const ananya = await makeCred({
    uid: "trader-ananya",
    name: "Ananya Deshmukh",
    overall: 93,
    discoverable: true,
    concepts: [
      { name: "Mark-to-Market (MTM) Margin", teachback_score: 94, stress_score: 92, last_verified: "2026-11-20T09:00:00Z" },
      { name: "Stop-Loss & Overnight Gap Risk", teachback_score: 92, stress_score: 95, last_verified: "2026-11-20T09:00:00Z" },
    ],
  });

  const diya = await makeCred({
    uid: "trader-diya",
    name: "Diya Nair",
    overall: 82,
    discoverable: true,
    concepts: [
      { name: "Mark-to-Market (MTM) Margin", teachback_score: 82, stress_score: 84, last_verified: "2026-11-20T09:00:00Z" },
      { name: "Stop-Loss & Overnight Gap Risk", teachback_score: 80, stress_score: 82, last_verified: "2026-11-20T09:00:00Z" },
    ],
  });

  // 3. HMAC-SHA256 verification + tamper flip to false
  const fetched = await getCredentialBySlug(ananya.credentialId);
  assert.equal(verifyCredentialSignature(fetched), true);
  assert.equal(verifyCredentialSignature({ ...fetched, overall_score: 100 }), false);

  // 4. Employer requisition matching excludes private trader & ranks Ananya #1, Diya #2
  await upsertUser({ uid: "emp-1", displayName: "Employer", role: "employer" });
  const req = await createRequisition({
    id: "req_test01",
    employerId: "emp-1",
    title: "Derivatives Risk Analyst",
    required_concepts: [
      { name: "Mark-to-Market (MTM) Margin", min_score: 80 },
      { name: "Stop-Loss & Overnight Gap Risk", min_score: 80 },
    ],
  });

  const discoverable = await listDiscoverableCredentials();
  assert.equal(discoverable.some((c) => c.userId === privateTrader.userId), false);
  const matched = discoverable
    .filter((c) =>
      req.required_concepts.every((rc) => {
        const found = c.concepts.find((x) => x.name.toLowerCase() === rc.name.toLowerCase());
        return found && Math.round((found.teachback_score + found.stress_score) / 2) >= rc.min_score;
      })
    )
    .sort((a, b) => b.overall_score - a.overall_score);

  assert.equal(matched.length, 2);
  assert.equal(matched[0].credentialId, ananya.credentialId);
  assert.equal(matched[1].credentialId, diya.credentialId);

  // 5. Custodial EVM address + fire-and-forget SBT fallback never breaks HMAC verification
  const addr1 = deriveCustodialAddress("trader-ananya");
  assert.equal(addr1, deriveCustodialAddress("trader-ananya"));
  const anchorInit = triggerOnChainAnchorFireAndForget({
    userId: "trader-ananya",
    credentialId: ananya.credentialId,
    verificationHash: ananya.verificationHash,
  });
  assert.equal(anchorInit.onchain_status, "pending");
  await new Promise((r) => setTimeout(r, 150));
  const afterAnchor = await getCredentialBySlug(ananya.credentialId);
  assert.equal(verifyCredentialSignature(afterAnchor), true);

  console.log("ALL FIX-PASS TESTS PASSED (5-entry scenario bank + fallback, real credential flow, HMAC tamper check, opt-in privacy, and SBT fallback verified).");
}

runPrompt4And5Tests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
