import { anonymizeBrokerTradeData, estimateKiteTokenExpiry } from "./kiteConnect.js";

export const SMARTAPI_BASE = "https://apiconnect.angelone.in";

/**
 * Strict read-only allowlist of Angel One SmartAPI endpoints Samajh is permitted to call.
 * Trading / order placement / modification / cancellation endpoints
 * (placeOrder, modifyOrder, cancelOrder) are permanently forbidden in code.
 */
const ALLOWED_SMARTAPI_ENDPOINTS = new Set([
  "POST /rest/auth/angelbroking/user/v1/loginByPassword",
  "POST /rest/auth/angelbroking/jwt/v1/generateTokens",
  "POST /rest/secure/angelbroking/user/v1/logout",
  "GET /rest/secure/angelbroking/order/v1/getTradeBook",
  "GET /rest/secure/angelbroking/order/v1/getOrderBook",
  "GET /rest/secure/angelbroking/portfolio/v1/getHolding",
]);

export function assertReadOnlySmartApiEndpoint(method, pathname) {
  const key = `${String(method).toUpperCase()} ${pathname}`;
  if (!ALLOWED_SMARTAPI_ENDPOINTS.has(key)) {
    const err = new Error(
      `Blocked non-read-only Angel One SmartAPI request "${key}". Samajh is strictly read-only and never requests or executes trading permissions.`
    );
    err.status = 403;
    throw err;
  }
}

export function isSmartApiConfigured() {
  return Boolean(process.env.ANGEL_SMARTAPI_KEY?.trim());
}

export function getSmartApiKey() {
  return process.env.ANGEL_SMARTAPI_KEY?.trim() || "";
}

export function estimateSmartApiTokenExpiry(now = new Date()) {
  // SmartAPI sessions also reset daily before market open (reuse same schedule)
  return estimateKiteTokenExpiry(now);
}

function buildSmartApiHeaders({ apiKey, jwtToken = null }) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": process.env.SMARTAPI_LOCAL_IP?.trim() || "127.0.0.1",
    "X-ClientPublicIP": process.env.SMARTAPI_PUBLIC_IP?.trim() || "127.0.0.1",
    "X-MACAddress": process.env.SMARTAPI_MAC_ADDRESS?.trim() || "00:00:00:00:00:00",
    "X-PrivateKey": apiKey,
  };
  if (jwtToken) {
    headers.Authorization = `Bearer ${jwtToken}`;
  }
  return headers;
}

async function callSmartApi({
  method,
  pathname,
  apiKey,
  jwtToken = null,
  jsonBody = null,
  fetchImpl = globalThis.fetch,
}) {
  assertReadOnlySmartApiEndpoint(method, pathname);

  const res = await fetchImpl(`${SMARTAPI_BASE}${pathname}`, {
    method,
    headers: buildSmartApiHeaders({ apiKey, jwtToken }),
    body: jsonBody ? JSON.stringify(jsonBody) : undefined,
  });

  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = { status: false, message: `SmartAPI returned HTTP ${res.status}` };
  }

  if (!res.ok || parsed?.status === false) {
    const err = new Error(parsed?.message || `Angel One SmartAPI error (HTTP ${res.status})`);
    err.status = res.status;
    err.errorCode = parsed?.errorcode || null;
    throw err;
  }

  return parsed?.data;
}

/**
 * POST /rest/auth/angelbroking/user/v1/loginByPassword
 * Authenticates via clientcode + MPIN (password) + 6-digit TOTP.
 * Credentials are passed straight through to Angel One and NEVER persisted.
 */
export async function loginAngelSmartApi({
  apiKey,
  clientcode,
  password,
  totp,
  fetchImpl = globalThis.fetch,
}) {
  const data = await callSmartApi({
    method: "POST",
    pathname: "/rest/auth/angelbroking/user/v1/loginByPassword",
    apiKey,
    jsonBody: { clientcode, password, totp },
    fetchImpl,
  });

  if (!data?.jwtToken) {
    const err = new Error("Angel One SmartAPI login succeeded but returned no jwtToken.");
    err.status = 502;
    throw err;
  }

  return {
    jwtToken: data.jwtToken,
    refreshToken: data.refreshToken || null,
  };
}

/**
 * POST /rest/auth/angelbroking/jwt/v1/generateTokens
 * Renews an expired jwtToken using the stored encrypted refreshToken.
 */
