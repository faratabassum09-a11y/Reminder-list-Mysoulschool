import express from "express";
import Notification from "../models/Notification.js";

const router = express.Router();
// Every route here is mounted behind requireAuth + requireAdmin in
// server.js — this is the admin's own inbox of "a member marked a task
// done" events, nothing in this file is reachable by a non-admin.

// GET paginated notifications, newest first. Used by both the bell's
// dropdown (small ?limit=) and the dedicated Notifications page (paged).
router.get("/", async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const q = (req.query.q || "").toString().trim();

  // doerName/taskName are denormalized onto the notification at creation
  // time, so a plain regex here covers search without any joins.
  let match = {};
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    match = { $or: [{ doerName: re }, { taskName: re }] };
  }

  const [rows, total, unread] = await Promise.all([
    Notification.find(match)
      .populate("doer")
      .populate("task")
      .populate({ path: "taskInstance", select: "planned actual status" })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(match),
    Notification.countDocuments({ read: false }),
  ]);
  res.json({ rows, total, unread, page, limit, pages: Math.max(Math.ceil(total / limit), 1) });
});

// Just the badge number — polled by the bell every few seconds.
router.get("/unread-count", async (req, res) => {
  const count = await Notification.countDocuments({ read: false });
  res.json({ count });
});

// Mark a single notification read (used when clicking straight into a
// task from the dropdown, so that one item stops counting toward the
// badge even if the rest of the inbox hasn't been opened).
router.patch("/:id/read", async (req, res) => {
  const entry = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
  if (!entry) return res.status(404).json({ error: "Not found" });
  res.json(entry);
});

// Mark everything read at once — this is the only place the badge count
// gets reset. Called when the bell's dropdown opens and when the
// dedicated Notifications page loads; nothing on Master touches this.
router.post("/read-all", async (req, res) => {
  const result = await Notification.updateMany({ read: false }, { $set: { read: true } });
  res.json({ ok: true, updated: result.modifiedCount });
});

export default router;
