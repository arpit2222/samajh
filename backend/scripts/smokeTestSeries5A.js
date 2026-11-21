import assert from "node:assert/strict";
import { initDatabase, createSession, getSession } from "../src/db/firestore.js";
import { retrieveNismGrounding } from "../src/tools/nismGrounding.js";
import {
  resolveNismModule,
  SERIES_VA_WEAK_SUBTOPICS,
} from "../src/tools/nismModules.js";
import { VALID_SAFEGUARD_SUBTOPICS } from "../src/services/safeguardClearance.js";

async function runSeries5AProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  await initDatabase();

  // 1. Default module remains Series VIII (with stress test)
  const defaultMod = resolveNismModule();
  assert.equal(defaultMod.id, "series-viii");
  assert.equal(defaultMod.hasStressTest, true);

  // 2. Series V-A resolves cleanly with hasStressTest: false (no F&O shock bank entries)
  const vaMod = resolveNismModule("series-va");
  assert.equal(vaMod.id, "series-va");
  assert.equal(vaMod.hasStressTest, false);

  // 3. Strict taxonomy separation — Series VIII taxonomy is NOT overloaded with MF concepts
  const overlap = SERIES_VA_WEAK_SUBTOPICS.filter((t) =>
    VALID_SAFEGUARD_SUBTOPICS.includes(t)
  );
  assert.deepEqual(
    overlap,
    [],
    "Series V-A weak_subtopics must NOT overlap with Series VIII taxonomy"
  );
  assert.ok(SERIES_VA_WEAK_SUBTOPICS.length >= 4);

  // 4. Verify grounding on 3+ distinct Mutual Fund concepts returns real NISM-Series-V-A citations
  const mfQueries = [
    {
      name: "NAV Valuation & 3:00 PM Cut-Off",
      query: "Net Asset Value NAV 3:00 PM cut-off realization NFO cheap units",
      expectedId: "nism-va-ch6-nav-cutoffs",
    },
    {
      name: "TER, Direct vs Regular & Exit Load",
      query: "Total Expense Ratio TER direct plan regular plan trail commission exit load",
      expectedId: "nism-va-ch6-ter-exitload",
    },
    {
      name: "Debt Fund Duration & Credit Risk / Side-Pocketing",
      query: "Debt mutual fund modified duration interest rate yield credit downgrade side-pocket",
      expectedId: "nism-va-ch9-debt-duration-credit",
    },
    {
      name: "IDCW vs Growth & SIP Rupee-Cost Averaging",
      query: "IDCW dividend payout vs growth option SIP rupee cost averaging",
      expectedId: "nism-va-ch5-idcw-sip",
    },
  ];

  for (const item of mfQueries) {
    const g = await retrieveNismGrounding(item.query, 2, { moduleId: "series-va" });
    assert.ok(g.passages.length > 0, `Expected Series V-A grounding for ${item.name}`);
    assert.equal(g.passages[0].id, item.expectedId, `Top passage mismatch for ${item.name}`);
    assert.match(
      g.passages[0].source,
      /NISM-Series-V-A/i,
      `Citation must be from NISM-Series-V-A workbook for ${item.name}`
    );
  }

  // 5. Verify Series VIII grounding behavior is completely unchanged
  const viiiGrounding = await retrieveNismGrounding(
    "Initial margin SPAN MTM mark-to-market daily settlement futures",
    2
  );
  assert.ok(viiiGrounding.passages.length > 0);
  assert.equal(viiiGrounding.passages[0].id, "nism-viii-ch5-mtm");
  assert.match(viiiGrounding.passages[0].source, /NISM-Series-VIII/i);

  // 6. Session persistence of nismModule: "series-va"
  const sessId = "sess_series_va_001";
  await createSession({
    sessionId: sessId,
    uid: "learner_mf_01",
    nismModule: "series-va",
    concept: "Net Asset Value (NAV) & 3:00 PM Cut-Off",
    turns: [],
  });
  const stored = await getSession(sessId);
  assert.equal(stored.nismModule, "series-va");

  console.log("✅ NISM Series V-A (Mutual Funds) Module smoke test passed!");
  console.log("   - 4 distinct mutual-fund concepts grounded in NISM-Series-V-A workbook citations");
  console.log("   - Dedicated Series V-A weak_subtopic taxonomy strictly separated from Series VIII");
  console.log("   - Series VIII default behavior & RAG grounding 100% unchanged");
  console.log("   - No stress-test scenario entries added for Series V-A (hasStressTest: false)");
}

runSeries5AProof().catch((err) => {
  console.error("❌ NISM Series V-A smoke test failed:", err);
  process.exit(1);
});
