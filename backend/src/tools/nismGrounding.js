import { GoogleAuth } from "google-auth-library";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const CORPUS_FILES = {
  "series-viii": path.resolve(__dirname, "../data/nismWorkbookCorpus.json"),
  "series-va": path.resolve(__dirname, "../data/nismSeries5ACorpus.json"),
  "series-i": path.resolve(__dirname, "../data/nismSeries1Corpus.json"),
};
const DEFAULT_SERVICE_ACCOUNT = path.resolve(BACKEND_ROOT, "service-account.json");

const cachedCorpora = new Map();

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadLocalCorpus(moduleId = "series-viii") {
  const key = CORPUS_FILES[moduleId] ? moduleId : "series-viii";
  if (cachedCorpora.has(key)) return cachedCorpora.get(key);
  try {
    const raw = await readFile(CORPUS_FILES[key], "utf-8");
    const parsed = JSON.parse(raw);
    cachedCorpora.set(key, parsed);
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Query Google Cloud Vertex AI Search (Discovery Engine REST API) when configured via:
 *   GOOGLE_CLOUD_PROJECT + VERTEX_SEARCH_DATASTORE_ID (+ optional VERTEX_SEARCH_LOCATION, default "global")
 */
async function queryVertexAiSearch(queryText, topK = 2, { moduleId = "series-viii" } = {}) {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const dataStoreId =
    moduleId === "series-va"
      ? process.env.VERTEX_SEARCH_DATASTORE_ID_VA?.trim()
      : moduleId === "series-i"
        ? process.env.VERTEX_SEARCH_DATASTORE_ID_I?.trim()
        : process.env.VERTEX_SEARCH_DATASTORE_ID?.trim();
  if (!project || !dataStoreId) return null;

  const location = process.env.VERTEX_SEARCH_LOCATION?.trim() || "global";
  const configuredCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const keyFilePath = configuredCreds
    ? path.resolve(BACKEND_ROOT, configuredCreds)
    : DEFAULT_SERVICE_ACCOUNT;
  const hasKeyFile = await fileExists(keyFilePath);

  const auth = new GoogleAuth({
    ...(hasKeyFile ? { keyFilename: keyFilePath } : {}),
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  const token = typeof tokenRes === "string" ? tokenRes : tokenRes?.token;
  if (!token) return null;

  const endpointHost =
    location === "global"
      ? "discoveryengine.googleapis.com"
      : `${location}-discoveryengine.googleapis.com`;

  const url =
    `https://${endpointHost}/v1/projects/${encodeURIComponent(project)}` +
    `/locations/${encodeURIComponent(location)}/collections/default_collection` +
    `/dataStores/${encodeURIComponent(dataStoreId)}/servingConfigs/default_search:search`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: queryText.slice(0, 500),
        pageSize: topK,
        contentSearchSpec: {
          snippetSpec: { returnSnippet: true, maxSnippetCount: 2 },
          extractiveContentSpec: { maxExtractiveAnswerCount: 1 },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.results || [];
    if (results.length === 0) return null;

    return results.slice(0, topK).map((r, i) => {
      const derived = r.document?.derivedStructData || {};
      const snippet =
        derived.extractive_answers?.[0]?.content ||
        derived.snippets?.[0]?.snippet ||
        r.document?.structData?.excerpt ||
        "";
      return {
        id: r.document?.id || `vertex-${i + 1}`,
        source: derived.title || r.document?.structData?.source || "Vertex AI Search · NISM Workbook",
        topic: derived.title || "Grounded NISM Reference",
        excerpt: String(snippet).replace(/<[^>]+>/g, "").trim(),
        engine: "vertex-ai-search",
      };
    }).filter((item) => item.excerpt.length > 0);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retrieve grounding excerpts from Vertex AI Search (when configured) or the built-in
 * curated NISM Series VIII workbook corpus.
 *
 * Returns { engine: "vertex-ai-search" | "nism-workbook-rag", passages: [...] }
 */
export async function retrieveNismGrounding(
  queryText,
  topK = 2,
  { moduleId = "series-viii" } = {}
) {
  const cleaned = String(queryText || "").trim();
  if (!cleaned) {
    return { engine: "nism-workbook-rag", module: moduleId, passages: [] };
  }

  // 1. Live Vertex AI Search if datastore env vars are configured for this module
  const vertexHits = await queryVertexAiSearch(cleaned, topK, { moduleId });
  if (vertexHits && vertexHits.length > 0) {
    return {
      engine: "vertex-ai-search",
      module: moduleId,
      passages: vertexHits,
    };
  }

  // 2. Local curated NISM workbook RAG corpus fallback (Series VIII or Series V-A)
  const corpus = await loadLocalCorpus(moduleId);
  const lower = cleaned.toLowerCase();

  const scored = corpus
    .map((doc) => {
      let score = 0;
      for (const kw of doc.keywords || []) {
        if (lower.includes(kw.toLowerCase())) {
          score += kw.length > 5 ? 3 : 2;
        }
      }
      if (lower.includes(doc.topic.toLowerCase())) score += 4;
      return { doc, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected = scored
    .filter((x) => x.score > 0)
    .slice(0, topK)
    .map(({ doc }) => ({
      id: doc.id,
      source: doc.source,
      topic: doc.topic,
      excerpt: doc.excerpt,
      engine: "nism-workbook-rag",
    }));

  // If no strong keyword hit, still return top 1 reference if query mentions derivatives/trading
  return {
    engine: "nism-workbook-rag",
    passages: selected,
  };
}

export function isVertexSearchConfigured() {
  return Boolean(
    process.env.GOOGLE_CLOUD_PROJECT?.trim() && process.env.VERTEX_SEARCH_DATASTORE_ID?.trim()
  );
}

export function formatGroundingBlock(grounding) {
  if (!grounding?.passages?.length) return "";
  return grounding.passages
    .map((p, i) => `[NISM Reference ${i + 1} — ${p.source}]\n${p.excerpt}`)
    .join("\n\n");
}
