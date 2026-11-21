import crypto from "node:crypto";
import {
  listSessionsForClustering,
  upsertCohortClusterSummary,
} from "../db/firestore.js";

const DOMAIN_AXES = [
  ["gap", "overnight", "stop-loss", "stoploss", "slippage", "trigger", "limit", "open"],
  ["circuit", "margin", "mtm", "mark-to-market", "halt", "freeze", "square-off", "illiquid"],
  ["option", "vix", "volatility", "gamma", "vega", "writer", "expiry", "straddle", "theta"],
  ["moratorium", "regulatory", "collateral", "haircut", "counterparty", "withdrawal", "pledge"],
  ["leverage", "sizing", "concentration", "drawdown", "risk", "position", "capital"],
];

const CLUSTER_LABELS = {
  overnight_gap_stoploss_risk: {
    label: "Overnight Gap & Non-Guaranteed Stop-Loss Misconceptions",
    themes: [
      "Assuming stop-loss guarantees fill price across overnight gaps",
      "Confusing trigger price with limit execution in thin opening books",
    ],
  },
  circuit_breaker_margin_risk: {
    label: "Circuit-Breaker Illiquidity & MTM Margin Cascade Gaps",
    themes: [
      "Underestimating forced broker square-offs during lower circuits",
      "Treating MTM margin shortfalls as deferred until expiry",
    ],
  },
  event_volatility_option_writing_risk: {
    label: "Binary Event Volatility & Short Option Tail-Risk Blind Spots",
    themes: [
      "Ignoring asymmetric gamma/vega expansion on event days",
      "Assuming historical intraday ranges cap expiry-day option risk",
    ],
  },
  regulatory_moratorium_liquidity_risk: {
    label: "Regulatory Moratorium & Collateral Haircut Blind Spots",
    themes: [
      "Treating pledged securities as 100% liquid during stress events",
      "Overlooking counterparty and settlement freeze mechanics",
    ],
  },
  general_market_risk: {
    label: "Position Sizing & Leverage Compounding Misconceptions",
    themes: [
      "Sizing F&O lots by margin availability rather than notional risk",
      "Conflating recent win streaks with structural edge",
    ],
  },
};

function computeDeterministicVector(text) {
  const lower = String(text || "").toLowerCase();
  const vec = DOMAIN_AXES.map((keywords) => {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }
    return score;
  });
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Generates an embedding vector for `(weak_subtopic + ExaminerAgent rationale)` using
 * Vertex AI `text-embedding-004` when configured, with deterministic domain-vector fallback.
 */
export async function embedWeakTopicText(text, { fetchImpl = globalThis.fetch } = {}) {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.VERTEX_AI_LOCATION?.trim() || "us-central1";
  const accessToken = process.env.VERTEX_AI_ACCESS_TOKEN?.trim();

  if (project && accessToken && typeof fetchImpl === "function") {
    try {
      const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-004:predict`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instances: [{ content: String(text || "").slice(0, 1500) }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const values = data?.predictions?.[0]?.embeddings?.values;
        if (Array.isArray(values) && values.length > 0) {
          return { vector: values, backend: "vertex-ai-text-embedding-004" };
        }
      }
    } catch {
      // Fall through to deterministic domain vector
    }
  }

  return {
    vector: computeDeterministicVector(text),
    backend: "local-cosine-index",
  };
}

/**
 * Upserts anonymized embedding datapoints (zero user IDs) into Vertex AI Vector Search
 * when VERTEX_VECTOR_SEARCH_INDEX_ID is configured.
 */
async function upsertVertexVectorSearchDatapoints(datapoints, { fetchImpl = globalThis.fetch } = {}) {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.VERTEX_AI_LOCATION?.trim() || "us-central1";
  const indexId = process.env.VERTEX_VECTOR_SEARCH_INDEX_ID?.trim();
  const accessToken = process.env.VERTEX_AI_ACCESS_TOKEN?.trim();

  if (!project || !indexId || !accessToken || !datapoints.length) {
    return "local-cosine-index";
  }

  try {
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/indexes/${indexId}:upsertDatapoints`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        datapoints: datapoints.map((dp) => ({
          datapointId: dp.id,
          featureVector: dp.vector,
          restricts: [{ namespace: "partner_id", allowList: [dp.partner_id] }],
        })),
      }),
    });
    if (res.ok) return "vertex-ai-vector-search";
  } catch {
    // Graceful fallback
  }
  return "local-cosine-index";
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function resolveCanonicalSubtopic(weakSubtopic, vector) {
  const key = String(weakSubtopic || "").trim().toLowerCase();
  if (CLUSTER_LABELS[key]) return key;
  if (/gap|stop[\s-]?loss|overnight/.test(key)) return "overnight_gap_stoploss_risk";
  if (/circuit|margin|mtm|halt/.test(key)) return "circuit_breaker_margin_risk";
  if (/option|vix|vol|writer|expiry/.test(key)) return "event_volatility_option_writing_risk";
  if (/moratorium|liquidity|collateral|haircut/.test(key)) return "regulatory_moratorium_liquidity_risk";

  // Nearest canonical centroid via cosine similarity
  const canonicalKeys = Object.keys(CLUSTER_LABELS);
  let bestKey = "general_market_risk";
  let bestSim = -1;
  for (const ck of canonicalKeys) {
    const centroid = computeDeterministicVector(
      `${ck} ${CLUSTER_LABELS[ck].label} ${CLUSTER_LABELS[ck].themes.join(" ")}`
    );
    const sim = cosineSimilarity(vector, centroid);
    if (sim > bestSim) {
      bestSim = sim;
      bestKey = ck;
    }
  }
  return bestKey;
}

