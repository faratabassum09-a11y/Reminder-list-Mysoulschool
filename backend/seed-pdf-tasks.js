// Imports EVERY row of the "Reminder List - Task List" PDF (data/pdf-tasks.txt)
// into the website:
//
//   1. Doers        - each Doer Name is matched to your Doer List. A name that
//                     is NOT in the list is still added (with its real details
//                     from data/doers.json if known, otherwise a placeholder
//                     email you can edit later in Doer List) so no task is
//                     ever dropped.
//   2. Task List    - one Task per PDF row (duplicates included), keeping its
//                     Task / Doer / Department / Frequency. EVERY task starts on
//                     5 October 2026 (override with --start=YYYY-MM-DD); the
//                     time of day comes from the PDF's Day/Date column.
//                     Tasks already in the Task List (e.g. from an earlier run
//                     with other start dates) are moved to the new start date
//                     and their not-yet-done Master rows are regenerated.
//   3. Master       - every occurrence from the PDF date's schedule, generated
//                     by the app's own recurrence engine, all the way up to the
//                     Schedule Horizon in Settings (Sundays/holidays handled
//                     exactly like normal tasks).
//   4. Submission Log - one row per PDF task (status "Sent"), timestamped with
//                     the PDF Day/Date.
//
// Safe to re-run: rows that already exist are skipped, never duplicated.
//
// Usage (from /backend):
//   npm run reload:tasks                       RELOAD: every task starts 5 Oct 2026, Master rebuilt from each task's occurrences
//   npm run seed:pdf-tasks                     same thing (default start date is 5 Oct 2026)
//   npm run seed:pdf-tasks -- --start=2026-10-12   use a different start date for all tasks
//   npm run seed:pdf-tasks -- --horizon=2026-12-31   also set the Schedule Horizon
//   npm run seed:pdf-tasks -- --fresh          FIRST wipe Task List, Master and Submission
//                                              Log (doers/logins/settings are kept)
//   npm run seed:pdf-tasks -- --fresh-master   Dashboard fresh start: wipe ALL Master rows (incl. done) and the
//                                              Dashboard archive, rebuild Master from the start date.
//                                              Task List and Submission Log are LEFT AS THEY ARE.
//   npm run seed:pdf-tasks -- --dry-run        show what would happen, write nothing
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Doer from "./models/Doer.js";
import Task from "./models/Task.js";
import TaskInstance from "./models/TaskInstance.js";
import SubmissionLog from "./models/SubmissionLog.js";
import Holiday from "./models/Holiday.js";
import WeeklyArchive from "./models/WeeklyArchive.js";
import Settings, { getSettings } from "./models/Settings.js";
import { generateOccurrencesForTask } from "./utils/generateOccurrences.js";
import { cacheDel } from "./utils/cache.js";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argVal = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const DRY = has("--dry-run");
const FRESH = has("--fresh");
// --fresh-master: dashboard fresh start. Deletes EVERY Master row (done ones too) and the
// Dashboard weekly archive, then rebuilds Master from 5 Oct. Task List and Submission Log are kept.
const FRESH_MASTER = has("--fresh-master");
const START_ARG = argVal("start") || "2026-10-05";
const START_DATE = new Date(`${START_ARG}T00:00:00Z`);
const HORIZON_ARG = argVal("horizon");

const VALID_FREQ = new Set(["D", "W", "M", "Q", "Y", "F", "E1st", "E2nd", "E3rd", "E4th", "ELast"]);
const IST_MS = (5 * 60 + 30) * 60000;

