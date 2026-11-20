import { callGeminiJSON } from "./geminiClient.js";
import { retrieveNismGrounding, formatGroundingBlock } from "../tools/nismGrounding.js";

const conceptResponseSchema = {
  type: "OBJECT",
  properties: {
    concept: {
      type: "STRING",
      description:
        "ONE single core financial concept extracted from the study text (never a bulleted list of multiple concepts). Include its clear name followed by a crisp 1-2 sentence explanation grounded in NISM/SEBI rules.",
    },
    analogy: {
      type: "STRING",
      description:
        "ONE vivid, trading-flavored analogy (2-3 sentences) that makes the financial risk or mechanism click intuitively for an Indian NISM/F&O learner.",
    },
  },
  required: ["concept", "analogy"],
};

/**
 * 2. conceptAgent({ raw_text }) -> { concept, analogy, grounding }
 *
 * Financial-markets educator for NISM/trading learners.
 * Grounds output against real NISM workbook text (Vertex AI Search / NISM RAG corpus)
 * and picks ONE concept (not a list) + ONE trading-flavored analogy.
 */
export async function conceptAgent({ raw_text } = {}) {
  if (!raw_text || typeof raw_text !== "string" || !raw_text.trim()) {
    const err = new Error("conceptAgent requires non-empty raw_text.");
    err.statusCode = 400;
    throw err;
  }

  const grounding = await retrieveNismGrounding(raw_text, 2);
  const groundingBlock = formatGroundingBlock(grounding);

  const parsed = await callGeminiJSON({
    systemInstruction:
      "You are a sharp Indian financial-markets educator preparing NISM certification candidates and retail F&O traders. " +
      "Given study material, identify the SINGLE most testable, high-stakes financial concept (NEVER a list of multiple topics) " +
      "and write ONE memorable trading-flavored analogy grounded in real market mechanics or Indian finance. " +
      "Check your terminology and rules against the provided NISM Workbook Reference excerpts when relevant. " +
      "Be concise, accurate to SEBI/NSE/NISM conventions, and skip textbook fluff.",
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Extract ONE core concept and ONE trading-flavored analogy from this study material:\n\n"""\n${raw_text.trim()}\n"""` +
              (groundingBlock
                ? `\n\nGROUNDING — NISM WORKBOOK REFERENCES (verify accuracy against these):\n${groundingBlock}`
                : ""),
          },
        ],
      },
    ],
    responseSchema: conceptResponseSchema,
  });

  if (!parsed.concept?.trim() || !parsed.analogy?.trim()) {
    const err = new Error("Could not extract a clear concept and analogy from the provided text.");
    err.statusCode = 502;
    throw err;
  }

  return {
    concept: parsed.concept.trim(),
    analogy: parsed.analogy.trim(),
    grounding: {
      engine: grounding.engine,
      citations: grounding.passages.map((p) => ({
        id: p.id,
        source: p.source,
        topic: p.topic,
      })),
    },
  };
}
