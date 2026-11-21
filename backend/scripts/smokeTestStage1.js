import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isSequentialAgent } from "@google/adk";
import { ingestAgent } from "../src/agents/ingestAgent.js";
import { retrieveScenario } from "../src/agents/stressTestAgent.js";
import {
  samajhSequentialPipeline,
  runSamajhPipeline,
} from "../src/agents/samajhPipeline.js";

const SAMPLE_NISM_TEXT =
  "In NSE equity futures, traders post an initial margin of 15-25% and positions are marked-to-market daily. " +
  "If daily MTM losses push margin below maintenance level, the broker triggers a margin call or auto-squares off the position.";

async function runFullStage3Tests() {
  process.env.GEMINI_API_KEY = "test-key-for-contract-verification";
  process.env.GEMINI_MODEL = "gemini-4-hydrogen";
  process.env.DISABLE_ADK_REMOTE_CODE_EXEC = "1";

  // 1. Verify literal @google/adk SequentialAgent with all 5 sub-agents
  assert.equal(
    isSequentialAgent(samajhSequentialPipeline),
    true,
    "samajhSequentialPipeline must be a literal @google/adk SequentialAgent"
  );
  assert.deepEqual(
    samajhSequentialPipeline.subAgents.map((a) => a.name),
    ["IngestAgent", "ConceptAgent", "SocraticAgent", "ExaminerAgent", "StressTestAgent"]
  );

  // 2. Verify scenarioBank.json contains 25+ verified Indian market events + general_market_risk fallback
  const bankRaw = await readFile(new URL("../src/data/scenarioBank.json", import.meta.url), "utf-8");
  const bank = JSON.parse(bankRaw);
  assert.ok(bank.length >= 25, `scenarioBank.json must contain 25+ verified events + fallback (got ${bank.length})`);
  const uniqueTags = new Set(bank.map((s) => s.concept_tag));
  for (const requiredTag of [
    "circuit_breaker_margin_risk",
    "overnight_gap_stoploss_risk",
    "event_volatility_option_writing_risk",
    "regulatory_moratorium_liquidity_risk",
    "general_market_risk",
  ]) {
    assert.ok(uniqueTags.has(requiredTag), `Missing required scenario concept_tag: ${requiredTag}`);
  }

  // 3. Verify deterministic RAG scenario retrieval + general_market_risk fallback
  const marginMatch = await retrieveScenario({ weak_subtopic: "margin call timing", scenarios: bank });
  assert.equal(marginMatch.concept_tag, "circuit_breaker_margin_risk");
  const gapMatch = await retrieveScenario({ weak_subtopic: "overnight gap stop-loss slippage", scenarios: bank });
  assert.equal(gapMatch.concept_tag, "overnight_gap_stoploss_risk");
  const vixMatch = await retrieveScenario({ weak_subtopic: "naked option writing vix spike", scenarios: bank });
  assert.equal(vixMatch.concept_tag, "event_volatility_option_writing_risk");
  const fallbackMatch = await retrieveScenario({ weak_subtopic: "mutual fund expense ratio taxation", scenarios: bank });
  assert.equal(
    fallbackMatch.concept_tag,
    "general_market_risk",
    "Unmatched weak_subtopic must fall back cleanly to general_market_risk"
  );

  const originalFetch = global.fetch;
  const queuedResponses = [
    // 1. ingestAgent unreadable photo
    { could_read: false, raw_text: "", reason: "Photo is too blurry to read." },
    // 2. conceptAgent
    {
      concept:
        "Mark-to-Market (MTM) Margin: Daily cash settlement of unrealized futures profits and losses against the exchange settlement price.",
      analogy:
        "Like settling your tab every single evening at a broker's desk instead of waiting until month-end.",
    },
    // 3-5. socraticAgent 3 turns
    { reply: "Wait, so once I pay 20% initial margin, losses only matter on expiry day right?" },
    { reply: "Oh daily! But if my margin dips during a circuit halt, won't the broker wait a week?" },
    { reply: "Does the broker really square me off even if I expect a rebound before expiry?" },
    // 6. examinerAgent
    {
      score: 78,
      weak_subtopic: "margin call timing during lower-circuit halts",
      rationale:
        "You correctly explained daily MTM settlement and broker square-offs, but missed how margin freezes during a lower-circuit halt and spikes on reopen.",
    },
    // 7. stressTestAgent
    {
      stress_score: 86,
      feedback:
        "Strong causal reasoning: you correctly noted that a 45-minute halt prevents exiting while margin stays marked to LTP, triggering a sharp margin spike on reopen.",
    },
  ];

  let idx = 0;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.match(
      url,
      /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/
    );
    assert.equal(body.generationConfig?.responseMimeType, "application/json");
    assert.ok(body.generationConfig?.responseSchema);

    const nextPayload = queuedResponses[idx++];
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(nextPayload) }],
              },
            },
          ],
        };
      },
    };
  };

  try {
    // Unreadable photo returns 422
    await assert.rejects(
      () => ingestAgent({ imageBase64: "ZmFrZQ==", mimeType: "image/jpeg" }),
      (err) => err.statusCode === 422
    );

    // Stage 1a: IngestAgent -> ConceptAgent via literal ADK SequentialAgent
    const ingestRun = await runSamajhPipeline({
      activeStages: ["ingest", "concept"],
      ingestInput: { text: SAMPLE_NISM_TEXT },
    });
    assert.deepEqual(ingestRun.adk_trace.executed_agents, ["IngestAgent", "ConceptAgent"]);
    assert.ok(ingestRun.state.concept.includes("Mark-to-Market"));
    assert.ok(
      ingestRun.state.concept_grounding.citations.length > 0,
      "conceptAgent must include NISM workbook RAG grounding citations"
    );

    // Stage 1b: 3-turn SocraticAgent loop via ADK SequentialAgent + cap check
    const turns = [];
    for (let i = 0; i < 3; i++) {
      const sRun = await runSamajhPipeline({
        activeStages: ["socratic"],
        concept: ingestRun.state.concept,
        turns,
      });
      assert.deepEqual(sRun.adk_trace.executed_agents, ["SocraticAgent"]);
      assert.equal(sRun.state.socratic_done, false);
      turns.push({ speaker: "agent", text: sRun.state.socratic_reply });
      turns.push({ speaker: "user", text: `Learner explanation turn ${i + 1} correcting the novice.` });
    }
    const cappedRun = await runSamajhPipeline({
      activeStages: ["socratic"],
      concept: ingestRun.state.concept,
      turns,
    });
    assert.equal(cappedRun.state.socratic_reply, null);
    assert.equal(cappedRun.state.socratic_done, true);

    // Stage 1c: ExaminerAgent (ADK CodeExec + NISM RAG) via ADK SequentialAgent
    const examRun = await runSamajhPipeline({
      activeStages: ["examiner"],
      concept: ingestRun.state.concept,
      turns,
    });
    assert.deepEqual(examRun.adk_trace.executed_agents, ["ExaminerAgent"]);
    const exam = examRun.state.examiner_result;
    assert.equal(exam.score, 78);
    assert.ok(exam.math_verification?.summary?.includes("₹"), "Examiner must compute ₹ financial math");
    assert.ok(exam.math_verification?.python_code?.length > 10);
    assert.ok(exam.grounding?.citations?.length > 0, "Examiner must include NISM RAG citations");

    // Stage 2 + 3: StressTestAgent (Curated Bank + ADK CodeExec) via ADK SequentialAgent
    const stressRun = await runSamajhPipeline({
      activeStages: ["stresstest"],
      weak_subtopic: exam.weak_subtopic,
      concept: ingestRun.state.concept,
      user_reasoning:
        "During the 45-minute circuit halt you cannot exit or adjust the position, margin stays marked at last traded price, and when trading resumes the margin requirement spikes immediately.",
      scenarios: bank,
    });
    assert.deepEqual(stressRun.adk_trace.executed_agents, ["StressTestAgent"]);
    const stress = stressRun.state.stresstest_result;
    assert.equal(stress.concept_tag, "circuit_breaker_margin_risk");
    assert.equal(stress.date, "2020-03-23");
    assert.equal(stress.stress_score, 86);
    assert.ok(stress.math_verification?.summary?.includes("₹"), "StressTest must compute ₹ financial math");

    console.log(
      "ALL STAGE 1 + 2 + 3 TESTS PASSED (ADK 5-agent SequentialAgent, CodeExec math, NISM RAG grounding, and curated scenario bank verified)."
    );
  } finally {
    global.fetch = originalFetch;
  }
}

runFullStage3Tests().catch((err) => {
  console.error("Stage 3 full pipeline test failed:", err);
  process.exit(1);
});
