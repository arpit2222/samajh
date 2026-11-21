import crypto from "node:crypto";

export const KITE_API_BASE = "https://api.kite.trade";
export const KITE_LOGIN_BASE = "https://kite.zerodha.com/connect/login";
export const KITE_VERSION_HEADER = "3";

/**
 * Strict allowlist of Kite Connect v3 endpoints Samajh is permitted to call.
 * Trading / order placement / modification endpoints (POST/PUT/DELETE /orders/*)
 * are permanently forbidden in code.
 */
const ALLOWED_KITE_ENDPOINTS = new Set([
  "POST /session/token",
  "POST /session/refresh_token",
  "DELETE /session/token",
  "GET /trades",
  "GET /orders",
  "GET /portfolio/holdings",
]);

export function assertReadOnlyKiteEndpoint(method, pathname) {
  const key = `${String(method).toUpperCase()} ${pathname}`;
  if (!ALLOWED_KITE_ENDPOINTS.has(key)) {
    const err = new Error(
      `Blocked non-read-only Kite Connect request "${key}". Samajh is strictly read-only and never requests or executes trading permissions.`
    );
    err.status = 403;
    throw err;
  }
}

export function isKiteConfigured() {
  return Boolean(process.env.KITE_API_KEY?.trim() && process.env.KITE_API_SECRET?.trim());
}

export function getKiteCredentials() {
  return {
    apiKey: process.env.KITE_API_KEY?.trim() || "",
    apiSecret: process.env.KITE_API_SECRET?.trim() || "",
  };
}

/**
 * Official Kite Connect v3 login URL:
 * https://kite.zerodha.com/connect/login?v=3&api_key=<api_key>
 * Never passes any write/trading scope parameter.
 */
export function buildKiteLoginUrl({ apiKey, redirectParams } = {}) {
  const key = apiKey || getKiteCredentials().apiKey;
  if (!key) {
    const err = new Error(
      "Zerodha Kite Connect is not configured on this server (missing KITE_API_KEY / KITE_API_SECRET)."
    );
    err.status = 503;
    throw err;
  }
  const params = new URLSearchParams();
  params.set("v", KITE_VERSION_HEADER);
  params.set("api_key", key);
  if (redirectParams) {
    params.set("redirect_params", redirectParams);
  }
  return `${KITE_LOGIN_BASE}?${params.toString()}`;
}

/**
 * Kite Connect v3 checksum formula:
 * SHA-256(api_key + request_or_refresh_token + api_secret)
 */
export function computeKiteChecksum(apiKey, token, apiSecret) {
  return crypto
    .createHash("sha256")
    .update(`${apiKey}${token}${apiSecret}`)
    .digest("hex");
}

/**
 * Compute next Kite daily token expiry (approx. 07:30 AM IST / 02:00 UTC next morning).
 */
export function estimateKiteTokenExpiry(now = new Date()) {
  const next = new Date(now.getTime());
  // 02:00 UTC == 07:30 IST
  next.setUTCHours(2, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

async function callKiteApi({
  method,
  pathname,
  apiKey,
  accessToken = null,
  formBody = null,
  queryParams = null,
  fetchImpl = globalThis.fetch,
}) {
  assertReadOnlyKiteEndpoint(method, pathname);

  const url = new URL(`${KITE_API_BASE}${pathname}`);
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers = {
    "X-Kite-Version": KITE_VERSION_HEADER,
  };
  if (accessToken) {
    headers.Authorization = `token ${apiKey}:${accessToken}`;
  }

  let body;
  if (formBody) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(formBody).toString();
  }

  const res = await fetchImpl(url.toString(), {
    method,
    headers,
    body,
  });

  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = { status: "error", message: `Kite API returned HTTP ${res.status}` };
  }

  if (!res.ok || parsed?.status === "error") {
    const err = new Error(parsed?.message || `Kite Connect request failed (HTTP ${res.status})`);
    err.status = res.status;
    err.kiteErrorType = parsed?.error_type || null;
    throw err;
  }

  return parsed?.data;
}

/**
 * POST /session/token — Exchange single-use request_token for access_token.
 * Returns ONLY { access_token, refresh_token } (strips Zerodha PII like user_id/email/user_name).
 */
export async function exchangeKiteRequestToken({
  apiKey,
  apiSecret,
  requestToken,
  fetchImpl = globalThis.fetch,
}) {
  const checksum = computeKiteChecksum(apiKey, requestToken, apiSecret);
  const data = await callKiteApi({
    method: "POST",
    pathname: "/session/token",
    apiKey,
    formBody: {
      api_key: apiKey,
      request_token: requestToken,
      checksum,
    },
    fetchImpl,
  });

  if (!data?.access_token) {
    const err = new Error("Kite Connect token exchange succeeded but returned no access_token.");
    err.status = 502;
    throw err;
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
  };
}

