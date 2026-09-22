// Shared date-range pills used by the Dashboard (team-wide) and the
// Account page's "Your Performance" section (personal). Value "" means
// all-time (no ?range= sent) — every other value maps to a keyword the
// backend's getDateRange() understands (see routes/consolidated.js).
export const RANGES = [
  { value: "", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "thisWeek", label: "This Week" },
  { value: "lastWeek", label: "Last Week" },
  { value: "nextWeek", label: "Next Week" },
  { value: "lastMonth", label: "Last Month" },
  { value: "year", label: "This Year" },
];

// A shorter set for tighter spaces (the Account page's performance card),
// where the full 8-pill row would crowd a narrower panel.
export const COMPACT_RANGES = [
  { value: "", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This Week" },
  { value: "lastMonth", label: "Last Month" },
  { value: "year", label: "This Year" },
];
