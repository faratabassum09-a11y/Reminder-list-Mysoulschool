import express from "express";
import mongoose from "mongoose";
import Workshop from "../models/Workshop.js";
import WorkshopTask from "../models/WorkshopTask.js";
import WorkshopTemplate from "../models/WorkshopTemplate.js";
import WorkshopResponse from "../models/WorkshopResponse.js";
import WorkshopCounter, { reserveSeq } from "../models/WorkshopCounter.js";
import Doer from "../models/Doer.js";
import { requireAdmin } from "../middleware/auth.js";
import { TRACKING_START, withTrackingFloor } from "../utils/trackingStart.js";
import {
  WORKSHOP_TYPES,
  TZ_NAME,
  listTemplates,
  cleanTypeCode,
  ensureTemplates,
  parseYmd,
  dayNameOf,
  normalizeTime,
  outcomeFor,
  statusOf,
  plannedInstant,
  generateTasksForWorkshop,
  reschedulePendingTasks,
  recordLaunchSync,
  fetchRemoteLaunches,
} from "../utils/workshopService.js";

const router = express.Router();
const isId = (id) => mongoose.isValidObjectId(id);
const withStatus = (t) => ({ ...t, status: statusOf(t) });

// ----------------------------------------------------------- roles ----
//   admin (e.g. Nitin)                 -> approves / rejects, manages everything
//   canRequestWorkshops (e.g. Tanvi)   -> fills the New Workshop form, sees her own requests
//   everyone else (members)            -> sees approved workshops, completes their own tasks
const isAdminUser = (u) => u?.role === "admin";
const canRequest = (u) => isAdminUser(u) || u?.canRequestWorkshops === true;

function requireRequester(req, res, next) {
  if (!canRequest(req.user)) {
    return res.status(403).json({ error: "Only the workshop coordinator or an admin can add a new workshop" });
  }
  next();
}

// Which workshops this person may see: admins everything; a requester
// approved ones + their own requests (any status); members approved only.
function workshopVisibility(user) {
  if (isAdminUser(user)) return {};
  if (user?.canRequestWorkshops) return { $or: [{ status: "approved" }, { requestedBy: user._id }] };
  return { status: "approved" };
}

// One place that marks a task done and writes the form response — used by
// both the Tasks page button and the Responses form.
async function completeTask(task, user, actual, note) {
  task.actual = actual;
  task.outcome = outcomeFor(actual, task.planned);
  task.ownerScore = task.outcome === "On Time" ? task.score : 0;
  task.workshopScore = task.score;
  task.completedByName = user.name;
  if (typeof note === "string") task.note = note.trim().slice(0, 500);
  await task.save();
  await WorkshopResponse.create({
    task: task._id,
    taskId: task.taskId,
    workshopId: task.workshopId,
    workshopType: task.workshopType,
    taskName: task.task,
    owner: task.owner,
    ownerEmail: task.ownerEmail,
    planned: task.planned,
    actual,
    outcome: task.outcome,
    score: task.score,
    ownerScore: task.ownerScore,
    submittedByName: user.name,
    submittedByEmail: user.email,
    note: task.note,
  });
  return task;
}

// ---------------------------------------------------------------- meta ----
router.get("/meta", async (req, res) => {
  const templates = await listTemplates();
  const types = templates.map((t) => ({ code: t.code, name: t.name, defaultDays: t.defaultDays, defaultTime: t.defaultTime, taskCount: t.tasks.length, custom: !WORKSHOP_TYPES.some((b) => b.code === t.code) }));
  res.json({ types, tz: TZ_NAME, webhookConfigured: Boolean(process.env.LAUNCH_WEBHOOK_URL), launchMode: process.env.LAUNCH_WEBHOOK_URL ? "external" : "internal" });
});

