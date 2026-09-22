// Shared date-range resolver for the Dashboard's time filters. Every range
// is computed in the server's local time zone and returns a [start, end)
// pair (end is exclusive) so callers can filter with a simple
// `{ $gte: start, $lt: end }` on TaskInstance.planned. Returns null for
// "all" (or an unrecognized key), meaning "no date filter".
export const RANGE_KEYS = [
  "all",
  "yesterday",
  "today",
  "thisWeek",
  "lastWeek",
  "nextWeek",
  "lastMonth",
  "year",
];

export const RANGE_LABELS = {
  all: "All Time",
  yesterday: "Yesterday",
  today: "Today",
  thisWeek: "This Week",
  lastWeek: "Last Week",
  nextWeek: "Next Week",
  lastMonth: "Last Month",
  year: "This Year",
};

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
// Week starts on Monday, matching most ops/reporting conventions.
function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(x, diff);
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}

export function resolveDateRange(key) {
  const now = new Date();
  switch (key) {
    case "yesterday": {
      const start = addDays(startOfDay(now), -1);
      return { start, end: startOfDay(now) };
    }
    case "today": {
      const start = startOfDay(now);
      return { start, end: addDays(start, 1) };
    }
    case "thisWeek": {
      const start = startOfWeek(now);
      return { start, end: addDays(start, 7) };
    }
    case "lastWeek": {
      const start = addDays(startOfWeek(now), -7);
      return { start, end: addDays(start, 7) };
    }
    case "nextWeek": {
      const start = addDays(startOfWeek(now), 7);
      return { start, end: addDays(start, 7) };
    }
    case "lastMonth": {
      const startThisMonth = startOfMonth(now);
      const start = new Date(startThisMonth.getFullYear(), startThisMonth.getMonth() - 1, 1);
      return { start, end: startThisMonth };
    }
    case "year": {
      const start = startOfYear(now);
      return { start, end: new Date(start.getFullYear() + 1, 0, 1) };
    }
    case "all":
    default:
      return null;
  }
}

// Builds a Mongo filter fragment for the `planned` field from a range key.
export function plannedFilterForRange(key) {
  const range = resolveDateRange(key);
  if (!range) return {};
  return { planned: { $gte: range.start, $lt: range.end } };
}
