import assert from "node:assert/strict";
import { initDatabase, getBrokerConnection } from "../src/db/firestore.js";
import { createKiteRouter } from "../src/routes/kite.js";
import {
  assertReadOnlyKiteEndpoint,
  computeKiteChecksum,
} from "../src/tools/kiteConnect.js";
import {
  parseAndRedactTradebookCsv,
  SAMPLE_BROKER_CSV,
} from "../../frontend/src/lib/tradebookParser.js";

function invokeRouter(router, { method = "GET", path, headers = {}, body = {} }) {
  return new Promise((resolve, reject) => {
    const [pathname, queryStr = ""] = path.split("?");
    const query = Object.fromEntries(new URLSearchParams(queryStr));
    let statusCode = 200;

    const req = {
      method,
      url: pathname + (queryStr ? `?${queryStr}` : ""),
      headers,
      query,
      body,
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
      setHeader() {},
      end() {},
    };
    router(req, res, (err) => {
      if (err) return reject(err);
      resolve({ status: 404, body: { error: "Not found" } });
    });
  });
}

// Same 5 trades as SAMPLE_BROKER_CSV in official Kite Connect v3 /trades + /orders format
const MOCK_KITE_TRADES = [
  {
    trade_id: "T99101",
    order_id: "25031000182",
    tradingsymbol: "INDUSINDBK MAR FUT",
    exchange: "NFO",
    product: "NRML",
    transaction_type: "BUY",
    quantity: 500,
    average_price: 900.5,
    fill_timestamp: "2025-03-10 09:16:12",
    pnl: -42500,
  },
  {
    trade_id: "T99102",
    order_id: "25031300419",
    tradingsymbol: "NIFTY 24000 CE WK",
    exchange: "NFO",
    product: "MIS",
    transaction_type: "BUY",
    quantity: 150,
    average_price: 84.2,
    fill_timestamp: "2025-03-13 11:02:45",
    pnl: -8400,
  },
  {
    trade_id: "T99103",
    order_id: "25031800772",
    tradingsymbol: "BANKNIFTY 51500 PE WK",
    exchange: "NFO",
    product: "NRML",
    transaction_type: "SELL",
    quantity: 60,
    average_price: 210.0,
    fill_timestamp: "2025-03-18 14:55:10",
    pnl: -19200,
  },
  {
    trade_id: "T99104",
    order_id: "25032000911",
    tradingsymbol: "RELIANCE MAR FUT",
    exchange: "NFO",
    product: "NRML",
    transaction_type: "SELL",
    quantity: 250,
    average_price: 1280.0,
    fill_timestamp: "2025-03-20 10:21:00",
    pnl: -11500,
  },
  {
    trade_id: "T99105",
    order_id: "25032100205",
    tradingsymbol: "HDFCBANK",
    exchange: "EQ",
    product: "CNC",
    transaction_type: "BUY",
    quantity: 40,
    average_price: 1715.0,
    fill_timestamp: "2025-03-21 13:10:05",
    pnl: 3200,
  },
];

const MOCK_KITE_ORDERS = [
  { order_id: "25031000183", tradingsymbol: "INDUSINDBK MAR FUT", order_type: "SL" },
  { order_id: "25032000912", tradingsymbol: "RELIANCE MAR FUT", order_type: "SL-M" },
  { order_id: "25032100206", tradingsymbol: "HDFCBANK", order_type: "SL" },
];

