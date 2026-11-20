import { callGeminiJSON } from "./geminiClient.js";
import { listScenarios } from "../db/firestore.js";
import { runAdkCodeExecutionCheck } from "../tools/adkCodeExec.js";

/**
 * Keyword affinity map for fast, deterministic RAG-style retrieval over the curated scenario bank.
 * NEVER generates scenario content — strictly selects an existing verified entry,
 * falling back cleanly to `general_market_risk` whenever no specific scenario matches.
 */
const TAG_KEYWORDS = {
  overnight_gap_stoploss_risk: [
    "stop-loss",
    "stoploss",
    "stop loss",
    "sl-m",
    "slm",
    "gap",
    "overnight",
    "slippage",
    "trigger",
    "opening",
    "open price",
    "disclosure",
    "accounting",
    "indusind",
    "after-hours",
    "after hours",
    "execution price",
    "exit price",
  ],
  circuit_breaker_margin_risk: [
    "circuit",
    "breaker",
    "halt",
    "margin",
    "mtm",
    "mark-to-market",
    "mark to market",
    "maintenance",
    "margin call",
    "square-off",
    "square off",
    "futures",
    "span",
    "exposure",
    "sensex",
    "covid",
    "settlement",
  ],
  event_volatility_option_writing_risk: [
    "option",
    "writer",
    "writing",
    "short put",
    "short call",
    "naked",
    "straddle",
    "strangle",
    "vix",
    "implied volatility",
    "vega",
    "theta",
    "expiry",
    "election",
    "binary event",
    "asymmetry",
    "unlimited",
    "premium",
  ],
  regulatory_moratorium_liquidity_risk: [
    "moratorium",
    "rbi",
    "solvency",
    "default",
    "collateral",
    "pledge",
    "haircut",
    "yes bank",
    "bank run",
    "tail risk",
    "wipeout",
    "delisting",
    "regulatory",
  ],
};

const stressGradeSchema = {
  type: "OBJECT",
  properties: {
    stress_score: {
      type: "INTEGER",
      description:
        "Reasoning score from 0 to 100 measuring how accurately the learner's typed reasoning matches the documented historical consequence chain.",
    },
    feedback: {
      type: "STRING",
      description:
        "2 to 4 direct, evidence-based sentences comparing the learner's reasoning against the real historical outcome — citing what they understood and what exact market mechanic they missed. Do NOT estimate new numbers in prose.",
    },
  },
  required: ["stress_score", "feedback"],
};

/**
 * Retrieve the single best-matching curated scenario from Firestore's `scenarios` collection.
 * NEVER invents or alters scenario text.
 * If no specific historical entry reasonably matches `weak_subtopic`, returns the
 * `general_market_risk` fallback scenario so the stress-test step never comes up empty.
 */
export async function retrieveScenario({ weak_subtopic = "", concept = "", scenarios = null } = {}) {
  const bank = Array.isArray(scenarios) && scenarios.length > 0 ? scenarios : await listScenarios();

  if (bank.length === 0) {
    const err = new Error("Scenario bank is empty. Seed backend/src/data/scenarioBank.json first.");
    err.statusCode = 500;
    throw err;
  }

  const fallbackEntry =
    bank.find((s) => s.concept_tag === "general_market_risk") || bank[bank.length - 1];

  const weakLower = String(weak_subtopic || "").toLowerCase();
  const conceptLower = String(concept || "").toLowerCase();

  let best = null;
  let bestScore = 0;

  for (const entry of bank) {
    if (entry.concept_tag === "general_market_risk") continue;
    const keywords = TAG_KEYWORDS[entry.concept_tag] || [];
    let score = 0;

    for (const kw of keywords) {
      if (weakLower.includes(kw)) score += 3;
      else if (conceptLower.includes(kw)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  // Require at least a clear match (>= 2) before picking a specific historical shock;
  // otherwise deterministically return the general_market_risk fallback scenario.
  if (best && bestScore >= 2) {
    return best;
  }

  return fallbackEntry;
}

/**
 * 5. stressTestAgent({ weak_subtopic, concept?, user_reasoning, scenario?, scenarios? })
 *    -> { concept_tag, event, date, scenario_text, user_reasoning, stress_score, feedback,
 *         correct_reasoning_chain, math_verification }
 */
export async function stressTestAgent({
  weak_subtopic,
  concept = "",
  user_reasoning,
  scenario = null,
  scenarios = null,
} = {}) {
  const cleanedReasoning = typeof user_reasoning === "string" ? user_reasoning.trim() : "";
  if (cleanedReasoning.length < 15) {
    const err = new Error(
      "Please write at least a brief reasoning explanation (15+ characters) about what happens to a trader's position in this event."
    );
    err.statusCode = 400;
    throw err;
  }

  const matchedScenario =
    scenario || (await retrieveScenario({ weak_subtopic, concept, scenarios }));

  const parsed = await callGeminiJSON({
    systemInstruction:
      "You are the StressTestAgent for Samajh ('Learn it. Prove it.'). You are NOT a trading simulator — " +
      "you NEVER score simulated P&L luck. You grade a learner's CAUSAL REASONING on a real, verified Indian market shock " +
      "strictly against the documented ground-truth reasoning chain.\n\n" +
      "GRADING RUBRIC:\n" +
      "- 85-100: Captures the core operational failure mechanism in the documented reasoning chain with clear cause-and-effect.\n" +
      "- 60-84: Recognizes serious loss/risk, but misses part of the exact execution, liquidity, or margin mechanism.\n" +
      "- 35-59: Generic advice ('markets are risky', 'use stop loss') or partially wrong assumption about order execution/margin.\n" +
      "- 0-34: Dangerous misconception (e.g., claims stop-loss protects you at trigger price in a gap, or claims you can exit freely during a halt).\n\n" +
      "Do NOT invent financial arithmetic in prose — a dedicated ADK Code Execution tool computes exact ₹ verification numbers.",
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `HISTORICAL EVENT (GROUND TRUTH):\n` +
              `Event: ${matchedScenario.event}\n` +
              `Date: ${matchedScenario.date}\n` +
              `What Happened: ${matchedScenario.what_happened}\n\n` +
              `DOCUMENTED CORRECT REASONING CHAIN (GRADE AGAINST THIS):\n` +
              `${matchedScenario.correct_reasoning_chain}\n\n` +
              `LEARNER'S WEAK SUB-TOPIC: ${weak_subtopic || matchedScenario.concept_tag}\n\n` +
              `LEARNER'S TYPED REASONING:\n` +
              `"""\n${cleanedReasoning}\n"""\n\n` +
              "Grade the learner's reasoning strictly against the documented reasoning chain and return stress_score (0-100) and concise feedback.",
          },
        ],
      },
    ],
    responseSchema: stressGradeSchema,
  });

  const rawScore = Number(parsed.stress_score);
  const clampedScore = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(100, Math.round(rawScore)))
    : 0;

  const mathVerification = await runAdkCodeExecutionCheck({
    weak_subtopic: weak_subtopic || matchedScenario.concept_tag,
    concept,
    concept_tag: matchedScenario.concept_tag,
  });

  return {
    concept_tag: matchedScenario.concept_tag,
    event: matchedScenario.event,
    date: matchedScenario.date,
    scenario_text: matchedScenario.what_happened,
    user_reasoning: cleanedReasoning,
    stress_score: clampedScore,
    feedback: String(parsed.feedback || "").trim(),
    correct_reasoning_chain: matchedScenario.correct_reasoning_chain,
    math_verification: mathVerification,
  };
}
