import { Router } from "express";
import { runSamajhPipeline } from "../agents/samajhPipeline.js";
import { getSession, updateSession } from "../db/firestore.js";

const router = Router();

/**
 * POST /api/examine
 * Runs ExaminerAgent (NISM RAG grounding + ADK BuiltInCodeExecutor) via the ADK SequentialAgent
 * pipeline and returns { score, weak_subtopic, rationale, math_verification, grounding, adk_trace }.
 */
router.post("/", async (req, res, next) => {
  try {
    const { sessionId } = req.body || {};

    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId is required." });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found. Please start again from Capture." });
    }

    const { state, adk_trace } = await runSamajhPipeline({
      activeStages: ["examiner"],
      concept: session.concept,
      turns: session.turns || [],
    });

    const result = state.examiner_result;

    await updateSession(sessionId, {
      examinerScore: result.score,
      weakSubtopic: result.weak_subtopic,
      rationale: result.rationale,
    });

    return res.status(200).json({
      score: result.score,
      weak_subtopic: result.weak_subtopic,
      rationale: result.rationale,
      math_verification: result.math_verification,
      grounding: result.grounding,
      adk_trace,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
