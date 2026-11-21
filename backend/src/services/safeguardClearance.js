import {
  clearMatchingRiskFlags,
  getCredentialByUserId,
  getLatestRiskFlag,
  upsertCredential,
} from "../db/firestore.js";
import {
  computeVerificationHash,
  generateCredentialSlug,
} from "../tools/credentialSigning.js";
import { CONCEPT_TAG_MAP, VALID_CONCEPT_TAGS } from "../agents/tradePostMortemAgent.js";

export const VALID_SAFEGUARD_SUBTOPICS = [...VALID_CONCEPT_TAGS, "general_market_risk"];
export const SAFEGUARD_PASS_THRESHOLD = 70;

/**
 * Called ONLY by Samajh's own scoring pipeline (POST /api/stresstest) after a user
 * finishes Teach-Back + Stress-Test with the existing 50/50 Combined Mastery Score.
 *
 * Partners can NEVER invoke this directly to set cleared=true.
 */
export async function evaluateAndClearSafeguard({
  session,
  matchedConceptTag,
  examinerScore,
  stressScore,
  combinedMasteryScore,
}) {
  const candidateRef = session?.externalUserRef || session?.uid || null;
  if (!candidateRef || !matchedConceptTag) {
    return { cleared: false, credential_id: null };
  }

  if (typeof combinedMasteryScore !== "number" || combinedMasteryScore < SAFEGUARD_PASS_THRESHOLD) {
    return { cleared: false, credential_id: null };
  }

  // Only proceed if there is actually an open risk flag for this ref + subtopic
  const latestFlag = await getLatestRiskFlag(candidateRef);
  if (!latestFlag || latestFlag.cleared || latestFlag.flagged_subtopic !== matchedConceptTag) {
    return { cleared: false, credential_id: null };
  }

  // Ensure a real HMAC-SHA256 verifiable credential exists for this user/ref
  const ownerId = session.uid || candidateRef;
  const existingCred = await getCredentialByUserId(ownerId);
  const conceptName =
    CONCEPT_TAG_MAP[matchedConceptTag]?.concept_name ||
    String(session.concept || matchedConceptTag).split(":")[0].trim();
  const now = new Date().toISOString();

  const mergedConcepts = (existingCred?.concepts || []).filter(
    (c) => c.name.toLowerCase() !== conceptName.toLowerCase()
  );
  mergedConcepts.push({
    name: conceptName,
    teachback_score: Math.round(Number(examinerScore)),
    stress_score: Math.round(Number(stressScore)),
    last_verified: now,
  });

  const overall_score = Math.round(
    mergedConcepts.reduce((sum, c) => {
      const s =
        typeof c.stress_score === "number"
          ? Math.round((c.teachback_score + c.stress_score) / 2)
          : c.teachback_score;
      return sum + s;
    }, 0) / mergedConcepts.length
  );

  const credentialId = existingCred?.credentialId || generateCredentialSlug();
  const credDraft = {
    userId: ownerId,
    displayName: existingCred?.displayName || "Verified Trader",
    concepts: mergedConcepts,
    overall_score,
    credentialId,
    discoverable: existingCred ? Boolean(existingCred.discoverable) : false,
    isSeedData: false,
  };
  credDraft.verificationHash = computeVerificationHash(credDraft);
  await upsertCredential(credDraft);

  const clearedDocs = await clearMatchingRiskFlags({
    externalUserRef: candidateRef,
    matchedSubtopic: matchedConceptTag,
    credentialId,
    passingScore: combinedMasteryScore,
    sessionId: session.sessionId,
  });

  return {
    cleared: clearedDocs.length > 0,
    credential_id: clearedDocs.length > 0 ? credentialId : null,
  };
}
