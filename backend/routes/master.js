import express from "express";
import TaskInstance from "../models/TaskInstance.js";
import Doer from "../models/Doer.js";
import Task from "../models/Task.js";
import User from "../models/User.js";
import { generateAllUpcoming, dedupeTaskInstances } from "../utils/generateOccurrences.js";
import { sendCsv } from "../utils/csv.js";
import { requireAdmin } from "../middleware/auth.js";
import { claimCooldown } from "../utils/cache.js";
import { sendMail } from "../utils/mailer.js";

const router = express.Router();

// Fire-and-forget email to every active admin when a member marks a task
// done — replaces the old "submitted, waiting on an admin to approve"
// step entirely. Never awaited by the route handler: a slow/misconfigured
// mailer must never make the doer's "mark as done" click feel slow, and a
// failure here must never turn into a failed completion.
async function notifyAdminsTaskCompleted(entry) {
  const admins = await User.find({ role: "admin", active: true }).select("email").lean();
  if (!admins.length) return;
  const subject = `${entry.doer?.name || "Someone"} marked "${entry.task?.taskName || "a task"}" done`;
  const statusLine = entry.status === "Delayed" ? "Delayed" : "On Time";
  const text =
    `${entry.doer?.name || "A team member"} just marked "${entry.task?.taskName || "a task"}" as done ` +
    `(${statusLine}, completed ${new Date(entry.actual).toLocaleString()}).` +
    (entry.submission?.note ? `\n\nNote: ${entry.submission.note}` : "") +
    (entry.submission?.link ? `\nLink: ${entry.submission.link}` : "");
  await Promise.all(admins.map((a) => sendMail({ to: a.email, subject, text }).catch(() => {})));
}

// A member only ever sees rows assigned to their own Doer record (matched
// by email, same pairing used everywhere else in this file). Admins see
// everything. Returns a Mongo filter fragment to merge into the route's
// query — { doer: <their id> } for a member, {} for an admin, and an
// impossible match if a member is signed in but has no matching Doer
// record yet, so they see an empty list instead of everyone else's rows.
async function scopeToOwnDoer(req) {
  if (req.user.role === "admin") return {};
  const doer = await Doer.findOne({ email: req.user.email }).select("_id").lean();
  return { doer: doer ? doer._id : "000000000000000000000000" };
}

