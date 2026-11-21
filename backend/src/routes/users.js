import { Router } from "express";
import { upsertUser, listDiscoverableCredentials } from "../db/firestore.js";
import { requireAuth } from "../middleware/authGuard.js";
import { SYSTEM_CONCEPT_CATALOG } from "../data/seedCredentials.js";

const router = Router();

/**
 * POST /api/users/sync
 * Syncs a Firebase-verified user's profile and role ('trader' | 'employer') into Firestore `users`.
 * Identity (uid, email, displayName, photoURL) is derived strictly from the verified Firebase ID token.
 */
router.post("/sync", requireAuth, async (req, res, next) => {
  try {
    const user = await upsertUser({
      uid: req.user.uid,
      displayName: req.user.displayName || "",
      email: req.user.email || "",
      photoURL: req.user.photoURL || "",
      role: req.body?.role === "employer" ? "employer" : "trader",
    });

    return res.status(200).json({ user });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/users/me
 */
router.get("/me", requireAuth, (req, res) => {
  return res.status(200).json({ user: req.user });
});

/**
 * GET /api/users/concepts
 * Returns unique concept names available in the system for Employer Requisition dropdowns.
 */
router.get("/concepts", async (_req, res, next) => {
  try {
    const creds = await listDiscoverableCredentials();
    const set = new Set(SYSTEM_CONCEPT_CATALOG);
    for (const c of creds) {
      for (const item of c.concepts || []) {
        if (item.name) set.add(item.name);
      }
    }
    return res.status(200).json({ concepts: [...set].sort() });
  } catch (err) {
    return next(err);
  }
});

export default router;
