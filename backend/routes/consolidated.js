import express from "express";
import TaskInstance from "../models/TaskInstance.js";
import Doer from "../models/Doer.js";

const router = express.Router();

// Both routes below used to $lookup + $unwind the ~59k-row Master collection
// against Doers on every request — that expands into ~59k joined documents
// before it can even start grouping, which is the main reason Consolidated
// and the Dashboard felt slow. Doers is a tiny collection (~20 rows), so we
// group Master by doer id first (cheap, uses the doer_1_planned_-1 index)
// and then join names/departments from an in-memory map instead — same
// result, one pass over Master instead of a full join.
async function rollupByDoer() {
  const [doers, statusCounts] = await Promise.all([
    Doer.find().select("name department").lean(),
    TaskInstance.aggregate([
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

// Consolidated view = computed rollup, not a duplicated sheet.
// Returns per-doer stats: total tasks, on-time, delayed, pending, % on-time
router.get("/", async (req, res) => {
  const { doerMap, statusCounts } = await rollupByDoer();

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

  res.json(rows);
});

// Overall dashboard summary (for cards / charts)
router.get("/summary", async (req, res) => {
  const { doerMap, statusCounts } = await rollupByDoer();

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

export default router;
