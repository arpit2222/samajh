const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080"
).replace(/\/$/, "");

const DEFAULT_TIMEOUT_MS = 50_000;

let activeUserContext = null;

export function setApiUser(user) {
  activeUserContext = user && user.uid ? user : null;
}

function buildHeaders(extra = {}) {
  const headers = { ...extra };
  if (activeUserContext?.uid) {
    headers["X-Firebase-Uid"] = activeUserContext.uid;
  }
  if (activeUserContext?.email) {
    headers["X-Firebase-Email"] = activeUserContext.email;
  }
  if (activeUserContext?.role) {
    headers["X-User-Role"] = activeUserContext.role;
  }
  if (activeUserContext?.displayName) {
    headers["X-User-Name"] = activeUserContext.displayName;
  }
  return headers;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      headers: buildHeaders(options.headers),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The request timed out — please try again.");
    }
    throw new Error(
      "Could not reach the Samajh backend. Check your network connection or server status and try again."
    );
  } finally {
    clearTimeout(timer);
  }
}

async function parseApiResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: `Server returned status ${res.status}` };
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }
  return data;
}

export async function fetchHealth() {
  const res = await fetchWithTimeout(`${API_BASE}/api/health`, {}, 8000);
  return parseApiResponse(res);
}

export async function ingestMaterial({
  text,
  imageBase64,
  mimeType,
  language = "en-IN",
  module = "series-viii",
}) {
  const payload = imageBase64
    ? { imageBase64, mimeType: mimeType || "image/jpeg", language, module }
    : { text, language, module };

  const res = await fetchWithTimeout(`${API_BASE}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseApiResponse(res);
}

export async function sendTeachBack({ sessionId, userText }) {
  const res = await fetchWithTimeout(`${API_BASE}/api/teachback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, userText }),
  });
  return parseApiResponse(res);
}

export async function examineSession({ sessionId }) {
  const res = await fetchWithTimeout(`${API_BASE}/api/examine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return parseApiResponse(res);
}

export async function fetchStressScenario({ sessionId }) {
  const res = await fetchWithTimeout(`${API_BASE}/api/stresstest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return parseApiResponse(res);
}

export async function submitStressReasoning({ sessionId, user_reasoning }) {
  const res = await fetchWithTimeout(`${API_BASE}/api/stresstest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, user_reasoning }),
  });
  return parseApiResponse(res);
}

export async function fetchMultiScenarios() {
  const res = await fetchWithTimeout(`${API_BASE}/api/stresstest/multi`, {}, 10_000);
  return parseApiResponse(res);
}

export async function submitMultiScenarios({ answers }) {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/stresstest/multi`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    },
    65_000
  );
  return parseApiResponse(res);
}

/* --- Prompt 4: Users, Credentials & Employer Requisitions --- */

export async function syncUserProfile({ uid, displayName, email, photoURL, role }) {
  const res = await fetchWithTimeout(`${API_BASE}/api/users/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, displayName, email, photoURL, role }),
  });
  return parseApiResponse(res);
}

export async function fetchConceptCatalog() {
  const res = await fetchWithTimeout(`${API_BASE}/api/users/concepts`, {}, 10_000);
  return parseApiResponse(res);
}

export async function fetchMyCredential() {
  const res = await fetchWithTimeout(`${API_BASE}/api/credential/me`, {}, 10_000);
  return parseApiResponse(res);
}

export async function generateMyCredential() {
  const res = await fetchWithTimeout(`${API_BASE}/api/credential/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return parseApiResponse(res);
}

export async function setCredentialDiscoverable(discoverable) {
  const res = await fetchWithTimeout(`${API_BASE}/api/credential/discoverable`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discoverable }),
  });
  return parseApiResponse(res);
}

/**
 * PUBLIC endpoint — zero auth required. Works in incognito tabs.
 */
export async function verifyPublicCredential(credentialId) {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/verify/${encodeURIComponent(credentialId)}`,
    {},
    10_000
  );
  return parseApiResponse(res);
}

/**
 * PUBLIC polling endpoint for non-blocking Polygon Amoy SBT anchor status.
 */
export async function fetchCredentialOnchainStatus(credentialId) {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/credential/${encodeURIComponent(credentialId)}/onchain-status`,
    {},
    8_000
  );
  return parseApiResponse(res);
}

export async function createJobRequisition({ title, required_concepts }) {
  const res = await fetchWithTimeout(`${API_BASE}/api/requisitions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, required_concepts }),
  });
  return parseApiResponse(res);
}

export async function fetchMyRequisitions() {
  const res = await fetchWithTimeout(`${API_BASE}/api/requisitions`, {}, 10_000);
  return parseApiResponse(res);
}

export async function fetchRequisitionMatches(requisitionId) {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/requisitions/${encodeURIComponent(requisitionId)}/matches`,
    {},
    10_000
  );
  return parseApiResponse(res);
}

export async function reviewPastTrade({ ratios, risk_tags, trade, note }) {
  // Strictly send ONLY anonymized ratios, risk_tags, bucketed trade, and optional note
  const res = await fetchWithTimeout(`${API_BASE}/api/trade-profile/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ratios, risk_tags, trade, note }),
  });
  return parseApiResponse(res);
}

/**
 * Loop-back: seeds a session directly for socraticAgent from a diagnosed concept_tag,
 * skipping ingestAgent and conceptAgent.
 */
export async function startTeachBackFromConceptTag({ concept_tag }) {
  const res = await fetchWithTimeout(`${API_BASE}/api/trade-profile/start-teachback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concept_tag }),
  });
  return parseApiResponse(res);
}

