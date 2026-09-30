import Task from "../models/Task.js";
import TaskInstance from "../models/TaskInstance.js";
import Holiday from "../models/Holiday.js";
import { getSettings } from "../models/Settings.js";

// Safety cap so a bad startDate (e.g. a Daily task starting years ago)
// can't insert an unbounded backlog in a single call — mirrors having a
// sane "Working Day Calendar" length in the original, without needing to
// enumerate one.
const MAX_PER_TASK = 1000;
// Cap on anchors walked (kept or skipped) — guards against runaway loops.
const MAX_WALK = 20000;
// Cap on how many days the backward "find a working day" walk will try
// before giving up, in case every remaining day is somehow a holiday.
const MAX_BACKSHIFT_DAYS = 30;

// Every frequency (Daily included) generates ALL occurrences from the task's
// start date up to the Schedule Horizon set in Settings — nothing is
// throttled to a rolling window. MAX_PER_TASK above is only a safety net.

function dateKey(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Adds `months` calendar months, clamping to the last valid day of the
// target month (Jan 31 + 1 month -> Feb 28/29, not Mar 3).
function addMonthsClamped(date, months) {
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInTarget));
  return target;
}

function addYearsClamped(date, years) {
  const day = date.getDate();
  const target = new Date(date.getFullYear() + years, date.getMonth(), 1);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInTarget));
  return target;
}

// A day counts as "working" unless it's a Sunday (when skipSundays is on)
// or it's in the Holiday list — the stand-in for the original's
// "Working Day Calendar" sheet (an explicit enumerated list of valid dates).
function isWorkingDay(date, holidaySet, skipSundays) {
  if (skipSundays && date.getDay() === 0) return false;
  if (holidaySet.has(dateKey(date))) return false;
  return true;
}

// Walks a date backward, one day at a time, until it lands on a working
// day — exactly what the script's `while (!workingDatesStr.includes(...))`
// loop does. Used by every frequency except Daily.
function shiftBackToWorkingDay(date, holidaySet, skipSundays) {
  let d = new Date(date);
  let tries = 0;
  while (!isWorkingDay(d, holidaySet, skipSundays) && tries < MAX_BACKSHIFT_DAYS) {
    d = addDays(d, -1);
    tries++;
  }
  return d;
}

// The Nth (1-4) or last (-1) occurrence of `weekday` (0=Sun..6=Sat) within
// the given month. Falls back to the last occurrence if the Nth one
// doesn't exist (the original datejs chain would throw a RangeError here
// instead — we'd rather degrade gracefully than crash a live app).
function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n === -1) {
    const last = new Date(year, month + 1, 0);
    const diff = (last.getDay() - weekday + 7) % 7;
    last.setDate(last.getDate() - diff);
    return last;
  }
  const first = new Date(year, month, 1);
  const diffToWeekday = (weekday - first.getDay() + 7) % 7;
  const occurrence = new Date(year, month, 1 + diffToWeekday + (n - 1) * 7);
  if (occurrence.getMonth() !== month) return nthWeekdayOfMonth(year, month, weekday, -1);
  return occurrence;
}

// For E1st/E2nd/E3rd/E4th/ELast: given the (pre-shift) anchor date, find
// the Nth occurrence of *that same weekday* in the following month —
// matches `Date.parse(frozenDate).next().month().first().monday()` etc.
function nextAnchorForNthWeekday(frozen, n) {
  const weekday = frozen.getDay();
  const nextMonth = new Date(frozen.getFullYear(), frozen.getMonth() + 1, 1);
  return nthWeekdayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth(), weekday, n);
}

