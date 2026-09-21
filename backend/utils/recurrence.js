import TaskInstance from "../models/TaskInstance.js";

export const GENERATION_HORIZON_DAYS = 90;
const MAX_INSTANCES_PER_PASS = 400;

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonthsClamped(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  const totalMonths = d.getMonth() + months;
  const year = d.getFullYear() + Math.floor(totalMonths / 12);
  const monthIndex = ((totalMonths % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInMonth(year, monthIndex));
  const result = new Date(d);
  result.setFullYear(year, monthIndex, clampedDay);
  result.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  return result;
}

function nthWeekdayOfMonth(year, monthIndex, weekday, n) {
  if (n === -1) {
    const last = new Date(year, monthIndex + 1, 0);
    const diff = (last.getDay() - weekday + 7) % 7;
    last.setDate(last.getDate() - diff);
    return last;
  }
  const first = new Date(year, monthIndex, 1);
  const firstWeekday = first.getDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  const result = new Date(year, monthIndex, day);
  if (result.getMonth() !== monthIndex) {
    return nthWeekdayOfMonth(year, monthIndex, weekday, -1);
  }
  return result;
}

const NTH_MAP = { E1st: 1, E2nd: 2, E3rd: 3, E4th: 4, ELast: -1 };

export function nextOccurrence(date, frequency) {
  const d = new Date(date);
  switch (frequency) {
    case "D":
      return addDays(d, 1);
    case "W":
      return addDays(d, 7);
    case "F":
      return addDays(d, 14);
    case "M":
      return addMonthsClamped(d, 1);
    case "Q":
      return addMonthsClamped(d, 3);
    case "Y":
      return addMonthsClamped(d, 12);
    case "E1st":
    case "E2nd":
    case "E3rd":
    case "E4th":
    case "ELast": {
      const weekday = d.getDay();
      let monthIndex = d.getMonth() + 1;
      let year = d.getFullYear();
      if (monthIndex > 11) {
        monthIndex = 0;
        year += 1;
      }
      const next = nthWeekdayOfMonth(year, monthIndex, weekday, NTH_MAP[frequency]);
      next.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
      return next;
    }
    default:
      return addDays(d, 1);
  }
}

export async function generateInstancesForTask(task, horizon) {
  if (!task.defaultAssignee) return { created: 0, reason: "no-default-assignee" };
  if (task.active === false) return { created: 0, reason: "inactive" };

  let cursor = new Date(task.nextDue || task.startDate || Date.now());
  const docs = [];

  while (cursor <= horizon && docs.length < MAX_INSTANCES_PER_PASS) {
    docs.push({ doer: task.defaultAssignee, task: task._id, planned: new Date(cursor) });
    cursor = nextOccurrence(cursor, task.frequency);
  }

  if (docs.length) {
    await TaskInstance.insertMany(docs);
  }

  task.nextDue = cursor;
  await task.save();

  return { created: docs.length };
}

export function defaultHorizon() {
  return addDays(new Date(), GENERATION_HORIZON_DAYS);
}