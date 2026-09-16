import express from "express";
import SubmissionLog from "../models/SubmissionLog.js";

const router = express.Router();

// GET paginated submission log (Consolidated sheet).
// Query params: page (default 1), limit (default 100, max 500),
// q (optional — matches against name OR task, so one search box finds a
// submission whether you remember who did it or what the task was)
router.get("/", async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
  const filter = {};
  if (req.query.q) {
    const re = { $regex: req.query.q.trim(), $options: "i" };
    filter.$or = [{ name: re }, { task: re }];
  }

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
  const total = await SubmissionLog.countDocuments();
  const unresolved = await SubmissionLog.countDocuments({ name: "" });
  const uniqueNames = await SubmissionLog.distinct("name", { name: { $ne: "" } });
  res.json({ total, resolved: total - unresolved, unresolved, uniqueDoers: uniqueNames.length });
});

export default router;