function makeDoc(task, date) {
  const now = new Date();
  // Pin to 05:30 UTC (IST midnight) so the planned date always displays
  // on the correct calendar day in India regardless of server timezone.
  // The task's own time of day (IST, "HH:MM") wins; blank falls back to the
  // old 11:00 AM IST default. IST = UTC+5:30, so subtract that offset.
  const [hh, mm] = /^\d{2}:\d{2}$/.test(task.startTime || "")
    ? task.startTime.split(":").map(Number)
    : [11, 0];
  const planned = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hh, mm) - (5 * 60 + 30) * 60000
  );
  return {
    doer: task.defaultAssignee,
    task: task._id,
    planned,
    actual: null,
    status: now > planned ? "Delayed" : "Pending",
  };
}

// Tops up Master (TaskInstance) rows for a single task, resuming from
// wherever generation last left off (task.nextAnchor) up to the schedule
// horizon. Safe to call repeatedly and safe to call concurrently — claims
// an advisory lock on the task first, so two near-simultaneous calls (e.g.
// a page-load top-up racing a manual "Generate Upcoming" click) can't both
// read the same resume point and double-insert the same occurrences.
//
// `options.skipBefore` (optional Date): occurrences planned before this
// moment are still walked (so the recurrence cadence stays exactly right)
// but not inserted (`options.clampToHorizon` also trims Yearly's fixed
// multi-year burst to the Schedule Horizon) — used by the PDF importer to load only today-onward
// reminders instead of a year of already-past, never-marked rows.
export async function generateOccurrencesForTask(task, settings, holidaySet, options = {}) {
  const skipBefore = options.skipBefore ? new Date(options.skipBefore) : null;
  if (!task.startDate || !task.defaultAssignee || task.active === false) {
    return { created: 0 };
  }

  const claimed = await Task.findOneAndUpdate(
    { _id: task._id, generating: { $ne: true } },
    { generating: true },
    { new: true }
  );
  // Another call already has this task locked — it'll finish the job, so
  // this call is simply a no-op rather than racing it.
  if (!claimed) return { created: 0, skipped: true };

  try {
    // YEARLY is a special case in the original script: a one-time burst of
    // 3-4 rows (this year if still upcoming, plus the next 3), no horizon
    // check and no working-day shift at all — not an ongoing rolling series.
    if (claimed.frequency === "Y") {
      const existing = await TaskInstance.countDocuments({ task: claimed._id });
      if (existing > 0) return { created: 0 };
      const docs = [];
      let anchor = new Date(claimed.startDate);
      const now = new Date();
      if (anchor > now) docs.push(makeDoc(claimed, anchor));
      for (let i = 0; i < 3; i++) {
        anchor = addYearsClamped(anchor, 1);
        docs.push(makeDoc(claimed, anchor));
      }
      if (skipBefore) {
        for (let i = docs.length - 1; i >= 0; i--) if (docs[i].planned < skipBefore) docs.splice(i, 1);
      }
      if (options.clampToHorizon && settings.scheduleHorizon) {
        // Horizon is end-of-day of the chosen date.
        const limit = new Date(new Date(settings.scheduleHorizon).getTime() + 24 * 3600 * 1000);
        for (let i = docs.length - 1; i >= 0; i--) if (docs[i].planned >= limit) docs.splice(i, 1);
      }
      if (docs.length) await TaskInstance.insertMany(docs);
      return { created: docs.length };
    }

    if (!settings.scheduleHorizon) return { created: 0, horizonMissing: true };
    const globalHorizon = new Date(settings.scheduleHorizon);
    const horizon = globalHorizon;
    const skipSundays = settings.skipSundays;

    let anchor = claimed.nextAnchor ? new Date(claimed.nextAnchor) : new Date(claimed.startDate);
    const docs = [];
    let iterations = 0;

    while (anchor <= horizon && docs.length < MAX_PER_TASK && iterations < MAX_WALK) {
      iterations++;
      const frozen = new Date(anchor);
      let occurrenceDate = null;
      let nextAnchor;

      if (claimed.frequency === "D") {
        // Daily never shifts to a nearby working day — it just silently
        // skips non-working days, cadence stays exactly 1 calendar day.
        if (isWorkingDay(anchor, holidaySet, skipSundays)) occurrenceDate = new Date(anchor);
        nextAnchor = addDays(frozen, 1);
      } else {
        occurrenceDate = shiftBackToWorkingDay(anchor, holidaySet, skipSundays);
        switch (claimed.frequency) {
          case "W":
            nextAnchor = addDays(frozen, 7);
            break;
          case "F":
            nextAnchor = addDays(frozen, 14);
            break;
          case "Q":
            nextAnchor = addMonthsClamped(frozen, 3);
            break;
          case "M":
            // Matches the original's January-specific fix: if the day is
            // past the 28th and we're in January, jump 2 months (skipping
            // February) instead of letting the clamp collapse the
            // day-of-month down to 28 for the rest of the year.
            nextAnchor = frozen.getMonth() === 0 && frozen.getDate() > 28
              ? addMonthsClamped(frozen, 2)
              : addMonthsClamped(frozen, 1);
            break;
          case "E1st":
            nextAnchor = nextAnchorForNthWeekday(frozen, 1);
            break;
          case "E2nd":
            nextAnchor = nextAnchorForNthWeekday(frozen, 2);
            break;
          case "E3rd":
            nextAnchor = nextAnchorForNthWeekday(frozen, 3);
            break;
          case "E4th":
            nextAnchor = nextAnchorForNthWeekday(frozen, 4);
            break;
          case "ELast":
            nextAnchor = nextAnchorForNthWeekday(frozen, -1);
            break;
          default:
            nextAnchor = addDays(frozen, 7);
        }
      }

      if (occurrenceDate) {
        const doc = makeDoc(claimed, occurrenceDate);
        if (!skipBefore || doc.planned >= skipBefore) docs.push(doc);
      }
      anchor = nextAnchor;
    }

    if (docs.length) await TaskInstance.insertMany(docs);
    await Task.findByIdAndUpdate(claimed._id, { nextAnchor: anchor });
    console.log(
      `[generate] "${claimed.taskName}" (${claimed.frequency}) -> ${docs.length} row(s) up to horizon ${globalHorizon.toISOString().slice(0, 10)}`
    );
    return { created: docs.length };
  } finally {
    // Always release the lock, even if generation threw partway through.
    await Task.findByIdAndUpdate(task._id, { generating: false });
  }
}

