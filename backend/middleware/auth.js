import User from "../models/User.js";
import { verifyToken } from "../utils/auth.js";

// Requires a valid "Authorization: Bearer <token>" header. Attaches the
// current user (minus passwordHash) to req.user for downstream routes.
// Applied to every /api/* route except /api/auth/login and /api/health.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });

  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.id).select("-passwordHash").lean();
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
