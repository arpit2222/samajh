import { MongoClient } from "mongodb";
import { Firestore } from "@google-cloud/firestore";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_SERVICE_ACCOUNT_PATH = path.resolve(BACKEND_ROOT, "service-account.json");
const SCENARIO_BANK_PATH = path.resolve(__dirname, "../data/scenarioBank.json");

let mongoClient = null;
let mongoDb = null;
let nativeFirestore = null;
let mode = "uninitialized"; // "firestore-mongo" | "firestore-native" | "memory"

const memoryStore = {
  sessions: new Map(),
  scenarios: [],
  users: new Map(),
  credentials: new Map(), // keyed by userId
  requisitions: new Map(), // keyed by requisition id
  apiKeys: new Map(), // keyed by api key id
  riskFlags: new Map(), // keyed by risk flag id
  gauntletRuns: new Map(), // keyed by gauntlet run id
  discussionThreads: new Map(), // keyed by weak_subtopic
  brokerConnections: new Map(), // keyed by `${userId}:${broker}`
  cohortClusters: new Map(), // keyed by partner_id (aggregate-only)
};

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize GCP database layer:
 * 1. Google Cloud Firestore in MongoDB-compatible mode via MONGO_CONNECTION_STRING (or MONGODB_URI)
 * 2. Google Cloud Firestore in Native mode (when service-account.json or GOOGLE_CLOUD_PROJECT / Cloud Run ADC is set)
 * 3. Local in-memory Map fallback (when no GCP credentials are configured yet)
 *
 * Collections:
 *   - sessions  (read/write per user verification flow)
 *   - scenarios (seeded once from scenarioBank.json, read-only at runtime)
 */
export async function initDatabase() {
  const mongoUri =
    process.env.MONGO_CONNECTION_STRING?.trim() || process.env.MONGODB_URI?.trim();
  const dbName = process.env.MONGODB_DB_NAME?.trim() || "samajh";

  // Priority 1: GCP Firestore in MongoDB-compatible mode
  if (mongoUri) {
    try {
      mongoClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
      await mongoClient.connect();
      mongoDb = mongoClient.db(dbName);
      mode = "firestore-mongo";
      await seedScenariosIfNeeded();
      await ensureApiKeyIndexes();
      console.log(`[GCP DB] Connected to Firestore (MongoDB-compatible mode), db="${dbName}"`);
      return { mode };
    } catch (err) {
      console.warn(`[GCP DB] Could not connect via MONGO_CONNECTION_STRING (${err.message}).`);
    }
  }

  // Priority 2: GCP Firestore (Native mode)
  const configuredCredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const resolvedCredPath = configuredCredPath
    ? path.resolve(BACKEND_ROOT, configuredCredPath)
    : DEFAULT_SERVICE_ACCOUNT_PATH;
  const hasServiceAccountFile = await fileExists(resolvedCredPath);
  const gcpProject = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const runningOnCloudRun = Boolean(process.env.K_SERVICE);

  if (hasServiceAccountFile || gcpProject || runningOnCloudRun) {
    try {
      const firestoreOptions = {};
      if (hasServiceAccountFile) {
        firestoreOptions.keyFilename = resolvedCredPath;
      }
      if (gcpProject) {
        firestoreOptions.projectId = gcpProject;
      }
      if (process.env.FIRESTORE_DATABASE_ID?.trim()) {
        firestoreOptions.databaseId = process.env.FIRESTORE_DATABASE_ID.trim();
      }

      nativeFirestore = new Firestore(firestoreOptions);
      await nativeFirestore.collection("scenarios").limit(1).get();
      mode = "firestore-native";
      await seedScenariosIfNeeded();
      console.log(
        `[GCP DB] Connected to Google Cloud Firestore (Native mode)${
          gcpProject ? `, project="${gcpProject}"` : ""
        }`
      );
      return { mode };
    } catch (err) {
      nativeFirestore = null;
      console.warn(
        `[GCP DB] Could not initialize GCP Firestore Native mode (${err.message}). Falling back to local in-memory store.`
      );
    }
  }

  // Priority 3: Local fallback
  mode = "memory";
  await seedScenariosIntoMemory();
  console.log(
    "[GCP DB] MONGO_CONNECTION_STRING not set — running with local in-memory store. " +
      "Set MONGO_CONNECTION_STRING in backend/.env to connect Firestore (MongoDB-compatible mode)."
  );
  return { mode };
}

