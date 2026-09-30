// Loads the WHOLE Workshop PMS history into MongoDB:
//   data/workshops.csv            -> 206 workshops (form responses + plan sheet)
//   data/workshop-templates.json  -> the 4 fixed task lists (UTW / ICP / R12 / THW)
//   data/workshop-tasks.json      -> 10,715 workshop tasks with planned/actual/outcome
//   (+ one "Responses" row per completed task, and the ID counters so the
//    next new workshop / task continues the old numbering)
//
// Usage:
//   cd backend
//   npm run seed:workshops            # load
//   npm run seed:workshops -- --dry-run   # validate files, touch nothing
//   npm run seed:workshops -- --force     # also replace workshops created in the app
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import Workshop from "./models/Workshop.js";
import WorkshopTask from "./models/WorkshopTask.js";
import WorkshopTemplate from "./models/WorkshopTemplate.js";
import WorkshopResponse from "./models/WorkshopResponse.js";
import WorkshopCounter from "./models/WorkshopCounter.js";
import Doer from "./models/Doer.js";
import User from "./models/User.js";
import { WORKSHOP_TYPES, normalizeTime, parseTimeline, dayNameOf } from "./utils/workshopService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";
const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const DAY_MS = 86_400_000;
const TZ_MIN = Number(process.env.WORKSHOP_TZ_OFFSET_MIN ?? 330);

// The short name used in the sheets -> real person.
const PEOPLE = {
  Aravind: { name: "Aravind", email: "aravind@mysoulschool.in", department: "Operations", buddy: "ruchimysoulschool@gmail.com" },
  Tanvi: { name: "Tanvi Negi", email: "tanvi_negi@mysoulschool.in", department: "Customer Support", buddy: "chandrika.mysoulschool@gmail.com" },
  Paridhi: { name: "Paridhi", email: "paridhi.mysoulschool@gmail.com", department: "Customer Support" },
  Chandrika: { name: "Chandrika Pathak", email: "chandrika.mysoulschool@gmail.com", department: "Customer Support" },
  Deesha: { name: "Deesha", email: "deesha.mysoulschool@gmail.com", department: "Customer Support" },
  Megha: { name: "Megha Chanda", email: "megha@mysoulschool.in", department: "Social Media" },
  Ruchi: { name: "Ruchi", email: "ruchimysoulschool@gmail.com", department: "Operations" },
  Dolly: { name: "Dolly", email: "dolly_naagar@mysoulschool.in", department: "Admin" },
  Nitin: { name: "Nitin", email: "nitin@mysoulschool.in", department: "Operations" },
};
const DEFAULTS = { UTW: { days: 3, time: "19:00" }, ICP: { days: 1, time: "16:00" }, R12: { days: 1, time: "11:00" }, THW: { days: 1, time: "11:00" } };

