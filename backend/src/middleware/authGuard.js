import { getUser, upsertUser } from "../db/firestore.js";

/**
 * Auth middleware: reads Firebase UID from X-Firebase-Uid header.
 * Rejects anonymous/guest requests on protected credential & employer routes.
 */
export async function requireAuth(req, res, next) {
  try {
    const uid = req.headers["x-firebase-uid"]?.toString().trim();
    if (!uid) {
      return res.status(401).json({
        error: "Sign in with Google or Email (or Employer demo) to access this feature.",
      });
    }

    let user = await getUser(uid);
    const headerRole = req.headers["x-user-role"]?.toString().trim();
    const headerName = req.headers["x-user-name"]?.toString().trim();
    const headerEmail = req.headers["x-firebase-email"]?.toString().trim();

    if (!user) {
      user = await upsertUser({
        uid,
        role: headerRole === "employer" ? "employer" : "trader",
        displayName: headerName || headerEmail?.split("@")[0] || "Learner",
        email: headerEmail || "",
      });
    }

    req.user = user;
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
