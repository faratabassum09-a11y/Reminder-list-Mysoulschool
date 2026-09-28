import express from "express";
import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import { getDoerMaps } from "../utils/lookups.js";

const router = express.Router();
// Every route here is mounted behind requireAuth + requireAdmin in
// server.js — this is the admin's own inbox of "a member marked a task
// done" events, nothing in this file is reachable by a non-admin.
//
// There's a single shared "admin" inbox (not per-admin), so reading or
// clearing notifications affects it for every admin.

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET paginated notifications, newest first. Used by both the bell's
// dropdown (small ?limit=) and the dedicated Notifications page (paged).
//
// doerName / taskName are denormalized onto each notification when it's
// created, and the doer's department comes from the in-memory doer lookup —
// so this no longer runs three populate() queries per request.
// `taskInstance` is returned as the plain id, which is all "View task"
// needs to open that exact row on Master.
router.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const q = (req.query.q || "").toString().trim();

    let match = {};
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match = { $or: [{ doerName: re }, { taskName: re }] };
    }

    const [rows, total, unread, { byId: doers }] = await Promise.all([
      Notification.find(match)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(match),
      Notification.countDocuments({ read: false }),
      getDoerMaps(),
    ]);

    for (const n of rows) {
      const d = doers.get(String(n.doer));
      n.doer = d ? { _id: d._id, name: d.name, department: d.department } : null;
    }

    res.json({ rows, total, unread, page, limit, pages: Math.max(Math.ceil(total / limit), 1) });
  } catch (err) {
    console.error("[notifications/]", err);
    res.status(500).json({ error: err.message });
  }
});

// Just the badge number — polled by the bell every few seconds.
router.get("/unread-count", async (req, res) => {
  try {
    const count = await Notification.countDocuments({ read: false });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark everything read at once — called when the bell's dropdown opens and
// when the dedicated Notifications page loads.
router.post("/read-all", async (req, res) => {
  try {
    const result = await Notification.updateMany({ read: false }, { $set: { read: true } });
    res.json({ ok: true, updated: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CLEAR ALL — permanently removes every notification in the inbox.
// (Route order matters: this exact-path DELETE must stay above "/:id".)
router.delete("/", async (req, res) => {
  try {
    const result = await Notification.deleteMany({});
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    console.error("[notifications/clear]", err);
    res.status(500).json({ error: err.message });
  }
});

// Mark a single notification read.
router.patch("/:id/read", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid notification ID" });
    const entry = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true }).lean();
    if (!entry) return res.status(404).json({ error: "Not found" });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dismiss (delete) a single notification.
router.delete("/:id", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid notification ID" });
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