export function getDbMode() {
  return mode;
}

export function getDbLabel() {
  if (mode === "firestore-mongo") return "Firestore (MongoDB)";
  if (mode === "firestore-native") return "Firestore (Native)";
  return "Local Memory";
}

export async function loadScenarioBankFromDisk() {
  try {
    const raw = await readFile(SCENARIO_BANK_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function seedScenariosIntoMemory() {
  memoryStore.scenarios = await loadScenarioBankFromDisk();
}

/**
 * Seed the `scenarios` collection once from data/scenarioBank.json.
 * Never written to at runtime after initial seed.
 */
async function seedScenariosIfNeeded() {
  const bank = await loadScenarioBankFromDisk();
  if (bank.length === 0) return;

  if (mode === "firestore-mongo" && mongoDb) {
    const col = mongoDb.collection("scenarios");
    const existingCount = await col.countDocuments();
    if (existingCount === 0) {
      await col.insertMany(bank.map((s) => ({ ...s })));
      console.log(`[GCP DB] Seeded ${bank.length} curated scenarios into Firestore 'scenarios' collection.`);
    } else if (existingCount < bank.length) {
      for (const s of bank) {
        const key = s.id ? { id: s.id } : { concept_tag: s.concept_tag, date: s.date };
        await col.updateOne(key, { $set: { ...s } }, { upsert: true });
      }
      console.log(`[GCP DB] Synced curated scenarios bank up to ${bank.length} entries.`);
    }
    return;
  }

  if (mode === "firestore-native" && nativeFirestore) {
    const col = nativeFirestore.collection("scenarios");
    const snap = await col.limit(1).get();
    if (snap.empty) {
      const batch = nativeFirestore.batch();
      for (const item of bank) {
        const ref = item.concept_tag ? col.doc(String(item.concept_tag)) : col.doc();
        batch.set(ref, item);
      }
      await batch.commit();
      console.log(`[GCP DB] Seeded ${bank.length} curated scenarios into Firestore 'scenarios' collection.`);
    }
  }
}

export async function createSession(doc) {
  const session = {
    sessionId: doc.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    uid: doc.uid ?? null,
    userEmail: doc.userEmail ?? null,
    externalUserRef: doc.externalUserRef ?? null,
    partnerId: doc.partnerId ?? null,
    instituteId: doc.instituteId ?? null,
    language: doc.language ?? "en-IN",
    nismModule: doc.nismModule ?? "series-viii",
    rawText: doc.rawText ?? "",
    concept: doc.concept ?? "",
    analogy: doc.analogy ?? "",
    turns: doc.turns ?? [],
    examinerScore: doc.examinerScore ?? null,
    weakSubtopic: doc.weakSubtopic ?? null,
    rationale: doc.rationale ?? doc.examinerRationale ?? null,
    examinerRationale: doc.examinerRationale ?? doc.rationale ?? null,
    stressScenarioTag: doc.stressScenarioTag ?? null,
    stressScenarioEvent: doc.stressScenarioEvent ?? null,
    stressScenarioDate: doc.stressScenarioDate ?? null,
    stressUserReasoning: doc.stressUserReasoning ?? null,
    stressScore: doc.stressScore ?? null,
    stressFeedback: doc.stressFeedback ?? null,
    combinedMasteryScore: doc.combinedMasteryScore ?? null,
    timestamp: new Date().toISOString(),
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb.collection("sessions").insertOne({ ...session });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("sessions").doc(session.sessionId).set(session);
  } else {
    memoryStore.sessions.set(session.sessionId, { ...session });
  }
  return session;
}

export async function getSession(sessionId) {
  if (!sessionId) return null;

  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("sessions").findOne({ sessionId });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }

  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore.collection("sessions").doc(sessionId).get();
    return snap.exists ? snap.data() : null;
  }

  return memoryStore.sessions.get(sessionId) ?? null;
}

export async function updateSession(sessionId, patch) {
  if (!sessionId) throw new Error("sessionId is required");
  const updatedPatch = {
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb.collection("sessions").updateOne({ sessionId }, { $set: updatedPatch });
    return getSession(sessionId);
  }

  if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("sessions").doc(sessionId).set(updatedPatch, { merge: true });
    return getSession(sessionId);
  }

  const existing = memoryStore.sessions.get(sessionId);
  if (!existing) return null;
  const merged = { ...existing, ...updatedPatch };
  memoryStore.sessions.set(sessionId, merged);
  return merged;
}

