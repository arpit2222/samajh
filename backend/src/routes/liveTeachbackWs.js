import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";
import { getSession, updateSession } from "../db/firestore.js";
import { MAX_AGENT_TURNS } from "../agents/socraticAgent.js";
import { resolveLanguage } from "../tools/languages.js";

const DEFAULT_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.8-live";

function buildLiveSocraticInstruction({ concept, language, existingAgentTurns }) {
  const langConfig = resolveLanguage(language);
  const remaining = Math.max(0, MAX_AGENT_TURNS - existingAgentTurns);
  return (
    "You are the SocraticAgent for Samajh ('Learn it. Prove it.'). You are NOT a tutor. " +
    "You play a curious, slightly confused novice studying for NISM / Indian F&O markets in a live voice conversation. " +
    "Never give textbook definitions, never praise with 'Great job!', and never tell the learner if they are right or wrong. " +
    "Keep every spoken reply crisp (2-3 short sentences, under 12 seconds of speech).\n\n" +
    `LANGUAGE REQUIREMENT (${langConfig.code} — ${langConfig.label}):\n${langConfig.socraticInstruction}\n\n` +
    `TARGET CONCEPT:\n${concept}\n\n` +
    `TURN BUDGET: You have ${remaining} probe turn(s) remaining out of ${MAX_AGENT_TURNS}. ` +
    "On your first turn, restate the concept slightly wrong on purpose and ask casually if you got it right. " +
    "On subsequent turns, spot the specific mechanism gap in what the learner just said and ask one pointed follow-up question."
  );
}

async function defaultConnectLiveSession({ concept, language, turns, callbacks }) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server for Gemini Live voice mode.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const existingAgentTurns = (turns || []).filter((t) => t.speaker === "agent").length;

  const liveSession = await ai.live.connect({
    model: DEFAULT_LIVE_MODEL,
    config: {
      responseModalities: ["AUDIO"],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: {
        parts: [
          {
            text: buildLiveSocraticInstruction({
              concept,
              language,
              existingAgentTurns,
            }),
          },
        ],
      },
    },
    callbacks,
  });

  // Seed prior turns if the learner already completed 1+ turns before opening Live Voice
  if (Array.isArray(turns) && turns.length > 0 && typeof liveSession.sendClientContent === "function") {
    liveSession.sendClientContent({
      turns: turns.map((t) => ({
        role: t.speaker === "user" ? "user" : "model",
        parts: [{ text: t.text }],
      })),
      turnComplete: false,
    });
  }

  return liveSession;
}

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Attaches the bidirectional Gemini Live WebSocket endpoint at `/ws/teachback/live?sessionId=...`
 * to an existing Node HTTP server (Express-compatible, single port).
 *
 * Strictly enforces:
 * - Server-side 3-agent-turn cap (MAX_AGENT_TURNS = 3)
 * - Immediate Firestore persistence of every completed turn so a dropped WS never loses progress
 * - Clean shutdown of the upstream Gemini Live session on cap completion or client disconnect
 */
