// Explains the Master row count. Read-only: nothing is changed.
//   npm run audit:master
import fs from "fs";
import mongoose from "mongoose";
import Doer from "./models/Doer.js";
import dotenv from "dotenv";
import Task from "./models/Task.js";
import TaskInstance from "./models/TaskInstance.js";
import { getSettings } from "./models/Settings.js";
import { TRACKING_START } from "./utils/trackingStart.js";

dotenv.config();
await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list");
const settings = await getSettings();
const horizonEnd = new Date(new Date(settings.scheduleHorizon).getTime() + 24 * 3600 * 1000);
const ist = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);

const total = await TaskInstance.countDocuments();
const before = await TaskInstance.countDocuments({ planned: { $lt: TRACKING_START } });
const beforeDone = await TaskInstance.countDocuments({ planned: { $lt: TRACKING_START }, actual: { $ne: null } });
const after = await TaskInstance.countDocuments({ planned: { $gte: horizonEnd } });
const inRange = await TaskInstance.countDocuments({ planned: { $gte: TRACKING_START, $lt: horizonEnd } });
console.log(`Total Master rows:                 ${total}`);
console.log(`  before ${ist(TRACKING_START)} (${beforeDone} done):   ${before}`);
console.log(`  in range (to horizon):           ${inRange}`);
console.log(`  after horizon ${ist(new Date(horizonEnd - 86400000))}:       ${after}`);

const sundays = await TaskInstance.aggregate([
  { $match: { planned: { $gte: TRACKING_START, $lt: horizonEnd } } },
  { $addFields: { dow: { $dayOfWeek: { date: "$planned", timezone: "Asia/Kolkata" } } } },
  { $match: { dow: 1 } },
  { $count: "n" },
]);
console.log(`  in-range rows falling on Sunday: ${sundays[0]?.n || 0}  (Skip Sundays is ${settings.skipSundays ? "ON" : "OFF"})`);

const dups = await TaskInstance.aggregate([
  { $group: { _id: { task: "$task", planned: "$planned" }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
  { $group: { _id: null, groups: { $sum: 1 }, extra: { $sum: { $subtract: ["$n", 1] } } } },
]);
console.log(`  duplicate rows (same task+time): ${dups[0]?.extra || 0}`);

const tasks = await Task.find().lean();
const byFreq = new Map();
for (const t of tasks) byFreq.set(t.frequency, (byFreq.get(t.frequency) || 0) + 1);
console.log(`\nTasks in Task List: ${tasks.length}  by frequency: ${[...byFreq].map(([f, c]) => `${f}=${c}`).join("  ")}`);

const perTask = await TaskInstance.aggregate([
  { $match: { planned: { $gte: TRACKING_START, $lt: horizonEnd } } },
  { $group: { _id: "$task", n: { $sum: 1 } } },
]);
const freqOf = new Map(tasks.map((t) => [String(t._id), t.frequency]));
const sums = {};
let orphans = 0;
for (const r of perTask) {
  const f = freqOf.get(String(r._id));
  if (!f) { orphans += r.n; continue; }
  sums[f] = sums[f] || { tasks: 0, rows: 0, min: 1e9, max: 0 };
  sums[f].tasks++; sums[f].rows += r.n; sums[f].min = Math.min(sums[f].min, r.n); sums[f].max = Math.max(sums[f].max, r.n);
}
console.log("\nIn-range rows by frequency (expected per task: D=76 W=13 M=3 E1st=3 E3rd=3 Q=1 Y=1):");
for (const [f, s] of Object.entries(sums)) console.log(`  ${f.padEnd(5)} tasks=${s.tasks}  rows=${s.rows}  per-task min/max=${s.min}/${s.max}`);
console.log(`  rows whose Task no longer exists: ${orphans}`);

// ---- which Task List entries are NOT in the PDF? ------------------------
const doers = new Map((await Doer.find().lean()).map((d) => [String(d._id), d.name]));
const key = (n, d, f, t) => [String(n).trim().toLowerCase(), String(d).trim().toLowerCase(), f, t || ""].join("|");
const pdf = new Map();
for (const line of fs.readFileSync(new URL("./data/pdf-tasks.txt", import.meta.url), "utf-8").split(/\r?\n/).filter((l) => l.trim())) {
  const [n, d, , f, dt] = line.split("|").map((x) => x.trim());
  const m = dt.match(/(\d{2}):(\d{2}):\d{2}$/);
  const k = key(n, d, f, m ? `${m[1]}:${m[2]}` : "");
  pdf.set(k, (pdf.get(k) || 0) + 1);
}
const used = new Map();
console.log("\nTasks in Task List that are NOT in the PDF (or are extra copies):");
let extras = 0;
for (const t of tasks) {
  const k = key(t.taskName, doers.get(String(t.defaultAssignee)) || "?", t.frequency, t.startTime);
  const n = (used.get(k) || 0) + 1;
  used.set(k, n);
  if (n > (pdf.get(k) || 0)) {
    extras++;
    console.log(`  #${t.taskId}  [${t.frequency}] "${t.taskName}"  doer=${doers.get(String(t.defaultAssignee)) || "?"}  time=${t.startTime || "-"}  start=${t.startDate ? ist(new Date(t.startDate)) : "-"}`);
  }
}
if (!extras) console.log("  none");

// ---- Sunday rows --------------------------------------------------------
const sun = await TaskInstance.aggregate([
  { $match: { planned: { $gte: TRACKING_START, $lt: horizonEnd } } },
  { $addFields: { dow: { $dayOfWeek: { date: "$planned", timezone: "Asia/Kolkata" } } } },
  { $match: { dow: 1 } },
  { $group: { _id: "$task", n: { $sum: 1 }, first: { $min: "$planned" }, last: { $max: "$planned" } } },
  { $sort: { n: -1 } },
]);
const tById = new Map(tasks.map((t) => [String(t._id), t]));
console.log("\nSunday rows by task:");
for (const r of sun) {
  const t = tById.get(String(r._id));
  console.log(`  ${r.n} row(s)  [${t?.frequency}] "${t?.taskName}"  doer=${doers.get(String(t?.defaultAssignee)) || "?"}  ${ist(r.first)}..${ist(r.last)}`);
}
await mongoose.disconnect();
