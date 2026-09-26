// Frequency codes match the backend's Task.frequency enum exactly — see
// backend/models/Task.js. FREQ_LABELS is the human-readable name for each
// code (used for display everywhere, and to pre-fill the edit input with
// something readable instead of a bare code like "E1st").
export const FREQ_LABELS = {
  D: "Daily",
  W: "Weekly",
  M: "Monthly",
  Q: "Quarterly",
  Y: "Yearly",
  F: "Fortnightly",
  E1st: "1st same weekday/mo",
  E2nd: "2nd same weekday/mo",
  E3rd: "3rd same weekday/mo",
  E4th: "4th same weekday/mo",
  ELast: "Last same weekday/mo",
};

// Shown as <datalist> suggestions under the free-text frequency input, so
// typing is still discoverable even though it's no longer a dropdown.
export const FREQ_SUGGESTIONS = [
  "Daily",
  "Weekly on Monday",
  "Weekly on Friday",
  "Fortnightly",
  "Monthly",
  "Quarterly",
  "Yearly",
  "1st Monday of month",
  "Last Friday of month",
];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ORDINAL_TO_CODE = {
  "1st": "E1st", first: "E1st",
  "2nd": "E2nd", second: "E2nd",
  "3rd": "E3rd", third: "E3rd",
  "4th": "E4th", fourth: "E4th",
  last: "ELast",
};

function capitalize(w) {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

// Turns free text like "daily", "weekly on monday", "1st monday of month",
// "every 2 weeks" into { code, label }, or null if nothing recognizable was
// typed. The weekday named alongside "weekly" is cosmetic (the actual
// cadence still comes from the schedule's start date) but is echoed back in
// the label so the admin can see what they typed was understood.
export function parseFrequencyInput(raw) {
  const text = (raw || "").trim().toLowerCase();
  if (!text) return null;

  const nthMatch = text.match(
    /\b(1st|first|2nd|second|3rd|third|4th|fourth|last)\b[^a-z]*\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/
  );
  if (nthMatch) {
    const code = ORDINAL_TO_CODE[nthMatch[1]];
    if (code) return { code, label: `${capitalize(nthMatch[1])} ${capitalize(nthMatch[2])} of month` };
  }

  if (/\bdaily\b|\bevery ?day\b/.test(text)) return { code: "D", label: "Daily" };

  if (/\bfortnightly\b|\bbi-?weekly\b|\bevery (other|2) weeks?\b/.test(text)) {
    return { code: "F", label: "Fortnightly" };
  }

  const everyWeekday = text.match(/\b(?:every|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (/\bweekly\b|\bevery week\b/.test(text) || everyWeekday) {
    const wd = everyWeekday?.[1] || WEEKDAYS.find((w) => text.includes(w));
    return { code: "W", label: wd ? `Weekly on ${capitalize(wd)}` : "Weekly" };
  }

  if (/\bquarterly\b|\bevery quarter\b|\bevery 3 months\b/.test(text)) return { code: "Q", label: "Quarterly" };
  if (/\bmonthly\b|\bevery month\b/.test(text)) return { code: "M", label: "Monthly" };
  if (/\byearly\b|\bannual(ly)?\b|\bevery year\b/.test(text)) return { code: "Y", label: "Yearly" };

  return null;
}
