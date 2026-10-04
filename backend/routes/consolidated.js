import express from "express";
import TaskInstance from "../models/TaskInstance.js";
import Doer from "../models/Doer.js";
import WeeklyArchive from "../models/WeeklyArchive.js";
import { requireAdmin } from "../middleware/auth.js";
import { memo, getDataVersion } from "../utils/cache.js";
import { getDoerMaps } from "../utils/lookups.js";
import { withTrackingFloor } from "../utils/trackingStart.js";

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
// actually missed anything. When scoreMode is true, the upper bound of
// whatever range was requested (or "no range" = unbounded) is capped at
// the end of today, so only tasks that have actually come due are counted.
// A range entirely in the future (e.g. "Next Week") then correctly yields
// no scored tasks rather than a misleading 0%.
async function computeRollup(rangeKey, { scoreMode = false } = {}) {
  const range = getDateRange(rangeKey);
  // Nothing planned before the tracking start date (5 Oct 2026) is ever counted.
  let matchStage;
  if (scoreMode) {
    const cutoff = addDays(startOfDay(new Date()), 1); // end of today, exclusive
    const end = range ? new Date(Math.min(range.end.getTime(), cutoff.getTime())) : cutoff;
    const plannedFilter = { $lt: end };
    if (range) plannedFilter.$gte = range.start;
    matchStage = [{ $match: { planned: withTrackingFloor(plannedFilter) } }];
  } else if (range) {
    matchStage = [{ $match: { planned: withTrackingFloor({ $gte: range.start, $lt: range.end }) } }];
  } else {
    matchStage = [{ $match: { planned: withTrackingFloor() } }];
  }

  const [{ byId: doerMap }, statusCounts] = await Promise.all([
    getDoerMaps(),
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

  return { doerMap, statusCounts };
}

// The Dashboard asks for the summary AND the per-person table for the same
// range at the same moment, every 20s, from every open tab — each one a
// full aggregation over the whole Master collection. Cache the result in
// memory for a few seconds (shared by concurrent callers, retired
// instantly by any write to Master via the data version, and keyed by the
// calendar day since "up to today" moves at midnight).
function rollupByDoer(rangeKey, opts = {}) {
  const day = startOfDay(new Date()).getTime();
  const key = `rollup:${getDataVersion()}:${day}:${rangeKey || "all"}:${opts.scoreMode ? 1 : 0}`;
  return memo(key, 20_000, () => computeRollup(rangeKey, opts));
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
  const { byEmail } = await getDoerMaps();
  const doer = byEmail.get(String(req.user.email || "").toLowerCase());
  if (!doer) {
    // Admin accounts (or any user with no matching Doer record) simply
    // have nothing to show here — not an error.
    return res.json({ doer: null, total: 0, onTime: 0, delayed: 0, pending: 0, onTimePercent: 0 });
  }

  const range = getDateRange(req.query.range);
  const cutoff = addDays(startOfDay(new Date()), 1);
  const end = range ? new Date(Math.min(range.end.getTime(), cutoff.getTime())) : cutoff;
  const plannedFilter = { $lt: end };
  if (range) plannedFilter.$gte = range.start;
  const match = { doer: doer._id, planned: withTrackingFloor(plannedFilter) };

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

// ─── ORPHAN CLEANUP ────────────────────────────────────────────────────────
// Why Fara (or anyone) can show tasks in the Dashboard even with 0 rows
// in Master filtered view:
//
//  1. TaskInstance rows are grouped by doer ObjectId — NOT by task name.
//     If tasks were deleted from the Task collection but their TaskInstance
//     rows were NOT deleted, those orphaned instances still count.
//
//  2. Column filters on the Master page filter what YOU SEE — they don't
//     change what the DB aggregate counts.
//
//  3. A Doer can have TaskInstances whose linked Task no longer exists
//     (task was removed). The instance still has the doer's _id so it
//     still appears in the per-person rollup.
//
// This route: GET  /api/consolidated/orphans        → preview orphaned rows
//             DELETE /api/consolidated/orphans      → delete them
// ──────────────────────────────────────────────────────────────────────────
router.get("/orphans", requireAdmin, async (req, res) => {
  try {
    const Task = (await import("../models/Task.js")).default;
    const [allTaskIds, allDoerIds] = await Promise.all([
      Task.distinct("_id"),
      Doer.distinct("_id"),
    ]);
    const taskSet = new Set(allTaskIds.map(String));
    const doerSet = new Set(allDoerIds.map(String));

    // Find instances whose task OR doer no longer exists
    const all = await TaskInstance.find({}, { task: 1, doer: 1, planned: 1, status: 1 }).lean();
    const orphans = all.filter(
      (inst) => !taskSet.has(String(inst.task)) || !doerSet.has(String(inst.doer))
    );

    // Group by doer for a readable preview
    const byDoer = {};
    for (const o of orphans) {
      const key = String(o.doer);
      byDoer[key] = byDoer[key] || { doerId: key, count: 0, reason: [] };
      byDoer[key].count++;
      if (!taskSet.has(String(o.task)) && !byDoer[key].reason.includes("task deleted"))
        byDoer[key].reason.push("task deleted");
      if (!doerSet.has(String(o.doer)) && !byDoer[key].reason.includes("doer deleted"))
        byDoer[key].reason.push("doer deleted");
    }

    // Enrich with doer name where possible
    const doerDocs = await Doer.find({ _id: { $in: Object.keys(byDoer) } }, { name: 1 }).lean();
    const nameMap = new Map(doerDocs.map((d) => [String(d._id), d.name]));
    const summary = Object.values(byDoer).map((r) => ({
      ...r,
      name: nameMap.get(r.doerId) || "(deleted doer)",
    }));

    res.json({ totalOrphans: orphans.length, byDoer: summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/orphans", requireAdmin, async (req, res) => {
  try {
    const Task = (await import("../models/Task.js")).default;
    const [allTaskIds, allDoerIds] = await Promise.all([
      Task.distinct("_id"),
      Doer.distinct("_id"),
    ]);
    const taskSet = new Set(allTaskIds.map(String));
    const doerSet = new Set(allDoerIds.map(String));

    const all = await TaskInstance.find({}, { task: 1, doer: 1 }).lean();
    const orphanIds = all
      .filter((inst) => !taskSet.has(String(inst.task)) || !doerSet.has(String(inst.doer)))
      .map((inst) => inst._id);

    if (!orphanIds.length) return res.json({ deleted: 0, message: "No orphans found" });

    const result = await TaskInstance.deleteMany({ _id: { $in: orphanIds } });
    res.json({ deleted: result.deletedCount, message: `Removed ${result.deletedCount} orphaned rows from Master` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
