import { callGeminiJSON } from "./geminiClient.js";

export const MAX_AGENT_TURNS = 3;

const socraticResponseSchema = {
  type: "OBJECT",
  properties: {
    reply: {
      type: "STRING",
      description:
        "The confused novice's short, conversational message (2-3 sentences, under 70 words). Never lecture or give away the textbook answer.",
    },
  },
  required: ["reply"],
};

/**
 * 3. socraticAgent({ concept, turns }) -> { reply, done }
 *
 * turns = [{ speaker: 'user' | 'agent', text: string }]
 * Plays a confused novice:
 *   - First agent turn: restate the concept slightly wrong on purpose.
 *   - Later turns (2nd & 3rd): probe the specific gap in what the learner just said.
 *   - Cap at 3 agent turns — after that return { reply: null, done: true }.
 */
export async function socraticAgent({ concept, turns = [] } = {}) {
  if (!concept || typeof concept !== "string") {
    const err = new Error("socraticAgent requires a concept.");
    err.statusCode = 400;
    throw err;
  }

  const safeTurns = Array.isArray(turns) ? turns : [];
  const agentTurnCount = safeTurns.filter((t) => t.speaker === "agent").length;

  // Hard cap at 3 agent turns
  if (agentTurnCount >= MAX_AGENT_TURNS) {
    return {
      reply: null,
      done: true,
    };
  }

  const nextAgentTurn = agentTurnCount + 1;

  const transcript =
    safeTurns.length > 0
      ? safeTurns
          .map((t, i) => `${t.speaker === "user" ? "LEARNER" : "NOVICE"} [#${i + 1}]: ${t.text}`)
          .join("\n")
      : "(No turns yet — you are opening the conversation.)";

  const turnRule =
    nextAgentTurn === 1
      ? "THIS IS YOUR FIRST TURN (Turn 1 of 3). Restate the target concept SLIGHTLY WRONG ON PURPOSE — " +
        "introduce one subtle, realistic retail-trader misconception (for example, assuming a stop-loss guarantees your exit price, " +
        "or thinking futures losses only get settled on expiry day, or confusing option buyer vs seller risk). " +
        "Ask the learner casually if you got that right."
      : `THIS IS TURN ${nextAgentTurn} OF 3. Do NOT repeat your earlier question and do NOT lecture or reveal the right answer. ` +
        "Look closely at what the learner just said, spot the specific gap, hand-wave, or edge case they skipped, " +
        "and ask ONE pointed, confused-novice follow-up question probing that exact gap.";

  const parsed = await callGeminiJSON({
    systemInstruction:
      "You are the SocraticAgent for Samajh ('Learn it. Prove it.'). You are NOT a tutor. " +
      "You play a curious, slightly confused novice studying for NISM / Indian F&O markets. " +
      "Never give textbook definitions, never praise with 'Great job!', and never tell the learner if they are right or wrong. " +
      "Keep every reply crisp (2-3 sentences, max ~65 words) and natural.\n\n" +
      `TARGET CONCEPT:\n${concept}\n\n` +
      `TURN INSTRUCTION:\n${turnRule}`,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Dialogue so far:\n${transcript}\n\nWrite your next confused-novice message.`,
          },
        ],
      },
    ],
    responseSchema: socraticResponseSchema,
  });

  return {
    reply: parsed.reply.trim(),
    done: false,
  };
}
