import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Doer from "../models/Doer.js";
import Task from "../models/Task.js";
import Holiday from "../models/Holiday.js";
import TaskInstance from "../models/TaskInstance.js";
import { getSettings } from "../models/Settings.js";
import { generateOccurrencesForTask } from "./generateOccurrences.js";
import { FREQUENCIES } from "./parseTaskListText.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLED_TASK_LIST = path.join(__dirname, "..", "data", "task-list-2026-10.json");

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const dateKey = (d) => new Date(d).toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDaysUTC = (date, n) => utc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + n);
const daysInMonthUTC = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// Nth (1-4) or last (-1) `weekday` of a month, UTC.
function nthWeekdayUTC(year, month, weekday, n) {
  if (n === -1) {
    const last = utc(year, month, daysInMonthUTC(year, month));
    return addDaysUTC(last, -((last.getUTCDay() - weekday + 7) % 7));
  }
  const first = utc(year, month, 1);
  const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7;
  return day > daysInMonthUTC(year, month) ? nthWeekdayUTC(year, month, weekday, -1) : utc(year, month, day);
}
const NTH = { E1st: 1, E2nd: 2, E3rd: 3, E4th: 4, ELast: -1 };

// "Keep each task's own weekday / day-of-month": the first date on or after
// `start` that fits the row's original due date (its weekday, day of month...).
function alignedStart(row, start) {
  if (!row.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate)) return start;
  const [y, m, d] = row.dueDate.split("-").map(Number);
  const src = utc(y, m - 1, d);
  const f = row.frequency;
  if (f === "D") return start;
  if (f === "W" || f === "F") return addDaysUTC(start, (src.getUTCDay() - start.getUTCDay() + 7) % 7);
  if (f in NTH) {
    for (let k = 0; k < 4; k++) {
      const c = nthWeekdayUTC(start.getUTCFullYear(), start.getUTCMonth() + k, src.getUTCDay(), NTH[f]);
      if (c >= start) return c;
    }
    return start;
  }
  if (f === "M" || f === "Q") {
    for (let k = 0; k < 3; k++) {
      const yy = start.getUTCFullYear();
      const mm = start.getUTCMonth() + k;
      const c = utc(yy, mm, Math.min(d, daysInMonthUTC(yy, mm)));
      if (c >= start) return c;
    }
    return start;
  }
  if (f === "Y") {
    for (let k = 0; k < 2; k++) {
      const yy = start.getUTCFullYear() + k;
      const c = utc(yy, m - 1, Math.min(d, daysInMonthUTC(yy, m - 1)));
      if (c >= start) return c;
    }
  }
  return start;
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("No task rows to import");
  if (rows.length > 3000) throw new Error("Too many rows (max 3000)");
  return rows.map((r, i) => {
    const taskName = String(r?.taskName || "").trim().slice(0, 500);
    const doerName = String(r?.doerName || "").trim();
    const department = String(r?.department || "").trim().slice(0, 100);
    const frequency = String(r?.frequency || "").trim();
    const startTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(r?.startTime || "") ? r.startTime : "";
    if (!taskName || !doerName || !department) throw new Error(`Row ${i + 1}: task, person and department are required`);
    if (!FREQUENCIES.includes(frequency)) throw new Error(`Row ${i + 1}: unknown frequency "${frequency}"`);
    return { taskName, doerName, department, frequency, startTime, dueDate: r?.dueDate || "" };
  });
}

