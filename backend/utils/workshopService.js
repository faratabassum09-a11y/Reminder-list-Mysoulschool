import Workshop from "../models/Workshop.js";
import WorkshopTask from "../models/WorkshopTask.js";
import WorkshopTemplate from "../models/WorkshopTemplate.js";
import Doer from "../models/Doer.js";
import { reserveSeq } from "../models/WorkshopCounter.js";

// ---------------------------------------------------------------------
// Workshop types. The four task lists the team runs today. To add a fifth
// type later, add one line here and restart — its template appears on the
// Templates page automatically.
// (R12 / THW default days + time are placeholders: change them on the
// Templates page, no code needed.)
// ---------------------------------------------------------------------
export const WORKSHOP_TYPES = [
  { code: "UTW", name: "UTW Workshop", defaultDays: 3, defaultTime: "19:00" },
  { code: "ICP", name: "ICP Workshop", defaultDays: 1, defaultTime: "16:00" },
  { code: "R12", name: "R12 Workshop", defaultDays: 1, defaultTime: "11:00" },
  { code: "THW", name: "THW Workshop", defaultDays: 1, defaultTime: "11:00" },
];
export const TYPE_CODES = WORKSHOP_TYPES.map((t) => t.code); // built-ins only; custom types live in the DB

// "xyz " -> "XYZ"; "" / "1ab" / too long -> "" (2–8 chars, starts with a letter)
export function cleanTypeCode(value) {
  const c = String(value || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{1,7}$/.test(c) ? c : "";
}

// Every workshop type = every template in the DB (the 4 built-ins first, then
// custom ones in creation order).
export async function listTemplates(full = false) {
  await ensureTemplates();
  const list = await WorkshopTemplate.find({}, full ? undefined : "code name defaultDays defaultTime tasks createdAt").lean();
  const order = new Map(WORKSHOP_TYPES.map((t, i) => [t.code, i]));
  return list.sort((a, b) => (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99) || new Date(a.createdAt) - new Date(b.createdAt));
}

// Workshops run on India time (the original script used Asia/Kolkata).
export const TZ_NAME = "Asia/Kolkata";
const TZ_OFFSET_MIN = Number(process.env.WORKSHOP_TZ_OFFSET_MIN ?? 330);
const DAY_MS = 86_400_000;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Tasks with no time in the template are due by the end of that day.
const DEFAULT_TASK_TIME = "23:59";

export async function ensureTemplates() {
  const existing = await WorkshopTemplate.find({}, "code").lean();
  const have = new Set(existing.map((t) => t.code));
  const missing = WORKSHOP_TYPES.filter((t) => !have.has(t.code));
  if (missing.length) {
    await WorkshopTemplate.insertMany(
      missing.map((t) => ({ code: t.code, name: t.name, defaultDays: t.defaultDays, defaultTime: t.defaultTime, tasks: [] })),
      { ordered: false }
    ).catch(() => {}); // a concurrent request may have created them first
  }
}

// "2025-01-06" -> Date at UTC midnight of that calendar day (or null).
export function parseYmd(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1 ? null : d;
}

export function dayNameOf(dateUtcMidnight) {
  return DAY_NAMES[dateUtcMidnight.getUTCDay()];
}

// Accepts "19:00", "19:00:00", "7:30 PM", "7pm" -> "HH:mm" (or "" if not a time).
export function normalizeTime(value) {
  if (value === null || value === undefined) return "";
  const s = String(value).trim().toLowerCase();
  if (!s) return "";
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/.exec(s);
  if (!m) return "";
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// "T-7" -> -7, "T" -> 0, "T+2" -> 2, "-3" -> -3 (same rule as the sheet).
export function parseTimeline(value) {
  const n = Number.parseInt(String(value ?? "").replace(/t/i, "").replace("+", "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

// The real instant a task is due: calendar day (start date + offset) at the
// given India-time clock reading.
export function plannedInstant(startDateUtcMidnight, offsetDays, time) {
  const [h, m] = (normalizeTime(time) || DEFAULT_TASK_TIME).split(":").map(Number);
  const dayStart = startDateUtcMidnight.getTime() + offsetDays * DAY_MS;
  return new Date(dayStart + (h * 60 + m - TZ_OFFSET_MIN) * 60_000);
}

export function outcomeFor(actual, planned) {
  return new Date(actual).getTime() <= new Date(planned).getTime() ? "On Time" : "Delayed";
}

// Open tasks past their due time read as "Overdue"; done ones keep the
// outcome they were completed with.
export function statusOf(task, now = Date.now()) {
  if (task.actual) return task.outcome || "On Time";
  return new Date(task.planned).getTime() < now ? "Overdue" : "Pending";
}

// Copies the type's fixed task list into WorkshopTask rows for one workshop.
export async function generateTasksForWorkshop(workshop) {
  const template = await WorkshopTemplate.findOne({ code: workshop.type }).lean();
  const items = (template?.tasks || []).filter((t) => t.task && t.task.trim());
  if (!items.length) return 0;

  const doerIds = items.map((t) => t.doer).filter(Boolean);
  const doers = doerIds.length ? await Doer.find({ _id: { $in: doerIds } }).lean() : [];
  const doerById = new Map(doers.map((d) => [String(d._id), d]));

  const first = await reserveSeq("wts", items.length);
  const docs = items.map((t, i) => {
    const doer = t.doer ? doerById.get(String(t.doer)) : null;
    const offsetDays = parseTimeline(t.timeline);
    const time = normalizeTime(t.time);
    return {
      workshop: workshop._id,
      workshopId: workshop.workshopId,
      workshopType: workshop.type,
      workshopDate: workshop.startDate,
      taskId: `${workshop.workshopId}-WTS-${first + i}`,
      task: t.task.trim(),
      templateTaskId: t.taskId || "",
      description: t.description || "",
      timeline: t.timeline || "T",
      offsetDays,
      time,
      doer: doer?._id,
      owner: doer?.name || t.ownerName || "",
      ownerEmail: doer?.email || "",
      department: doer?.department || "",
      buddyEmail: doer?.buddyEmails?.[0] || "",
      score: Number(t.score) || 0,
      planned: plannedInstant(workshop.startDate, offsetDays, time),
    };
  });
  await WorkshopTask.insertMany(docs);
  return docs.length;
}

// Re-times every still-open task after a workshop is postponed/moved.
export async function reschedulePendingTasks(workshop) {
  const open = await WorkshopTask.find({ workshop: workshop._id, actual: null });
  if (!open.length) return 0;
  await WorkshopTask.bulkWrite(
    open.map((t) => ({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { workshopDate: workshop.startDate, planned: plannedInstant(workshop.startDate, t.offsetDays, t.time) } },
      },
    }))
  );
  // Keep the date on completed rows too so the workshop reads consistently.
  await WorkshopTask.updateMany({ workshop: workshop._id, actual: { $ne: null } }, { $set: { workshopDate: workshop.startDate } });
  return open.length;
}

// ---------------------------------------------------------------------
// Launch Verification hand-off — the Apps Script web app that stores
// launches (doPost) and serves them back (doGet). Set LAUNCH_WEBHOOK_URL.
// ---------------------------------------------------------------------
function ddmmyyyy(d) {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export function launchPayload(w) {
  return {
    id: w.workshopId,
    name: w.name || w.typeName,
    days: w.days,
    date: ddmmyyyy(new Date(w.startDate)),
    time: `${w.startTime}:00`,
    day: w.startDay,
    type: w.type,
  };
}

async function timedFetch(url, options = {}, ms = 20_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctl.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

// Never throws — returns { status, error } and lets the caller record it.
export async function postLaunchToWebhook(workshop) {
  const url = process.env.LAUNCH_WEBHOOK_URL;
  // No external Launch Verification app configured -> the website itself is
  // the launch list (see fetchRemoteLaunches / the Launches page).
  if (!url) return { status: "internal", error: "" };
  try {
    const res = await timedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(launchPayload(workshop)),
    });
    if (!res.ok) return { status: "failed", error: `Webhook answered HTTP ${res.status}` };
    return { status: "sent", error: "" };
  } catch (err) {
    return { status: "failed", error: err.name === "AbortError" ? "Webhook timed out" : err.message };
  }
}

export async function fetchRemoteLaunches() {
  const url = process.env.LAUNCH_WEBHOOK_URL;
  if (!url) {
    // Built-in feed: every approved workshop, in the same shape the Apps Script serves.
    const list = await Workshop.find({ status: "approved" }).sort({ startDate: 1 }).lean();
    return { launches: list.map(launchPayload), updatedAt: new Date().toISOString(), internal: true };
  }
  const res = await timedFetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Webhook answered HTTP ${res.status}`);
  const json = await res.json();
  return { launches: Array.isArray(json.launches) ? json.launches : [], updatedAt: json.updatedAt || "" };
}

export async function recordLaunchSync(workshopDoc) {
  const result = await postLaunchToWebhook(workshopDoc);
  workshopDoc.launchSync = { status: result.status, at: new Date(), error: result.error };
  await workshopDoc.save();
  return result;
}

export { Workshop };
