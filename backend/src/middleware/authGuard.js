import { getUser, upsertUser } from "../db/firestore.js";
import { verifyFirebaseIdToken } from "../firebaseAdmin.js";

function extractBearerToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token || null;
}

async function resolveVerifiedUser(decoded, requestedRoleHeader = "") {
  const uid = decoded.uid;
  const email = decoded.email || "";
  const isAnonymous = decoded.firebase?.sign_in_provider === "anonymous";
  const verifiedName =
    decoded.name || (email ? email.split("@")[0] : isAnonymous ? "Guest" : "Learner");
  const photoURL = decoded.picture || "";

  let user = await getUser(uid);
  if (!user) {
    user = await upsertUser({
      uid,
      role: requestedRoleHeader === "employer" ? "employer" : "trader",
      displayName: verifiedName,
      email,
      photoURL,
    });
  }

  return {
    ...user,
    uid,
    email: user.email || email,
    displayName: user.displayName || verifiedName,
    photoURL: user.photoURL || photoURL,
    isAnonymous,
  };
}

/**
 * Strict Firebase ID Token Auth Middleware.
 * NEVER trusts client-supplied X-Firebase-Uid / X-Firebase-Email / X-User-Name headers.
 * Derives uid, email, and displayName exclusively from `admin.auth().verifyIdToken(token)`.
 */
export async function requireAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({
        error:
          "Authentication required. Provide a valid Firebase ID token in the Authorization: Bearer <token> header.",
      });
    }

    let decoded;
    try {
      decoded = await verifyFirebaseIdToken(token);
    } catch {
      return res.status(401).json({
        error: "Invalid or expired Firebase ID token. Please sign in again.",
      });
    }

    if (!decoded?.uid) {
      return res.status(401).json({
        error: "Firebase ID token did not contain a valid user identity.",
      });
    }

    const roleHint = req.headers?.["x-user-role"]?.toString().trim();
    req.user = await resolveVerifiedUser(decoded, roleHint);
    req.authClaims = decoded;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Optional Firebase ID Token Middleware for Guest-compatible endpoints.
 * - If Authorization: Bearer <idToken> is present (and not an sk_live_ API key),
 *   verifies it against Firebase Admin and attaches `req.user`.
 * - If no Bearer token is present (unauthenticated Guest session), sets `req.user = null`
 *   and allows the request through — NEVER reads X-Firebase-Uid.
 */
export async function optionalAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token || token.startsWith("sk_live_")) {
      req.user = null;
      return next();
    }

    let decoded;
    try {
      decoded = await verifyFirebaseIdToken(token);
    } catch {
      return res.status(401).json({
        error: "Invalid or expired Firebase ID token. Please sign in again.",
      });
    }

    if (!decoded?.uid) {
      return res.status(401).json({
        error: "Firebase ID token did not contain a valid user identity.",
      });
    }

    const roleHint = req.headers?.["x-user-role"]?.toString().trim();
    req.user = await resolveVerifiedUser(decoded, roleHint);
    req.authClaims = decoded;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Role-based route guard middleware ('trader' | 'employer').
 */
export function requireRole(expectedRole) {
  return (req, res, next) => {
    const actualRole = req.user?.role || "trader";
    if (actualRole !== expectedRole) {
      return res.status(403).json({
        error: `Access restricted to ${expectedRole} accounts (signed in as ${actualRole}).`,
      });
    }
    return next();
  };
}