export async function refreshAngelSmartApiToken({
  apiKey,
  jwtToken,
  refreshToken,
  fetchImpl = globalThis.fetch,
}) {
  const data = await callSmartApi({
    method: "POST",
    pathname: "/rest/auth/angelbroking/jwt/v1/generateTokens",
    apiKey,
    jwtToken,
    jsonBody: { refreshToken },
    fetchImpl,
  });

  if (!data?.jwtToken) {
    const err = new Error("Angel One SmartAPI token refresh returned no jwtToken.");
    err.status = 401;
    throw err;
  }

  return {
    jwtToken: data.jwtToken,
    refreshToken: data.refreshToken || refreshToken,
  };
}

/**
 * POST /rest/secure/angelbroking/user/v1/logout
 * Terminates the active SmartAPI session.
 */
export async function logoutAngelSmartApi({
  apiKey,
  jwtToken,
  fetchImpl = globalThis.fetch,
}) {
  return callSmartApi({
    method: "POST",
    pathname: "/rest/secure/angelbroking/user/v1/logout",
    apiKey,
    jwtToken,
    jsonBody: {},
    fetchImpl,
  });
}

/**
 * Strictly read-only fetch of TradeBook, OrderBook (for stop-loss detection), and Holdings.
 */
export async function fetchAngelReadOnlyData({
  apiKey,
  jwtToken,
  fetchImpl = globalThis.fetch,
}) {
  const [trades, orders, holdings] = await Promise.all([
    callSmartApi({
      method: "GET",
      pathname: "/rest/secure/angelbroking/order/v1/getTradeBook",
      apiKey,
      jwtToken,
      fetchImpl,
    }),
    callSmartApi({
      method: "GET",
      pathname: "/rest/secure/angelbroking/order/v1/getOrderBook",
      apiKey,
      jwtToken,
      fetchImpl,
    }).catch(() => []),
    callSmartApi({
      method: "GET",
      pathname: "/rest/secure/angelbroking/portfolio/v1/getHolding",
      apiKey,
      jwtToken,
      fetchImpl,
    }).catch(() => []),
  ]);

  return {
    trades: Array.isArray(trades) ? trades : [],
    orders: Array.isArray(orders) ? orders : [],
    holdings: Array.isArray(holdings) ? holdings : [],
  };
}

function mapSmartApiProduct(producttype) {
  const p = String(producttype || "").toUpperCase();
  if (p === "DELIVERY" || p === "CNC") return "CNC";
  if (p === "CARRYFORWARD" || p === "MARGIN" || p === "NRML") return "NRML";
  if (p === "INTRADAY" || p === "MIS" || p === "BO" || p === "ROBO") return "MIS";
  return p;
}

function mapSmartApiOrderType(ordertype) {
  const t = String(ordertype || "").toUpperCase();
  if (t === "STOPLOSS_LIMIT" || t === "SL") return "SL";
  if (t === "STOPLOSS_MARKET" || t === "SL-M") return "SL-M";
  return t;
}

/**
 * Normalizes Angel One SmartAPI tradebook/orderbook/holding rows and delegates
 * directly to the SAME shared `anonymizeBrokerTradeData` pipeline used by Zerodha Kite
 * and `tradebookParser.js` — zero parallel or divergent anonymization model.
 */
export function anonymizeAngelTradeData({ trades = [], orders = [], holdings = [] } = {}) {
  const normalizedTrades = (trades || []).map((t) => ({
    tradingsymbol: t.tradingsymbol || t.scrip || t.symbol,
    exchange: t.exchange || t.segment,
    product: mapSmartApiProduct(t.producttype || t.product),
    transaction_type: t.transactiontype || t.transaction_type || t.trade_type,
    fill_timestamp: t.filltime || t.updatetime || t.trade_date || "",
    outcome: t.outcome,
    pnl: t.pnl ?? t.profitandloss,
    had_stop_loss: t.had_stop_loss,
  }));

  const normalizedOrders = (orders || []).map((o) => ({
    tradingsymbol: o.tradingsymbol || o.scrip || o.symbol,
    order_type: mapSmartApiOrderType(o.ordertype || o.order_type),
  }));

  const normalizedHoldings = (holdings || []).map((h) => ({
    tradingsymbol: h.tradingsymbol || h.symbol,
    exchange: h.exchange || "EQ",
    pnl: h.profitandloss ?? h.pnl,
  }));

  return anonymizeBrokerTradeData({
    trades: normalizedTrades,
    orders: normalizedOrders,
    holdings: normalizedHoldings,
    brokerSource: "Angel One SmartAPI (Read-Only)",
    extraRedactedFields: ["Angel One clientcode", "MPIN / TOTP"],
  });
}
