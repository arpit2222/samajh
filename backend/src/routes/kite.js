import { Router } from "express";
import {
  deleteBrokerConnection,
  getBrokerConnection,
  upsertBrokerConnection,
} from "../db/firestore.js";
import { decryptBrokerToken, encryptBrokerToken } from "../tools/kiteEncryption.js";
import {
  anonymizeKiteTradeData,
  buildKiteLoginUrl,
  estimateKiteTokenExpiry,
  exchangeKiteRequestToken,
  fetchKiteReadOnlyData,
  getKiteCredentials,
  isKiteConfigured,
  refreshKiteAccessToken,
  revokeKiteSession,
} from "../tools/kiteConnect.js";

function requireSignedInUser(req, res) {
  const uid = req.headers["x-firebase-uid"]?.toString().trim();
  if (!uid) {
    res.status(401).json({
      error: "Sign in with Google or Email to connect your Zerodha Kite account.",
    });
    return null;
  }
  return uid;
}

export function createKiteRouter({ fetchImpl = globalThis.fetch } = {}) {
  const router = Router();

  /**
   * GET /api/broker/kite/status
   * Returns connection metadata ONLY (never returns any token or Zerodha PII).
   */
  router.get("/status", async (req, res, next) => {
    try {
      const uid = req.headers["x-firebase-uid"]?.toString().trim() || null;
      const configured = isKiteConfigured();
      if (!uid) {
        return res.status(200).json({
          configured,
          connected: false,
          broker: "zerodha_kite",
          scope: "read_only",
        });
      }

      const conn = await getBrokerConnection(uid, "zerodha_kite");
      if (!conn) {
        return res.status(200).json({
          configured,
          connected: false,
          broker: "zerodha_kite",
          scope: "read_only",
        });
      }

      const isExpired =
        Boolean(conn.expiresAt) && Date.now() >= new Date(conn.expiresAt).getTime();

      return res.status(200).json({
        configured,
        connected: true,
        broker: "zerodha_kite",
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
   * GET /api/broker/kite/login-url
   * Returns the official Kite Connect v3 login URL (read-only; no write scope).
   */
  router.get("/login-url", async (req, res, next) => {
    try {
      const uid = requireSignedInUser(req, res);
      if (!uid) return;

      if (!isKiteConfigured()) {
        return res.status(503).json({
          configured: false,
          error:
            "Zerodha Kite Connect is not configured yet on this server. Set KITE_API_KEY and KITE_API_SECRET in backend/.env.",
        });
      }

      const { apiKey } = getKiteCredentials();
      const login_url = buildKiteLoginUrl({
        apiKey,
        redirectParams: "broker=zerodha_kite",
      });

      return res.status(200).json({
        configured: true,
        scope: "read_only",
        login_url,
      });
    } catch (err) {
      return next(err);
    }
  });

  /**
   * POST /api/broker/kite/exchange
   * Exchanges Kite's single-use request_token for an access_token server-side,
   * encrypts the token with AES-256-GCM, and stores ONLY the encrypted blob in Firestore.
   */
  router.post("/exchange", async (req, res, next) => {
    try {
      const uid = requireSignedInUser(req, res);
      if (!uid) return;

      if (!isKiteConfigured()) {
        return res.status(503).json({
          error: "Zerodha Kite Connect is not configured on this server.",
        });
      }

      const requestToken = req.body?.request_token?.toString().trim();
      if (!requestToken) {
        return res.status(400).json({ error: "request_token is required." });
      }

      const { apiKey, apiSecret } = getKiteCredentials();
      const { access_token, refresh_token } = await exchangeKiteRequestToken({
        apiKey,
        apiSecret,
        requestToken,
        fetchImpl,
      });

      const encryptedAccessToken = encryptBrokerToken(access_token);
      const encryptedRefreshToken = refresh_token ? encryptBrokerToken(refresh_token) : null;
      const connectedAt = new Date().toISOString();
      const expiresAt = estimateKiteTokenExpiry();

      await upsertBrokerConnection({
        userId: uid,
        broker: "zerodha_kite",
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
        broker: "zerodha_kite",
        scope: "read_only",
        connected_at: connectedAt,
        expires_at: expiresAt,
      });
    } catch (err) {
      return next(err);
    }
  });

  /**
   * POST /api/broker/kite/sync
   * Fetches read-only trades/orders/holdings from Kite Connect, handles token refresh
   * if a refresh_token is available (or flags needs_reconnect on daily expiry), and
   * anonymizes all data identically to tradebookParser.js before returning.
   */
  router.post("/sync", async (req, res, next) => {
    try {
      const uid = requireSignedInUser(req, res);
      if (!uid) return;

      if (!isKiteConfigured()) {
        return res.status(503).json({
          error: "Zerodha Kite Connect is not configured on this server.",
        });
      }

      const conn = await getBrokerConnection(uid, "zerodha_kite");
      if (!conn || !conn.encryptedAccessToken) {
        return res.status(404).json({
          error: "No active Zerodha Kite connection found. Connect Zerodha first.",
        });
      }

      const { apiKey, apiSecret } = getKiteCredentials();
      let accessToken = decryptBrokerToken(conn.encryptedAccessToken);
      let rawKiteData = null;

      try {
        rawKiteData = await fetchKiteReadOnlyData({
          apiKey,
          accessToken,
          fetchImpl,
        });
      } catch (fetchErr) {
        const isTokenError =
          fetchErr.status === 401 ||
          fetchErr.status === 403 ||
          fetchErr.kiteErrorType === "TokenException";

        if (!isTokenError) throw fetchErr;

        // Attempt token refresh if a partner refresh_token is stored
        if (conn.encryptedRefreshToken) {
          const refreshToken = decryptBrokerToken(conn.encryptedRefreshToken);
          const refreshed = await refreshKiteAccessToken({
            apiKey,
            apiSecret,
            refreshToken,
            fetchImpl,
          });
          accessToken = refreshed.access_token;
          await upsertBrokerConnection({
            userId: uid,
            broker: "zerodha_kite",
            scope: "read_only",
            encryptedAccessToken: encryptBrokerToken(refreshed.access_token),
            encryptedRefreshToken: encryptBrokerToken(refreshed.refresh_token),
            connectedAt: conn.connectedAt,
            expiresAt: estimateKiteTokenExpiry(),
            lastSyncedAt: conn.lastSyncedAt,
            needsReconnect: false,
          });
          rawKiteData = await fetchKiteReadOnlyData({
            apiKey,
            accessToken,
            fetchImpl,
          });
        } else {
          // Standard Zerodha retail access tokens expire daily at ~07:30 AM IST
          await upsertBrokerConnection({
            ...conn,
            needsReconnect: true,
          });
          return res.status(401).json({
            needs_reconnect: true,
            error:
              "Your Zerodha Kite daily session expired. Click 'Connect Zerodha' to re-authorize read-only access.",
          });
        }
      }

      // Immediately anonymize raw Kite payload identically to tradebookParser.js
      const anonymizedProfile = anonymizeKiteTradeData(rawKiteData);

      // Update lastSyncedAt metadata (raw Kite data is never persisted)
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
   * DELETE /api/broker/kite/disconnect
   * Revokes the active Kite token at DELETE /session/token and IMMEDIATELY deletes
   * the encrypted token document from Firestore.
   */
  router.delete("/disconnect", async (req, res, next) => {
    try {
      const uid = requireSignedInUser(req, res);
      if (!uid) return;

      const conn = await getBrokerConnection(uid, "zerodha_kite");
      let revokedAtKite = false;

      if (conn?.encryptedAccessToken && isKiteConfigured()) {
        try {
          const { apiKey } = getKiteCredentials();
          const accessToken = decryptBrokerToken(conn.encryptedAccessToken);
          await revokeKiteSession({ apiKey, accessToken, fetchImpl });
          revokedAtKite = true;
        } catch {
          // Always proceed with immediate local deletion even if Kite token already expired
        }
      }

      const deleted = await deleteBrokerConnection(uid, "zerodha_kite");

      return res.status(200).json({
        disconnected: true,
        deleted_from_store: deleted,
        revoked_at_kite: revokedAtKite,
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default createKiteRouter();