// --------------------------------------------------------------- stats ----
router.get("/stats", async (req, res) => {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const mine = { ownerEmail: req.user.email };
  // Workshop PMS is tracked from the tracking start date (5 Oct 2026) only:
  // tasks planned before it are never counted, scored or flagged overdue.
  const live = { $gte: TRACKING_START };
  const [pendingApproval, upcoming, open, overdue, done, onTime, myOpen, myOverdue, dueThisWeek] = await Promise.all([
    isAdminUser(req.user) ? Workshop.countDocuments({ status: "pending" }) : Promise.resolve(0),
    Workshop.countDocuments({ status: "approved", startDate: { $gte: new Date(now.toISOString().slice(0, 10)) } }),
    WorkshopTask.countDocuments({ actual: null, planned: live }),
    WorkshopTask.countDocuments({ actual: null, planned: { ...live, $lt: now } }),
    WorkshopTask.countDocuments({ actual: { $ne: null }, planned: live }),
    WorkshopTask.countDocuments({ outcome: "On Time", planned: live }),
    WorkshopTask.countDocuments({ ...mine, actual: null, planned: live }),
    WorkshopTask.countDocuments({ ...mine, actual: null, planned: { ...live, $lt: now } }),
    WorkshopTask.countDocuments({ actual: null, planned: withTrackingFloor({ $gte: now, $lte: soon }) }),
  ]);
  res.json({
    pendingApproval,
    upcoming,
    openTasks: open,
    overdueTasks: overdue,
    doneTasks: done,
    onTimePct: done ? Math.round((onTime / done) * 100) : null,
    myOpen,
    myOverdue,
    dueThisWeek,
  });
});

// ------------------------------------------------------------ dashboard ----
// Team-wide performance for every workshop user (not just admins), same
// rules as the Reminder List dashboard: only tasks that have come due are
// scored, and On-Time % = on time / due. Range filters on the planned date.
function wsRange(key) {
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = (d) => add(d, d.getDay() === 0 ? -6 : 1 - d.getDay());
  const now = new Date();
  switch (key) {
    case "today": return { start: day0, end: add(day0, 1) };
    case "yesterday": return { start: add(day0, -1), end: day0 };
    case "thisWeek": { const m = monday(day0); return { start: m, end: add(m, 7) }; }
    case "lastWeek": { const m = monday(day0); return { start: add(m, -7), end: m }; }
    case "nextWeek": { const m = add(monday(day0), 7); return { start: m, end: add(m, 7) }; }
    case "lastMonth": return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
    case "year": return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear() + 1, 0, 1) };
    default: return null;
  }
}

