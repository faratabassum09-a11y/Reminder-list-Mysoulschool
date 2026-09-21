import express from "express";
import TaskInstance from "../models/TaskInstance.js";
import { generateAllUpcoming, dedupeTaskInstances } from "../utils/generateOccurrences.js";
import { sendCsv } from "../utils/csv.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// A member may mark complete / edit only occurrences assigned to their own
// Doer record (matched by email — Users and Doers share the same email
// space). Admins bypass this entirely. Fetches the instance once here and
// stashes it on req so the route handler below doesn't have to fetch it
// again.
async function requireOwnDoerOrAdmin(req, res, next) {
  if (req.user.role === "admin") return next();
  try {
    const entry = await TaskInstance.findById(req.params.id).populate("doer");
    if (!entry) return res.status(404).json({ error: "Not found" });
    if (entry.doer?.email !== req.user.email) {
      return res.status(403).json({ error: "You can only update your own tasks" });
    }
    req._entry = entry;
    next();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// CSV export of every row matching the current filter (?status=), not just
// the current page — a plain download link, not a fetch call, so the
// browser handles the file itself. Capped at 20k rows as a sanity limit.
router.get("/export.csv", async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const rows = await TaskInstance.find(filter)
    .populate("doer")
    .populate("task")
    .sort({ planned: -1 })
    .limit(20000)
    .lean();

  const headers = ["Doer", "Task", "Department", "Planned", "Actual", "Status"];
  const body = rows.map((r) => [
    r.doer?.name || "",
    r.task?.taskName || "",
    r.doer?.department || "",
    r.planned ? new Date(r.planned).toLocaleString() : "",
    r.actual ? new Date(r.actual).toLocaleString() : "",
    r.status,
  ]);
  sendCsv(res, "master.csv", headers, body);
});

// Tops up Master with any upcoming occurrences that are due to exist for
// every active, schedule-driven task (has a startDate + defaultAssignee).
// Called automatically whenever the Master page loads, and available as a
// manual "Generate Upcoming" button too — safe to call repeatedly, it only
// ever adds rows that don't already exist.
router.post("/generate-upcoming", async (req, res) => {
  try {
    const result = await generateAllUpcoming();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One-time cleanup for duplicate rows created by a race condition that
// existed before generation calls were locked per-task (fixed above) —
// removes exact duplicates (same task+doer+planned, still incomplete),
// keeping one of each. Safe to run any time; does nothing once there's
// nothing left to clean up.
router.post("/dedupe", requireAdmin, async (req, res) => {
  try {
    const result = await dedupeTaskInstances();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET master log, paginated (?page=, ?limit=, max 500/page), with optional
// filters (?doer=, ?status=). Sorted newest-planned-first, same as before.
// Previously this hard-capped at 500 rows total with no way to reach the
// rest of the ~59k-row sheet — now every row is reachable, page by page,
// and the response tells the frontend the true total + page count so it can
// number rows correctly (S.No continues across pages, not reset per page).
router.get("/", async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
  const filter = {};
  if (req.query.doer) filter.doer = req.query.doer;
  if (req.query.status) filter.status = req.query.status;

  const [rows, total] = await Promise.all([
    TaskInstance.find(filter)
      .populate("doer")
      .populate("task")
      .sort({ planned: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(), // plain objects, not full Mongoose documents — faster to serialize for read-only list views
    TaskInstance.countDocuments(filter),
  ]);

  res.json({ rows, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) });
});

// CREATE a reminder occurrence — a one-off, ad hoc entry outside the normal
// recurring schedule. Admin-only: a member logs their own work by marking
// existing occurrences complete, not by inventing new ones.
router.post("/", requireAdmin, async (req, res) => {
  try {
    const entry = await TaskInstance.create(req.body);
    const populated = await entry.populate(["doer", "task"]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// MARK COMPLETE (sets actual = now, status auto-computed on save)
router.patch("/:id/complete", requireOwnDoerOrAdmin, async (req, res) => {
  try {
    const entry = req._entry;
    entry.actual = req.body.actual ? new Date(req.body.actual) : new Date();
    await entry.save();
    const populated = await entry.populate(["doer", "task"]);
    res.json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE (edit planned/actual manually)
router.put("/:id", requireOwnDoerOrAdmin, async (req, res) => {
  try {
    const entry = req._entry;
    Object.assign(entry, req.body);
    await entry.save();
    const populated = await entry.populate(["doer", "task"]);
    res.json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await TaskInstance.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
