import express from "express";
import TaskInstance from "../models/TaskInstance.js";
import Doer from "../models/Doer.js";
import WeeklyArchive from "../models/WeeklyArchive.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Shared by the Dashboard's date-range pills (This Week / Yesterday /
// Today / Last Week / Next Week / Last Month / Year). "planned" is the
// field filtered on — the same field the rest of the app schedules and
// sorts by. Returns null for "all time" (no range keyword, or one that
// isn't recognized), which callers treat as "don't filter".
function getDateRange(key) {
  const today0 = startOfDay(new Date());
  switch (key) {
    case "today":
      return { start: today0, end: addDays(today0, 1) };
    case "yesterday":
      return { start: addDays(today0, -1), end: today0 };
    case "thisWeek": {
      const day = today0.getDay(); // 0 = Sunday
      const monday = addDays(today0, day === 0 ? -6 : 1 - day);
      return { start: monday, end: addDays(monday, 7) };
    }
    case "lastWeek": {
      const day = today0.getDay();
      const thisMonday = addDays(today0, day === 0 ? -6 : 1 - day);
      return { start: addDays(thisMonday, -7), end: thisMonday };
    }
    case "nextWeek": {
      const day = today0.getDay();
      const thisMonday = addDays(today0, day === 0 ? -6 : 1 - day);
      const nextMonday = addDays(thisMonday, 7);
      return { start: nextMonday, end: addDays(nextMonday, 7) };
    }
    case "lastMonth": {
      const now = new Date();
      return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
    }
    case "year": {
      const now = new Date();
      return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear() + 1, 0, 1) };
    }
    default:
      return null; // "all" / unrecognized — no filter
  }
}

// Both routes below used to $lookup + $unwind the ~59k-row Master collection
// against Doers on every request — that expands into ~59k joined documents
// before it can even start grouping, which is the main reason Consolidated
// and the Dashboard felt slow. Doers is a tiny collection (~20 rows), so we
// group Master by doer id first (cheap, uses the doer_1_planned_-1 index)
// and then join names/departments from an in-memory map instead — same
// result, one pass over Master instead of a full join.
//
// scoreMode: recurring tasks are pre-generated for months ahead, so an
// unbounded "all time" query counts hundreds of not-yet-due occurrences as
// part of the denominator — someone can look bad purely because the system
// already created next quarter's reminders for them, not because they've
// actually missed anything. A task only "counts" once it's either (a)
// actually due — planned date has passed (or falls inside the requested
// range) — or (b) already completed, even if that happened ahead of its
// planned date (a doer who knocks out next week's task today shouldn't
// have it sit invisible until the due date arrives before it shows as On
// Time). A range entirely in the future (e.g. "Next Week") with nothing
// completed early then still correctly yields no scored tasks rather than
// a misleading 0%.
function scoreMatch(rangeKey) {
  const range = getDateRange(rangeKey);
  const cutoff = addDays(startOfDay(new Date()), 1); // end of today, exclusive
  const end = range ? new Date(Math.min(range.end.getTime(), cutoff.getTime())) : cutoff;
  const plannedFilter = { $lt: end };
  if (range) plannedFilter.$gte = range.start;
  const actualFilter = range ? { $ne: null, $gte: range.start, $lt: range.end } : { $ne: null };
  return { $or: [{ planned: plannedFilter }, { actual: actualFilter }] };
}