export async function listSessionsByUid(uid, limit = 20) {
  if (!uid) return [];
  if (mode === "firestore-mongo" && mongoDb) {
    const docs = await mongoDb
      .collection("sessions")
      .find({ uid })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    return docs.map(({ _id, ...rest }) => rest);
  }
  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore
      .collection("sessions")
      .where("uid", "==", uid)
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data());
  }
  return [...memoryStore.sessions.values()]
    .filter((s) => s.uid === uid)
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
    .slice(0, limit);
}

/**
 * Read-only retrieval of curated historical scenarios from Firestore `scenarios` collection.
 */
export async function listScenarios() {
  if (mode === "firestore-mongo" && mongoDb) {
    const docs = await mongoDb.collection("scenarios").find({}).toArray();
    if (docs.length > 0) {
      return docs.map(({ _id, ...rest }) => rest);
    }
  }

  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore.collection("scenarios").get();
    if (!snap.empty) {
      return snap.docs.map((d) => d.data());
    }
  }

  if (memoryStore.scenarios.length > 0) {
    return [...memoryStore.scenarios];
  }

  return loadScenarioBankFromDisk();
}

/* ============================================================================
 * PROMPT 4 ADDITIVE COLLECTIONS: users, credentials, job_requisitions
 * Credentials are created ONLY via POST /api/credential/generate (including
 * one-time seeding via backend/scripts/seedCredentials.js).
 * ============================================================================ */

export async function upsertUser({ uid, displayName = "", email = "", photoURL = "", role = "trader" }) {
  const safeRole = role === "employer" ? "employer" : "trader";
  const now = new Date().toISOString();
  const existing = await getUser(uid);
  const doc = {
    uid,
    displayName: displayName || existing?.displayName || email?.split("@")[0] || "Learner",
    email: email || existing?.email || "",
    photoURL: photoURL || existing?.photoURL || "",
    role: safeRole,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb.collection("users").updateOne({ uid }, { $set: doc }, { upsert: true });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("users").doc(uid).set(doc, { merge: true });
  } else {
    memoryStore.users.set(uid, doc);
  }
  return doc;
}

export async function getUser(uid) {
  if (!uid) return null;
  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("users").findOne({ uid });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }
  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore.collection("users").doc(uid).get();
    return snap.exists ? snap.data() : null;
  }
  return memoryStore.users.get(uid) ?? null;
}

export async function upsertCredential(doc) {
  const record = {
    ...doc,
    updatedAt: new Date().toISOString(),
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb
      .collection("credentials")
      .updateOne({ userId: record.userId }, { $set: record }, { upsert: true });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("credentials").doc(record.userId).set(record, { merge: true });
  } else {
    memoryStore.credentials.set(record.userId, record);
  }
  return record;
}

export async function getCredentialByUserId(userId) {
  if (!userId) return null;
  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("credentials").findOne({ userId });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }
  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore.collection("credentials").doc(userId).get();
    return snap.exists ? snap.data() : null;
  }
  return memoryStore.credentials.get(userId) ?? null;
}

export async function getCredentialBySlug(credentialId) {
  if (!credentialId) return null;
  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("credentials").findOne({ credentialId });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }
  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore
      .collection("credentials")
      .where("credentialId", "==", credentialId)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0].data();
  }
  for (const cred of memoryStore.credentials.values()) {
    if (cred.credentialId === credentialId) return cred;
  }
  return null;
}

export async function updateCredentialDiscoverable(userId, discoverable) {
  const existing = await getCredentialByUserId(userId);
  if (!existing) return null;
  const updated = {
    ...existing,
    discoverable: Boolean(discoverable),
    updatedAt: new Date().toISOString(),
  };
  return upsertCredential(updated);
}

export async function listDiscoverableCredentials() {
  if (mode === "firestore-mongo" && mongoDb) {
    const docs = await mongoDb.collection("credentials").find({ discoverable: true }).toArray();
    return docs.map(({ _id, ...rest }) => rest);
  }
  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore
      .collection("credentials")
      .where("discoverable", "==", true)
      .get();
    return snap.docs.map((d) => d.data());
  }
  return [...memoryStore.credentials.values()].filter((c) => c.discoverable === true);
}

