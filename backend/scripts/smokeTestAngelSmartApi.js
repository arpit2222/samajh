import assert from "node:assert/strict";
import { initDatabase, getBrokerConnection } from "../src/db/firestore.js";
import { createAngelRouter } from "../src/routes/angel.js";
import { assertReadOnlySmartApiEndpoint } from "../src/tools/angelSmartApi.js";
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

// Same 5 trades as SAMPLE_BROKER_CSV in official Angel One SmartAPI getTradeBook / getOrderBook format
const MOCK_ANGEL_TRADES = [
  {
    fillid: "T99101",
    orderid: "25031000182",
    tradingsymbol: "INDUSINDBK MAR FUT",
    exchange: "NFO",
    producttype: "CARRYFORWARD",
    transactiontype: "BUY",
    quantity: 500,
    fillprice: 900.5,
    filltime: "2025-03-10 09:16:12",
    pnl: -42500,
  },
  {
    fillid: "T99102",
    orderid: "25031300419",
    tradingsymbol: "NIFTY 24000 CE WK",
    exchange: "NFO",
    producttype: "INTRADAY",
    transactiontype: "BUY",
    quantity: 150,
    fillprice: 84.2,
    filltime: "2025-03-13 11:02:45",
    pnl: -8400,
  },
  {
    fillid: "T99103",
    orderid: "25031800772",
    tradingsymbol: "BANKNIFTY 51500 PE WK",
    exchange: "NFO",
    producttype: "CARRYFORWARD",
    transactiontype: "SELL",
    quantity: 60,
    fillprice: 210.0,
    filltime: "2025-03-18 14:55:10",
    pnl: -19200,
  },
  {
    fillid: "T99104",
    orderid: "25032000911",
    tradingsymbol: "RELIANCE MAR FUT",
    exchange: "NFO",
    producttype: "MARGIN",
    transactiontype: "SELL",
    quantity: 250,
    fillprice: 1280.0,
    filltime: "2025-03-20 10:21:00",
    pnl: -11500,
  },
  {
    fillid: "T99105",
    orderid: "25032100205",
    tradingsymbol: "HDFCBANK",
    exchange: "EQ",
    producttype: "DELIVERY",
    transactiontype: "BUY",
    quantity: 40,
    fillprice: 1715.0,
    filltime: "2025-03-21 13:10:05",
    pnl: 3200,
  },
];

const MOCK_ANGEL_ORDERS = [
  { orderid: "25031000183", tradingsymbol: "INDUSINDBK MAR FUT", ordertype: "STOPLOSS_LIMIT" },
  { orderid: "25032000912", tradingsymbol: "RELIANCE MAR FUT", ordertype: "STOPLOSS_MARKET" },
  { orderid: "25032100206", tradingsymbol: "HDFCBANK", ordertype: "STOPLOSS_LIMIT" },
];

