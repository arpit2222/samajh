import { Router } from "express";
import { runSamajhPipeline } from "../agents/samajhPipeline.js";
import { getSession, updateSession } from "../db/firestore.js";

const router = Router();

/**
 * POST /api/teachback
 * Runs SocraticAgent via the ADK SequentialAgent pipeline and returns { reply, done, adk_trace }.
 */
router.post("/", async (req, res, next) => {
  try {
    const { sessionId, userText } = req.body || {};

    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId is required." });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found. Please start again from Capture." });
    }

    const turns = Array.isArray(session.turns) ? [...session.turns] : [];
    const cleanedUserText = typeof userText === "string" ? userText.trim() : "";

    if (cleanedUserText) {
      turns.push({ speaker: "user", text: cleanedUserText });
    } else if (turns.length > 0) {
      return res.status(400).json({ error: "Please enter your explanation before sending." });
    }

    const sessionLanguage = session.language || "en-IN";
    const sessionModule = session.nismModule || "series-viii";
    const { state, adk_trace } = await runSamajhPipeline({
      activeStages: ["socratic"],
      concept: session.concept,
      turns,
      language: sessionLanguage,
      nismModule: sessionModule,
    });

    const reply = state.socratic_reply ?? null;
    const done = Boolean(state.socratic_done);

    if (reply) {
      turns.push({ speaker: "agent", text: reply });
    }

    await updateSession(sessionId, { turns });

    return res.status(200).json({
      reply,
      done,
      language: sessionLanguage,
      adk_trace,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