const load = (f) => fs.readFileSync(path.join(__dirname, "data", f), "utf-8");
function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const keys = head.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [keys[i], v])));
}
const dmy = (s) => { const [d, m, y] = s.split("/").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const dmyhms = (s) => { const [dd, tt] = s.split(" "); const [d, m, y] = dd.split("/").map(Number); const [h, mi, se] = tt.split(":").map(Number); return new Date(Date.UTC(y, m - 1, d, h, mi, se) - TZ_MIN * 60_000); };

async function main() {
  const workshopsCsv = parseCsv(load("workshops.csv"));
  const templates = JSON.parse(load("workshop-templates.json"));
  const tasks = JSON.parse(load("workshop-tasks.json"));
  const typeName = Object.fromEntries(WORKSHOP_TYPES.map((t) => [t.code, t.name]));

  const known = new Set(workshopsCsv.map((w) => w.workshopId));
  const orphan = tasks.filter((t) => !known.has(t.w));
  console.log(`Files OK: ${workshopsCsv.length} workshops, ${tasks.length} tasks, ${Object.values(templates).reduce((n, t) => n + t.tasks.length, 0)} template rows, ${orphan.length} orphan tasks.`);
  if (DRY) { console.log("--dry-run: nothing written."); return; }

  await mongoose.connect(MONGO_URI);
  const inApp = await Workshop.find({ workshopId: { $nin: [...known] } }, "workshopId").lean();
  if (inApp.length && !FORCE) {
    console.error(`Found ${inApp.length} workshop(s) created in the app that are not in the files (${inApp.slice(0, 5).map((w) => w.workshopId).join(", ")}…). Re-run with --force to replace everything, or export them first.`);
    process.exit(1);
  }

  // Doers already in the app (from seed:real), matched by email — optional link.
  const doers = await Doer.find({}).lean();
  const doerByEmail = new Map(doers.map((d) => [d.email, d]));
  // App logins, so imported form responses are linked to the account that submitted them.
  const users = await User.find({}, "email").lean();
  const userByEmail = new Map(users.map((u) => [u.email, u._id]));
  const person = (short) => {
    const p = PEOPLE[short] || PEOPLE.Aravind;
    const d = doerByEmail.get(p.email);
    return { doer: d?._id, owner: d?.name || p.name, ownerEmail: p.email, department: d?.department || p.department, buddyEmail: d?.buddyEmails?.[0] || p.buddy || "" };
  };

  // 1. Templates -------------------------------------------------------
  for (const code of Object.keys(templates)) {
    const rows = templates[code].tasks.map((t, i) => {
      const p = person(t.owner);
      return { taskId: `${code}-TS-${i + 2}`, description: "", task: t.task, timeline: t.timeline, time: t.time, doer: p.doer, ownerName: p.owner, score: t.score };
    });
    await WorkshopTemplate.findOneAndUpdate(
      { code },
      { $set: { name: typeName[code], defaultDays: DEFAULTS[code].days, defaultTime: DEFAULTS[code].time, tasks: rows } },
      { upsert: true }
    );
  }
  console.log("Templates loaded (UTW, ICP, R12, THW).");

  // 2. Wipe + reload workshops / tasks / responses ---------------------
  await Promise.all([Workshop.deleteMany({}), WorkshopTask.deleteMany({}), WorkshopResponse.deleteMany({})]);
  const count = {};
  tasks.forEach((t) => (count[t.w] = (count[t.w] || 0) + 1));

  const wsDocs = workshopsCsv.map((w) => {
    const type = w.workshopId.split("-")[0];
    const startDate = dmy(w.startDate);
    const pending = w.workshopId === "UTW-96"; // blank status in the plan sheet = not approved yet
    const requester = PEOPLE[Object.keys(PEOPLE).find((k) => PEOPLE[k].email === w.requestedByEmail)] || PEOPLE.Tanvi;
    const submitted = dmyhms(w.submittedAt);
    return {
      workshopId: w.workshopId,
      type,
      typeName: typeName[type] || `${type} Workshop`,
      name: typeName[type] || `${type} Workshop`,
      goal: "",
      days: DEFAULTS[type]?.days ?? 1,
      startDate,
      startTime: normalizeTime(w.startTime),
      startDay: dayNameOf(startDate),
      status: pending ? "pending" : "approved",
      requestedByName: requester.name,
      requestedBy: userByEmail.get(requester.email),
      requestedByEmail: requester.email,
      submittedAt: submitted, // the form response "Timestamp"
      reviewedByName: pending ? "" : "Nitin",
      reviewedAt: pending ? undefined : submitted,
      reviewNote: pending ? "" : "Imported from the Google Sheets Plan",
      tasksGenerated: count[w.workshopId] || 0,
      launchSync: { status: pending ? "not_sent" : "skipped", error: pending ? "" : "Imported history — not re-sent to Launch Verification" },
      createdAt: submitted,
    };
  });
  // The plan sheet's "Workshop Days" column: UTW = 3, others 1 — already the DEFAULTS above.
  const inserted = await Workshop.insertMany(wsDocs, { ordered: true, timestamps: false });
  const wsByCode = new Map(inserted.map((w) => [w.workshopId, w]));
  console.log(`Workshops loaded: ${inserted.length} (${inserted.filter((w) => w.status === "pending").length} pending approval).`);

  const taskDocs = tasks.map((t) => {
    const w = wsByCode.get(t.w);
    const p = person(t.o);
    const planned = new Date(t.p);
    const actual = t.a ? new Date(t.a) : null;
    return {
      workshop: w._id,
      workshopId: t.w,
      workshopType: w.type,
      workshopDate: w.startDate,
      taskId: t.id,
      task: t.t,
      timeline: t.tl,
      offsetDays: parseTimeline(t.tl),
      time: "",
      doer: p.doer,
      owner: p.owner,
      ownerEmail: p.ownerEmail,
      department: p.department,
      buddyEmail: p.buddyEmail,
      score: t.s,
      planned,
      actual,
      outcome: t.oc || null,
      ownerScore: actual ? (t.oc === "On Time" ? t.s : 0) : null,
      workshopScore: actual ? t.s : null,
      completedByName: actual ? p.owner : "",
    };
  });
  // planned "time" field for display: derive from the planned instant in India time
  taskDocs.forEach((d) => {
    const local = new Date(d.planned.getTime() + TZ_MIN * 60_000);
    d.time = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  });
  const BATCH = 1000;
  const savedTasks = [];
  for (let i = 0; i < taskDocs.length; i += BATCH) {
    savedTasks.push(...(await WorkshopTask.insertMany(taskDocs.slice(i, i + BATCH), { ordered: false })));
    process.stdout.write(`\rTasks loaded: ${Math.min(i + BATCH, taskDocs.length)} / ${taskDocs.length}`);
  }
  console.log();

  // 3. Responses = one per completed task (the "Responses" sheet) ------
  const respDocs = savedTasks.filter((t) => t.actual).map((t) => ({
    task: t._id, taskId: t.taskId, workshopId: t.workshopId, workshopType: t.workshopType, taskName: t.task,
    owner: t.owner, ownerEmail: t.ownerEmail, planned: t.planned, actual: t.actual, outcome: t.outcome,
    score: t.score, ownerScore: t.ownerScore, submittedByName: t.owner, submittedByEmail: t.ownerEmail,
    createdAt: t.actual, updatedAt: t.actual,
  }));
  for (let i = 0; i < respDocs.length; i += BATCH) await WorkshopResponse.insertMany(respDocs.slice(i, i + BATCH), { ordered: false, timestamps: false });
  console.log(`Responses loaded: ${respDocs.length}.`);

  // 4. Counters so new IDs continue from the old sheet -----------------
  const maxWs = {};
  workshopsCsv.forEach((w) => { const [c, n] = w.workshopId.split("-"); maxWs[c] = Math.max(maxWs[c] || 0, Number(n)); });
  const maxWts = Math.max(...tasks.map((t) => Number(/(\d+)$/.exec(t.id)[1])));
  const ops = Object.entries(maxWs).map(([c, n]) => WorkshopCounter.findOneAndUpdate({ _id: `ws:${c}` }, { $set: { seq: n } }, { upsert: true }));
  ops.push(WorkshopCounter.findOneAndUpdate({ _id: "wts" }, { $set: { seq: maxWts } }, { upsert: true }));
  await Promise.all(ops);
  console.log(`Counters set: ${Object.entries(maxWs).map(([c, n]) => `${c}=${n}`).join(", ")}, tasks=${maxWts}.`);

  const done = savedTasks.filter((t) => t.actual).length;
  console.log(`Done. ${done} of ${savedTasks.length} tasks completed.`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