// One-time cleanup for duplicates created before the locking fix above
// existed — finds TaskInstance rows that are exact duplicates (same task +
// doer + planned time, still incomplete) and removes all but one of each
// group. Safe to run any time; a no-op once there's nothing left to clean.
export async function dedupeTaskInstances() {
  const duplicateGroups = await TaskInstance.aggregate([
    { $match: { actual: null } },
    {
      $group: {
        _id: { task: "$task", doer: "$doer", planned: "$planned" },
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  let removed = 0;
  for (const group of duplicateGroups) {
    const [, ...extras] = group.ids; // keep the first, drop the rest
    if (extras.length) {
      await TaskInstance.deleteMany({ _id: { $in: extras } });
      removed += extras.length;
    }
  }
  return { removed, groupsAffected: duplicateGroups.length };
}

// Tops up every active, schedule-driven task. Called on-demand (the
// "Generate Upcoming" button on Master) and once whenever Master loads.
export async function generateAllUpcoming() {
  const settings = await getSettings();
  const holidays = await Holiday.find().lean();
  const holidaySet = new Set(holidays.map((h) => dateKey(new Date(h.date))));

  const tasks = await Task.find({
    active: { $ne: false },
    startDate: { $ne: null },
    defaultAssignee: { $ne: null },
  });

  let created = 0;
  let horizonMissing = false;
  for (const task of tasks) {
    const result = await generateOccurrencesForTask(task, settings, holidaySet);
    created += result.created;
    if (result.horizonMissing) horizonMissing = true;
  }
  return { created, tasksChecked: tasks.length, horizonMissing };
}