/**
 * POST /session/refresh_token — Refresh access_token when partner refresh_token is available.
 */
export async function refreshKiteAccessToken({
  apiKey,
  apiSecret,
  refreshToken,
  fetchImpl = globalThis.fetch,
}) {
  const checksum = computeKiteChecksum(apiKey, refreshToken, apiSecret);
  const data = await callKiteApi({
    method: "POST",
    pathname: "/session/refresh_token",
    apiKey,
    formBody: {
      api_key: apiKey,
      refresh_token: refreshToken,
      checksum,
    },
    fetchImpl,
  });

  if (!data?.access_token) {
    const err = new Error("Kite Connect token refresh returned no access_token.");
    err.status = 401;
    throw err;
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
  };
}

/**
 * DELETE /session/token — Immediately revoke the active Kite session token.
 */
export async function revokeKiteSession({
  apiKey,
  accessToken,
  fetchImpl = globalThis.fetch,
}) {
  return callKiteApi({
    method: "DELETE",
    pathname: "/session/token",
    apiKey,
    accessToken,
    queryParams: {
      api_key: apiKey,
      access_token: accessToken,
    },
    fetchImpl,
  });
}

/**
 * Read-only fetch of executed trades, orders (for stop-loss detection), and holdings.
 */
export async function fetchKiteReadOnlyData({
  apiKey,
  accessToken,
  fetchImpl = globalThis.fetch,
}) {
  const [trades, orders, holdings] = await Promise.all([
    callKiteApi({ method: "GET", pathname: "/trades", apiKey, accessToken, fetchImpl }),
    callKiteApi({ method: "GET", pathname: "/orders", apiKey, accessToken, fetchImpl }).catch(
      () => []
    ),
    callKiteApi({
      method: "GET",
      pathname: "/portfolio/holdings",
      apiKey,
      accessToken,
      fetchImpl,
    }).catch(() => []),
  ]);

  return {
    trades: Array.isArray(trades) ? trades : [],
    orders: Array.isArray(orders) ? orders : [],
    holdings: Array.isArray(holdings) ? holdings : [],
  };
}

/* ============================================================================
 * IDENTICAL ANONYMIZATION PIPELINE (1:1 parity with frontend/src/lib/tradebookParser.js)
 * Strips all symbols, order_id, trade_id, client_id, PAN, quantity, price, and ₹ P&L.
 * ============================================================================ */

function classifyInstrument(symbol, segment) {
  const s = `${symbol} ${segment}`.toUpperCase();
  if (/\bCE\b|\bPE\b|\d+(CE|PE)$/.test(s)) return "Options";
  if (/FUT|FUTURE/.test(s)) return "Futures";
  if (/FO|F&O|NFO|BFO|DERIV/.test(s)) return "F&O";
  return "Equity Cash";
}

function bucketOutcome(rawOutcome) {
  if (rawOutcome === undefined || rawOutcome === null || rawOutcome === "") {
    return "loss";
  }
  const lower = String(rawOutcome).toLowerCase();
  if (lower === "gain" || lower === "profit") return "gain";
  if (lower === "loss") return "loss";
  if (lower === "flat") return "flat";
  const num = Number(lower);
  if (Number.isFinite(num)) {
    return num > 0 ? "gain" : num < 0 ? "loss" : "flat";
  }
  return "loss";
}

/**
 * Anonymizes raw Kite Connect trades/orders/holdings into the EXACT same shape
 * produced by frontend/src/lib/tradebookParser.js (`parseAndRedactTradebookCsv`).
 *
 * Output contains ZERO PII, ZERO symbols, ZERO order/trade IDs, and ZERO ₹ figures.
 */
