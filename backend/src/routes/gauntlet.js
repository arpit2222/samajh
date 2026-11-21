import { Router } from "express";
import {
  getCredentialByUserId,
  getUser,
  listGauntletRuns,
} from "../db/firestore.js";

const router = Router();

/**
 * GET /api/gauntlet/leaderboard?scenario_set_id=...&limit=20
 *
 * Ranks completed Multi-Scenario Gauntlet runs strictly by human comprehension
 * `composite_score` DESC, with ties broken by earliest `completed_at` ASC.
 *
 * PRIVACY GUARANTEE:
 * - Only shows a display name if the user explicitly opted in (`discoverable: true`
 *   on their credential profile — default OFF).
 * - Guest runs and non-opted-in users ALWAYS appear as "Anonymous Learner".
 * - Raw userId / email are NEVER included in the response.
 */
router.get("/leaderboard", async (req, res, next) => {
  try {
    const scenarioSetId = req.query.scenario_set_id?.toString().trim() || null;
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));

    const runs = await listGauntletRuns({ scenario_set_id: scenarioSetId, limit });

    const entries = await Promise.all(
      runs.map(async (run, idx) => {
        let displayName = "Anonymous Learner";
        let optedIn = false;
        let credentialId = null;

        if (!run.isGuest && run.userId) {
          const cred = await getCredentialByUserId(run.userId);
          if (cred && cred.discoverable === true) {
            const userDoc = await getUser(run.userId);
            displayName = cred.displayName || userDoc?.displayName || "Verified Learner";
            optedIn = true;
            credentialId = cred.credentialId || null;
          }
        }

        // Explicitly omit run.userId so raw user IDs are never exposed
        return {
          rank: idx + 1,
          run_id: run.id,
          display_name: displayName,
          opted_in: optedIn,
          composite_score: run.composite_score,
          scenario_set_id: run.scenario_set_id,
          total_scenarios: run.total_scenarios,
          completed_at: run.completed_at,
          credential_id: credentialId,
        };
      })
    );

    return res.status(200).json({
      scenario_set_id: scenarioSetId || "all",
      total_entries: entries.length,
      leaderboard: entries,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
