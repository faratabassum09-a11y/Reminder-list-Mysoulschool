import express from "express";
import SubmissionLog from "../models/SubmissionLog.js";
import { sendCsv } from "../utils/csv.js";
import { getDoerMaps } from "../utils/lookups.js";

const router = express.Router();

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Admins see the whole log. A member only ever sees submissions made under
// their own Doer name (Doer matched by email, same pairing as routes/master.js).
// If no Doer record matches, they get nothing rather than everything.
async function scopeToOwnName(req) {
  if (req.user.role === "admin") return {};
  const { byEmail } = await getDoerMaps();
  const doer = byEmail.get(String(req.user.email || "").toLowerCase());
  if (!doer?.name) return { _id: null };
  return { name: { $regex: `^\\s*${escapeRegex(doer.name.trim())}\\s*$`, $options: "i" } };
}

// The member scope is ANDed with the search, never replaced by it, so a
// search can't widen what a member sees.
function buildFilter(q, scope) {
  const parts = [scope];
  if (q) {
    const re = { $regex: String(q).trim(), $options: "i" };
    parts.push({ $or: [{ name: re }, { task: re }] });
  }
  return { $and: parts };
}

// CSV export of every row matching the current search (?q=), not just the
// current page. Capped at 20k rows as a sanity limit.
router.get("/export.csv", async (req, res) => {
  const filter = buildFilter(req.query.q, await scopeToOwnName(req));
  const rows = await SubmissionLog.find(filter).sort({ timestamp: -1 }).limit(20000).lean();
  const headers = ["Task Id", "Timestamp", "Name", "Task"];
  const body = rows.map((r) => [r.taskId, new Date(r.timestamp).toLocaleString(), r.name, r.task]);
  sendCsv(res, "submission-log.csv", headers, body);
});

// GET paginated submission log (Consolidated sheet).
// Query params: page (default 1), limit (default 100, max 500),
// q (optional — matches against name OR task, so one search box finds a
// submission whether you remember who did it or what the task was)
router.get("/", async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
  const filter = buildFilter(req.query.q, await scopeToOwnName(req));

  const [rows, total] = await Promise.all([
    SubmissionLog.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SubmissionLog.countDocuments(filter),
  ]);

  res.json({ rows, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) });
});

// GET summary counts (total rows, rows with a resolved name, unique names)
router.get("/summary", async (req, res) => {
  const scope = await scopeToOwnName(req);
  const total = await SubmissionLog.countDocuments(scope);
  const unresolved = await SubmissionLog.countDocuments({ $and: [scope, { name: "" }] });
  const uniqueNames = await SubmissionLog.distinct("name", { $and: [scope, { name: { $ne: "" } }] });
  res.json({ total, resolved: total - unresolved, unresolved, uniqueDoers: uniqueNames.length });
});

export default router;
