import express from "express";
import TaskInstance from "../models/TaskInstance.js";

const router = express.Router();

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

// CREATE a reminder occurrence
router.post("/", async (req, res) => {
  try {
    const entry = await TaskInstance.create(req.body);
    const populated = await entry.populate(["doer", "task"]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// MARK COMPLETE (sets actual = now, status auto-computed on save)
router.patch("/:id/complete", async (req, res) => {
  try {
    const entry = await TaskInstance.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: "Not found" });
    entry.actual = req.body.actual ? new Date(req.body.actual) : new Date();
    await entry.save();
    const populated = await entry.populate(["doer", "task"]);
    res.json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE (edit planned/actual manually)
router.put("/:id", async (req, res) => {
  try {
    const entry = await TaskInstance.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: "Not found" });
    Object.assign(entry, req.body);
    await entry.save();
    const populated = await entry.populate(["doer", "task"]);
    res.json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  await TaskInstance.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