/**
 * Batch job: embeds session weak_subtopic + ExaminerAgent rationales, indexes them in
 * Vertex AI Vector Search (when configured), clusters per partner_id cohort, and writes
 * ONLY aggregate misconception cluster counts into Firestore `cohort_clusters`.
 *
 * NEVER triggered per-request.
 */
export async function runCohortClusteringBatch({
  partnerId = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const records = await listSessionsForClustering({ partnerId });
  const byPartner = new Map();
  for (const rec of records) {
    const pid = rec.partner_id || "default";
    if (!byPartner.has(pid)) byPartner.set(pid, []);
    byPartner.get(pid).push(rec);
  }

  const summaries = [];
  for (const [pid, partnerRecords] of byPartner.entries()) {
    const datapoints = [];
    const groups = new Map();

    for (const rec of partnerRecords) {
      const combinedText = `${rec.weak_subtopic} — ${rec.rationale}`.trim();
      const { vector } = await embedWeakTopicText(combinedText, { fetchImpl });
      const canonical = resolveCanonicalSubtopic(rec.weak_subtopic, vector);

      datapoints.push({
        id: `dp_${crypto.createHash("sha256").update(`${pid}:${combinedText}:${datapoints.length}`).digest("hex").slice(0, 16)}`,
        partner_id: pid,
        vector,
      });

      if (!groups.has(canonical)) {
        groups.set(canonical, { count: 0 });
      }
      groups.get(canonical).count += 1;
    }

    const vectorBackend = await upsertVertexVectorSearchDatapoints(datapoints, { fetchImpl });
    const total = partnerRecords.length;

    const clusters = [...groups.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([subtopic, info], idx) => {
        const meta = CLUSTER_LABELS[subtopic] || CLUSTER_LABELS.general_market_risk;
        return {
          rank: idx + 1,
          cluster_id: `cl_${pid}_${subtopic}`,
          label: meta.label,
          primary_subtopic: subtopic,
          session_count: info.count,
          pct_of_cohort: total > 0 ? Math.round((info.count / total) * 100) : 0,
          top_themes: meta.themes,
        };
      });

    const saved = await upsertCohortClusterSummary({
      partner_id: pid,
      computed_at: new Date().toISOString(),
      total_sessions_analyzed: total,
      vector_backend: vectorBackend,
      clusters,
    });
    summaries.push(saved);
  }

  return {
    cohorts_processed: summaries.length,
    total_sessions_clustered: records.length,
    summaries,
  };
}

let activeScheduleTimer = null;

/**
 * Starts the scheduled background clustering job (default: every 6 hours).
 * Uses .unref() so Node exits cleanly in tests/CLI scripts.
 */
export function startCohortClusteringSchedule({
  intervalMs = Number(process.env.COHORT_CLUSTER_INTERVAL_MS) || 6 * 60 * 60 * 1000,
} = {}) {
  if (activeScheduleTimer) return activeScheduleTimer;
  activeScheduleTimer = setInterval(() => {
    runCohortClusteringBatch().catch((err) => {
      console.warn(`[CohortClusteringJob] Scheduled run failed: ${err.message}`);
    });
  }, intervalMs);
  if (typeof activeScheduleTimer.unref === "function") {
    activeScheduleTimer.unref();
  }
  return activeScheduleTimer;
}

export function stopCohortClusteringSchedule() {
  if (activeScheduleTimer) {
    clearInterval(activeScheduleTimer);
    activeScheduleTimer = null;
  }
}
