import assert from "node:assert/strict";
import { initDatabase, createSession, getSession } from "../src/db/firestore.js";
import { retrieveNismGrounding } from "../src/tools/nismGrounding.js";
import {
  resolveNismModule,
  SERIES_I_WEAK_SUBTOPICS,
  SERIES_VA_WEAK_SUBTOPICS,
} from "../src/tools/nismModules.js";
import { VALID_SAFEGUARD_SUBTOPICS } from "../src/services/safeguardClearance.js";

async function runSeries1Proof() {
  process.env.MONGO_CONNECTION_STRING = "";
  await initDatabase();

  // 1. Default module remains Series VIII
  const defaultMod = resolveNismModule();
  assert.equal(defaultMod.id, "series-viii");
  assert.equal(defaultMod.hasStressTest, true);

  // 2. Series I resolves cleanly
  const iMod = resolveNismModule("series-i");
  assert.equal(iMod.id, "series-i");
  assert.equal(iMod.hasStressTest, false);

  // 3. Strict taxonomy separation — zero overlap with Series VIII or Series V-A
  const overlapVIII = SERIES_I_WEAK_SUBTOPICS.filter((t) =>
    VALID_SAFEGUARD_SUBTOPICS.includes(t)
  );
  const overlapVA = SERIES_I_WEAK_SUBTOPICS.filter((t) =>
    SERIES_VA_WEAK_SUBTOPICS.includes(t)
  );
  assert.deepEqual(overlapVIII, [], "Series I taxonomy must NOT overlap Series VIII");
  assert.deepEqual(overlapVA, [], "Series I taxonomy must NOT overlap Series V-A");
  assert.ok(SERIES_I_WEAK_SUBTOPICS.length >= 4);

  // 4. Verify grounding on 4 distinct Currency Derivatives concepts returns real NISM-Series-I citations
  const fxQueries = [
    {
      name: "Currency Futures Pricing & Interest Rate Parity",
      query: "USDINR currency futures pricing covered interest rate parity forward premium lot size",
      expectedId: "nism-i-ch3-futures-pricing-irp",
    },
    {
      name: "FBIL Reference Rate & Cash Settlement",
      query: "FBIL RBI reference rate cash settlement in INR 12:30 PM physical delivery expiry",
      expectedId: "nism-i-ch2-fbil-settlement",
    },
    {
      name: "Exporter/Importer Hedging & Basis Risk",
      query: "Indian exporter USD receivable hedge short USDINR importer payable basis risk",
      expectedId: "nism-i-ch5-hedging-basis",
    },
    {
      name: "European-Style Currency Options",
      query: "USDINR currency option European style auto-exercised premium quotation writer margin",
      expectedId: "nism-i-ch4-currency-options",
    },
  ];

  for (const item of fxQueries) {
    const g = await retrieveNismGrounding(item.query, 2, { moduleId: "series-i" });
    assert.ok(g.passages.length > 0, `Expected Series I grounding for ${item.name}`);
    assert.equal(g.passages[0].id, item.expectedId, `Top passage mismatch for ${item.name}`);
    assert.match(
      g.passages[0].source,
      /NISM-Series-I:/i,
      `Citation must be from NISM-Series-I workbook for ${item.name}`
    );
  }

  // 5. Series VIII grounding behavior completely unchanged
  const viiiGrounding = await retrieveNismGrounding(
    "Initial margin SPAN MTM mark-to-market daily settlement futures",
    2
  );
  assert.equal(viiiGrounding.passages[0].id, "nism-viii-ch5-mtm");
  assert.match(viiiGrounding.passages[0].source, /NISM-Series-VIII/i);

  // 6. Session persistence of nismModule: "series-i"
  const sessId = "sess_series_i_001";
  await createSession({
    sessionId: sessId,
    uid: "learner_fx_01",
    nismModule: "series-i",
    concept: "FBIL Reference Rate & INR Cash Settlement",
    turns: [],
  });
  const stored = await getSession(sessId);
  assert.equal(stored.nismModule, "series-i");

  console.log("✅ NISM Series I (Currency Derivatives) Module smoke test passed!");
  console.log("   - 4 distinct currency-derivatives concepts grounded in NISM-Series-I workbook citations");
  console.log("   - Dedicated Series I weak_subtopic taxonomy strictly separated from Series VIII & V-A");
  console.log("   - Series VIII default behavior & RAG grounding 100% unchanged");
}

runSeries1Proof().catch((err) => {
  console.error("❌ NISM Series I smoke test failed:", err);
  process.exit(1);
});
