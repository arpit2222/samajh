import { computeVerificationHash } from "../tools/credentialSigning.js";

/**
 * ============================================================================
 * SEED DATA — DEMO ONLY (STRIP BEFORE ANY REAL PRODUCTION DEPLOYMENT)
 * ============================================================================
 * 5 realistic trader credential records with varied NISM concept scores and
 * discoverable:true so the Employer Matches screen has real ranked candidates
 * to inspect during live judging even before live trader sessions accumulate.
 * Every record is signed with computeVerificationHash() so /verify/:credentialId
 * independently verifies as true (and flips to false if tampered in Firestore).
 */

export const SYSTEM_CONCEPT_CATALOG = [
  "Mark-to-Market (MTM) Margin",
  "Stop-Loss & Overnight Gap Risk",
  "Market-Wide Circuit Breakers & Margin Halts",
  "Option Buyer vs Writer Payoff Asymmetry",
];

const RAW_SEED_TRADERS = [
  {
    userId: "seed-trader-aarav",
    displayName: "Aarav Mehta (NISM VIII)",
    credentialId: "smj-aarav88",
    discoverable: true,
    concepts: [
      {
        name: "Mark-to-Market (MTM) Margin",
        teachback_score: 91,
        stress_score: 88,
        last_verified: "2026-11-18T10:15:00.000Z",
      },
      {
        name: "Stop-Loss & Overnight Gap Risk",
        teachback_score: 86,
        stress_score: 90,
        last_verified: "2026-11-19T08:40:00.000Z",
      },
      {
        name: "Market-Wide Circuit Breakers & Margin Halts",
        teachback_score: 84,
        stress_score: 85,
        last_verified: "2026-11-19T14:20:00.000Z",
      },
    ],
  },
  {
    userId: "seed-trader-diya",
    displayName: "Diya Nair (NISM VIII)",
    credentialId: "smj-diya82",
    discoverable: true,
    concepts: [
      {
        name: "Mark-to-Market (MTM) Margin",
        teachback_score: 82,
        stress_score: 84,
        last_verified: "2026-11-17T12:10:00.000Z",
      },
      {
        name: "Stop-Loss & Overnight Gap Risk",
        teachback_score: 80,
        stress_score: 82,
        last_verified: "2026-11-18T16:05:00.000Z",
      },
      {
        name: "Option Buyer vs Writer Payoff Asymmetry",
        teachback_score: 85,
        stress_score: 81,
        last_verified: "2026-11-19T09:30:00.000Z",
      },
    ],
  },
  {
    userId: "seed-trader-rohan",
    displayName: "Rohan Kulkarni (NISM VIII)",
    credentialId: "smj-rohan76",
    discoverable: true,
    concepts: [
      {
        name: "Mark-to-Market (MTM) Margin",
        teachback_score: 79,
        stress_score: 74,
        last_verified: "2026-11-16T11:25:00.000Z",
      },
      {
        name: "Market-Wide Circuit Breakers & Margin Halts",
        teachback_score: 76,
        stress_score: 78,
        last_verified: "2026-11-18T11:00:00.000Z",
      },
      {
        name: "Option Buyer vs Writer Payoff Asymmetry",
        teachback_score: 74,
        stress_score: 72,
        last_verified: "2026-11-19T07:50:00.000Z",
      },
    ],
  },
  {
    userId: "seed-trader-ananya",
    displayName: "Ananya Deshmukh (NISM VIII)",
    credentialId: "smj-ananya93",
    discoverable: true,
    concepts: [
      {
        name: "Mark-to-Market (MTM) Margin",
        teachback_score: 94,
        stress_score: 92,
        last_verified: "2026-11-19T11:15:00.000Z",
      },
      {
        name: "Stop-Loss & Overnight Gap Risk",
        teachback_score: 92,
        stress_score: 95,
        last_verified: "2026-11-19T12:45:00.000Z",
      },
      {
        name: "Market-Wide Circuit Breakers & Margin Halts",
        teachback_score: 90,
        stress_score: 93,
        last_verified: "2026-11-20T06:20:00.000Z",
      },
      {
        name: "Option Buyer vs Writer Payoff Asymmetry",
        teachback_score: 91,
        stress_score: 89,
        last_verified: "2026-11-20T07:10:00.000Z",
      },
    ],
  },
  {
    userId: "seed-trader-kabir",
    displayName: "Kabir Verma (NISM VIII)",
    credentialId: "smj-kabir64",
    discoverable: true,
    concepts: [
      {
        name: "Mark-to-Market (MTM) Margin",
        teachback_score: 68,
        stress_score: 62,
        last_verified: "2026-11-15T15:00:00.000Z",
      },
      {
        name: "Stop-Loss & Overnight Gap Risk",
        teachback_score: 64,
        stress_score: 60,
        last_verified: "2026-11-16T09:15:00.000Z",
      },
    ],
  },
];

export function buildSignedSeedCredentials() {
  return RAW_SEED_TRADERS.map((entry) => {
    const scores = entry.concepts.map((c) =>
      Math.round((Number(c.teachback_score) + Number(c.stress_score)) / 2)
    );
    const overall_score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const doc = {
      ...entry,
      overall_score,
      isSeedData: true,
      updatedAt: "2026-11-20T08:00:00.000Z",
    };
    doc.verificationHash = computeVerificationHash(doc);
    return doc;
  });
}
