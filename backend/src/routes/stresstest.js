import { Router } from "express";
import crypto from "node:crypto";
import { retrieveScenario } from "../agents/stressTestAgent.js";
import { runSamajhPipeline } from "../agents/samajhPipeline.js";
import {
  createGauntletRunRecord,
  getSession,
  listScenarios,
  updateSession,
} from "../db/firestore.js";
import { evaluateAndClearSafeguard } from "../services/safeguardClearance.js";

const router = Router();

function buildPromptQuestion(conceptTag) {
  if (conceptTag === "overnight_gap_stoploss_risk") {
    return "Suppose a retail trader held a leveraged long position before market close with a Stop-Loss Market order set 3% below the prior close. Walk through exactly what happens to their stop-loss order and realized risk at the next morning's open.";
  }
  if (conceptTag === "event_volatility_option_writing_risk") {
    return "Suppose a retail trader wrote (sold) naked out-of-the-money Nifty puts the evening before results to collect premium. Walk through what happens to their option premium, intraday margin requirement, and broker square-off risk when Nifty plunges over 8% intraday and India VIX spikes past 28.";
  }
  if (conceptTag === "regulatory_moratorium_liquidity_risk") {
    return "Suppose a trader held leveraged long exposure (or pledged shares as margin collateral) before the RBI moratorium was announced overnight. Walk through what happens to their exit liquidity, collateral value, and margin shortfall on the next morning.";
  }
  if (conceptTag === "general_market_risk") {
    return "Suppose a leveraged trader holds an open position when sudden volatility widens bid-ask spreads and thins order-book depth. Walk through what happens to their execution slippage, mark-to-market drawdown, and margin buffer if they try to exit using a market order.";
  }
  return "Suppose a retail trader held an open leveraged futures/short position when the 10% lower-circuit trading halt triggered. Walk through exactly what happens to their ability to exit and to their margin requirement during the 45-minute halt and the moment trading resumes.";
}

/**
 * POST /api/stresstest
 * Mode 1: { sessionId } -> retrieves matched curated scenario from Firestore `scenarios`
 * Mode 2: { sessionId, user_reasoning } -> grades via ADK SequentialAgent + BuiltInCodeExecutor
 */