export async function createRequisition(doc) {
  const record = {
    id: doc.id,
    employerId: doc.employerId,
    title: doc.title,
    required_concepts: doc.required_concepts,
    status: doc.status || "open",
    created_at: new Date().toISOString(),
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb.collection("job_requisitions").insertOne({ ...record });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("job_requisitions").doc(record.id).set(record);
  } else {
    memoryStore.requisitions.set(record.id, record);
  }
  return record;
}

export async function getRequisition(id) {
  if (!id) return null;
  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("job_requisitions").findOne({ id });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }
  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore.collection("job_requisitions").doc(id).get();
    return snap.exists ? snap.data() : null;
  }
  return memoryStore.requisitions.get(id) ?? null;
}

export async function listRequisitionsByEmployer(employerId) {
  if (!employerId) return [];
  if (mode === "firestore-mongo" && mongoDb) {
    const docs = await mongoDb
      .collection("job_requisitions")
      .find({ employerId })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map(({ _id, ...rest }) => rest);
  }
  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore
      .collection("job_requisitions")
      .where("employerId", "==", employerId)
      .get();
    return snap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }
  return [...memoryStore.requisitions.values()]
    .filter((r) => r.employerId === employerId)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/* ============================================================================
 * PROMPT 8 COLLECTION: api_keys
 * Indexed on keyHash (exact-match lookup) and userId (listing user's own keys).
 * NEVER stores plaintext API keys — only SHA-256 keyHash and 12-char keyPrefix.
 * ============================================================================ */

async function ensureApiKeyIndexes() {
  if (mode !== "firestore-mongo" || !mongoDb) return;
  try {
    const col = mongoDb.collection("api_keys");
    await col.createIndex({ keyHash: 1 }, { unique: true });
    await col.createIndex({ userId: 1 });
    const rfCol = mongoDb.collection("risk_flags");
    await rfCol.createIndex({ external_user_ref: 1 });
    await rfCol.createIndex({ partnerUserId: 1, external_user_ref: 1 });
    const grCol = mongoDb.collection("gauntlet_runs");
    await grCol.createIndex({ scenario_set_id: 1, composite_score: -1, completed_at: 1 });
    const dtCol = mongoDb.collection("discussion_threads");
    await dtCol.createIndex({ weak_subtopic: 1 }, { unique: true });
    const bcCol = mongoDb.collection("broker_connections");
    await bcCol.createIndex({ userId: 1, broker: 1 }, { unique: true });
    const ccCol = mongoDb.collection("cohort_clusters");
    await ccCol.createIndex({ partner_id: 1 }, { unique: true });
  } catch (err) {
    // Some Firestore MongoDB-compatible tiers manage indexes via console; don't fail startup
    console.warn(`[GCP DB] Index check notice on api_keys/risk_flags: ${err.message}`);
  }
}

export async function createApiKeyRecord({ id, userId, keyHash, keyPrefix, label }) {
  const now = new Date().toISOString();
  const doc = {
    id,
    userId,
    keyHash,
    keyPrefix,
    label: label || "Unnamed key",
    createdAt: now,
    revokedAt: null,
    lastUsedAt: null,
    requestCount: 0,
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb.collection("api_keys").insertOne({ ...doc });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("api_keys").doc(id).set(doc);
  } else {
    memoryStore.apiKeys.set(id, { ...doc });
  }
  return doc;
}

export async function listApiKeysByUserId(userId) {
  if (!userId) return [];
  let rows = [];

  if (mode === "firestore-mongo" && mongoDb) {
    rows = await mongoDb
      .collection("api_keys")
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
  } else if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore
      .collection("api_keys")
      .where("userId", "==", userId)
      .get();
    rows = snap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  } else {
    rows = [...memoryStore.apiKeys.values()]
      .filter((k) => k.userId === userId)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  // Never include keyHash in listed keys
  return rows.map((k) => ({
    id: k.id,
    keyPrefix: k.keyPrefix,
    label: k.label,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt ?? null,
    revokedAt: k.revokedAt ?? null,
    requestCount: Number(k.requestCount || 0),
  }));
}

export async function findApiKeyByHash(keyHash) {
  if (!keyHash) return null;

  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("api_keys").findOne({ keyHash });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }

  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore
      .collection("api_keys")
      .where("keyHash", "==", keyHash)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0].data();
  }

  for (const doc of memoryStore.apiKeys.values()) {
    if (doc.keyHash === keyHash) return doc;
  }
  return null;
}