async function rollupByDoer(rangeKey, { scoreMode = false } = {}) {
  const range = getDateRange(rangeKey);
  let matchStage = [];
  if (scoreMode) {
    matchStage = [{ $match: scoreMatch(rangeKey) }];
  } else if (range) {
    matchStage = [{ $match: { planned: { $gte: range.start, $lt: range.end } } }];
  }

  const [doers, statusCounts] = await Promise.all([
    Doer.find().select("name department").lean(),
    TaskInstance.aggregate([
      ...matchStage,
      {
        $group: {
          _id: "$doer",
          total: { $sum: 1 },
          onTime: { $sum: { $cond: [{ $eq: ["$status", "On Time"] }, 1, 0] } },
          delayed: { $sum: { $cond: [{ $eq: ["$status", "Delayed"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const doerMap = new Map(doers.map((d) => [String(d._id), d]));
  return { doerMap, statusCounts };
}

// Consolidated (per-person) rollup, merged into the Dashboard page — not a
// duplicated sheet, computed live. Optional ?range= narrows it to one of
// the Dashboard's date-range pills; omit for all-time. scoreMode is always
// on here since every row carries an onTimePercent (see rollupByDoer).
router.get("/", async (req, res) => {
  const { doerMap, statusCounts } = await rollupByDoer(req.query.range, { scoreMode: true });

  const rows = statusCounts
    .map((row) => {
      const doer = doerMap.get(String(row._id));
      if (!doer) return null; // orphaned instance (doer deleted) — skip from the rollup
      const onTimePercent = row.total ? (row.onTime / row.total) * 100 : 0;
      return {
        _id: row._id,
        name: doer.name,
        department: doer.department,
        total: row.total,
        onTime: row.onTime,
        delayed: row.delayed,
        pending: row.pending,
        onTimePercent,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.onTimePercent - a.onTimePercent);

  // Rank is assigned after sorting, and ties share a rank (standard
  // competition ranking: 1, 2, 2, 4 — not 1, 2, 2, 3) so two people with
  // an identical on-time rate are both shown in 1st rather than one being
  // arbitrarily bumped down by sort order alone.
  rows.forEach((r, i) => {
    r.rank = i > 0 && rows[i - 1].onTimePercent === r.onTimePercent ? rows[i - 1].rank : i + 1;
  });

  res.json(rows);
});

// A member's own performance rollup — same shape as a row from "/", but
// scoped to just the signed-in user's Doer record (matched by email, same
// convention as requireOwnDoerOrAdmin in routes/master.js). Powers the
// "Your Performance" section on the Account page. Same ?range= support as
// every other Consolidated endpoint. Always scored against tasks due up to
// today only — see rollupByDoer's scoreMode for why.
router.get("/me", async (req, res) => {
  const doer = await Doer.findOne({ email: req.user.email }).lean();
  if (!doer) {
    // Admin accounts (or any user with no matching Doer record) simply
    // have nothing to show here — not an error.
    return res.json({ doer: null, total: 0, onTime: 0, delayed: 0, pending: 0, onTimePercent: 0 });
  }

  const match = { doer: doer._id, ...scoreMatch(req.query.range) };

  const [row] = await TaskInstance.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        onTime: { $sum: { $cond: [{ $eq: ["$status", "On Time"] }, 1, 0] } },
        delayed: { $sum: { $cond: [{ $eq: ["$status", "Delayed"] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
      },
    },
  ]);

  const total = row?.total || 0;
  const onTime = row?.onTime || 0;
  const delayed = row?.delayed || 0;
  const pending = row?.pending || 0;

  res.json({
    doer: { name: doer.name, department: doer.department },
    total,
    onTime,
    delayed,
    pending,
    onTimePercent: total ? (onTime / total) * 100 : 0,
  });
});

// Overall dashboard summary (for cards / charts). Same ?range= support,
// same scoreMode cutoff as the per-doer rollup — otherwise the "On-Time
// Rate" card would be diluted by every not-yet-due recurring occurrence
// in the system, and "Pending" would mean "scheduled at all" instead of
// "actually waiting on someone right now".
router.get("/summary", async (req, res) => {
  const { doerMap, statusCounts } = await rollupByDoer(req.query.range, { scoreMode: true });

  let total = 0, onTime = 0, delayed = 0, pending = 0;
  const byDeptMap = new Map();

  for (const row of statusCounts) {
    total += row.total;
    onTime += row.onTime;
    delayed += row.delayed;
    pending += row.pending;

    const dept = doerMap.get(String(row._id))?.department || "Unassigned";
    const acc = byDeptMap.get(dept) || { _id: dept, total: 0, onTime: 0, delayed: 0 };
    acc.total += row.total;
    acc.onTime += row.onTime;
    acc.delayed += row.delayed;
    byDeptMap.set(dept, acc);
  }

  res.json({
    total,
    onTime,
    delayed,
    pending,
    byDepartment: Array.from(byDeptMap.values()).sort((a, b) => b.total - a.total),
  });
});

// Archive — a non-destructive log of Dashboard snapshots over time, the
// equivalent of the original's archive() button (which copied that week's
// numbers into an Archive sheet). Here it never resets the live totals.
// Always logs the all-time totals, regardless of whatever date-range pill
// is selected on the Dashboard at the moment — a snapshot is meant to be a
// consistent running record, not affected by what someone was filtering.
router.post("/archive", requireAdmin, async (req, res) => {
  const { doerMap, statusCounts } = await rollupByDoer();
  let total = 0, onTime = 0, delayed = 0, pending = 0;
  for (const row of statusCounts) {
    total += row.total;
    onTime += row.onTime;
    delayed += row.delayed;
    pending += row.pending;
  }
  const label = req.body?.label || `Snapshot of ${new Date().toLocaleDateString()}`;
  const archived = await WeeklyArchive.create({ label, total, onTime, delayed, pending });
  res.status(201).json(archived);
});

router.get("/archive", async (req, res) => {
  const archives = await WeeklyArchive.find().sort({ snapshotDate: -1 }).limit(100).lean();
  res.json(archives);
});

router.delete("/archive/:id", requireAdmin, async (req, res) => {
  const deleted = await WeeklyArchive.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Archive entry not found" });
  res.json({ ok: true });
});

export default router;