/* --- Prompt 8: Developer API Keys --- */

export function getApiBaseUrl() {
  return API_BASE;
}

export async function listDeveloperApiKeys() {
  const res = await fetchWithTimeout(`${API_BASE}/api/developer/keys`, {}, 10_000);
  return parseApiResponse(res);
}

export async function createDeveloperApiKey({ label } = {}) {
  const res = await fetchWithTimeout(`${API_BASE}/api/developer/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  return parseApiResponse(res);
}

export async function revokeDeveloperApiKey(id) {
  const res = await fetchWithTimeout(`${API_BASE}/api/developer/keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return parseApiResponse(res);
}

/* --- Phase 1 Prompt 2: Comprehension Leaderboard --- */

export async function fetchGauntletLeaderboard({
  scenario_set_id = "nism-viii-gauntlet",
  limit = 20,
} = {}) {
  const params = new URLSearchParams();
  if (scenario_set_id) params.set("scenario_set_id", scenario_set_id);
  if (limit) params.set("limit", String(limit));
  const res = await fetchWithTimeout(
    `${API_BASE}/api/gauntlet/leaderboard?${params.toString()}`,
    {},
    10_000
  );
  return parseApiResponse(res);
}

/* --- Phase 1 Prompt 3: Weak-Subtopic Discussion Circles --- */

export async function fetchDiscussionThread({
  weak_subtopic,
  page = 1,
  limit = 10,
  sessionId,
}) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (sessionId) params.set("sessionId", sessionId);

  const res = await fetchWithTimeout(
    `${API_BASE}/api/discussion/${encodeURIComponent(weak_subtopic)}?${params.toString()}`,
    {},
    10_000
  );

  if (res.status === 403) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      // ignore parse failure
    }
    return {
      locked: true,
      weak_subtopic,
      error:
        data?.error ||
        "Attempt this subtopic in Teach-Back or Stress-Test first to unlock its Discussion Circle.",
    };
  }

  return parseApiResponse(res);
}

export async function postToDiscussion({ weak_subtopic, text, sessionId }) {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/discussion/${encodeURIComponent(weak_subtopic)}/post`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sessionId }),
    }
  );
  return parseApiResponse(res);
}

export async function reportDiscussionPost({ weak_subtopic, postId }) {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/discussion/${encodeURIComponent(weak_subtopic)}/posts/${encodeURIComponent(
      postId
    )}/report`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  return parseApiResponse(res);
}

/* --- Phase 2 Prompt 4: Zerodha Kite Connect (Read-Only) --- */

export async function fetchKiteStatus() {
  const res = await fetchWithTimeout(`${API_BASE}/api/broker/kite/status`, {}, 10_000);
  return parseApiResponse(res);
}

export async function fetchKiteLoginUrl() {
  const res = await fetchWithTimeout(`${API_BASE}/api/broker/kite/login-url`, {}, 10_000);
  return parseApiResponse(res);
}

export async function exchangeKiteRequestToken(request_token) {
  const res = await fetchWithTimeout(`${API_BASE}/api/broker/kite/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_token }),
  });
  return parseApiResponse(res);
}

export async function syncKiteTrades() {
  const res = await fetchWithTimeout(`${API_BASE}/api/broker/kite/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (res.status === 401) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    const err = new Error(data?.error || "Zerodha Kite session expired.");
    err.needsReconnect = Boolean(data?.needs_reconnect);
    throw err;
  }
  return parseApiResponse(res);
}

export async function disconnectKite() {
  const res = await fetchWithTimeout(`${API_BASE}/api/broker/kite/disconnect`, {
    method: "DELETE",
  });
  return parseApiResponse(res);
}

/* --- Phase 2 Prompt 5: Angel One SmartAPI (Read-Only) --- */

export async function fetchAngelStatus() {
  const res = await fetchWithTimeout(`${API_BASE}/api/broker/angel/status`, {}, 10_000);
  return parseApiResponse(res);
}

export async function connectAngelSmartApi({ clientcode, password, totp }) {
  const res = await fetchWithTimeout(`${API_BASE}/api/broker/angel/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientcode, password, totp }),
  });
  return parseApiResponse(res);
}

export async function syncAngelTrades() {
  const res = await fetchWithTimeout(`${API_BASE}/api/broker/angel/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (res.status === 401) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    const err = new Error(data?.error || "Angel One SmartAPI session expired.");
    err.needsReconnect = Boolean(data?.needs_reconnect);
    throw err;
  }
  return parseApiResponse(res);
}

export async function disconnectAngel() {
  const res = await fetchWithTimeout(`${API_BASE}/api/broker/angel/disconnect`, {
    method: "DELETE",
  });
  return parseApiResponse(res);
}

/* --- Phase 2 Prompt 6: Aggregate Cohort Weak-Topic Clustering --- */

export async function fetchEmployerCohortInsights(partnerId = "default") {
  const params = new URLSearchParams();
  if (partnerId) params.set("partner_id", partnerId);
  const res = await fetchWithTimeout(
    `${API_BASE}/api/requisitions/cohort-insights?${params.toString()}`,
    {},
    10_000
  );
  return parseApiResponse(res);
}

export async function fetchMySessions() {
  const res = await fetchWithTimeout(`${API_BASE}/api/sessions`, {}, 10_000);
  return parseApiResponse(res);
}
