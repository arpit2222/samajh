import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { runSamajhPipeline } from "../agents/samajhPipeline.js";
import { createSession } from "../db/firestore.js";

const router = Router();

const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error("Unsupported image format. Please upload a JPEG, PNG, or WebP photo.");
      err.statusCode = 400;
      cb(err);
    }
  },
});

/**
 * POST /api/ingest
 * Runs IngestAgent -> ConceptAgent via the literal ADK SequentialAgent pipeline,
 * persists the session to Firestore (MongoDB-compatible), and returns
 * { sessionId, concept, analogy, grounding, adk_trace }.
 */
router.post("/", upload.single("image"), async (req, res, next) => {
  try {
    let ingestInput = {};

    if (req.file) {
      ingestInput = {
        imageBase64: req.file.buffer.toString("base64"),
        mimeType: req.file.mimetype === "image/jpg" ? "image/jpeg" : req.file.mimetype,
      };
    } else if (typeof req.body?.imageBase64 === "string" && req.body.imageBase64.trim()) {
      ingestInput = {
        imageBase64: req.body.imageBase64,
        mimeType: req.body.mimeType || "image/jpeg",
      };
    } else if (typeof req.body?.text === "string" && req.body.text.trim()) {
      ingestInput = {
        text: req.body.text,
      };
    } else {
      return res.status(400).json({
        error: "Provide either a study-material photo or pasted study text.",
      });
    }

    const { state, adk_trace } = await runSamajhPipeline({
      activeStages: ["ingest", "concept"],
      ingestInput,
    });

    const uid = req.headers["x-firebase-uid"]?.toString().trim() || req.body?.uid || null;
    const userEmail = req.headers["x-firebase-email"]?.toString().trim() || null;

    const sessionId = crypto.randomUUID();
    await createSession({
      sessionId,
      uid,
      userEmail,
      rawText: state.raw_text,
      concept: state.concept,
      analogy: state.analogy,
      turns: [],
    });

    return res.status(200).json({
      sessionId,
      concept: state.concept,
      analogy: state.analogy,
      grounding: state.concept_grounding,
      adk_trace,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
