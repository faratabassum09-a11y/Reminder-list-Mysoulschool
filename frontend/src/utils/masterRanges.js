// Date windows for the Master page filters and the assistant. Everything is
// computed in the person's own (browser) time zone and returned as a
// [from, to) pair — `to` is exclusive — which the backend applies to each
// task's Planned date. Weeks run Monday–Sunday, same as the Dashboard.

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function mondayOf(d) {
  const day = d.getDay(); // 0 = Sunday
  return addDays(startOfDay(d), day === 0 ? -6 : 1 - day);
}

export const QUICK_RANGES = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "lastWeek", label: "Last Week" },
  { key: "nextWeek", label: "Next Week" },
];

// Returns { from, to, label } for a quick-range key, or null if unknown.
export function quickRange(key, now = new Date()) {
  const today = startOfDay(now);
  switch (key) {
    case "today":
      return { from: today, to: addDays(today, 1), label: "today" };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 2), label: "tomorrow" };
    case "yesterday":
      return { from: addDays(today, -1), to: today, label: "yesterday" };
    case "thisWeek": {
      const mon = mondayOf(today);
      return { from: mon, to: addDays(mon, 7), label: "this week" };
    }
    case "lastWeek": {
      const mon = addDays(mondayOf(today), -7);
      return { from: mon, to: addDays(mon, 7), label: "last week" };
    }
    case "nextWeek": {
      const mon = addDays(mondayOf(today), 7);
      return { from: mon, to: addDays(mon, 7), label: "next week" };
    }
    case "upcoming": // the next 7 days, starting tomorrow
      return { from: addDays(today, 1), to: addDays(today, 8), label: "in the next 7 days" };
    default:
      return null;
  }
}

// "2026-09-28" (from <input type="date">) -> local midnight Date.
export function parseDateInput(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Turns the From/To calendar values into a [from, to) pair. The To date is
// INCLUSIVE from the person's point of view, so it's pushed to the start of
// the following day. Either side may be empty.
export function customRange(fromValue, toValue) {
  const from = parseDateInput(fromValue);
  const toDay = parseDateInput(toValue);
  return { from, to: toDay ? addDays(toDay, 1) : null };
}

export function rangeToParams(range) {
  const p = {};
  if (range?.from) p.plannedFrom = range.from.toISOString();
  if (range?.to) p.plannedTo = range.to.toISOString();
  return p;
}

export function formatRange(range) {
  const fmt = (d) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  if (!range?.from) return "";
  const last = addDays(range.to, -1);
  return last.getTime() === range.from.getTime() ? fmt(range.from) : `${fmt(range.from)} – ${fmt(last)}`;
}
