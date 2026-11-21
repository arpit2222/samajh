import { Router } from "express";
import {
  deleteBrokerConnection,
  getBrokerConnection,
  upsertBrokerConnection,
} from "../db/firestore.js";
import { decryptBrokerToken, encryptBrokerToken } from "../tools/kiteEncryption.js";
import {
  anonymizeAngelTradeData,
  estimateSmartApiTokenExpiry,
  fetchAngelReadOnlyData,
  getSmartApiKey,
  isSmartApiConfigured,
  loginAngelSmartApi,
  logoutAngelSmartApi,
  refreshAngelSmartApiToken,
} from "../tools/angelSmartApi.js";

const BROKER_ID = "angel_smartapi";

function requireSignedInUser(req, res) {
  const uid = req.headers["x-firebase-uid"]?.toString().trim();
  if (!uid) {
    res.status(401).json({
      error: "Sign in with Google or Email to connect your Angel One SmartAPI account.",
    });
    return null;
  }
  return uid;
}

export function createAngelRouter({ fetchImpl = globalThis.fetch } = {}) {
  const router = Router();

  /**
   * GET /api/broker/angel/status
   * Returns connection metadata ONLY (never returns tokens, clientcode, MPIN, or TOTP).
   */
  router.get("/status", async (req, res, next) => {
    try {
      const uid = req.headers["x-firebase-uid"]?.toString().trim() || null;
      const configured = isSmartApiConfigured();
      if (!uid) {
        return res.status(200).json({
          configured,
          connected: false,
          broker: BROKER_ID,
          scope: "read_only",
        });
      }

      const conn = await getBrokerConnection(uid, BROKER_ID);
      if (!conn) {
        return res.status(200).json({
          configured,
          connected: false,
          broker: BROKER_ID,
          scope: "read_only",
        });
      }

      const isExpired =
        Boolean(conn.expiresAt) && Date.now() >= new Date(conn.expiresAt).getTime();

      return res.status(200).json({
        configured,
        connected: true,
        broker: BROKER_ID,
        scope: "read_only",
        connected_at: conn.connectedAt,
        expires_at: conn.expiresAt,
        last_synced_at: conn.lastSyncedAt,
        has_refresh_token: Boolean(conn.encryptedRefreshToken),
        needs_reconnect: Boolean(conn.needsReconnect || isExpired),
      });
    } catch (err) {
      return next(err);
    }
  });

  /**
   * POST /api/broker/angel/connect
   * Angel One SmartAPI TOTP-based login (`loginByPassword`).
   * Passes { clientcode, password (MPIN), totp } straight to Angel One,
   * stores ONLY AES-256-GCM encrypted jwtToken & refreshToken in Firestore `broker_connections`,
   * and NEVER persists clientcode, password/MPIN, or TOTP.
   */
  router.post("/connect", async (req, res, next) => {
    try {
      const uid = requireSignedInUser(req, res);
      if (!uid) return;

      if (!isSmartApiConfigured()) {
        return res.status(503).json({
          configured: false,
          error:
            "Angel One SmartAPI is not configured yet on this server. Set ANGEL_SMARTAPI_KEY in backend/.env.",
        });
      }

      const clientcode = req.body?.clientcode?.toString().trim();
      const password = req.body?.password?.toString().trim();
      const totp = req.body?.totp?.toString().trim();

      if (!clientcode || !password || !totp) {
        return res.status(400).json({
          error: "clientcode, MPIN (password), and 6-digit TOTP are required.",
        });
      }
      if (!/^\d{6}$/.test(totp)) {
        return res.status(400).json({
          error: "TOTP must be a 6-digit numeric code from your authenticator app.",
        });
      }

      const apiKey = getSmartApiKey();
      const { jwtToken, refreshToken } = await loginAngelSmartApi({
        apiKey,
        clientcode,
        password,
        totp,
        fetchImpl,
      });

      const encryptedAccessToken = encryptBrokerToken(jwtToken);
      const encryptedRefreshToken = refreshToken ? encryptBrokerToken(refreshToken) : null;
      const connectedAt = new Date().toISOString();
      const expiresAt = estimateSmartApiTokenExpiry();

      // Reuse the EXACT same Firestore `broker_connections` schema as Zerodha Kite
      await upsertBrokerConnection({
        userId: uid,
        broker: BROKER_ID,
        scope: "read_only",
        encryptedAccessToken,
        encryptedRefreshToken,
        connectedAt,
        expiresAt,
        lastSyncedAt: null,
        needsReconnect: false,
      });

      return res.status(200).json({
        connected: true,
        broker: BROKER_ID,
        scope: "read_only",
        connected_at: connectedAt,
        expires_at: expiresAt,
      });
    } catch (err) {
      return next(err);
    }
  });

  /**
   * POST /api/broker/angel/sync
   * Fetches read-only TradeBook/OrderBook/Holding, handles automatic refreshToken renewal
   * on expired JWT, and runs through the exact same anonymization pipeline as CSV & Zerodha Kite.
   */
  router.post("/sync", async (req, res, next) => {
    try {
      const uid = requireSignedInUser(req, res);
      if (!uid) return;

      if (!isSmartApiConfigured()) {
        return res.status(503).json({
          error: "Angel One SmartAPI is not configured on this server.",
        });
      }

      const conn = await getBrokerConnection(uid, BROKER_ID);
      if (!conn || !conn.encryptedAccessToken) {
        return res.status(404).json({
          error: "No active Angel One SmartAPI connection found. Connect Angel One first.",
        });
      }

      const apiKey = getSmartApiKey();
      let jwtToken = decryptBrokerToken(conn.encryptedAccessToken);
      let rawAngelData = null;

      try {
        rawAngelData = await fetchAngelReadOnlyData({
          apiKey,
          jwtToken,
          fetchImpl,
        });
      } catch (fetchErr) {
        const isTokenError =
          fetchErr.status === 401 ||
          fetchErr.status === 403 ||
          fetchErr.errorCode === "AG8001" ||
          fetchErr.errorCode === "AG8002";

        if (!isTokenError) throw fetchErr;

        if (conn.encryptedRefreshToken) {
          const refreshToken = decryptBrokerToken(conn.encryptedRefreshToken);
          const refreshed = await refreshAngelSmartApiToken({
            apiKey,
            jwtToken,
            refreshToken,
            fetchImpl,
          });
          jwtToken = refreshed.jwtToken;
          await upsertBrokerConnection({
            userId: uid,
            broker: BROKER_ID,
            scope: "read_only",
            encryptedAccessToken: encryptBrokerToken(refreshed.jwtToken),
            encryptedRefreshToken: encryptBrokerToken(refreshed.refreshToken),
            connectedAt: conn.connectedAt,
            expiresAt: estimateSmartApiTokenExpiry(),
            lastSyncedAt: conn.lastSyncedAt,
            needsReconnect: false,
          });
          rawAngelData = await fetchAngelReadOnlyData({
            apiKey,
            jwtToken,
            fetchImpl,
          });
        } else {
          await upsertBrokerConnection({
            ...conn,
            needsReconnect: true,
          });
          return res.status(401).json({
            needs_reconnect: true,
            error:
              "Your Angel One SmartAPI session expired. Re-authenticate with your TOTP to continue.",
          });
        }
      }

      // Immediately anonymize through the exact same shared pipeline as CSV & Zerodha Kite
      const anonymizedProfile = anonymizeAngelTradeData(rawAngelData);

      await upsertBrokerConnection({
        ...conn,
        lastSyncedAt: new Date().toISOString(),
        needsReconnect: false,
      });

      return res.status(200).json(anonymizedProfile);
    } catch (err) {
      return next(err);
    }
  });

  /**
   * DELETE /api/broker/angel/disconnect
   * Calls SmartAPI logout and IMMEDIATELY deletes the encrypted token from Firestore.
   */
  router.delete("/disconnect", async (req, res, next) => {
    try {
      const uid = requireSignedInUser(req, res);
      if (!uid) return;

      const conn = await getBrokerConnection(uid, BROKER_ID);
      let loggedOutAtAngel = false;

      if (conn?.encryptedAccessToken && isSmartApiConfigured()) {
        try {
          const apiKey = getSmartApiKey();
          const jwtToken = decryptBrokerToken(conn.encryptedAccessToken);
          await logoutAngelSmartApi({ apiKey, jwtToken, fetchImpl });
          loggedOutAtAngel = true;
        } catch {
          // Always proceed with immediate local deletion
        }
      }

      const deleted = await deleteBrokerConnection(uid, BROKER_ID);

      return res.status(200).json({
        disconnected: true,
        deleted_from_store: deleted,
        logged_out_at_broker: loggedOutAtAngel,
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default createAngelRouter();