export async function revokeApiKeyForUser(id, userId) {
  if (!id || !userId) return { status: "not_found" };

  let existing = null;
  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("api_keys").findOne({ id });
    if (doc) {
      const { _id, ...rest } = doc;
      existing = rest;
    }
  } else if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore.collection("api_keys").doc(id).get();
    if (snap.exists) existing = snap.data();
  } else {
    existing = memoryStore.apiKeys.get(id) ?? null;
  }

  // Identical not_found whether key doesn't exist OR belongs to another user
  if (!existing || existing.userId !== userId) {
    return { status: "not_found" };
  }

  if (existing.revokedAt) {
    return { status: "already_revoked" };
  }

  const revokedAt = new Date().toISOString();
  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb.collection("api_keys").updateOne({ id, userId }, { $set: { revokedAt } });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("api_keys").doc(id).set({ revokedAt }, { merge: true });
  } else {
    memoryStore.apiKeys.set(id, { ...existing, revokedAt });
  }

  return { status: "revoked", id, revokedAt };
}

export async function recordApiKeyUsage(id) {
  if (!id) return;
  const lastUsedAt = new Date().toISOString();

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb
      .collection("api_keys")
      .updateOne({ id }, { $set: { lastUsedAt }, $inc: { requestCount: 1 } });
    return;
  }

  if (mode === "firestore-native" && nativeFirestore) {
    const ref = nativeFirestore.collection("api_keys").doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      const prevCount = Number(snap.data()?.requestCount || 0);
      await ref.set({ lastUsedAt, requestCount: prevCount + 1 }, { merge: true });
    }
    return;
  }

  const existing = memoryStore.apiKeys.get(id);
  if (existing) {
    memoryStore.apiKeys.set(id, {
      ...existing,
      lastUsedAt,
      requestCount: Number(existing.requestCount || 0) + 1,
    });
  }
}

/* ============================================================================
 * PHASE 1 COLLECTION: risk_flags (B2B Broker Safeguard Webhook + Clearance)
 * Stores ONLY anonymized external_user_ref + taxonomy subtopic (zero PII/₹).
 * `cleared` can ONLY be flipped to true by Samajh's own scoring pipeline.
 * ============================================================================ */

export async function createRiskFlagRecord({
  id,
  partnerUserId,
  external_user_ref,
  flagged_subtopic,
  flagged_at,
}) {
  const now = new Date().toISOString();
  const doc = {
    id,
    partnerUserId,
    external_user_ref,
    flagged_subtopic,
    flagged_at: flagged_at || now,
    cleared: false,
    cleared_at: null,
    credential_id: null,
    passing_score: null,
    clearing_session_id: null,
    createdAt: now,
    updatedAt: now,
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb.collection("risk_flags").insertOne({ ...doc });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("risk_flags").doc(id).set(doc);
  } else {
    memoryStore.riskFlags.set(id, { ...doc });
  }
  return doc;
}

export async function getLatestRiskFlag(external_user_ref, partnerUserId = null) {
  if (!external_user_ref) return null;
  let rows = [];

  if (mode === "firestore-mongo" && mongoDb) {
    const query = partnerUserId
      ? { external_user_ref, partnerUserId }
      : { external_user_ref };
    rows = await mongoDb
      .collection("risk_flags")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
    if (rows.length === 0) return null;
    const { _id, ...rest } = rows[0];
    return rest;
  }

  if (mode === "firestore-native" && nativeFirestore) {
    let q = nativeFirestore
      .collection("risk_flags")
      .where("external_user_ref", "==", external_user_ref);
    if (partnerUserId) {
      q = q.where("partnerUserId", "==", partnerUserId);
    }
    const snap = await q.get();
    rows = snap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return rows[0] ?? null;
  }

  rows = [...memoryStore.riskFlags.values()]
    .filter(
      (r) =>
        r.external_user_ref === external_user_ref &&
        (!partnerUserId || r.partnerUserId === partnerUserId)
    )
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return rows[0] ?? null;
}