// Adds task rows (every row becomes its own task, repeats included) to the Task
// List with the given start date, then lets the normal recurrence engine create
// their Master rows up to the Schedule Horizon in Settings.
//
//  - A task that already exists (same name + person + frequency) is REUSED:
//    new start date and time, schedule restarted; its not-yet-done Master rows
//    from the start date on are removed and re-created so nothing is doubled.
//    Completed rows and older overdue rows are never touched.
//  - Anything else is created as a new task.
//  - reset: first delete tasks from this list added in the last 14 days that
//    have no completed history (leftovers of an earlier import) so the import
//    starts clean.
//  - keepWeekdays: repeated rows keep their own weekday / day of month instead
//    of all starting on the same day.
export async function importTaskList({ rows, startDate = "2026-10-02", dryRun = false, reset = false, keepWeekdays = false, resetDays = 14, onProgress } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("startDate must look like 2026-10-02");
  const start = new Date(`${startDate}T00:00:00.000Z`); // same as a date picked in the app
  if (isNaN(start)) throw new Error("Invalid start date");
  rows = validateRows(rows || JSON.parse(fs.readFileSync(BUNDLED_TASK_LIST, "utf-8")));

  const doers = await Doer.find().lean();
  const doerByName = new Map(doers.map((d) => [norm(d.name), d]));
  const doerNameById = new Map(doers.map((d) => [String(d._id), norm(d.name)]));
  let existing = await Task.find().lean();

  // ---- Optional clean slate ------------------------------------------------
  const resetInfo = { tasksDeleted: 0, rowsRemoved: 0 };
  if (reset) {
    const since = new Date(Date.now() - resetDays * 86400000);
    const listKeys = new Set(rows.map((r) => `${norm(r.taskName)}|${norm(r.doerName)}|${r.frequency}`));
    const inList = existing.filter((t) => listKeys.has(`${norm(t.taskName)}|${doerNameById.get(String(t.defaultAssignee)) || ""}|${t.frequency}`));
    const inListIds = inList.map((t) => t._id);
    const doneIds = new Set((await TaskInstance.distinct("task", { task: { $in: inListIds }, actual: { $ne: null } })).map(String));
    const deletable = inList.filter((t) => new Date(t.createdAt) >= since && !doneIds.has(String(t._id)));
    const deletableIds = deletable.map((t) => t._id);
    const keepIds = inList.filter((t) => !deletable.includes(t)).map((t) => t._id);
    resetInfo.tasksDeleted = deletable.length;
    resetInfo.rowsRemoved =
      (await TaskInstance.countDocuments({ task: { $in: deletableIds } })) +
      (await TaskInstance.countDocuments({ task: { $in: keepIds }, actual: null, planned: { $gte: start } }));
    if (!dryRun) {
      await TaskInstance.deleteMany({ task: { $in: deletableIds } });
      await Task.deleteMany({ _id: { $in: deletableIds } });
      await TaskInstance.deleteMany({ task: { $in: keepIds }, actual: null, planned: { $gte: start } });
    }
    const gone = new Set(deletableIds.map(String));
    existing = existing.filter((t) => !gone.has(String(t._id)));
  }

  const byKey = new Map(); // "name|doerId|freq" -> [tasks]
  for (const t of existing) {
    if (!t.defaultAssignee) continue;
    const k = `${norm(t.taskName)}|${t.defaultAssignee}|${t.frequency}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const claimed = new Set();
  let nextId = existing.reduce((m, t) => Math.max(m, t.taskId || 0), 0) + 1;

  const settings = await getSettings();
  const summary = {
    total: rows.length,
    horizon: settings.scheduleHorizon ? dateKey(settings.scheduleHorizon) : null,
    created: 0, updated: 0, missingDoers: [], removedPending: 0, generated: 0,
    horizonMissing: !settings.scheduleHorizon, dryRun, reset, keepWeekdays,
    resetTasksDeleted: resetInfo.tasksDeleted, resetRowsRemoved: resetInfo.rowsRemoved,
    repeatedRows: 0,
  };
  const plan = [];
  const seenKeys = new Set();

  for (const r of rows) {
    const doer = doerByName.get(norm(r.doerName));
    if (!doer) {
      if (!summary.missingDoers.includes(r.doerName)) summary.missingDoers.push(r.doerName);
      continue;
    }
    const rk = `${norm(r.taskName)}|${doer._id}|${r.frequency}|${r.startTime}`;
    if (seenKeys.has(rk)) summary.repeatedRows++;
    seenKeys.add(rk);
    const cands = (byKey.get(`${norm(r.taskName)}|${doer._id}|${r.frequency}`) || []).filter((t) => !claimed.has(String(t._id)));
    const match = cands.find((t) => t.startTime === r.startTime) || cands[0];
    const rowStart = keepWeekdays ? alignedStart(r, start) : start;
    if (match) {
      claimed.add(String(match._id));
      plan.push({ kind: "update", id: match._id, row: r, doer, rowStart });
      summary.updated++;
    } else {
      plan.push({ kind: "create", row: r, doer, rowStart });
      summary.created++;
    }
  }
  if (dryRun) return summary;

  const holidays = await Holiday.find().lean();
  const holidaySet = new Set(holidays.map((h) => dateKey(h.date)));
  const ids = [];

  let n = 0;
  for (const p of plan) {
    n++;
    if (onProgress) onProgress({ done: n - 1, total: plan.length, created: summary.created, updated: summary.updated, generated: summary.generated });
    let task;
    if (p.kind === "update") {
      const { deletedCount } = await TaskInstance.deleteMany({ task: p.id, actual: null, planned: { $gte: start } });
      summary.removedPending += deletedCount;
      task = await Task.findByIdAndUpdate(
        p.id,
        { department: p.row.department, startTime: p.row.startTime, startDate: p.rowStart, nextAnchor: null, active: true, generating: false },
        { new: true }
      );
    } else {
      task = await Task.create({
        taskId: nextId++,
        taskName: p.row.taskName,
        department: p.row.department,
        frequency: p.row.frequency,
        startDate: p.rowStart,
        startTime: p.row.startTime,
        defaultAssignee: p.doer._id,
        active: true,
      });
    }
    ids.push(task._id);
    const res = await generateOccurrencesForTask(task, settings, holidaySet);
    summary.generated += res.created || 0;
  }

  // ---- Check the result ------------------------------------------------------
  const present = await Task.countDocuments({ _id: { $in: ids } });
  const withRows = (await TaskInstance.distinct("task", { task: { $in: ids }, planned: { $gte: start } })).length;
  summary.verify = { expectedTasks: plan.length, tasksInList: present, tasksWithMasterRows: withRows, tasksWithoutRows: present - withRows };
  return summary;
}

// ---- Background job -------------------------------------------------------
// Creating thousands of Master rows takes longer than a web request is allowed
// to (hosts cut requests off after ~30-60s), which looks like "it didn't add".
// So the button starts the work in the background and polls getImportJob().
let job = { state: "idle" };
export const getImportJob = () => job;

export function startImportJob(opts = {}) {
  if (job.state === "running") return job;
  job = { state: "running", startedAt: new Date().toISOString(), done: 0, total: 0, created: 0, updated: 0, generated: 0 };
  importTaskList({
    ...opts,
    onProgress: (p) => {
      job = { ...job, ...p };
    },
  })
    .then((summary) => {
      job = { ...job, ...summary, state: "done", done: summary.total, finishedAt: new Date().toISOString() };
    })
    .catch((err) => {
      console.error("[import-task-list]", err);
      job = { ...job, state: "error", error: err.message, finishedAt: new Date().toISOString() };
    });
  return job;
}