// A member may mark complete / edit only occurrences assigned to their own
// Doer record (matched by email — Users and Doers share the same email
// space). Admins bypass this entirely. Fetches the instance once here and
// stashes it on req so the route handler below doesn't have to fetch it
// again.
async function requireOwnDoerOrAdmin(req, res, next) {
  if (req.user.role === "admin") return next();
  try {
    const entry = await TaskInstance.findById(req.params.id).populate("doer");
    if (!entry) return res.status(404).json({ error: "Not found" });
    if (entry.doer?.email !== req.user.email) {
      return res.status(403).json({ error: "You can only update your own tasks" });
    }
    req._entry = entry;
    next();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// CSV export of every row matching the current filter (?status=), not just
// the current page — a plain download link, not a fetch call, so the
// browser handles the file itself. Capped at 20k rows as a sanity limit.
router.get("/export.csv", async (req, res) => {
  const filter = { ...(await scopeToOwnDoer(req)) };
  if (req.query.status) filter.status = req.query.status;
  const rows = await TaskInstance.find(filter)
    .populate("doer")
    .populate("task")
    .sort({ planned: -1 })
    .limit(20000)
    .lean();

  const headers = ["Doer", "Task", "Department", "Planned", "Actual", "Status"];
  const body = rows.map((r) => [
    r.doer?.name || "",
    r.task?.taskName || "",
    r.doer?.department || "",
    r.planned ? new Date(r.planned).toLocaleString() : "",
    r.actual ? new Date(r.actual).toLocaleString() : "",
    r.status,
  ]);
  sendCsv(res, "master.csv", headers, body);
});

// Tops up Master with any upcoming occurrences that are due to exist for
// every active, schedule-driven task (has a startDate + defaultAssignee).
// Called automatically whenever the Master page loads, and available as a
// manual "Generate Upcoming" button too — safe to call repeatedly, it only
// ever adds rows that don't already exist.
//
// With many people using the app, that "on every page load" call used to
// mean every single person opening Master fired the full scan-every-task
// routine at once — redundant work piling up under load, since nothing
// changes between one person's load and the next person's a second later.
// The automatic call now shares one 60-second cooldown (via Redis — a
// no-op without REDIS_URL, so this degrades to the old always-run
// behavior if caching isn't configured): only the first load in that
// window does the work, everyone else's load just uses what's already
// there. The manual "Generate Upcoming" button passes ?force=1 to bypass
// the cooldown, since a deliberate click should always run.
router.post("/generate-upcoming", async (req, res) => {
  try {
    if (req.query.force !== "1") {
      const claimed = await claimCooldown("generate:upcoming:cooldown", 60);
      if (!claimed) return res.json({ created: 0, tasksChecked: 0, horizonMissing: false, skipped: true });
    }
    const result = await generateAllUpcoming();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One-time cleanup for duplicate rows created by a race condition that
// existed before generation calls were locked per-task (fixed above) —
// removes exact duplicates (same task+doer+planned, still incomplete),
// keeping one of each. Safe to run any time; does nothing once there's
// nothing left to clean up.
router.post("/dedupe", requireAdmin, async (req, res) => {
  try {
    const result = await dedupeTaskInstances();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET master log, paginated (?page=, ?limit=, max 500/page), with optional
// filters (?doer=, ?status=). Sorted newest-planned-first, same as before.
// Previously this hard-capped at 500 rows total with no way to reach the
// rest of the ~59k-row sheet — now every row is reachable, page by page,
// and the response tells the frontend the true total + page count so it can
// number rows correctly (S.No continues across pages, not reset per page).
router.get("/", async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
  const filter = { ...(await scopeToOwnDoer(req)) };
  // Members are already locked to their own doer above; admins may still
  // narrow further with ?doer= (e.g. picking a specific person to review).
  if (req.query.doer && req.user.role === "admin") filter.doer = req.query.doer;
  if (req.query.status) filter.status = req.query.status;
  // "Recently completed" quick view (admin banner click) — everything
  // finished in the last 24 hours, most recent first. Overrides the normal
  // planned-date sort below since "when it was done" is what matters here,
  // not "when it was due".
  const recentView = req.query.recent === "1";
  if (recentView) {
    filter.actual = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
  }
  // "Today's Tasks" quick filter — everything planned for the current
  // calendar day (server's local time), regardless of status.
  if (req.query.today === "1") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    filter.planned = { $gte: start, $lt: end };
  }
  // Free-text search across doer name/department/email and task
  // name/department — Doers and Tasks are both small catalogs, so
  // resolving matching ids from them first (fast) and then filtering
  // TaskInstance by those ids is much cheaper than a full collection scan
  // over ~78k rows with a regex on populated fields (which Mongo can't do
  // directly anyway, since doer/task are references, not embedded text).
  const search = String(req.query.search || "").trim();
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const [matchingDoers, matchingTasks] = await Promise.all([
      Doer.find({ $or: [{ name: rx }, { department: rx }, { email: rx }] }).select("_id").lean(),
      Task.find({ $or: [{ taskName: rx }, { department: rx }] }).select("_id").lean(),
    ]);
    const doerIds = matchingDoers.map((d) => d._id);
    const taskIds = matchingTasks.map((t) => t._id);
    filter.$or = [{ doer: { $in: doerIds } }, { task: { $in: taskIds } }];
  }

  const [rows, total] = await Promise.all([
    TaskInstance.find(filter)
      .select("-submission.image")
      .populate("doer")
      .populate("task")
      .sort(recentView ? { actual: -1 } : { planned: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(), // plain objects, not full Mongoose documents — faster to serialize for read-only list views
    TaskInstance.countDocuments(filter),
  ]);

  res.json({ rows, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) });
});

// CREATE a reminder occurrence — a one-off, ad hoc entry outside the normal
// recurring schedule. Admin-only: a member logs their own work by marking
// existing occurrences complete, not by inventing new ones.
router.post("/", requireAdmin, async (req, res) => {
  try {
    const entry = await TaskInstance.create(req.body);
    const populated = await entry.populate(["doer", "task"]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Tasks completed since this admin last dismissed the banner (capped to
// the last 24h so it can never grow unbounded for someone who hasn't
// looked in a while).
router.get("/review-count", requireAdmin, async (req, res) => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since = req.user.lastSeenCompletionsAt && req.user.lastSeenCompletionsAt > dayAgo ? req.user.lastSeenCompletionsAt : dayAgo;
  const count = await TaskInstance.countDocuments({ actual: { $gte: since } });
  res.json({ count });
});

// Dismisses the "recently completed" banner for this admin — clicking
// "Show them" calls this so the count doesn't just show the same tasks
// again on the next page load.
router.post("/recent-completions-seen", requireAdmin, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { lastSeenCompletionsAt: new Date() });
  res.json({ ok: true });
});

// Full proof (including the image, which the list endpoint leaves out).
router.get("/:id/proof", async (req, res) => {
  const entry = await TaskInstance.findById(req.params.id).select("submission").lean();
  if (!entry) return res.status(404).json({ error: "Not found" });
  res.json(entry.submission || { state: "none" });
});

// DOER: "Mark as done" — completes the task immediately, no admin approval
// step. Sets `actual` to right now (the moment they clicked it), which is
// what the pre-save hook below uses to compute On Time / Delayed, then
// emails every admin that it happened. Proof (note/link/screenshot) is
// still optional and kept for the record, but is no longer a gate — a
// bare "I'm done" completes the task on its own.
router.post("/:id/submit-done", requireOwnDoerOrAdmin, async (req, res) => {
  try {
    const entry = req._entry || (await TaskInstance.findById(req.params.id));
    if (!entry) return res.status(404).json({ error: "Not found" });
    if (entry.actual) return res.status(400).json({ error: "This task is already complete" });
    const note = String(req.body.note || "").trim();
    const link = String(req.body.link || "").trim();
    const image = String(req.body.image || "");
    if (link && !/^https?:\/\//i.test(link)) return res.status(400).json({ error: "Proof link must start with http:// or https://" });
    if (image && !/^data:image\/(png|jpe?g|webp);base64,/.test(image)) return res.status(400).json({ error: "Proof image must be a PNG, JPG or WebP" });
    if (image.length > 2_000_000) return res.status(400).json({ error: "Proof image is too large" });
    entry.actual = new Date();
    entry.submission = { state: "approved", at: entry.actual, by: req.user.name, note, link, image, rejectReason: "" };
    await entry.save();
    const populated = await entry.populate(["doer", "task"]);
    const out = populated.toObject();
    delete out.submission.image;
    res.json(out);
    // Runs after the response is already sent — a slow or misconfigured
    // mailer must never delay the doer's "mark as done" click.
    notifyAdminsTaskCompleted(populated).catch((err) => console.error("[master] admin notify failed:", err.message));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ADMIN: MARK COMPLETE / APPROVE. If the doer submitted proof, the
// completion time is when they said they finished (not when the admin got
// round to reviewing), so On Time / Delayed stays fair to the doer.
router.patch("/:id/complete", requireAdmin, async (req, res) => {
  try {
    const entry = await TaskInstance.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: "Not found" });
    entry.actual = req.body.actual
      ? new Date(req.body.actual)
      : entry.submission?.state === "submitted" && entry.submission.at
      ? entry.submission.at
      : new Date();
    // Record the approval permanently on the row itself — this never
    // deletes or replaces the task instance, it just flips a status flag
    // so the doer (and the admin, looking back later) can see it was
    // reviewed and approved, not merely that it happens to have an
    // `actual` timestamp.
    if (entry.submission?.state === "submitted") {
      entry.submission.state = "approved";
      entry.submission.rejectReason = "";
    }
    await entry.save();
    const populated = await entry.populate(["doer", "task"]);
    const out = populated.toObject();
    if (out.submission) delete out.submission.image;
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ADMIN: send a submission back to the doer with a reason.
router.patch("/:id/reject", requireAdmin, async (req, res) => {
  try {
    const entry = await TaskInstance.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: "Not found" });
    entry.submission.state = "rejected";
    entry.submission.rejectReason = String(req.body.reason || "").slice(0, 500);
    await entry.save();
    const populated = await entry.populate(["doer", "task"]);
    const out = populated.toObject();
    delete out.submission.image;
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE (edit planned/actual manually). Members can't touch completion
// fields here — that would bypass the proof + admin review flow.
router.put("/:id", requireOwnDoerOrAdmin, async (req, res) => {
  try {
    const entry = req._entry;
    const body = { ...req.body };
    if (req.user.role !== "admin") {
      delete body.actual; delete body.status; delete body.submission; delete body.doer; delete body.task;
    }
    Object.assign(entry, body);
    await entry.save();
    const populated = await entry.populate(["doer", "task"]);
    res.json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await TaskInstance.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;