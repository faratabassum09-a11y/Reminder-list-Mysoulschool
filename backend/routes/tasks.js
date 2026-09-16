import express from "express";
import Task from "../models/Task.js";

const router = express.Router();

// GET all tasks (Task List sheet)
router.get("/", async (req, res) => {
  const tasks = await Task.find().populate("defaultAssignee").sort({ taskId: 1 }).lean();
  res.json(tasks);
});

// CREATE task
router.post("/", async (req, res) => {
  try {
    const task = await Task.create(req.body);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE task
router.put("/:id", async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE (permanent) task
router.delete("/:id", async (req, res) => {
  const deleted = await Task.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Task not found" });
  res.json({ ok: true });
});

export default router;