export function anonymizeBrokerTradeData({
  trades = [],
  orders = [],
  holdings = [],
  brokerSource = "Zerodha Kite Connect (Read-Only)",
  extraRedactedFields = ["Zerodha user_id"],
} = {}) {
  // Build a symbol -> hasStopLoss lookup from read-only orders (without retaining symbols)
  const slSymbols = new Set();
  const hasOrdersContext = Array.isArray(orders) && orders.length > 0;
  for (const ord of orders || []) {
    const orderType = String(ord?.order_type || "").toUpperCase();
    const sym = String(ord?.tradingsymbol || ord?.symbol || "").trim().toUpperCase();
    if (sym && (orderType === "SL" || orderType === "SL-M")) {
      slSymbols.add(sym);
    }
  }

  const anonymizedTrades = [];
  const sourceRows =
    Array.isArray(trades) && trades.length > 0
      ? trades.slice(0, 40)
      : (holdings || []).slice(0, 40).map((h) => ({
          tradingsymbol: h.tradingsymbol || h.symbol || "EQUITY",
          exchange: h.exchange || "EQ",
          product: "CNC",
          transaction_type: "BUY",
          fill_timestamp: new Date().toISOString().slice(0, 10),
          pnl: h.pnl,
          had_stop_loss: null,
        }));

  for (let i = 0; i < sourceRows.length; i++) {
    const row = sourceRows[i];
    const rawSymbol = String(row?.tradingsymbol || row?.symbol || "").trim();
    if (!rawSymbol) continue;

    const rawSegment = String(row?.exchange || row?.segment || "");
    const instrument_type = classifyInstrument(rawSymbol, rawSegment);
    const segment = instrument_type === "Equity Cash" ? "EQ" : "F&O";

    const sideRaw = String(row?.transaction_type || row?.trade_type || "BUY").toUpperCase();
    const direction = sideRaw.startsWith("S") ? "SELL" : "BUY";

    const rawDate = String(
      row?.trade_date || row?.fill_timestamp || row?.order_timestamp || row?.exchange_timestamp || ""
    );
    const date = rawDate ? rawDate.slice(0, 10) : "Recent";

    const prodRaw = String(row?.product || "").toUpperCase();
    const holding_bucket = prodRaw.includes("CNC")
      ? "Multi-day"
      : prodRaw.includes("NRML") || prodRaw.includes("OVER")
        ? "Overnight"
        : prodRaw.includes("MIS") || prodRaw.includes("INTRA")
          ? "Intraday"
          : instrument_type === "Futures"
            ? "Overnight"
            : "Intraday";

    const expiry_day = instrument_type === "Options" && /WK|EXP|THU|\d{5}(CE|PE)/i.test(rawSymbol);

    const outcome_bucket = bucketOutcome(row?.outcome ?? row?.pnl);

    let had_stop_loss = null;
    if (typeof row?.had_stop_loss === "boolean") {
      had_stop_loss = row.had_stop_loss;
    } else if (hasOrdersContext) {
      had_stop_loss = slSymbols.has(rawSymbol.toUpperCase());
    }

    // Strictly anonymized trade object — identical keys to tradebookParser.js
    anonymizedTrades.push({
      id: `trade_${i + 1}`,
      date,
      instrument_type,
      segment,
      direction,
      holding_bucket,
      outcome_bucket,
      expiry_day,
      had_stop_loss,
    });
  }

  if (anonymizedTrades.length === 0) {
    const err = new Error(
      "No executed trades or holdings were returned by Zerodha Kite for this session."
    );
    err.status = 404;
    throw err;
  }

  const total_trades = anonymizedTrades.length;
  const fno_pct = Math.round(
    (anonymizedTrades.filter((t) => t.segment === "F&O").length / total_trades) * 100
  );
  const overnight_pct = Math.round(
    (anonymizedTrades.filter((t) => t.holding_bucket !== "Intraday").length / total_trades) * 100
  );
  const expiry_day_pct = Math.round(
    (anonymizedTrades.filter((t) => t.expiry_day).length / total_trades) * 100
  );

  const risk_tags = [];
  if (fno_pct >= 60) risk_tags.push("high F&O concentration");
  if (overnight_pct >= 40) risk_tags.push("high overnight exposure");
  if (expiry_day_pct >= 20) risk_tags.push("expiry-day options exposure");
  if (anonymizedTrades.some((t) => t.instrument_type === "Options" && t.direction === "SELL")) {
    risk_tags.push("short option writing exposure");
  }
  if (risk_tags.length === 0) risk_tags.push("balanced cash profile");

  return {
    brokerSource,
    redactedFields: [
      "Absolute ₹ Capital & P&L",
      "Ticker Symbols",
      "order_id",
      "trade_id",
      "quantity",
      "average_price",
      ...extraRedactedFields,
    ],
    ratios: {
      fno_pct,
      overnight_pct,
      expiry_day_pct,
      total_trades,
    },
    risk_tags,
    trades: anonymizedTrades,
  };
}

export function anonymizeKiteTradeData(input = {}) {
  return anonymizeBrokerTradeData({
    ...input,
    brokerSource: "Zerodha Kite Connect (Read-Only)",
    extraRedactedFields: ["Zerodha user_id"],
  });
}
