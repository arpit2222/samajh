import { Router } from "express";
import crypto from "node:crypto";
import {
  createRequisition,
  getRequisition,
  listDiscoverableCredentials,
  listRequisitionsByEmployer,
} from "../db/firestore.js";
import { requireAuth, requireRole } from "../middleware/authGuard.js";
import { verifyCredentialSignature } from "../tools/credentialSigning.js";

const router = Router();

/**
 * POST /api/requisitions (auth required, employer role only)
 * Body: { title: string, required_concepts: [{ name: string, min_score: number }] }
 */
router.post("/", requireAuth, requireRole("employer"), async (req, res, next) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const rawConcepts = Array.isArray(req.body?.required_concepts)
      ? req.body.required_concepts
      : [];

    if (title.length < 3) {
      return res.status(400).json({ error: "Requisition title must be at least 3 characters." });
    }

    const required_concepts = rawConcepts
      .filter((c) => c && typeof c.name === "string" && c.name.trim())
      .map((c) => ({
        name: c.name.trim(),
        min_score: Math.max(0, Math.min(100, Math.round(Number(c.min_score) || 0))),
      }));

    if (required_concepts.length === 0) {
      return res.status(400).json({
        error: "Add at least one required concept with a minimum score.",
      });
    }

    const requisition = await createRequisition({
      id: `req_${crypto.randomUUID().slice(0, 8)}`,
      employerId: req.user.uid,
      title,
      required_concepts,
      status: "open",
    });

    return res.status(201).json({ requisition });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/requisitions (auth required, employer role only)
 */
router.get("/", requireAuth, requireRole("employer"), async (req, res, next) => {
  try {
    const requisitions = await listRequisitionsByEmployer(req.user.uid);
    return res.status(200).json({ requisitions });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/requisitions/:id/matches (auth required, employer role only)
 * Ranks discoverable:true traders whose concept scores meet EVERY required_concepts
 * threshold, sorted by highest overall_score first. Deterministic threshold + sort matching.
 */
router.get("/:id/matches", requireAuth, requireRole("employer"), async (req, res, next) => {
  try {
    const requisition = await getRequisition(req.params.id);
    if (!requisition) {
      return res.status(404).json({ error: "Job requisition not found." });
    }
    if (requisition.employerId !== req.user.uid) {
      return res.status(403).json({ error: "You do not have access to this requisition." });
    }

    const candidates = await listDiscoverableCredentials();
    const matched = [];

    for (const cand of candidates) {
      const conceptMap = new Map();
      for (const c of cand.concepts || []) {
        const combined =
          typeof c.stress_score === "number"
            ? Math.round((Number(c.teachback_score) + Number(c.stress_score)) / 2)
            : Number(c.teachback_score);
        conceptMap.set(c.name.toLowerCase(), {
          ...c,
          effective_score: combined,
        });
      }

      let meetsAll = true;
      const matchedConcepts = [];

      for (const reqItem of requisition.required_concepts || []) {
        const found = conceptMap.get(reqItem.name.toLowerCase());
        if (!found || found.effective_score < reqItem.min_score) {
          meetsAll = false;
          break;
        }
        matchedConcepts.push({
          name: found.name,
          teachback_score: found.teachback_score,
          stress_score: found.stress_score,
          effective_score: found.effective_score,
          required_min: reqItem.min_score,
        });
      }

      if (meetsAll) {
        matched.push({
          credentialId: cand.credentialId,
          displayName: cand.displayName || "Verified Candidate",
          overall_score: cand.overall_score,
          verified: verifyCredentialSignature(cand),
          matched_concepts: matchedConcepts,
          total_concepts_verified: (cand.concepts || []).length,
          isSeedData: Boolean(cand.isSeedData),
        });
      }
    }

    // Best overall_score first
    matched.sort((a, b) => b.overall_score - a.overall_score);

    return res.status(200).json({
      requisition,
      total_matches: matched.length,
      matches: matched,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
