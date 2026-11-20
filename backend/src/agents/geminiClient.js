/**
 * Raw Gemini REST API client using native Node 22 fetch.
 * Explicitly calls:
 *   https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * without @google/genai or @google/generative-ai SDK dependencies.
 */

const GEMINI_REST_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const VERTEX_EXPRESS_BASE = "https://aiplatform.googleapis.com/v1/publishers/google/models";
const DEFAULT_TIMEOUT_MS = 45_000;

export function getModelName() {
  return process.env.GEMINI_MODEL?.trim() || "gemini-4-hydrogen";
}

export function isGeminiConfigured() {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== "your_gemini_api_key_here");
}

function getApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    const err = new Error(
      "GEMINI_API_KEY is not configured. Copy backend/.env.example to backend/.env and add your Gemini API key."
    );
    err.statusCode = 503;
    throw err;
  }
  return apiKey;
}

/**
 * Call Gemini REST generateContent with enforced application/json responseMimeType
 * and an explicit OpenAPI-style responseSchema so every agent receives parseable JSON.
 */
export async function callGeminiJSON({
  systemInstruction,
  contents,
  responseSchema,
  model = getModelName(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const apiKey = getApiKey();
  const isVertexExpressKey = apiKey.startsWith("AQ.");
  const url = isVertexExpressKey
    ? `${VERTEX_EXPRESS_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
    : `${GEMINI_REST_BASE}/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  if (systemInstruction) {
    body.system_instruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const headers = { "Content-Type": "application/json" };
  if (!isVertexExpressKey) {
    headers["x-goog-api-key"] = apiKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error("Gemini API timed out. Please try again.");
      timeoutErr.statusCode = 504;
      throw timeoutErr;
    }
    const netErr = new Error(`Failed to reach Gemini API: ${err.message}`);
    netErr.statusCode = 502;
    throw netErr;
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const parseErr = new Error(`Gemini API returned non-JSON response (HTTP ${response.status}).`);
    parseErr.statusCode = 502;
    throw parseErr;
  }

  if (!response.ok) {
    const upstreamMsg = payload?.error?.message || `HTTP ${response.status}`;
    const apiErr = new Error(`Gemini API error (${response.status}): ${upstreamMsg}`);
    apiErr.statusCode = response.status === 429 ? 429 : response.status >= 400 && response.status < 500 ? 400 : 502;
    throw apiErr;
  }

  const candidate = payload?.candidates?.[0];
  const textPart = candidate?.content?.parts?.find((p) => typeof p.text === "string")?.text;

  if (!textPart) {
    const blockReason = payload?.promptFeedback?.blockReason || candidate?.finishReason || "EMPTY_RESPONSE";
    const emptyErr = new Error(`Gemini returned no JSON output (${blockReason}).`);
    emptyErr.statusCode = 502;
    throw emptyErr;
  }

  try {
    return JSON.parse(textPart);
  } catch (err) {
    const jsonErr = new Error(`Gemini returned malformed JSON: ${err.message}`);
    jsonErr.statusCode = 502;
    throw jsonErr;
  }
}
