import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";
import { initDatabase, createSession, getSession } from "../src/db/firestore.js";
import { attachLiveTeachbackWebSocket } from "../src/routes/liveTeachbackWs.js";

function waitForEvent(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS message")), timeoutMs);
    const onMessage = (raw) => {
      const msg = JSON.parse(String(raw));
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      }
    };
    ws.on("message", onMessage);
  });
}

async function runLiveVoiceProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  await initDatabase();

  let turnCounter = 0;

  // Deterministic low-latency mock Gemini Live session (tests exact protocol & 3-turn cap)
  const mockConnectLiveSession = async ({ callbacks }) => {
    return {
      sendClientContent() {},
      sendRealtimeInput(input) {
        if (input.audioStreamEnd || input.text) {
          turnCounter += 1;
          const idx = turnCounter;
          setTimeout(() => {
            if (!input.text) {
              callbacks.onmessage({
                serverContent: {
                  inputTranscription: { text: `Spoken learner explanation #${idx}` },
                },
              });
            }
            callbacks.onmessage({
              serverContent: {
                modelTurn: {
                  parts: [
                    {
                      inlineData: {
                        data: Buffer.from([0, 1, 2, 3]).toString("base64"),
                        mimeType: "audio/pcm;rate=24000",
                      },
                    },
                  ],
                },
                outputTranscription: { text: `Confused novice live probe #${idx}` },
                turnComplete: true,
              },
            });
          }, 15);
        }
      },
      close() {},
    };
  };

  const server = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  attachLiveTeachbackWebSocket(server, { connectLiveSession: mockConnectLiveSession });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    // --- TEST 1: Full 3-turn session via Live voice (< 1s round-trip latency + strict 3-turn cap) ---
    const sessionId1 = "sess_live_3turn_001";
    await createSession({
      sessionId: sessionId1,
      uid: "trader_live_01",
      language: "hi-IN",
      concept: "Mark-to-Market (MTM) Daily Cash Settlement",
      turns: [],
    });

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/teachback/live?sessionId=${sessionId1}`);
    const ready1 = await waitForEvent(ws1, (m) => m.type === "ready");
    assert.equal(ready1.agentTurns, 0);
    assert.equal(ready1.maxTurns, 3);
    assert.equal(ready1.language, "hi-IN");

    let maxLatencyMs = 0;
    for (let i = 1; i <= 3; i++) {
      const t0 = Date.now();
      ws1.send(
        JSON.stringify({
          type: "audio",
          data: Buffer.from([10, 20, 30, 40]).toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        })
      );
      ws1.send(JSON.stringify({ type: "audio_end" }));

      const turnDone = await waitForEvent(ws1, (m) => m.type === "turn_complete");
      const rtt = Date.now() - t0;
      maxLatencyMs = Math.max(maxLatencyMs, rtt);
      assert.ok(rtt < 1000, `Round-trip latency ${rtt}ms exceeded 1000ms budget`);
      assert.equal(turnDone.agentTurns, i);
      assert.equal(turnDone.done, i === 3);
    }

    const persisted1 = await getSession(sessionId1);
    assert.equal(persisted1.turns.filter((t) => t.speaker === "agent").length, 3);
    assert.equal(persisted1.turns.filter((t) => t.speaker === "user").length, 3);

    // --- TEST 2: Kill WebSocket mid-session -> prior turns & turn count preserved for typing fallback ---
    const sessionId2 = "sess_live_drop_002";
    await createSession({
      sessionId: sessionId2,
      uid: "trader_live_02",
      language: "en-IN",
      concept: "Overnight Gap-Down Stop-Loss Execution",
      turns: [
        { speaker: "agent", text: "Turn 1 novice probe from typing mode" },
        { speaker: "user", text: "Turn 1 learner reply from typing mode" },
      ],
    });

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/teachback/live?sessionId=${sessionId2}`);
    const ready2 = await waitForEvent(ws2, (m) => m.type === "ready");
    assert.equal(ready2.agentTurns, 1, "Live WS must resume from existing turn count");
    assert.equal(ready2.turns.length, 2, "Live WS must carry over prior typing context");

    // Complete Turn 2 over Live voice
    ws2.send(JSON.stringify({ type: "audio_end" }));
    const turn2 = await waitForEvent(ws2, (m) => m.type === "turn_complete");
    assert.equal(turn2.agentTurns, 2);
    assert.equal(turn2.done, false);

    // Abruptly kill the WebSocket mid-session (simulating network drop)
    ws2.terminate();
    await new Promise((r) => setTimeout(r, 50));

    // Verify Firestore session still has exact 2 agent turns + all prior context intact for Typing fallback
    const persisted2 = await getSession(sessionId2);
    assert.equal(
      persisted2.turns.filter((t) => t.speaker === "agent").length,
      2,
      "Mid-session WS drop must preserve exact turn count (2)"
    );
    assert.equal(
      persisted2.turns[0].text,
      "Turn 1 novice probe from typing mode",
      "Mid-session WS drop must preserve prior context"
    );

    console.log("✅ Bidirectional Gemini Live Voice smoke test passed!");
    console.log(`   - Full 3-turn Live voice session completed (max RTT: ${maxLatencyMs}ms < 1000ms)`);
    console.log("   - Strict 3-agent-turn cap enforced server-side & persisted to Firestore");
    console.log("   - Mid-session WebSocket kill preserved turn count (2/3) & prior context for typing fallback");
  } finally {
    server.close();
  }
}

runLiveVoiceProof().catch((err) => {
  console.error("❌ Bidirectional Gemini Live Voice smoke test failed:", err);
  process.exit(1);
});