export async function clearMatchingRiskFlags({
  externalUserRef,
  matchedSubtopic,
  credentialId,
  passingScore,
  sessionId,
}) {
  if (!externalUserRef || !matchedSubtopic) return [];
  const cleared_at = new Date().toISOString();
  const patch = {
    cleared: true,
    cleared_at,
    credential_id: credentialId,
    passing_score: passingScore,
    clearing_session_id: sessionId,
    updatedAt: cleared_at,
  };

  if (mode === "firestore-mongo" && mongoDb) {
    const col = mongoDb.collection("risk_flags");
    const matching = await col
      .find({
        external_user_ref: externalUserRef,
        flagged_subtopic: matchedSubtopic,
        cleared: false,
      })
      .toArray();
    if (matching.length === 0) return [];
    const ids = matching.map((m) => m.id);
    await col.updateMany({ id: { $in: ids } }, { $set: patch });
    return matching.map(({ _id, ...rest }) => ({ ...rest, ...patch }));
  }

  if (mode === "firestore-native" && nativeFirestore) {
    const col = nativeFirestore.collection("risk_flags");
    const snap = await col
      .where("external_user_ref", "==", externalUserRef)
      .where("flagged_subtopic", "==", matchedSubtopic)
      .where("cleared", "==", false)
      .get();
    if (snap.empty) return [];
    const batch = nativeFirestore.batch();
    const clearedDocs = [];
    for (const docSnap of snap.docs) {
      batch.set(docSnap.ref, patch, { merge: true });
      clearedDocs.push({ ...docSnap.data(), ...patch });
    }
    await batch.commit();
    return clearedDocs;
  }

  const clearedDocs = [];
  for (const [id, rec] of memoryStore.riskFlags.entries()) {
    if (
      rec.external_user_ref === externalUserRef &&
      rec.flagged_subtopic === matchedSubtopic &&
      rec.cleared === false
    ) {
      const updated = { ...rec, ...patch };
      memoryStore.riskFlags.set(id, updated);
      clearedDocs.push(updated);
    }
  }
  return clearedDocs;
}

/* ============================================================================
 * PHASE 1 COLLECTION: gauntlet_runs (Comprehension Leaderboard)
 * Stores { id, userId, isGuest, composite_score, scenario_set_id, total_scenarios, completed_at }.
 * Raw userId is NEVER exposed by GET /api/gauntlet/leaderboard.
 * ============================================================================ */

export async function createGauntletRunRecord({
  id,
  userId,
  isGuest = false,
  composite_score,
  scenario_set_id = "nism-viii-gauntlet",
  total_scenarios = 0,
  completed_at,
}) {
  const doc = {
    id,
    userId,
    isGuest: Boolean(isGuest),
    composite_score: Math.max(0, Math.min(100, Math.round(Number(composite_score) || 0))),
    scenario_set_id: String(scenario_set_id || "nism-viii-gauntlet"),
    total_scenarios: Math.max(0, Math.round(Number(total_scenarios) || 0)),
    completed_at: completed_at || new Date().toISOString(),
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb.collection("gauntlet_runs").insertOne({ ...doc });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("gauntlet_runs").doc(id).set(doc);
  } else {
    memoryStore.gauntletRuns.set(id, { ...doc });
  }
  return doc;
}

export async function listGauntletRuns({ scenario_set_id = null, limit = 25 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  let rows = [];

  if (mode === "firestore-mongo" && mongoDb) {
    const query = scenario_set_id ? { scenario_set_id } : {};
    const docs = await mongoDb
      .collection("gauntlet_runs")
      .find(query)
      .sort({ composite_score: -1, completed_at: 1 })
      .limit(safeLimit)
      .toArray();
    rows = docs.map(({ _id, ...rest }) => rest);
  } else if (mode === "firestore-native" && nativeFirestore) {
    let q = nativeFirestore.collection("gauntlet_runs");
    if (scenario_set_id) {
      q = q.where("scenario_set_id", "==", scenario_set_id);
    }
    const snap = await q.get();
    rows = snap.docs.map((d) => d.data());
  } else {
    rows = [...memoryStore.gauntletRuns.values()].filter(
      (r) => !scenario_set_id || r.scenario_set_id === scenario_set_id
    );
  }

  // Deterministic sort: highest composite_score first, ties broken by earliest completed_at
  rows.sort((a, b) => {
    if (b.composite_score !== a.composite_score) {
      return b.composite_score - a.composite_score;
    }
    return String(a.completed_at || "").localeCompare(String(b.completed_at || ""));
  });

  return rows.slice(0, safeLimit);
}

/* ============================================================================
 * PHASE 1 COLLECTION: discussion_threads (Weak-Subtopic Discussion Circles)
 * One document per weak_subtopic from the existing taxonomy.
 * Flagged posts store flagged:true and are NEVER auto-deleted.
 * ============================================================================ */

async function getDiscussionThreadDoc(weak_subtopic) {
  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("discussion_threads").findOne({ weak_subtopic });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }
  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore.collection("discussion_threads").doc(weak_subtopic).get();
    return snap.exists ? snap.data() : null;
  }
  return memoryStore.discussionThreads.get(weak_subtopic) ?? null;
}