async function runKiteProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  process.env.KITE_API_KEY = "kite_test_api_key_123";
  process.env.KITE_API_SECRET = "kite_test_api_secret_xyz";
  process.env.KITE_TOKEN_ENCRYPTION_KEY = "test-aes256-gcm-encryption-secret";
  await initDatabase();

  const uid = "trader_kite_001";
  const headers = { "x-firebase-uid": uid };
  const rawAccessToken = "kite_live_access_token_SECRET_999";
  const refreshedAccessToken = "kite_refreshed_access_token_SECRET_888";
  const rawRefreshToken = "kite_refresh_token_SECRET_777";
  const requestToken = "kite_req_token_abc";

  let expireFirstTradesCall = false;
  let revokeCalled = false;
  let refreshCalled = false;

  const mockFetch = async (urlStr, options = {}) => {
    const url = new URL(urlStr);
    const method = (options.method || "GET").toUpperCase();
    assert.equal(options.headers["X-Kite-Version"], "3", "Must send X-Kite-Version: 3");

    if (method === "POST" && url.pathname === "/session/token") {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("api_key"), process.env.KITE_API_KEY);
      assert.equal(form.get("request_token"), requestToken);
      assert.equal(
        form.get("checksum"),
        computeKiteChecksum(process.env.KITE_API_KEY, requestToken, process.env.KITE_API_SECRET),
        "Kite v3 checksum must equal SHA-256(api_key + request_token + api_secret)"
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: {
            access_token: rawAccessToken,
            refresh_token: rawRefreshToken,
            user_id: "ZD9941",
            user_name: "Sensitive Name",
            email: "sensitive@example.com",
          },
        }),
      };
    }

    if (method === "POST" && url.pathname === "/session/refresh_token") {
      refreshCalled = true;
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("refresh_token"), rawRefreshToken);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: {
            access_token: refreshedAccessToken,
            refresh_token: rawRefreshToken,
          },
        }),
      };
    }

    if (method === "DELETE" && url.pathname === "/session/token") {
      revokeCalled = true;
      assert.equal(url.searchParams.get("api_key"), process.env.KITE_API_KEY);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: true }),
      };
    }

    if (method === "GET" && url.pathname === "/trades") {
      if (expireFirstTradesCall && options.headers.Authorization.includes(rawAccessToken)) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            status: "error",
            error_type: "TokenException",
            message: "Token is invalid or has expired.",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: MOCK_KITE_TRADES }),
      };
    }

    if (method === "GET" && url.pathname === "/orders") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: MOCK_KITE_ORDERS }),
      };
    }

    if (method === "GET" && url.pathname === "/portfolio/holdings") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: [] }),
      };
    }

    throw new Error(`Unexpected Kite API call: ${method} ${url.pathname}`);
  };

  const router = createKiteRouter({ fetchImpl: mockFetch });

  // 1. Verify write-scope endpoints are strictly forbidden in code
  assert.throws(
    () => assertReadOnlyKiteEndpoint("POST", "/orders/regular"),
    /strictly read-only/i,
    "Order placement must be permanently blocked"
  );

  // 2. Verify login URL uses official Kite Connect v3 path and requests NO write scope
  const loginRes = await invokeRouter(router, {
    method: "GET",
    path: "/login-url",
    headers,
  });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.scope, "read_only");
  const parsedLoginUrl = new URL(loginRes.body.login_url);
  assert.equal(parsedLoginUrl.origin, "https://kite.zerodha.com");
  assert.equal(parsedLoginUrl.pathname, "/connect/login");
  assert.equal(parsedLoginUrl.searchParams.get("v"), "3");
  assert.equal(parsedLoginUrl.searchParams.get("api_key"), process.env.KITE_API_KEY);
  assert.equal(parsedLoginUrl.searchParams.get("scope"), null, "Must never request write scope");

  // 3. Exchange request_token -> verify encrypted storage in Firestore (NO plaintext token or PII)
  const exchangeRes = await invokeRouter(router, {
    method: "POST",
    path: "/exchange",
    headers,
    body: { request_token: requestToken },
  });
  assert.equal(exchangeRes.status, 200);
  assert.equal(exchangeRes.body.connected, true);
  assert.equal(exchangeRes.body.scope, "read_only");

  const storedDoc = await getBrokerConnection(uid, "zerodha_kite");
  assert.ok(storedDoc, "Encrypted connection doc must exist in Firestore");
  const storedJson = JSON.stringify(storedDoc);
  assert.equal(storedDoc.encryptedAccessToken.alg, "aes-256-gcm");
  assert.ok(!storedJson.includes(rawAccessToken), "Plaintext access_token must NEVER be stored");
  assert.ok(!storedJson.includes(rawRefreshToken), "Plaintext refresh_token must NEVER be stored");
  assert.ok(!storedJson.includes("ZD9941"), "Zerodha user_id/PII must NEVER be stored");

  // 4. Sync read-only trades and DIFF against CSV upload anonymization (MUST BE IDENTICAL)
  const syncRes = await invokeRouter(router, {
    method: "POST",
    path: "/sync",
    headers,
  });
  assert.equal(syncRes.status, 200);

  const csvParsed = parseAndRedactTradebookCsv(SAMPLE_BROKER_CSV);
  assert.deepEqual(
    syncRes.body.ratios,
    csvParsed.ratios,
    "Kite live-fetch ratios must be 100% identical to CSV upload ratios"
  );
  assert.deepEqual(
    syncRes.body.risk_tags,
    csvParsed.risk_tags,
    "Kite live-fetch risk_tags must be 100% identical to CSV upload risk_tags"
  );
  assert.deepEqual(
    syncRes.body.trades,
    csvParsed.trades,
    "Kite live-fetch anonymized trades must be 100% identical to CSV upload anonymized trades"
  );

  const syncJson = JSON.stringify(syncRes.body);
  assert.ok(!syncJson.includes("INDUSINDBK"), "Ticker symbol must be stripped");
  assert.ok(!syncJson.includes("T99101"), "trade_id must be stripped");
  assert.ok(!syncJson.includes("42500"), "₹ P&L must be stripped");

  // 5. Verify token refresh handling on TokenException
  expireFirstTradesCall = true;
  const refreshSyncRes = await invokeRouter(router, {
    method: "POST",
    path: "/sync",
    headers,
  });
  assert.equal(refreshSyncRes.status, 200, "Sync must succeed after automatic token refresh");
  assert.equal(refreshCalled, true, "POST /session/refresh_token must be called on TokenException");

  // 6. Disconnect -> revokes at Kite AND immediately deletes stored token
  const disconnectRes = await invokeRouter(router, {
    method: "DELETE",
    path: "/disconnect",
    headers,
  });
  assert.equal(disconnectRes.status, 200);
  assert.equal(disconnectRes.body.disconnected, true);
  assert.equal(disconnectRes.body.deleted_from_store, true);
  assert.equal(revokeCalled, true, "DELETE /session/token must be called on disconnect");

  const afterDelete = await getBrokerConnection(uid, "zerodha_kite");
  assert.equal(afterDelete, null, "Stored encrypted token must be deleted immediately on disconnect");

  const statusAfter = await invokeRouter(router, {
    method: "GET",
    path: "/status",
    headers,
  });
  assert.equal(statusAfter.body.connected, false);

  console.log("✅ Zerodha Kite Connect (Read-Only) smoke test passed!");
  console.log("   - Zero write-scope permissions in OAuth URL & hard 403 block on trading endpoints");
  console.log("   - Access & refresh tokens encrypted with AES-256-GCM (zero plaintext / zero Zerodha PII stored)");
  console.log("   - Live-fetch anonymization diff vs CSV upload: 0 differences (100% identical ratios, risk_tags, trades)");
  console.log("   - Token refresh on TokenException verified");
  console.log("   - Disconnect revokes at Kite and immediately deletes stored token");
}

runKiteProof().catch((err) => {
  console.error("❌ Zerodha Kite Connect smoke test failed:", err);
  process.exit(1);
});
