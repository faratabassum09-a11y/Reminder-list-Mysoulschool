import User from "../models/User.js";
import { verifyToken } from "../utils/auth.js";
import { hasApp } from "../utils/access.js";

// Requires a valid "Authorization: Bearer <token>" header. Attaches the
// current user (minus passwordHash) to req.user for downstream routes.
// Applied to every /api/* route except /api/auth/login and /api/health.
// The signed-in user is re-checked against the database on every request
// (so a deactivated account is locked out immediately) — but that's one
// extra Mongo round-trip on EVERY call, including the bell/messages polling.
// Keep the lookup in memory for a few seconds; anything that changes a user
// (Users page, profile, password) calls clearAuthCache() so it takes effect
// straight away on this server.
const AUTH_TTL_MS = 20_000;
const userCache = new Map(); // id -> { user, exp }
export function clearAuthCache() {
  userCache.clear();
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });

  try {
    const payload = verifyToken(token);
    let entry = userCache.get(payload.id);
    if (!entry || entry.exp <= Date.now()) {
      const found = await User.findById(payload.id).select("-passwordHash").lean();
      entry = { user: found, exp: Date.now() + AUTH_TTL_MS };
      if (userCache.size > 500) userCache.clear();
      userCache.set(payload.id, entry);
    }
    const user = entry.user;
    if (!user || user.active === false) return res.status(401).json({ error: "Account no longer active" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired — please sign in again" });
  }
}

// Stacks after requireAuth — admin-only actions (delete, Settings, user
// management). A 403 here is a real permission boundary, not just a
// hidden button: the frontend also hides these, but this is what actually
// stops a non-admin from calling the endpoint directly.
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admins only" });
  }
  next();
}

// Stacks after requireAuth — blocks accounts that weren't given this app
// ("reminder" = Reminder List, "workshop" = Workshop PMS). Enforced on the
// server so a workshop-only user can't reach reminder data by calling the
// API directly, and vice versa.
export function requireApp(app) {
  return (req, res, next) => {
    if (!hasApp(req.user, app)) {
      return res.status(403).json({ error: `Your account doesn't have access to ${{ workshop: "Workshop PMS", tickets: "Help Tickets" }[app] || "the Reminder List"}` });
    }
    next();
  };
}