async function saveDiscussionThreadDoc(doc) {
  const updated = {
    ...doc,
    updatedAt: new Date().toISOString(),
  };
  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb
      .collection("discussion_threads")
      .updateOne({ weak_subtopic: updated.weak_subtopic }, { $set: updated }, { upsert: true });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore
      .collection("discussion_threads")
      .doc(updated.weak_subtopic)
      .set(updated, { merge: true });
  } else {
    memoryStore.discussionThreads.set(updated.weak_subtopic, updated);
  }
  return updated;
}

export async function appendDiscussionPost({ weak_subtopic, post }) {
  const existing = (await getDiscussionThreadDoc(weak_subtopic)) || {
    weak_subtopic,
    posts: [],
  };
  const posts = [post, ...(existing.posts || [])];
  await saveDiscussionThreadDoc({ weak_subtopic, posts });
  return post;
}

export async function getDiscussionPostsPaginated({ weak_subtopic, page = 1, limit = 10 }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const doc = await getDiscussionThreadDoc(weak_subtopic);
  const allPosts = doc?.posts || [];
  const total = allPosts.length;
  const start = (safePage - 1) * safeLimit;
  const items = allPosts.slice(start, start + safeLimit);
  return {
    weak_subtopic,
    page: safePage,
    limit: safeLimit,
    total_posts: total,
    total_pages: Math.max(1, Math.ceil(total / safeLimit)),
    posts: items,
  };
}

export async function flagDiscussionPost({ weak_subtopic, postId }) {
  const doc = await getDiscussionThreadDoc(weak_subtopic);
  if (!doc || !Array.isArray(doc.posts)) return null;

  let target = null;
  const flaggedAt = new Date().toISOString();
  const updatedPosts = doc.posts.map((p) => {
    if (p.id !== postId) return p;
    target = {
      ...p,
      flagged: true,
      flagged_at: p.flagged_at || flaggedAt,
      report_count: Number(p.report_count || 0) + 1,
    };
    return target;
  });

  if (!target) return null;
  await saveDiscussionThreadDoc({ weak_subtopic, posts: updatedPosts });
  return target;
}

/* ============================================================================
 * PHASE 2 COLLECTION: broker_connections (Read-Only Zerodha Kite Connect)
 * Stores ONLY AES-256-GCM encrypted access/refresh token blobs + metadata.
 * NEVER stores plaintext tokens, Zerodha passwords/PINs, or write scopes.
 * ============================================================================ */

function brokerConnKey(userId, broker = "zerodha_kite") {
  return `${userId}:${broker}`;
}

export async function upsertBrokerConnection({
  userId,
  broker = "zerodha_kite",
  scope = "read_only",
  encryptedAccessToken,
  encryptedRefreshToken = null,
  connectedAt,
  expiresAt = null,
  lastSyncedAt = null,
  needsReconnect = false,
}) {
  if (!userId) throw new Error("userId is required to save a broker connection.");
  const now = new Date().toISOString();
  const doc = {
    id: brokerConnKey(userId, broker),
    userId,
    broker,
    scope: "read_only", // strictly enforced read-only — never trading/write
    encryptedAccessToken,
    encryptedRefreshToken: encryptedRefreshToken || null,
    connectedAt: connectedAt || now,
    expiresAt: expiresAt || null,
    lastSyncedAt: lastSyncedAt || null,
    needsReconnect: Boolean(needsReconnect),
    updatedAt: now,
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb
      .collection("broker_connections")
      .updateOne({ userId, broker }, { $set: doc }, { upsert: true });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("broker_connections").doc(doc.id).set(doc, { merge: true });
  } else {
    memoryStore.brokerConnections.set(doc.id, { ...doc });
  }
  return doc;
}