export function attachLiveTeachbackWebSocket(
  httpServer,
  { connectLiveSession = defaultConnectLiveSession } = {}
) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    try {
      const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (parsedUrl.pathname !== "/ws/teachback/live") {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, parsedUrl);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", async (ws, _req, parsedUrl) => {
    const sessionId = parsedUrl.searchParams.get("sessionId")?.trim();
    if (!sessionId) {
      sendJson(ws, { type: "error", message: "sessionId query parameter is required." });
      ws.close(1008, "Missing sessionId");
      return;
    }

    let session = null;
    try {
      session = await getSession(sessionId);
    } catch (err) {
      sendJson(ws, { type: "error", message: err.message || "Could not load session." });
      ws.close(1011, "Session lookup error");
      return;
    }

    if (!session) {
      sendJson(ws, { type: "error", message: "Session not found." });
      ws.close(1008, "Session not found");
      return;
    }

    const turns = Array.isArray(session.turns) ? [...session.turns] : [];
    const language = session.language || "en-IN";
    let agentTurns = turns.filter((t) => t.speaker === "agent").length;

    if (agentTurns >= MAX_AGENT_TURNS) {
      sendJson(ws, {
        type: "ready",
        sessionId,
        language,
        model: DEFAULT_LIVE_MODEL,
        agentTurns,
        maxTurns: MAX_AGENT_TURNS,
        done: true,
        turns,
      });
      ws.close(1000, "Teach-back already complete");
      return;
    }

    let liveSession = null;
    let pendingUserTranscript = "";
    let pendingAgentTranscript = "";
    let closed = false;

    const persistCompletedTurn = async () => {
      const userChunk = pendingUserTranscript.trim();
      const agentChunk = pendingAgentTranscript.trim();
      pendingUserTranscript = "";
      pendingAgentTranscript = "";

      if (userChunk) {
        turns.push({ speaker: "user", text: userChunk });
      }
      if (agentChunk) {
        turns.push({ speaker: "agent", text: agentChunk });
        agentTurns += 1;
      }

      if (userChunk || agentChunk) {
        await updateSession(sessionId, { turns });
      }

      const done = agentTurns >= MAX_AGENT_TURNS;
      sendJson(ws, {
        type: "turn_complete",
        agentTurns,
        maxTurns: MAX_AGENT_TURNS,
        done,
        turns,
      });

      if (done) {
        try {
          liveSession?.close?.();
        } catch {
          // ignore close error
        }
        ws.close(1000, "3-turn cap reached");
      }
    };

    try {
      liveSession = await connectLiveSession({
        concept: session.concept,
        language,
        turns,
        callbacks: {
          onopen: () => {},
          onmessage: (msg) => {
            if (closed) return;
            const content = msg?.serverContent;
            if (!content) return;

            // Process ALL content parts (audio chunks + text parts)
            if (content.modelTurn?.parts) {
              for (const part of content.modelTurn.parts) {
                if (part.inlineData?.data) {
                  sendJson(ws, {
                    type: "audio",
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000",
                  });
                }
                if (part.text && !content.outputTranscription?.text) {
                  pendingAgentTranscript += `${part.text} `;
                  sendJson(ws, { type: "output_transcript", text: part.text });
                }
              }
            }

            if (content.inputTranscription?.text) {
              pendingUserTranscript += `${content.inputTranscription.text} `;
              sendJson(ws, {
                type: "input_transcript",
                text: content.inputTranscription.text,
              });
            }

            if (content.outputTranscription?.text) {
              pendingAgentTranscript += `${content.outputTranscription.text} `;
              sendJson(ws, {
                type: "output_transcript",
                text: content.outputTranscription.text,
              });
            }

            if (content.interrupted) {
              sendJson(ws, { type: "interrupted" });
            }

            if (content.turnComplete) {
              persistCompletedTurn().catch((err) => {
                sendJson(ws, { type: "error", message: err.message || "Failed to save turn." });
              });
            }
          },
          onerror: (err) => {
            if (closed) return;
            sendJson(ws, {
              type: "error",
              message: err?.message || "Gemini Live connection interrupted.",
            });
          },
          onclose: () => {
            if (!closed && ws.readyState === ws.OPEN) {
              ws.close(1011, "Upstream Gemini Live closed");
            }
          },
        },
      });
    } catch (err) {
      sendJson(ws, {
        type: "error",
        message: err.message || "Could not establish Gemini Live WebSocket session.",
      });
      ws.close(1011, "Live connect failed");
      return;
    }

    sendJson(ws, {
      type: "ready",
      sessionId,
      language,
      model: DEFAULT_LIVE_MODEL,
      agentTurns,
      maxTurns: MAX_AGENT_TURNS,
      done: false,
      turns,
    });

    ws.on("message", (raw) => {
      if (closed || !liveSession || agentTurns >= MAX_AGENT_TURNS) return;
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === "audio" && msg.data) {
        liveSession.sendRealtimeInput({
          audio: {
            data: msg.data,
            mimeType: msg.mimeType || "audio/pcm;rate=16000",
          },
        });
      } else if (msg.type === "audio_end") {
        liveSession.sendRealtimeInput({ audioStreamEnd: true });
      } else if (msg.type === "text" && typeof msg.text === "string" && msg.text.trim()) {
        const trimmed = msg.text.trim();
        pendingUserTranscript = trimmed;
        liveSession.sendRealtimeInput({ text: trimmed });
      }
    });

    ws.on("close", async () => {
      closed = true;
      // Flush any partial finalized user transcript so mid-session drops preserve progress
      if (pendingUserTranscript.trim()) {
        turns.push({ speaker: "user", text: pendingUserTranscript.trim() });
        pendingUserTranscript = "";
        await updateSession(sessionId, { turns }).catch(() => {});
      }
      try {
        liveSession?.close?.();
      } catch {
        // ignore
      }
    });
  });

  return wss;
}
