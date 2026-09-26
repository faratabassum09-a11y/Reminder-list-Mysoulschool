import express from "express";
import Doer from "../models/Doer.js";
import TaskInstance from "../models/TaskInstance.js";
import { sendMail } from "../utils/mailer.js";
import { requireAdmin } from "../middleware/auth.js";
import { cached, cacheDel } from "../utils/cache.js";

const router = express.Router();

// GET all doers (Doer List sheet). Every page that shows a doer's name —
// Master, Task List, Dashboard — fetches this list, so with many people
// using the app at once it's one of the most-repeated queries. Cached for
// 5 minutes (no-op without REDIS_URL) and invalidated immediately below
// whenever a doer is created, edited, or deleted, so the cache is never
// more than 5 minutes stale even on a cache-storage failure.
router.get(
  "/",
  cached("doers:all", 300, () => Doer.find().sort({ department: 1, name: 1 }).lean())
);

// CREATE doer — structural/setup data (who exists, their department, their
// buddy chain), so admin-only, not "day-to-day work".
router.post("/", requireAdmin, async (req, res) => {
  try {
    const doer = await Doer.create(req.body);
    await cacheDel("doers:all");
    res.status(201).json(doer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE doer
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const doer = await Doer.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    await cacheDel("doers:all");
    res.json(doer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE (permanent) doer
router.delete("/:id", requireAdmin, async (req, res) => {
  const deleted = await Doer.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Doer not found" });
  await cacheDel("doers:all");
  res.json({ ok: true });
});

// Email this doer their current task list — the equivalent of the
// original's sendtodoer(): an HTML table of their tasks, emailed on
// request. Defaults to everything not yet completed (Pending + Delayed);
// pass ?status=On+Time / Delayed / Pending to narrow it, matching the
// original's status dropdown. A member may only trigger this for their own
// Doer record (matched by email); admins may trigger it for anyone.
router.post("/:id/email-tasks", async (req, res) => {
  try {
    const doer = await Doer.findById(req.params.id).lean();
    if (!doer) return res.status(404).json({ error: "Doer not found" });
    if (req.user.role !== "admin" && doer.email !== req.user.email) {
      return res.status(403).json({ error: "You can only email your own tasks" });
    }

    const statusFilter = req.body?.status;
    const query = { doer: doer._id };
    if (statusFilter) {
      query.status = statusFilter;
    } else {
      // A far-future recurring task can have dozens of Pending rows queued
      // up to the schedule horizon — nobody needs all of those in one
      // email. Anything overdue (Delayed) always shows; Pending items only
      // show if they're due in the next 14 days.
      const windowEnd = new Date();
      windowEnd.setDate(windowEnd.getDate() + 14);
      query.$or = [{ status: "Delayed" }, { status: "Pending", planned: { $lte: windowEnd } }];
    }

    const instances = await TaskInstance.find(query)
      .populate("task")
      .sort({ planned: 1 })
      .limit(200)
      .lean();

    if (instances.length === 0) {
      return res.json({ sent: false, reason: "No matching tasks to email", count: 0 });
    }

    const rows = instances
      .map(
        (i) =>
          `<tr><td>${i.task?.taskName || "Untitled task"}</td><td>${new Date(i.planned).toLocaleString()}</td><td>${i.status}</td></tr>`
      )
      .join("");
    const html =
      `<p>Here are your ${statusFilter || "upcoming (next 14 days) and overdue"} tasks.</p>` +
      `<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Task</th><th>Planned</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    const text = instances
      .map((i) => `${i.task?.taskName || "Untitled task"} — ${new Date(i.planned).toLocaleString()} — ${i.status}`)
      .join("\n");

    const sent = await sendMail({
      to: doer.email,
      subject: "Details of Delegated Tasks",
      text: `Here are your tasks:\n\n${text}`,
      html,
    });

    res.json({ sent, count: instances.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
