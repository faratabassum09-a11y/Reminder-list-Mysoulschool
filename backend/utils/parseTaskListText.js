// Reads the text of the "Reminder List - Task List" sheet (exported as PDF, or
// copied/pasted from Google Sheets) into task rows:
//
//   Task | Doer Name | Department | Frequency | Day/Date | Status
//
// PDF text extraction is messy — cells can arrive glued together with no space
// ("Customer SupportE3rd", "22:00:00Sent", "slackParidhi"), long task names wrap
// onto a second line — so this works from the END of each row backwards and
// uses the known people / departments to find the column boundaries.

export const FREQUENCIES = ["D", "W", "M", "Q", "Y", "F", "E1st", "E2nd", "E3rd", "E4th", "ELast"];
const DEFAULT_DEPARTMENTS = ["Operations", "Customer Support", "Social Media", "Admin", "Marketing"];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pad2 = (n) => String(n).padStart(2, "0");

// "... W 16/6/2025 22:00:00 Sent" (glue-tolerant; time and "Sent" optional)
const ROW_END = /(E1st|E2nd|E3rd|E4th|ELast|[DWMQYF])\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:(\d{1,2}):(\d{2})(?::\d{2})?)?\s*(?:Sent)?\s*$/;

function cleanName(s) {
  return s
    .replace(/''/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s*\[\d+\]\s*$/g, "") // footnote markers like "[2]"
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTaskListText(text, { doerNames = [], departments = [] } = {}) {
  const depts = [...new Set([...DEFAULT_DEPARTMENTS, ...departments.filter(Boolean)])].sort((a, b) => b.length - a.length);
  const doers = [...new Set(doerNames.filter(Boolean))].sort((a, b) => b.length - a.length);
  const deptRe = new RegExp(`(${depts.map(escapeRe).join("|")})\\s*$`, "i");

  const rows = [];
  const skipped = [];
  const sentMarkers = (String(text).match(/Sent\b/g) || []).length;
  let buffer = ""; // first line(s) of a task name that wrapped

  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (/^Task\s+Doer Name/i.test(t)) { buffer = ""; continue; } // column header
    if (/^\[\d+\]\s/.test(t)) continue; // footnotes
    const m = ROW_END.exec(t);
    if (!m) { buffer = buffer ? `${buffer} ${t}` : t; continue; }

    const full = `${buffer} ${t.slice(0, m.index)}`.trim();
    buffer = "";

    const dm = deptRe.exec(full);
    if (!dm) { skipped.push({ line: t, reason: "department not recognised" }); continue; }
    const rest = full.slice(0, dm.index).trimEnd();
    const lower = rest.toLowerCase();
    const doer = doers.find((d) => lower.endsWith(d.toLowerCase()));
    if (!doer) { skipped.push({ line: t, reason: "person not found in Doer List" }); continue; }
    const taskName = cleanName(rest.slice(0, rest.length - doer.length));
    if (!taskName) { skipped.push({ line: t, reason: "empty task name" }); continue; }

    const [, freq, dd, mm, yyyy, hh, mi] = m;
    rows.push({
      taskName,
      doerName: doer,
      department: depts.find((d) => d.toLowerCase() === dm[1].toLowerCase()) || dm[1],
      frequency: freq,
      startTime: hh !== undefined ? `${pad2(hh)}:${mi}` : "",
      dueDate: `${yyyy}-${pad2(mm)}-${pad2(dd)}`, // the sheet's "next due date"
    });
  }
  return { rows, skipped, sentMarkers };
}

// Turns pdf.js text items ({ str, x, y, w }) into text lines: items whose y is
// within a few points are one line, ordered left to right.
export function itemsToLines(items, tolerance = 3) {
  const sorted = items.filter((i) => i.str && i.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tolerance) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    let out = "";
    let prevEnd = null;
    for (const it of l.items) {
      if (prevEnd !== null && it.x - prevEnd > 0.5 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
      out += it.str;
      prevEnd = it.x + (it.w || 0);
    }
    return out;
  });
}