async function runAngelProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  process.env.ANGEL_SMARTAPI_KEY = "angel_smartapi_test_key_456";
  process.env.KITE_TOKEN_ENCRYPTION_KEY = "test-aes256-gcm-encryption-secret";
  await initDatabase();

  const uid = "trader_angel_001";
  const headers = { "x-firebase-uid": uid };
  const rawJwt = "angel_jwt_SECRET_111";
  const refreshedJwt = "angel_jwt_refreshed_SECRET_222";
  const rawRefresh = "angel_refresh_SECRET_333";

  let expireFirstTradebookCall = false;
  let refreshCalled = false;
  let logoutCalled = false;

  const mockFetch = async (urlStr, options = {}) => {
    const url = new URL(urlStr);
    const method = (options.method || "GET").toUpperCase();
    assert.equal(options.headers["X-PrivateKey"], process.env.ANGEL_SMARTAPI_KEY);
    assert.equal(options.headers["X-UserType"], "USER");
    assert.equal(options.headers["X-SourceID"], "WEB");

    if (method === "POST" && url.pathname === "/rest/auth/angelbroking/user/v1/loginByPassword") {
      const payload = JSON.parse(options.body);
      assert.equal(payload.clientcode, "A123456");
      assert.equal(payload.password, "4321");
      assert.equal(payload.totp, "654321");
      assert.equal(options.headers.Authorization, undefined, "loginByPassword must omit Authorization");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: true,
          message: "SUCCESS",
          data: {
            jwtToken: rawJwt,
            refreshToken: rawRefresh,
            feedToken: "unused_feed_token",
          },
        }),
      };
    }

    if (method === "POST" && url.pathname === "/rest/auth/angelbroking/jwt/v1/generateTokens") {
      refreshCalled = true;
      const payload = JSON.parse(options.body);
      assert.equal(payload.refreshToken, rawRefresh);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: true,
          message: "SUCCESS",
          data: {
            jwtToken: refreshedJwt,
            refreshToken: rawRefresh,
          },
        }),
      };
    }

    if (method === "POST" && url.pathname === "/rest/secure/angelbroking/user/v1/logout") {
      logoutCalled = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: true, message: "SUCCESS", data: "Logout Successfully" }),
      };
    }

    if (method === "GET" && url.pathname === "/rest/secure/angelbroking/order/v1/getTradeBook") {
      if (expireFirstTradebookCall && options.headers.Authorization === `Bearer ${rawJwt}`) {
        return {
          ok: false,
          status: 401,
          json: async () => ({
            status: false,
            errorcode: "AG8001",
            message: "Invalid Token",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: true, message: "SUCCESS", data: MOCK_ANGEL_TRADES }),
      };
    }

    if (method === "GET" && url.pathname === "/rest/secure/angelbroking/order/v1/getOrderBook") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: true, message: "SUCCESS", data: MOCK_ANGEL_ORDERS }),
      };
    }

    if (method === "GET" && url.pathname === "/rest/secure/angelbroking/portfolio/v1/getHolding") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: true, message: "SUCCESS", data: [] }),
      };
    }

    throw new Error(`Unexpected SmartAPI call: ${method} ${url.pathname}`);
  };

  const router = createAngelRouter({ fetchImpl: mockFetch });

  // 1. Verify trading/order placement endpoints are permanently blocked
  assert.throws(
    () => assertReadOnlySmartApiEndpoint("POST", "/rest/secure/angelbroking/order/v1/placeOrder"),
    /strictly read-only/i,
    "Order placement must be permanently blocked"
  );

  // 2. Connect via TOTP -> verify AES-256-GCM encrypted token stored in shared `broker_connections`
  //    and ZERO clientcode, MPIN, TOTP, or plaintext JWT persisted
  const connectRes = await invokeRouter(router, {
    method: "POST",
    path: "/connect",
    headers,
    body: {
      clientcode: "A123456",
      password: "4321",
      totp: "654321",
    },
  });
  assert.equal(connectRes.status, 200);
  assert.equal(connectRes.body.connected, true);
  assert.equal(connectRes.body.scope, "read_only");

  const storedDoc = await getBrokerConnection(uid, "angel_smartapi");
  assert.ok(storedDoc, "Encrypted connection doc must exist in shared broker_connections");
  const storedJson = JSON.stringify(storedDoc);
  assert.equal(storedDoc.encryptedAccessToken.alg, "aes-256-gcm");
  assert.ok(!storedJson.includes(rawJwt), "Plaintext jwtToken must NEVER be stored");
  assert.ok(!storedJson.includes(rawRefresh), "Plaintext refreshToken must NEVER be stored");
  assert.ok(!storedJson.includes("A123456"), "Angel clientcode must NEVER be stored");
  assert.ok(!storedJson.includes("4321"), "Angel MPIN must NEVER be stored");
  assert.ok(!storedJson.includes("654321"), "Angel TOTP must NEVER be stored");

  // 3. Sync read-only trades and DIFF against CSV upload anonymization (MUST BE IDENTICAL)
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
    "SmartAPI live-fetch ratios must be 100% identical to CSV upload ratios"
  );
  assert.deepEqual(
    syncRes.body.risk_tags,
    csvParsed.risk_tags,
    "SmartAPI live-fetch risk_tags must be 100% identical to CSV upload risk_tags"
  );
  assert.deepEqual(
    syncRes.body.trades,
    csvParsed.trades,
    "SmartAPI live-fetch anonymized trades must be 100% identical to CSV upload anonymized trades"
  );

  const syncJson = JSON.stringify(syncRes.body);
  assert.ok(!syncJson.includes("INDUSINDBK"), "Ticker symbol must be stripped");
  assert.ok(!syncJson.includes("42500"), "₹ P&L must be stripped");

  // 4. Verify automatic refreshToken renewal on AG8001 / 401
  expireFirstTradebookCall = true;
  const refreshSyncRes = await invokeRouter(router, {
    method: "POST",
    path: "/sync",
    headers,
  });
  assert.equal(refreshSyncRes.status, 200, "Sync must succeed after automatic refreshToken renewal");
  assert.equal(refreshCalled, true, "POST /generateTokens must be called on expired JWT");

  // 5. Disconnect -> logs out at Angel One AND immediately deletes stored token
  const disconnectRes = await invokeRouter(router, {
    method: "DELETE",
    path: "/disconnect",
    headers,
  });
  assert.equal(disconnectRes.status, 200);
  assert.equal(disconnectRes.body.disconnected, true);
  assert.equal(disconnectRes.body.deleted_from_store, true);
  assert.equal(logoutCalled, true, "POST /logout must be called on disconnect");

  const afterDelete = await getBrokerConnection(uid, "angel_smartapi");
  assert.equal(afterDelete, null, "Stored encrypted token must be deleted immediately on disconnect");

  console.log("✅ Angel One SmartAPI (Read-Only) smoke test passed!");
  console.log("   - Hard 403 block on order placement / trading endpoints");
  console.log("   - Shared Firestore broker_connections schema + AES-256-GCM encryption (zero MPIN/TOTP/clientcode stored)");
  console.log("   - Live-fetch anonymization diff vs CSV upload: 0 differences (100% identical ratios, risk_tags, trades)");
  console.log("   - Automatic JWT refresh via /generateTokens verified");
  console.log("   - Disconnect calls SmartAPI logout and immediately deletes stored token");
}

runAngelProof().catch((err) => {
  console.error("❌ Angel One SmartAPI smoke test failed:", err);
  process.exit(1);
});
