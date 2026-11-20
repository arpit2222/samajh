import "dotenv/config";
import crypto from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import { initDatabase, createSession } from "../src/db/firestore.js";

/**
 * ============================================================================
 * ONE-TIME SEED SCRIPT — REAL FIREBASE AUTH USERS + REAL ON-CHAIN AMOY MINTS
 * ============================================================================
 * Creates 5 real Firebase Auth users via Firebase Admin SDK, seeds their
 * verified NISM sessions into Firestore, calls the live POST /api/credential/generate
 * endpoint for each user (triggering the real Polygon Amoy relayer mint), opts them
 * into employer discoverability, and waits until each txHash confirms on-chain.
 *
 * Run ONCE before demo time (with the backend server running and backend/.env +
 * backend/service-account.json + funded RELAYER_PRIVATE_KEY configured):
 *
 *   npm run seed:credentials --prefix backend
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const API_BASE = (process.env.SEED_API_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

const SEED_TRADERS = [
  {
    email: "ananya.deshmukh@samajh.demo",
    displayName: "Ananya Deshmukh (NISM VIII)",
    sessions: [
      { concept: "Mark-to-Market (MTM) Margin: Daily settlement of futures P&L.", examinerScore: 94, stressScore: 92 },
      { concept: "Stop-Loss & Overnight Gap Risk: Stop-loss triggers do not guarantee exit price on gaps.", examinerScore: 92, stressScore: 95 },
      { concept: "Market-Wide Circuit Breakers & Margin Halts: 10% circuit halts freeze exits.", examinerScore: 90, stressScore: 93 },
      { concept: "Option Buyer vs Writer Payoff Asymmetry: Writers face unlimited downside.", examinerScore: 91, stressScore: 89 },
    ],
  },
  {
    email: "aarav.mehta@samajh.demo",
    displayName: "Aarav Mehta (NISM VIII)",
    sessions: [
      { concept: "Mark-to-Market (MTM) Margin: Daily settlement of futures P&L.", examinerScore: 91, stressScore: 88 },
      { concept: "Stop-Loss & Overnight Gap Risk: Stop-loss triggers do not guarantee exit price on gaps.", examinerScore: 86, stressScore: 90 },
      { concept: "Market-Wide Circuit Breakers & Margin Halts: 10% circuit halts freeze exits.", examinerScore: 84, stressScore: 85 },
    ],
  },
  {
    email: "diya.nair@samajh.demo",
    displayName: "Diya Nair (NISM VIII)",
    sessions: [
      { concept: "Mark-to-Market (MTM) Margin: Daily settlement of futures P&L.", examinerScore: 82, stressScore: 84 },
      { concept: "Stop-Loss & Overnight Gap Risk: Stop-loss triggers do not guarantee exit price on gaps.", examinerScore: 80, stressScore: 82 },
      { concept: "Option Buyer vs Writer Payoff Asymmetry: Writers face unlimited downside.", examinerScore: 85, stressScore: 81 },
    ],
  },
  {
    email: "rohan.kulkarni@samajh.demo",
    displayName: "Rohan Kulkarni (NISM VIII)",
    sessions: [
      { concept: "Mark-to-Market (MTM) Margin: Daily settlement of futures P&L.", examinerScore: 79, stressScore: 74 },
      { concept: "Market-Wide Circuit Breakers & Margin Halts: 10% circuit halts freeze exits.", examinerScore: 76, stressScore: 78 },
      { concept: "Option Buyer vs Writer Payoff Asymmetry: Writers face unlimited downside.", examinerScore: 74, stressScore: 72 },
    ],
  },
  {
    email: "kabir.verma@samajh.demo",
    displayName: "Kabir Verma (NISM VIII)",
    sessions: [
      { concept: "Mark-to-Market (MTM) Margin: Daily settlement of futures P&L.", examinerScore: 68, stressScore: 62 },
      { concept: "Stop-Loss & Overnight Gap Risk: Stop-loss triggers do not guarantee exit price on gaps.", examinerScore: 64, stressScore: 60 },
    ],
  },
];

async function initFirebaseAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(BACKEND_ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : path.resolve(BACKEND_ROOT, "service-account.json");

  try {
    await access(credPath);
  } catch {
    throw new Error(
      `Missing Firebase Admin service account at ${credPath}. Place your GCP service-account.json in backend/ before running seed:credentials.`
    );
  }

  const serviceAccount = JSON.parse(await readFile(credPath, "utf-8"));
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return admin.auth();
}

async function getOrCreateAuthUser(auth, trader) {
  try {
    const existing = await auth.getUserByEmail(trader.email);
    return existing;
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    return auth.createUser({
      email: trader.email,
      displayName: trader.displayName,
      password: `SamajhSeed!${crypto.randomBytes(6).toString("hex")}`,
      emailVerified: true,
    });
  }
}

async function pollOnchainUntilSettled(credentialId, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${API_BASE}/api/credential/${encodeURIComponent(credentialId)}/onchain-status`);
    if (res.ok) {
      const data = await res.json();
      if (data.onchain_status === "confirmed" || data.onchain_status === "failed") {
        return data;
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { onchain_status: "timeout" };
}

async function main() {
  console.log(`[Seed] Initializing Firebase Admin SDK & Firestore...`);
  const auth = await initFirebaseAdmin();
  await initDatabase();

  // Verify backend server is reachable
  const healthRes = await fetch(`${API_BASE}/api/health`).catch(() => null);
  if (!healthRes || !healthRes.ok) {
    throw new Error(
      `Backend server is not reachable at ${API_BASE}. Start it first with: npm run dev --prefix backend`
    );
  }

  for (const trader of SEED_TRADERS) {
    const fbUser = await getOrCreateAuthUser(auth, trader);
    const customToken = await auth.createCustomToken(fbUser.uid, { role: "trader" });

    // 1. Sync trader role into Firestore users collection via API
    await fetch(`${API_BASE}/api/users/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: fbUser.uid,
        displayName: trader.displayName,
        email: trader.email,
        role: "trader",
      }),
    });

    // 2. Seed completed verification sessions tied to this real Firebase UID
    for (const sess of trader.sessions) {
      await createSession({
        sessionId: `seed_${crypto.randomUUID()}`,
        uid: fbUser.uid,
        userEmail: trader.email,
        concept: sess.concept,
        examinerScore: sess.examinerScore,
        stressScore: sess.stressScore,
      });
    }

    // 3. Call the real POST /api/credential/generate endpoint (triggers HMAC signing + real Amoy SBT mint)
    const genRes = await fetch(`${API_BASE}/api/credential/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customToken}`,
        "X-Firebase-Uid": fbUser.uid,
        "X-Firebase-Email": trader.email,
        "X-User-Role": "trader",
        "X-User-Name": trader.displayName,
      },
      body: JSON.stringify({}),
    });

    const genData = await genRes.json();
    if (!genRes.ok) {
      throw new Error(`Failed to generate credential for ${trader.email}: ${genData.error}`);
    }

    const credId = genData.credential.credentialId;

    // 4. Opt in to employer discoverability via PATCH /api/credential/discoverable
    await fetch(`${API_BASE}/api/credential/discoverable`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customToken}`,
        "X-Firebase-Uid": fbUser.uid,
        "X-User-Role": "trader",
      },
      body: JSON.stringify({ discoverable: true }),
    });

    // 5. Wait for real Polygon Amoy confirmation
    const chain = await pollOnchainUntilSettled(credId);
    console.log(
      `[Seed] ${trader.displayName} -> /verify/${credId} | overall=${genData.credential.overall_score} | onchain=${chain.onchain_status}${
        chain.txHash ? ` (${chain.explorerUrl})` : ""
      }`
    );
  }

  console.log("[Seed] Done! All real seed credentials generated & opted into employer matches.");
}

main().catch((err) => {
  console.error("[Seed] Error:", err.message);
  process.exit(1);
});