router.get("/dashboard", async (req, res) => {
  try {
    const now = new Date();
    const range = wsRange(String(req.query.range || ""));
    const cutoff = new Date(new Date(now).setHours(24, 0, 0, 0)); // end of today
    const end = range ? new Date(Math.min(range.end.getTime(), cutoff.getTime())) : cutoff;
    const planned = { $lt: end };
    if (range) planned.$gte = range.start;
    planned.$gte = withTrackingFloor(planned).$gte; // nothing before 5 Oct 2026

    const facet = (key) => [
      { $group: { _id: key, total: { $sum: 1 },
          onTime: { $sum: { $cond: [{ $eq: ["$outcome", "On Time"] }, 1, 0] } },
          delayed: { $sum: { $cond: [{ $eq: ["$outcome", "Delayed"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$actual", null] }, 1, 0] } },
          name: { $first: "$owner" }, department: { $first: "$department" } } },
    ];
    const [agg] = await WorkshopTask.aggregate([
      { $match: { planned } },
      { $facet: { all: facet(null), byType: facet("$workshopType"), byPerson: facet({ $ifNull: ["$ownerEmail", ""] }) } },
    ]);
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    const shape = (r) => ({ ...r, onTimePercent: pct(r.onTime, r.total), completedPercent: pct(r.onTime + r.delayed, r.total) });
    const all = shape(agg.all[0] || { total: 0, onTime: 0, delayed: 0, pending: 0 });
    const byType = agg.byType.map(shape).map((r) => ({ type: r._id, ...r })).sort((a, b) => a.type.localeCompare(b.type));
    const byPerson = agg.byPerson
      .filter((r) => r._id)
      .map(shape)
      .map((r) => ({ email: r._id, name: r.name || r._id, department: r.department || "—", ...r }))
      .sort((a, b) => b.onTimePercent - a.onTimePercent || b.total - a.total);
    let rank = 0, last = null, seen = 0;
    for (const p of byPerson) { seen++; if (p.onTimePercent !== last) { rank = seen; last = p.onTimePercent; } p.rank = p.total ? rank : null; }

    const overdue = await WorkshopTask.countDocuments({ actual: null, planned: { $lt: now, $gte: withTrackingFloor(range ? { $gte: range.start } : {}).$gte } });
    const [workshopsApproved, workshopsUpcoming, workshopsPending] = await Promise.all([
      Workshop.countDocuments({ status: "approved" }),
      Workshop.countDocuments({ status: "approved", startDate: { $gte: new Date(now.toISOString().slice(0, 10)) } }),
      Workshop.countDocuments({ status: "pending" }),
    ]);
    res.json({
      summary: { ...all, _id: undefined, name: undefined, department: undefined, overdue },
      byType, byPerson,
      workshops: { approved: workshopsApproved, upcoming: workshopsUpcoming, pending: workshopsPending },
      me: req.user.email,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------ templates ----
router.get("/templates", async (req, res) => {
  res.json(await listTemplates(true));
});

// Admin: create a brand-new workshop type (its own task list, empty until filled).
router.post("/templates", requireAdmin, async (req, res) => {
  try {
    const code = cleanTypeCode(req.body?.code);
    if (!code) return res.status(400).json({ error: "Type code must be 2–8 letters/numbers, starting with a letter (e.g. XYZ)" });
    const name = String(req.body?.name || "").trim() || `${code} Workshop`;
    if (await WorkshopTemplate.exists({ code })) return res.status(409).json({ error: `${code} already exists` });
    const time = normalizeTime(req.body?.defaultTime) || "10:00";
    const days = Number.isInteger(Number(req.body?.defaultDays)) && Number(req.body.defaultDays) >= 1 ? Math.min(30, Number(req.body.defaultDays)) : 1;
    const tpl = await WorkshopTemplate.create({ code, name: name.slice(0, 120), defaultDays: days, defaultTime: time, tasks: [] });
    res.status(201).json(tpl);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/templates/:code", requireAdmin, async (req, res) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const tpl = await WorkshopTemplate.findOne({ code });
    if (!tpl) return res.status(404).json({ error: "Unknown workshop type" });

    const { defaultDays, defaultTime, tasks } = req.body || {};
    if (defaultDays !== undefined) {
      const n = Number(defaultDays);
      if (!Number.isInteger(n) || n < 1 || n > 30) return res.status(400).json({ error: "Days must be 1–30" });
      tpl.defaultDays = n;
    }
    if (defaultTime !== undefined) {
      const t = normalizeTime(defaultTime);
      if (!t) return res.status(400).json({ error: "Default time must look like 19:00" });
      tpl.defaultTime = t;
    }
    if (Array.isArray(tasks)) {
      const clean = [];
      const prefix = `${code}-TS-`;
      const numOf = (id) => { const m = new RegExp(`^${prefix}(\\d+)$`, "i").exec(String(id || "").trim()); return m ? Number(m[1]) : 0; };
      let maxNum = Math.max(1, ...tasks.map((t) => numOf(t.taskId)));
      const seen = new Set();
      for (const [i, t] of tasks.entries()) {
        const task = String(t.task || "").trim();
        if (!task) continue;
        const time = t.time ? normalizeTime(t.time) : "";
        if (t.time && !time) return res.status(400).json({ error: `Row ${i + 1}: "${t.time}" isn't a valid time` });
        let taskId = String(t.taskId || "").trim().toUpperCase();
        if (!taskId) taskId = `${prefix}${++maxNum}`;
        if (seen.has(taskId)) return res.status(400).json({ error: `Task ID ${taskId} is used twice — each task needs its own ID` });
        seen.add(taskId);
        clean.push({
          taskId,
          task,
          description: String(t.description || "").trim().slice(0, 2000),
          timeline: String(t.timeline || "T").trim() || "T",
          time,
          doer: t.doer && isId(t.doer) ? t.doer : undefined,
          ownerName: String(t.ownerName || "").trim(),
          score: Number(t.score) || 0,
        });
      }
      tpl.tasks = clean;
    }
    await tpl.save();
    // Approved workshops of this type that ended up with no tasks (list was
    // empty at approval) get their tasks now — no manual step.
    let generatedFor = 0;
    if (Array.isArray(tasks) && tpl.tasks.length) {
      const empty = await Workshop.find({ type: code, status: "approved", tasksGenerated: 0 });
      for (const w of empty) {
        if (await WorkshopTask.exists({ workshop: w._id })) continue;
        w.tasksGenerated = await generateTasksForWorkshop(w);
        await w.save();
        generatedFor += 1;
      }
    }
    res.json({ ...tpl.toObject(), generatedFor });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------------- counters ----
// Lets an admin continue the numbering from the old sheet (e.g. the next
// UTW workshop should be UTW-17, tasks continue from WTS-1204).
router.get("/counters", requireAdmin, async (req, res) => {
  const docs = await WorkshopCounter.find().lean();
  const map = Object.fromEntries(docs.map((d) => [d._id, d.seq]));
  const out = { tasks: map.wts || 0 };
  (await listTemplates()).forEach((t) => (out[t.code] = map[`ws:${t.code}`] || 0));
  res.json(out);
});

router.put("/counters", requireAdmin, async (req, res) => {
  try {
    const ops = [];
    for (const [key, value] of Object.entries(req.body || {})) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return res.status(400).json({ error: `${key}: must be a whole number ≥ 0` });
      const id = key === "tasks" ? "wts" : (await WorkshopTemplate.exists({ code: key })) ? `ws:${key}` : null;
      if (id) ops.push(WorkshopCounter.findOneAndUpdate({ _id: id }, { $set: { seq: n } }, { upsert: true }));
    }
    await Promise.all(ops);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------- tasks ----
router.get("/tasks", async (req, res) => {
  const { workshop, owner, status, from, to, mine, q, type } = req.query;
  const now = new Date();
  const filter = {};
  if (workshop) filter.workshopId = String(workshop);
  if (type) filter.workshopType = String(type).toUpperCase();
  if (owner) filter.ownerEmail = String(owner).toLowerCase();
  if (mine === "1") filter.ownerEmail = req.user.email;
  // A plain member only does the tasks assigned to them — never anyone else's.
  if (!canRequest(req.user)) filter.ownerEmail = req.user.email;
  if (from || to) {
    filter.planned = {};
    if (from) filter.planned.$gte = new Date(from);
    if (to) filter.planned.$lte = new Date(to);
  }
  switch (status) {
    case "open": filter.actual = null; break;
    case "Pending": filter.actual = null; filter.planned = { ...(filter.planned || {}), $gte: now }; break;
    case "Overdue": filter.actual = null; filter.planned = { ...(filter.planned || {}), $lt: now }; break;
    case "On Time": filter.outcome = "On Time"; break;
    case "Delayed": filter.outcome = "Delayed"; break;
    default: break;
  }
  // Nothing planned before the tracking start date (5 Oct 2026) is listed.
  filter.planned = withTrackingFloor(filter.planned);
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ task: rx }, { taskId: rx }, { workshopId: rx }, { owner: rx }];
  }
  // Paged: ?page=1&limit=100 -> { rows, total, page, pages, limit }.
  // Without ?page the old behaviour (a plain array, capped) is kept for the
  // small widgets on the Overview / Responses pages.
  if (req.query.page !== undefined) {
    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 100));
    const total = await WorkshopTask.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
    const rows = await WorkshopTask.find(filter).sort({ planned: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean();
    return res.json({ rows: rows.map(withStatus), total, page, pages, limit });
  }
  const rows = await WorkshopTask.find(filter).sort({ planned: 1 }).limit(500).lean();
  res.json(rows.map(withStatus));
});

router.post("/tasks/:id/complete", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Task not found" });
  const task = await WorkshopTask.findById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (req.user.role !== "admin" && task.ownerEmail !== req.user.email) {
    return res.status(403).json({ error: "You can only complete your own tasks" });
  }
  if (task.actual) return res.status(400).json({ error: "This task is already done" });

  const actual = req.body?.actual ? new Date(req.body.actual) : new Date();
  if (Number.isNaN(actual.getTime())) return res.status(400).json({ error: "Invalid completion time" });

  await completeTask(task, req.user, actual, req.body?.note);
  res.json(withStatus(task.toObject()));
});

router.post("/tasks/:id/reopen", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Task not found" });
  const task = await WorkshopTask.findByIdAndUpdate(
    req.params.id,
    { $set: { actual: null, outcome: null, ownerScore: null, workshopScore: null, completedByName: "" } },
    { new: true }
  ).lean();
  if (!task) return res.status(404).json({ error: "Task not found" });
  await WorkshopResponse.deleteMany({ task: task._id }); // undo the form response too
  res.json(withStatus(task));
});

// Admin edits: move the due time, reassign, change the score.
router.put("/tasks/:id", requireAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Task not found" });
    const task = await WorkshopTask.findById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    const { planned, doer, score, task: name } = req.body || {};
    if (planned) {
      const d = new Date(planned);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid due date" });
      task.planned = d;
      if (task.actual) {
        task.outcome = outcomeFor(task.actual, d);
        task.ownerScore = task.outcome === "On Time" ? task.score : 0;
      }
    }
    if (score !== undefined) {
      task.score = Number(score) || 0;
      if (task.actual) { task.ownerScore = task.outcome === "On Time" ? task.score : 0; task.workshopScore = task.score; }
    }
    if (typeof name === "string" && name.trim()) task.task = name.trim();
    if (doer && isId(doer)) {
      const d = await Doer.findById(doer).lean();
      if (!d) return res.status(400).json({ error: "Doer not found" });
      task.doer = d._id;
      task.owner = d.name;
      task.ownerEmail = d.email;
      task.department = d.department;
    }
    await task.save();
    res.json(withStatus(task.toObject()));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------------ responses ----
// The task-done form. Body: { taskId: "UTW-3-WTS-45", actual?: ISO, note? }.
// Same rule as the old sheet: you can only submit for your own task
// (admins can submit for anyone).
router.post("/responses", async (req, res) => {
  try {
    const key = String(req.body?.taskId || "").trim();
    if (!key) return res.status(400).json({ error: "Enter the Workshop Task ID" });
    const task = await WorkshopTask.findOne({ taskId: key });
    if (!task) return res.status(404).json({ error: `No task with ID ${key}` });
    if (!isAdminUser(req.user) && task.ownerEmail !== req.user.email) {
      return res.status(403).json({ error: "You can only submit for your own tasks" });
    }
    if (task.actual) return res.status(400).json({ error: "This task is already done" });
    const actual = req.body?.actual ? new Date(req.body.actual) : new Date();
    if (Number.isNaN(actual.getTime())) return res.status(400).json({ error: "Invalid completion time" });
    await completeTask(task, req.user, actual, req.body?.note);
    res.status(201).json(withStatus(task.toObject()));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admins see every response; everyone else sees their own.
router.get("/responses", async (req, res) => {
  const filter = {};
  if (!isAdminUser(req.user)) filter.$or = [{ ownerEmail: req.user.email }, { submittedByEmail: req.user.email }];
  if (req.query.workshop) filter.workshopId = String(req.query.workshop);
  const rows = await WorkshopResponse.find(filter).sort({ createdAt: -1 }).limit(3000).lean();
  res.json(rows);
});

// ------------------------------------------------------------- launches ----
router.get("/launches/remote", requireAdmin, async (req, res) => {
  try {
    res.json(await fetchRemoteLaunches());
  } catch (err) {
    res.status(502).json({ error: `Couldn't read the Launch Verification feed: ${err.message}` });
  }
});

// ------------------------------------------------------------ workshops ----
// Task progress per workshop, computed in one aggregation.
async function progressByWorkshop() {
  const now = new Date();
  const rows = await WorkshopTask.aggregate([
    {
      $group: {
        _id: "$workshop",
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $ne: ["$actual", null] }, 1, 0] } },
        overdue: { $sum: { $cond: [{ $and: [{ $eq: ["$actual", null] }, { $lt: ["$planned", now] }, { $gte: ["$planned", TRACKING_START] }] }, 1, 0] } },
        score: { $sum: { $ifNull: ["$ownerScore", 0] } },
        maxScore: { $sum: { $cond: [{ $ne: ["$actual", null] }, "$score", 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

router.get("/", async (req, res) => {
  const filter = { ...workshopVisibility(req.user) };
  if (req.query.status) filter.status = String(req.query.status);
  const [list, progress] = await Promise.all([Workshop.find(filter).sort({ startDate: -1, createdAt: -1 }).limit(1000).lean(), progressByWorkshop()]);
  res.json(
    list.map((w) => {
      const p = progress.get(String(w._id));
      return { ...w, progress: p ? { total: p.total, done: p.done, overdue: p.overdue } : { total: 0, done: 0, overdue: 0 } };
    })
  );
});

// Preview of the ID the next submission of this type will get (shown, read-only, on the form).
router.get("/next-id", async (req, res) => {
  const code = cleanTypeCode(req.query.type);
  if (!code) return res.status(400).json({ error: "Unknown workshop type" });
  const c = await WorkshopCounter.findById(`ws:${code}`).lean();
  res.json({ workshopId: `${code}-${(c?.seq || 0) + 1}` });
});

router.post("/", requireRequester, async (req, res) => {
  try {
    await ensureTemplates();
    const code = cleanTypeCode(req.body?.type);
    if (!code) return res.status(400).json({ error: "Choose a workshop type" });
    let tpl = await WorkshopTemplate.findOne({ code }).lean();
    // Brand-new workshop type typed on the form: create its (empty) task list.
    if (!tpl && req.body?.newType) {
      const typeName = String(req.body?.typeName || "").trim().slice(0, 120) || `${code} Workshop`;
      const days = Math.min(30, Math.max(1, Number.parseInt(req.body?.days, 10) || 1));
      const time = normalizeTime(req.body?.startTime) || "10:00";
      tpl = (await WorkshopTemplate.create({ code, name: typeName, defaultDays: days, defaultTime: time, tasks: [] })).toObject();
    }
    if (!tpl) return res.status(400).json({ error: "Choose a workshop type" });

    const goal = String(req.body?.goal || "").trim();
    if (!goal) return res.status(400).json({ error: "Enter the workshop goal" });
    if (goal.length > 500) return res.status(400).json({ error: "Workshop goal is too long (500 characters max)" });
    const name = String(req.body?.name || "").trim() || tpl.name;
    if (name.length > 120) return res.status(400).json({ error: "Workshop name is too long (120 characters max)" });

    const startDate = parseYmd(req.body?.startDate);
    if (!startDate) return res.status(400).json({ error: "Enter a valid start date" });
    const startTime = normalizeTime(req.body?.startTime);
    if (!startTime) return res.status(400).json({ error: "Enter a valid start time" });
    const days = Number(req.body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 30) return res.status(400).json({ error: "Workshop days must be 1–30" });

    const dupe = await Workshop.findOne({ type: code, startDate, status: { $ne: "rejected" } }).lean();
    if (dupe) return res.status(409).json({ error: `${dupe.workshopId} is already scheduled for that date (${dupe.status})` });

    const seq = await reserveSeq(`ws:${code}`, 1);
    const workshop = await Workshop.create({
      workshopId: `${code}-${seq}`,
      type: code,
      typeName: tpl.name,
      name,
      goal,
      days,
      startDate,
      startTime,
      startDay: dayNameOf(startDate),
      requestedBy: req.user._id,
      requestedByName: req.user.name,
      requestedByEmail: req.user.email,
      submittedAt: new Date(),
      status: "pending", // every submission waits for an admin — no bypass
    });
    res.status(201).json(workshop);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  const key = req.params.id;
  const workshop = isId(key) ? await Workshop.findById(key).lean() : await Workshop.findOne({ workshopId: key }).lean();
  if (!workshop) return res.status(404).json({ error: "Workshop not found" });
  const vis = workshopVisibility(req.user);
  if (vis.status && workshop.status !== vis.status) return res.status(404).json({ error: "Workshop not found" });
  if (vis.$or && workshop.status !== "approved" && String(workshop.requestedBy) !== String(req.user._id)) {
    return res.status(404).json({ error: "Workshop not found" });
  }
  const tasks = await WorkshopTask.find({ workshop: workshop._id }).sort({ planned: 1 }).lean();
  res.json({ ...workshop, tasks: tasks.map(withStatus) });
});

// Edit the details. Admin any time; the requester only while it's pending.
// Moving an approved workshop re-times its open tasks and re-sends the launch.
router.put("/:id", async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ error: "Workshop not found" });
    const w = await Workshop.findById(req.params.id);
    if (!w) return res.status(404).json({ error: "Workshop not found" });
    const isAdmin = req.user.role === "admin";
    const isOwnPending = w.status === "pending" && String(w.requestedBy) === String(req.user._id);
    if (!isAdmin && !isOwnPending) return res.status(403).json({ error: "Only an admin can change this workshop" });

    let dateChanged = false;
    let launchChanged = false;
    if (req.body.goal !== undefined) w.goal = String(req.body.goal).trim().slice(0, 500);
    if (req.body.name !== undefined) {
      const nm = String(req.body.name).trim().slice(0, 120) || w.typeName;
      if (nm !== w.name) launchChanged = true;
      w.name = nm;
    }
    if (req.body.startDate !== undefined) {
      const d = parseYmd(req.body.startDate);
      if (!d) return res.status(400).json({ error: "Enter a valid start date" });
      if (d.getTime() !== w.startDate.getTime()) {
        dateChanged = true;
        launchChanged = true;
        w.startDate = d;
        w.startDay = dayNameOf(d);
      }
    }
    if (req.body.startTime !== undefined) {
      const t = normalizeTime(req.body.startTime);
      if (!t) return res.status(400).json({ error: "Enter a valid start time" });
      if (t !== w.startTime) launchChanged = true;
      w.startTime = t;
    }
    if (req.body.days !== undefined) {
      const n = Number(req.body.days);
      if (!Number.isInteger(n) || n < 1 || n > 30) return res.status(400).json({ error: "Workshop days must be 1–30" });
      if (n !== w.days) launchChanged = true;
      w.days = n;
    }
    await w.save();

    let retimed = 0;
    if (dateChanged && w.status === "approved") retimed = await reschedulePendingTasks(w);
    if (launchChanged && w.status === "approved") await recordLaunchSync(w);
    res.json({ ...w.toObject(), retimedTasks: retimed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/approve", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Workshop not found" });
  // Atomic pending -> approved flip, so a double click can't generate the
  // task list twice.
  const w = await Workshop.findOneAndUpdate(
    { _id: req.params.id, status: "pending" },
    { $set: { status: "approved", reviewedByName: req.user.name, reviewedAt: new Date(), reviewNote: String(req.body?.note || "").slice(0, 500) } },
    { new: true }
  );
  if (!w) {
    const exists = await Workshop.exists({ _id: req.params.id });
    return res.status(exists ? 409 : 404).json({ error: exists ? "This request was already reviewed" : "Workshop not found" });
  }
  try {
    w.tasksGenerated = await generateTasksForWorkshop(w);
    await w.save();
  } catch (err) {
    await WorkshopTask.deleteMany({ workshop: w._id });
    await Workshop.updateOne({ _id: w._id }, { $set: { status: "pending", tasksGenerated: 0 } });
    return res.status(500).json({ error: `Couldn't generate the task list: ${err.message}` });
  }
  await recordLaunchSync(w);
  res.json(w.toObject());
});

// Re-run task generation for an approved workshop whose list was empty at
// approval time (safe: refuses if it already has tasks).
router.post("/:id/generate-tasks", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Workshop not found" });
  const w = await Workshop.findById(req.params.id);
  if (!w || w.status !== "approved") return res.status(400).json({ error: "Only approved workshops have tasks" });
  if (await WorkshopTask.exists({ workshop: w._id })) return res.status(409).json({ error: "This workshop already has its tasks" });
  w.tasksGenerated = await generateTasksForWorkshop(w);
  await w.save();
  if (!w.tasksGenerated) return res.status(400).json({ error: `The ${w.type} task list is empty — add its tasks on the Task Lists page first` });
  res.json(w.toObject());
});

router.post("/:id/reject", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Workshop not found" });
  const w = await Workshop.findOneAndUpdate(
    { _id: req.params.id, status: "pending" },
    { $set: { status: "rejected", reviewedByName: req.user.name, reviewedAt: new Date(), reviewNote: String(req.body?.note || "").slice(0, 500) } },
    { new: true }
  ).lean();
  if (!w) return res.status(409).json({ error: "This request was already reviewed" });
  res.json(w);
});

// Built-in Launch Verification: admin ticks / un-ticks a launch as checked.
router.post("/:id/verify-launch", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Workshop not found" });
  const on = req.body?.verified !== false;
  const w = await Workshop.findOneAndUpdate(
    { _id: req.params.id, status: "approved" },
    { $set: { launchVerified: on ? { at: new Date(), byName: req.user.name } : { at: null, byName: "" } } },
    { new: true }
  ).lean();
  if (!w) return res.status(404).json({ error: "Approved workshop not found" });
  res.json(w);
});

router.post("/:id/resend-launch", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Workshop not found" });
  const w = await Workshop.findById(req.params.id);
  if (!w || w.status !== "approved") return res.status(400).json({ error: "Only approved workshops are sent to Launch Verification" });
  await recordLaunchSync(w);
  res.json(w.toObject());
});

router.delete("/:id", requireAdmin, async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Workshop not found" });
  const w = await Workshop.findByIdAndDelete(req.params.id);
  if (!w) return res.status(404).json({ error: "Workshop not found" });
  const { deletedCount } = await WorkshopTask.deleteMany({ workshop: w._id });
  res.json({ ok: true, deletedTasks: deletedCount });
});

export default router;