export async function getBrokerConnection(userId, broker = "zerodha_kite") {
  if (!userId) return null;
  const key = brokerConnKey(userId, broker);

  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("broker_connections").findOne({ userId, broker });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }

  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore.collection("broker_connections").doc(key).get();
    return snap.exists ? snap.data() : null;
  }

  return memoryStore.brokerConnections.get(key) ?? null;
}

export async function deleteBrokerConnection(userId, broker = "zerodha_kite") {
  if (!userId) return false;
  const key = brokerConnKey(userId, broker);

  if (mode === "firestore-mongo" && mongoDb) {
    const res = await mongoDb.collection("broker_connections").deleteOne({ userId, broker });
    return res.deletedCount > 0;
  }

  if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("broker_connections").doc(key).delete();
    return true;
  }

  return memoryStore.brokerConnections.delete(key);
}

/* ============================================================================
 * PHASE 2 COLLECTION: cohort_clusters (Aggregate-Only Partner Weak-Topic Clusters)
 * NEVER stores any individual userId, uid, email, displayName, or sessionId.
 * Populated ONLY by the scheduled batch clustering job (never per-request).
 * ============================================================================ */

export async function listSessionsForClustering({ partnerId = null, limit = 1000 } = {}) {
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 1000));
  let docs = [];

  if (mode === "firestore-mongo" && mongoDb) {
    const query = partnerId ? { partnerId } : {};
    const rows = await mongoDb.collection("sessions").find(query).limit(safeLimit).toArray();
    docs = rows.map(({ _id, ...rest }) => rest);
  } else if (mode === "firestore-native" && nativeFirestore) {
    let q = nativeFirestore.collection("sessions");
    if (partnerId) q = q.where("partnerId", "==", partnerId);
    const snap = await q.limit(safeLimit).get();
    docs = snap.docs.map((d) => d.data());
  } else {
    docs = [...memoryStore.sessions.values()]
      .filter((s) => !partnerId || s.partnerId === partnerId || s.instituteId === partnerId)
      .slice(0, safeLimit);
  }

  // Project ONLY non-PII fields needed for weak-topic embedding & clustering
  return docs
    .filter((s) => s.weakSubtopic || s.examinerRationale || s.stressScenarioTag)
    .map((s) => ({
      partner_id: s.partnerId || s.instituteId || "default",
      weak_subtopic: String(s.weakSubtopic || s.stressScenarioTag || "general_market_risk"),
      rationale: String(s.examinerRationale || s.examinerFeedback || s.concept || ""),
    }));
}

export async function upsertCohortClusterSummary(summary) {
  const partnerId = String(summary?.partner_id || "default").trim();
  const safeDoc = {
    partner_id: partnerId,
    computed_at: summary.computed_at || new Date().toISOString(),
    total_sessions_analyzed: Number(summary.total_sessions_analyzed || 0),
    cluster_count: Array.isArray(summary.clusters) ? summary.clusters.length : 0,
    vector_backend: summary.vector_backend || "local-cosine-index",
    clusters: (summary.clusters || []).map((c, idx) => ({
      rank: idx + 1,
      cluster_id: String(c.cluster_id),
      label: String(c.label),
      primary_subtopic: String(c.primary_subtopic),
      session_count: Number(c.session_count || 0),
      pct_of_cohort: Number(c.pct_of_cohort || 0),
      top_themes: Array.isArray(c.top_themes) ? c.top_themes.slice(0, 4).map(String) : [],
    })),
  };

  if (mode === "firestore-mongo" && mongoDb) {
    await mongoDb
      .collection("cohort_clusters")
      .updateOne({ partner_id: partnerId }, { $set: safeDoc }, { upsert: true });
  } else if (mode === "firestore-native" && nativeFirestore) {
    await nativeFirestore.collection("cohort_clusters").doc(partnerId).set(safeDoc, { merge: true });
  } else {
    memoryStore.cohortClusters.set(partnerId, safeDoc);
  }
  return safeDoc;
}

export async function getCohortClusterSummary(partnerId) {
  const pid = String(partnerId || "default").trim();
  if (mode === "firestore-mongo" && mongoDb) {
    const doc = await mongoDb.collection("cohort_clusters").findOne({ partner_id: pid });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }
  if (mode === "firestore-native" && nativeFirestore) {
    const snap = await nativeFirestore.collection("cohort_clusters").doc(pid).get();
    return snap.exists ? snap.data() : null;
  }
  return memoryStore.cohortClusters.get(pid) ?? null;
}





