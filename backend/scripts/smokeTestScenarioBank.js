import assert from "node:assert/strict";
import { initDatabase, listScenarios } from "../src/db/firestore.js";
import { retrieveScenario } from "../src/agents/stressTestAgent.js";
import { VERIFIED_SCENARIO_COUNT_MIN } from "../src/data/scenarioSources.js";

async function runScenarioBankProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  await initDatabase();

  const bank = await listScenarios();
  assert.ok(
    bank.length >= VERIFIED_SCENARIO_COUNT_MIN,
    `Expected at least ${VERIFIED_SCENARIO_COUNT_MIN} scenarios, got ${bank.length}`
  );

  const ids = new Set();
  const realEvents = bank.filter((s) => s.concept_tag !== "general_market_risk");
  const fallback = bank.find((s) => s.concept_tag === "general_market_risk");

  assert.ok(fallback, "general_market_risk fallback entry must exist");
  assert.ok(realEvents.length >= 25, `Expected 25+ real dated events, got ${realEvents.length}`);

  for (const s of realEvents) {
    assert.ok(s.id && !ids.has(s.id), `Duplicate or missing scenario id: ${s.id}`);
    ids.add(s.id);
    assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/, `Invalid ISO date on ${s.id}: ${s.date}`);
    assert.ok(s.source && s.source.length > 5, `Missing cited source on ${s.id}`);
    assert.ok(s.what_happened && s.what_happened.length > 30, `Missing what_happened on ${s.id}`);
    assert.ok(
      s.correct_reasoning_chain && s.correct_reasoning_chain.length > 30,
      `Missing correct_reasoning_chain on ${s.id}`
    );

    // Validate StressTest.jsx inline SVG shock_chart shape
    assert.ok(s.shock_chart, `Missing shock_chart on ${s.id}`);
    assert.ok(s.shock_chart.instrument, `Missing shock_chart.instrument on ${s.id}`);
    assert.ok(s.shock_chart.headline_stat, `Missing shock_chart.headline_stat on ${s.id}`);
    assert.ok(
      Array.isArray(s.shock_chart.points) && s.shock_chart.points.length >= 2,
      `Invalid shock_chart.points on ${s.id}`
    );
    assert.ok(
      Number.isFinite(s.shock_chart.threshold_y),
      `Invalid shock_chart.threshold_y on ${s.id}`
    );
  }

  // Verify unmatched concept falls back cleanly to general_market_risk
  const unmatched = await retrieveScenario({
    weak_subtopic: "completely unrelated obscure topic",
    concept: "obscure financial jargon",
    scenarios: bank,
  });
  assert.equal(unmatched.concept_tag, "general_market_risk");

  console.log(`✅ Expanded Historical Scenario Bank smoke test passed! (${bank.length} total entries)`);
  console.log(`   - ${realEvents.length} verified dated Indian market events (all with cited sources & valid SVG shock_chart data)`);
  console.log("   - 1 general_market_risk catch-all fallback entry verified");
}

runScenarioBankProof().catch((err) => {
  console.error("❌ Expanded Historical Scenario Bank smoke test failed:", err);
  process.exit(1);
});
