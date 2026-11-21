import { callGeminiJSON } from "./geminiClient.js";
import { retrieveNismGrounding, formatGroundingBlock } from "../tools/nismGrounding.js";
import { runAdkCodeExecutionCheck } from "../tools/adkCodeExec.js";
import { resolveLanguage } from "../tools/languages.js";
import { SERIES_I_WEAK_SUBTOPICS, SERIES_VA_WEAK_SUBTOPICS } from "../tools/nismModules.js";

const examinerResponseSchema = {
  type: "OBJECT",
  properties: {
    score: {
      type: "INTEGER",
      description:
        "Understanding score from 0 to 100 based strictly on the learner's causal reasoning across their turns.",
    },
    weak_subtopic: {
      type: "STRING",
      description:
        "Name the exact financial mechanism where the learner's reasoning was weakest, missing, or muddled (e.g., 'margin call timing', 'overnight gap-down stop-loss execution', 'daily MTM cash settlement'). NEVER a vague phrase like 'needs more practice' or 'general concepts'.",
    },
    rationale: {
      type: "STRING",
      description:
        "2 to 4 direct, evidence-based sentences citing what the learner reasoned correctly and the exact mechanism gap that cost them points. Do NOT invent arithmetic — use only qualitative reasoning here; numeric checks are computed separately via ADK Code Execution.",
    },
  },
  required: ["score", "weak_subtopic", "rationale"],
};

/**
 * 4. examinerAgent({ concept, turns }) -> { score (0-100), weak_subtopic, rationale, math_verification, grounding }
 *
 * Grades ONLY the learner's turns, grounded against NISM workbook references (Vertex AI Search / RAG),
 * and runs ADK BuiltInCodeExecutor for verified ₹ margin/payoff calculations.
 */
export async function examinerAgent({
  concept,
  turns = [],
  language = "en-IN",
  moduleId = "series-viii",
} = {}) {
  if (!concept || typeof concept !== "string") {
    const err = new Error("examinerAgent requires a concept.");
    err.statusCode = 400;
    throw err;
  }

  const langConfig = resolveLanguage(language);

  const safeTurns = Array.isArray(turns) ? turns : [];
  const learnerTurns = safeTurns.filter((t) => t.speaker === "user" && t.text?.trim());

  if (learnerTurns.length === 0) {
    const err = new Error("Complete at least one teach-back turn before running the examiner.");
    err.statusCode = 400;
    throw err;
  }

  const learnerOnlyText = learnerTurns
    .map((t, i) => `Learner Turn ${i + 1}: ${t.text.trim()}`)
    .join("\n\n");

  const fullContextText = safeTurns
    .map((t, i) => `${t.speaker === "user" ? "LEARNER" : "NOVICE PROBE"} [#${i + 1}]: ${t.text}`)
    .join("\n");

  // Retrieve NISM workbook grounding passages scoped to the active module
  const grounding = await retrieveNismGrounding(`${concept} ${learnerOnlyText}`, 2, { moduleId });
  const groundingBlock = formatGroundingBlock(grounding);

  const subtopicRule =
    moduleId === "series-va"
      ? `4. \`weak_subtopic\` MUST be one of the NISM Series V-A taxonomy values: ${SERIES_VA_WEAK_SUBTOPICS.join(", ")}. NEVER use Series VIII F&O tags or generic advice.\n`
      : moduleId === "series-i"
        ? `4. \`weak_subtopic\` MUST be one of the NISM Series I taxonomy values: ${SERIES_I_WEAK_SUBTOPICS.join(", ")}. NEVER use Series VIII equity F&O tags or generic advice.\n`
        : "4. `weak_subtopic` MUST name a concrete financial mechanism (2-6 words, e.g., 'margin call timing', " +
          "'overnight gap-down execution', 'short option unlimited downside'). NEVER output generic advice like " +
          "'needs more practice', 'better explanation', or 'lack of clarity'.\n";

  const parsed = await callGeminiJSON({
    systemInstruction:
      "You are the ExaminerAgent for Samajh ('Learn it. Prove it.'), a strict understanding verifier for NISM " +
      "certification candidates and retail derivatives traders.\n\n" +
      "STRICT GRADING RULES:\n" +
      "1. Grade ONLY the learner's own turns — NEVER credit the learner for terminology, mechanisms, or facts " +
      "that only appeared in the Novice's prompts.\n" +
      "2. Cross-check technical claims strictly against the NISM Workbook Reference excerpts provided.\n" +
      "3. Score CAUSAL REASONING, not buzzword repetition:\n" +
      "   - 85-100: Clearly corrects planted misconceptions and explains the exact financial mechanism and edge cases.\n" +
      "   - 65-84: Grasps the main intuition, but leaves a specific operational/risk mechanism unexplained or fuzzy.\n" +
      "   - 40-64: Surface-level, vague, or misses a critical flaw in the novice's misconception.\n" +
      "   - 0-39: Wrong causal model, dangerous misconception for real capital, or minimal/evasive answers.\n" +
      subtopicRule +
      "5. Do NOT do mental financial arithmetic in prose — a dedicated ADK Code Execution tool computes exact ₹ figures.\n" +
      `6. LANGUAGE REQUIREMENT (${langConfig.code} — ${langConfig.label}): ${langConfig.examinerInstruction}`,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `TARGET CONCEPT:\n${concept}\n\n` +
              (groundingBlock
                ? `NISM WORKBOOK GROUNDING REFERENCES:\n${groundingBlock}\n\n`
                : "") +
              `FULL CONVERSATION (for context on what probes were asked):\n${fullContextText}\n\n` +
              `LEARNER-ONLY TURNS TO GRADE (grade ONLY these):\n${learnerOnlyText}\n\n` +
              "Return the score (0-100), specific weak_subtopic mechanism, and concise rationale.",
          },
        ],
      },
    ],
    responseSchema: examinerResponseSchema,
  });

  const rawScore = Number(parsed.score);
  const clampedScore = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(100, Math.round(rawScore)))
    : 0;
  const weakSubtopic = String(parsed.weak_subtopic || "core risk mechanism").trim();

  // Compute verified ₹ financial math via ADK BuiltInCodeExecutor for Series VIII Equity F&O
  const mathVerification =
    moduleId !== "series-viii"
      ? null
      : await runAdkCodeExecutionCheck({
          weak_subtopic: weakSubtopic,
          concept,
        });

  return {
    score: clampedScore,
    weak_subtopic: weakSubtopic,
    rationale: String(parsed.rationale || "").trim(),
    language: langConfig.code,
    module: moduleId,
    math_verification: mathVerification,
    grounding: {
      engine: grounding.engine,
      // Citations are ALWAYS preserved verbatim in their original English NISM workbook form
      citations: grounding.passages.map((p) => ({
        id: p.id,
        source: p.source,
        topic: p.topic,
      })),
    },
  };
}
