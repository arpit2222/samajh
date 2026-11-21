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
    sessionId: doc.sessionId,
    uid: doc.uid ?? null,
    userEmail: doc.userEmail ?? null,
    rawText: doc.rawText ?? "",
    concept: doc.concept ?? "",
    analogy: doc.analogy ?? "",
    turns: doc.turns ?? [],
    examinerScore: doc.examinerScore ?? null,
    weakSubtopic: doc.weakSubtopic ?? null,
    rationale: doc.rationale ?? null,
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
  } catch (err) {
    // Some Firestore MongoDB-compatible tiers manage indexes via console; don't fail startup
    console.warn(`[GCP DB] Index check notice on api_keys: ${err.message}`);
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


