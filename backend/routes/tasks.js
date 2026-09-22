import express from "express";
import Task from "../models/Task.js";
import Holiday from "../models/Holiday.js";
import { getSettings } from "../models/Settings.js";
import { generateOccurrencesForTask } from "../utils/generateOccurrences.js";
import { requireAdmin } from "../middleware/auth.js";
import { cacheGet, cacheSet, cacheDel } from "../utils/cache.js";

const router = express.Router();

async function loadGenerationContext() {
  const settings = await getSettings();
  const holidays = await Holiday.find().lean();
  const holidaySet = new Set(
    holidays.map((h) => new Date(h.date).toISOString().slice(0, 10))
  );
  return { settings, holidaySet };
}

// GET all tasks (Task List sheet) — same reasoning as the Doers cache
// above: this list is fetched by nearly every page, so it's cached for 5
// minutes and invalidated below on every write.
//
// Members only see tasks whose default assignee is their own Doer record
// (matched by email, same pattern used for Master's edit permission) —
// admins see the full catalog. The underlying list is still cached as one
// shared "tasks:all" entry (it's the same data for everyone); the
// per-member filtering happens in memory after the cache read/load, so it
// costs nothing extra in the database.
router.get("/", async (req, res) => {
  let all = await cacheGet("tasks:all");
  if (!all) {
    all = await Task.find().populate("defaultAssignee").sort({ taskId: 1 }).lean();
    cacheSet("tasks:all", all, 300); // fire-and-forget
  }
  if (req.user.role === "admin") return res.json(all);
  res.json(all.filter((t) => t.defaultAssignee?.email === req.user.email));
});

// CREATE task — taskId is assigned automatically (one higher than the
// current highest), never taken from the request, so there's no ID field
// to fill in or collide with on the Add Task form. Structural/setup data,
// so admin-only, same reasoning as Doers.
router.post("/", requireAdmin, async (req, res) => {
  try {
    const last = await Task.findOne().sort({ taskId: -1 }).lean();
    const taskId = (last?.taskId || 0) + 1;
    const task = await Task.create({ ...req.body, taskId });
    // If this task has a start date + default assignee, seed its upcoming
    // Master occurrences immediately rather than waiting for the next
    // Master page visit.
    const { settings, holidaySet } = await loadGenerationContext();
    await generateOccurrencesForTask(task, settings, holidaySet);
    await cacheDel("tasks:all");
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE task
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    // taskId is immutable once assigned — ignore it even if sent.
    const { taskId, ...updates } = req.body;
    // A new/changed startDate means "restart the schedule from here" —
    // reset the resume bookmark so generation begins from the new date
    // instead of continuing an old sequence.
    if (updates.startDate) updates.nextAnchor = null;
    const task = await Task.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!task) return res.status(404).json({ error: "Task not found" });
    // Picking up a new startDate/defaultAssignee/frequency, or reactivating
    // the task, should (re)start automatic generation — safe to call
    // unconditionally since it only ever tops up, never duplicates.
    const { settings, holidaySet } = await loadGenerationContext();
    await generateOccurrencesForTask(task, settings, holidaySet);
    await cacheDel("tasks:all");
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE (permanent) task
router.delete("/:id", requireAdmin, async (req, res) => {
  const deleted = await Task.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Task not found" });
  await cacheDel("tasks:all");
  res.json({ ok: true });
});

export default router;