router.post("/", async (req, res, next) => {
  try {
    const { sessionId, user_reasoning, userReasoning } = req.body || {};
    const reasoningInput =
      typeof user_reasoning === "string"
        ? user_reasoning
        : typeof userReasoning === "string"
          ? userReasoning
          : null;

    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId is required." });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found. Please start again from Capture." });
    }

    const bank = await listScenarios();

    let scenario = session.stressScenarioTag
      ? bank.find((s) => s.concept_tag === session.stressScenarioTag)
      : null;

    if (!scenario) {
      scenario = await retrieveScenario({
        weak_subtopic: session.weakSubtopic || "",
        concept: session.concept || "",
        scenarios: bank,
      });

      await updateSession(sessionId, {
        stressScenarioTag: scenario.concept_tag,
        stressScenarioEvent: scenario.event,
        stressScenarioDate: scenario.date,
      });
    }

    if (reasoningInput === null) {
      return res.status(200).json({
        sessionId,
        id: scenario.id || null,
        concept_tag: scenario.concept_tag,
        event: scenario.event,
        date: scenario.date,
        scenario_text: scenario.what_happened,
        source: scenario.source || null,
        shock_chart: scenario.shock_chart || null,
        weak_subtopic: session.weakSubtopic,
        prompt_question: buildPromptQuestion(scenario.concept_tag),
      });
    }

    const { state, adk_trace } = await runSamajhPipeline({
      activeStages: ["stresstest"],
      weak_subtopic: session.weakSubtopic || scenario.concept_tag,
      concept: session.concept || "",
      user_reasoning: reasoningInput,
      scenario,
    });

    const result = state.stresstest_result;

    const examinerScore =
      typeof session.examinerScore === "number" ? session.examinerScore : result.stress_score;
    const combinedMasteryScore = Math.round(examinerScore * 0.5 + result.stress_score * 0.5);

    const uid = req.headers["x-firebase-uid"]?.toString().trim() || session.uid || null;

    await updateSession(sessionId, {
      uid,
      stressScenarioTag: result.concept_tag,
      stressScenarioEvent: result.event,
      stressScenarioDate: result.date,
      stressUserReasoning: result.user_reasoning,
      stressScore: result.stress_score,
      stressFeedback: result.feedback,
      combinedMasteryScore,
    });

    // Reuse this exact 50/50 Combined Mastery Score to clear any matching broker safeguard risk flag
    const clearance = await evaluateAndClearSafeguard({
      session: { ...session, uid },
      matchedConceptTag: result.concept_tag,
      examinerScore,
      stressScore: result.stress_score,
      combinedMasteryScore,
    });

    return res.status(200).json({
      sessionId,
      ...result,
      examiner_score: examinerScore,
      combined_mastery_score: combinedMasteryScore,
      concept_to_revisit: session.weakSubtopic || result.concept_tag,
      safeguard_cleared: clearance.cleared,
      cleared_credential_id: clearance.credential_id,
      adk_trace,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/stresstest/multi
 * Priority 6: Returns randomized curated scenarios from Firestore `scenarios` bank
 * for the Multi-Scenario Gauntlet test mode.
 */
router.get("/multi", async (_req, res, next) => {
  try {
    const bank = await listScenarios();
    // Fisher-Yates shuffle
    const shuffled = [...bank];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return res.status(200).json({
      scenarios: shuffled.map((s) => ({
        concept_tag: s.concept_tag,
        event: s.event,
        date: s.date,
        scenario_text: s.what_happened,
        prompt_question: buildPromptQuestion(s.concept_tag),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/stresstest/multi
 * Body: { answers: [{ concept_tag: string, user_reasoning: string }] }
 * Grades every scenario in the randomized gauntlet via the same ADK StressTestAgent
 * and returns a composite score + per-scenario breakdown.
 */
router.post("/multi", async (req, res, next) => {
  try {
    const { answers } = req.body || {};
    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ error: "Provide at least one scenario reasoning answer." });
    }

    const bank = await listScenarios();
    const results = [];

    for (const item of answers) {
      const scenario = bank.find((s) => s.concept_tag === item.concept_tag);
      if (!scenario) {
        return res.status(400).json({ error: `Unknown scenario tag: ${item.concept_tag}` });
      }
      const { state } = await runSamajhPipeline({
        activeStages: ["stresstest"],
        weak_subtopic: scenario.concept_tag,
        concept: scenario.event,
        user_reasoning: item.user_reasoning,
        scenario,
      });
      results.push(state.stresstest_result);
    }

    const compositeScore = Math.round(
      results.reduce((acc, r) => acc + r.stress_score, 0) / results.length
    );

    const weakest = [...results].sort((a, b) => a.stress_score - b.stress_score)[0];

    const uid = req.headers["x-firebase-uid"]?.toString().trim() || null;
    const isGuest = !uid;
    const scenarioSetId =
      typeof req.body?.scenario_set_id === "string" && req.body.scenario_set_id.trim()
        ? req.body.scenario_set_id.trim().slice(0, 64)
        : "nism-viii-gauntlet";

    const runRecord = await createGauntletRunRecord({
      id: `gr_${crypto.randomUUID()}`,
      userId: uid || `guest_${crypto.randomUUID().slice(0, 12)}`,
      isGuest,
      composite_score: compositeScore,
      scenario_set_id: scenarioSetId,
      total_scenarios: results.length,
      completed_at: new Date().toISOString(),
    });

    return res.status(200).json({
      run_id: runRecord.id,
      scenario_set_id: runRecord.scenario_set_id,
      completed_at: runRecord.completed_at,
      composite_score: compositeScore,
      total_scenarios: results.length,
      weakest_event: weakest?.event || "",
      weakest_tag: weakest?.concept_tag || "",
      results,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