// ---- parse the PDF rows --------------------------------------------------
function parseRows() {
  const lines = fs
    .readFileSync(path.join(__dirname, "data", "pdf-tasks.txt"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  return lines.map((line, i) => {
    const parts = line.split("|");
    if (parts.length !== 5) throw new Error(`pdf-tasks.txt line ${i + 1}: expected 5 fields, got ${parts.length}`);
    const [taskName, doerName, department, frequency, dt] = parts.map((s) => s.trim());
    const m = dt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) throw new Error(`pdf-tasks.txt line ${i + 1}: bad date "${dt}"`);
    const [, dd, mo, yyyy, hh, mi] = m.map(Number);
    if (!VALID_FREQ.has(frequency)) throw new Error(`pdf-tasks.txt line ${i + 1}: bad frequency "${frequency}"`);
    return {
      seq: i + 1,
      taskName,
      doerName,
      department,
      frequency,
      // Every task begins on the same start date (default 2 Oct 2026), pinned to
      // UTC midnight like the app's own date inputs.
      startDate: START_DATE,
      startTime: `${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}`,
      // The exact moment shown in the PDF (India time) - used for the Submission Log.
      stamp: new Date(Date.UTC(yyyy, mo - 1, dd, hh, mi) - IST_MS),
    };
  });
}

const dayKey = (d) => d.toISOString().slice(0, 10);
// Identity of a task = name + doer + frequency + time. The start date is NOT part
// of it, so re-running with a new start date updates tasks instead of duplicating.
const baseKey = (name, doerId, freq, time) =>
  [name.toLowerCase(), String(doerId), freq, time].join("|");
// Same holiday-key convention the recurrence engine uses.
const engineDateKey = (d) => d.toISOString().slice(0, 10); // UTC calendar day, same as the engine

async function main() {
  if (isNaN(START_DATE)) throw new Error(`--start must look like 2026-10-05 (got "${START_ARG}")`);
  const rows = parseRows();
  console.log(`Read ${rows.length} task rows from data/pdf-tasks.txt`);

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  console.log(`Connected to ${MONGO_URI}${DRY ? "  (DRY RUN - nothing will be written)" : ""}\n`);

  // Schedule Horizon must exist, otherwise no Master rows could be generated.
  let settings = await getSettings();
  if (HORIZON_ARG) {
    const h = new Date(`${HORIZON_ARG}T00:00:00Z`);
    if (isNaN(h)) throw new Error(`--horizon must look like 2026-12-31 (got "${HORIZON_ARG}")`);
    if (!DRY) {
      settings.scheduleHorizon = h;
      await settings.save();
    } else settings.scheduleHorizon = h;
  }
  if (!settings.scheduleHorizon) {
    throw new Error(
      "No Schedule Horizon set. Set it in Settings, or re-run with --horizon=YYYY-MM-DD (e.g. --horizon=2026-12-31)."
    );
  }
  console.log(`Schedule Horizon: ${dayKey(new Date(settings.scheduleHorizon))}   Skip Sundays: ${settings.skipSundays}`);

  if (FRESH) {
    for (const [label, Model] of [["Master rows", TaskInstance], ["Tasks", Task], ["Submission Log rows", SubmissionLog]]) {
      const n = await Model.countDocuments();
      if (!DRY) await Model.deleteMany({});
      console.log(`  ${DRY ? "would delete" : "deleted"} ${n} ${label}`);
    }
  }

  if (FRESH_MASTER) {
    for (const [label, Model] of [["Master rows", TaskInstance], ["Dashboard archive rows", WeeklyArchive]]) {
      const n = await Model.countDocuments();
      if (!DRY) await Model.deleteMany({});
      console.log(`  ${DRY ? "would delete" : "deleted"} ${n} ${label}`);
    }
    if (!DRY) await Task.updateMany({}, { nextAnchor: null, generating: false });
    console.log("  Submission Log and Task List kept as they are.");
  }

  // ---- 1. doers ----------------------------------------------------------
  const doers = await Doer.find();
  const doerByName = new Map(doers.map((d) => [d.name.trim().toLowerCase(), d]));
  let known = [];
  try {
    known = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "doers.json"), "utf-8"));
  } catch {}
  const knownByName = new Map(known.map((d) => [d.name.trim().toLowerCase(), d]));

  const created = { restored: [], placeholder: [] };
  const firstRowByDoer = new Map();
  for (const r of rows) if (!firstRowByDoer.has(r.doerName.toLowerCase())) firstRowByDoer.set(r.doerName.toLowerCase(), r);

  for (const [lname, r] of firstRowByDoer) {
    if (doerByName.has(lname)) continue;
    const k = knownByName.get(lname);
    let doc;
    if (k) {
      doc = { name: k.name, email: k.email, department: k.department, buddyEmails: k.buddyEmails || [] };
      created.restored.push(r.doerName);
    } else {
      const slug = r.doerName.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
      doc = { name: r.doerName, email: `${slug}@pending.mysoulschool.in`, department: r.department, buddyEmails: [] };
      created.placeholder.push(r.doerName);
    }
    // An email already used by a different doer would violate the unique index.
    const clash = await Doer.findOne({ email: doc.email });
    if (clash) {
      doerByName.set(lname, clash);
      continue;
    }
    if (DRY) doerByName.set(lname, { _id: new mongoose.Types.ObjectId(), ...doc });
    else doerByName.set(lname, await Doer.create(doc));
  }
  console.log(
    `\nDoers: ${firstRowByDoer.size} distinct names in the PDF. ` +
      `Added ${created.restored.length} from your saved Doer List (${created.restored.join(", ") || "-"}) and ` +
      `${created.placeholder.length} as placeholders (${created.placeholder.join(", ") || "-"}).`
  );

  // ---- 2. tasks ----------------------------------------------------------
  const existingTasks = await Task.find().lean();
  const existingCount = new Map();
  for (const t of existingTasks) {
    if (!t.defaultAssignee) continue;
    const k = baseKey(t.taskName, t.defaultAssignee, t.frequency, t.startTime || "");
    existingCount.set(k, (existingCount.get(k) || 0) + 1);
  }
  const last = await Task.findOne().sort({ taskId: -1 }).lean();
  let nextId = (last?.taskId || 0) + 1;

  const seenInFile = new Map();
  const toInsert = [];
  const rowToKey = [];
  for (const r of rows) {
    const doer = doerByName.get(r.doerName.toLowerCase());
    const k = baseKey(r.taskName, doer._id, r.frequency, r.startTime);
    const nth = (seenInFile.get(k) || 0) + 1;
    seenInFile.set(k, nth);
    rowToKey.push({ r, doer, k, nth });
    if (nth <= (existingCount.get(k) || 0)) continue; // already in the Task List
    toInsert.push({
      taskId: nextId++,
      taskName: r.taskName,
      department: r.department,
      frequency: r.frequency,
      startDate: r.startDate,
      startTime: r.startTime,
      defaultAssignee: doer._id,
      active: true,
    });
  }
  let insertedTasks = [];
  if (!DRY && toInsert.length) insertedTasks = await Task.insertMany(toInsert);
  console.log(
    `Task List: ${toInsert.length} new task(s) ${DRY ? "would be " : ""}added, ${rows.length - toInsert.length} already present.`
  );

  // ---- 3. master occurrences up to the horizon ---------------------------
  const holidays = await Holiday.find().lean();
  const holidaySet = new Set(holidays.map((h) => engineDateKey(new Date(h.date))));
  let masterCreated = 0;
  let restarted = 0;
  const perFreq = {};
  let lastDay = null;

  // Tasks that were already in the Task List (e.g. imported earlier with
  // other start dates): move them to the new start date and rebuild their
  // not-yet-done Master rows. Completed rows are history and never touched.
  const pdfKeys = new Set(rowToKey.map((x) => x.k));
  const seenExisting = new Map();
  const toRestart = [];
  for (const t of existingTasks) {
    if (!t.defaultAssignee) continue;
    const k = baseKey(t.taskName, t.defaultAssignee, t.frequency, t.startTime || "");
    if (!pdfKeys.has(k)) continue;
    const idx = (seenExisting.get(k) || 0) + 1;
    seenExisting.set(k, idx);
    if (idx > seenInFile.get(k)) continue; // an extra copy beyond what the PDF lists - leave alone
    if (FRESH_MASTER || !t.startDate || dayKey(new Date(t.startDate)) !== dayKey(START_DATE)) toRestart.push(t);
  }

  if (!DRY) {
    for (const old of toRestart) {
      await TaskInstance.deleteMany({ task: old._id, actual: null });
      const t = await Task.findByIdAndUpdate(old._id, { startDate: START_DATE, nextAnchor: null, active: true }, { new: true });
      const res = await generateOccurrencesForTask(t, settings, holidaySet, { clampToHorizon: true });
      masterCreated += res.created || 0;
      perFreq[t.frequency] = (perFreq[t.frequency] || 0) + (res.created || 0);
      restarted++;
    }
    let n = 0;
    for (const t of insertedTasks) {
      const res = await generateOccurrencesForTask(t, settings, holidaySet, { clampToHorizon: true });
      masterCreated += res.created || 0;
      perFreq[t.frequency] = (perFreq[t.frequency] || 0) + (res.created || 0);
      if (++n % 50 === 0) console.log(`  ...generated Master rows for ${n}/${insertedTasks.length} new tasks`);
    }
    const ids = [...insertedTasks.map((t) => t._id), ...toRestart.map((t) => t._id)];
    if (ids.length) {
      const lastRow = await TaskInstance.findOne({ task: { $in: ids } }).sort({ planned: -1 }).lean();
      lastDay = lastRow?.planned;
    }
  }
  console.log(
    `Start date for all tasks: ${dayKey(START_DATE)}. Moved ${DRY ? toRestart.length + " existing task(s) (dry run)" : restarted + " existing task(s)"} to it.`
  );
  console.log(
    `Master: ${DRY ? "(dry run)" : masterCreated + " row(s) created"} from ${dayKey(START_DATE)} up to the horizon` +
      (lastDay ? ` (latest planned: ${lastDay.toISOString()})` : "") +
      (Object.keys(perFreq).length ? `\n  by frequency: ${Object.entries(perFreq).map(([f, c]) => `${f}=${c}`).join("  ")}` : "")
  );

  // ---- 4. submission log -------------------------------------------------
  const wantedIds = new Set();
  const logDocs = [];
  const taskIdByRow = new Map();
  // Map each PDF row to the taskId it now has (new ones by insertion order, existing ones by match).
  const newIdQueue = new Map();
  for (const t of toInsert) {
    const k = baseKey(t.taskName, t.defaultAssignee, t.frequency, t.startTime);
    if (!newIdQueue.has(k)) newIdQueue.set(k, []);
    newIdQueue.get(k).push(t.taskId);
  }
  const existingIdQueue = new Map();
  for (const t of existingTasks) {
    if (!t.defaultAssignee) continue;
    const k = baseKey(t.taskName, t.defaultAssignee, t.frequency, t.startTime || "");
    if (!existingIdQueue.has(k)) existingIdQueue.set(k, []);
    existingIdQueue.get(k).push(t.taskId);
  }
  const used = new Map();
  for (const { r, k, nth } of rowToKey) {
    const ex = existingIdQueue.get(k) || [];
    const nw = newIdQueue.get(k) || [];
    const pool = [...ex, ...nw];
    const taskId = pool[nth - 1];
    if (taskId == null) continue;
    wantedIds.add(taskId);
    logDocs.push({ taskId, timestamp: r.stamp, name: r.doerName, task: r.taskName });
  }
  const haveLogs = new Set(
    (await SubmissionLog.find({ taskId: { $in: [...wantedIds] } }).lean()).map(
      (l) => `${l.taskId}|${new Date(l.timestamp).getTime()}|${l.name}`
    )
  );
  const newLogs = logDocs.filter((l) => !haveLogs.has(`${l.taskId}|${l.timestamp.getTime()}|${l.name}`));
  if (!DRY && newLogs.length) await SubmissionLog.insertMany(newLogs);
  console.log(`Submission Log: ${newLogs.length} row(s) ${DRY ? "would be " : ""}added (${logDocs.length - newLogs.length} already there).`);

  if (!DRY) await cacheDel("*");

  const totalTasks = await Task.countDocuments();
  const totalMaster = await TaskInstance.countDocuments();
  console.log(`\nDone. Database now has ${totalTasks} tasks, ${totalMaster} Master rows.`);
  console.log("Restart the backend and hard-refresh the browser so caches pick up the new data.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("\nImport failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
