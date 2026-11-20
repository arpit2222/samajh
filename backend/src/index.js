import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import {
  initDatabase,
  getDbMode,
  getDbLabel,
  getSession,
  listSessionsByUid,
  listScenarios,
} from "./db/firestore.js";
import { getModelName, isGeminiConfigured } from "./agents/geminiClient.js";
import { samajhSequentialPipeline } from "./agents/samajhPipeline.js";
import { isVertexSearchConfigured } from "./tools/nismGrounding.js";
import ingestRouter from "./routes/ingest.js";
import teachbackRouter from "./routes/teachback.js";
import examineRouter from "./routes/examine.js";
import stresstestRouter from "./routes/stresstest.js";
import usersRouter from "./routes/users.js";
import { credentialRouter, verifyRouter } from "./routes/credentials.js";
import requisitionsRouter from "./routes/requisitions.js";
import tradeProfileRouter from "./routes/tradeProfile.js";

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow configured frontend origin, localhost dev ports, and phone LAN testing during demos
      if (
        !origin ||
        origin === FRONTEND_ORIGIN ||
        /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, true); // Hackathon demo-friendly CORS; tighten on production Cloud Run
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Firebase-Uid",
      "X-Firebase-Email",
      "X-User-Role",
      "X-User-Name",
    ],
  })
);

app.use(express.json({ limit: "20mb" }));

app.get("/api/health", async (_req, res) => {
  const scenarios = await listScenarios().catch(() => []);
  res.json({
    status: "ok",
    product: "Samajh — Learn it. Prove it.",
    stage: "stage-3",
    transport: "gemini-rest-v1beta",
    adkPipeline: samajhSequentialPipeline.name,
    adkAgents: samajhSequentialPipeline.subAgents.map((a) => a.name),
    codeExecution: "adk-built-in-code-executor",
    grounding: isVertexSearchConfigured() ? "vertex-ai-search" : "nism-workbook-rag",
    model: getModelName(),
    geminiConfigured: isGeminiConfigured(),
    dbMode: getDbMode(),
    dbLabel: getDbLabel(),
    scenarioCount: scenarios.length,
  });
});

app.get("/api/sessions", async (req, res, next) => {
  try {
    const uid = req.query.uid?.toString().trim() || req.headers["x-firebase-uid"]?.toString().trim();
    if (!uid) {
      return res.status(400).json({ error: "uid query parameter or X-Firebase-Uid header is required." });
    }
    const sessions = await listSessionsByUid(uid);
    return res.json({ uid, sessions });
  } catch (err) {
    return next(err);
  }
});

app.get("/api/sessions/:sessionId", async (req, res, next) => {
  try {
    const session = await getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }
    return res.json(session);
  } catch (err) {
    return next(err);
  }
});

app.use("/api/ingest", ingestRouter);
app.use("/api/teachback", teachbackRouter);
app.use("/api/examine", examineRouter);
app.use("/api/stresstest", stresstestRouter);
app.use("/api/users", usersRouter);
app.use("/api/credential", credentialRouter);
app.use("/api/verify", verifyRouter);
app.use("/api/requisitions", requisitionsRouter);
app.use("/api/trade-profile", tradeProfileRouter);

// Centralized JSON error handler (prevents crashes & unhandled rejections)
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "Photo is too large (max 15 MB). Please take a smaller photo or crop the page."
        : `Upload error: ${err.message}`;
    return res.status(400).json({ error: msg });
  }

  const status = err.statusCode || err.status || 500;
  const message = err.message || "Unexpected server error.";
  if (status >= 500) {
    console.error("[Samajh API Error]", err);
  }
  return res.status(status).json({ error: message });
});

process.on("unhandledRejection", (reason) => {
  console.error("[Samajh] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Samajh] Uncaught exception:", err);
});

async function start() {
  await initDatabase();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Samajh] Backend listening on http://localhost:${PORT}`);
    console.log(`[Samajh] Gemini REST model: ${getModelName()}`);
  });
}

start().catch((err) => {
  console.error("[Samajh] Failed to start server:", err);
  process.exit(1);
});
