// Shared date helpers for the Workshop PMS. Everything is shown in India
// time (the team's timezone) no matter where the browser is.
const TZ = "Asia/Kolkata";

const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" });
const dtFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
const dtYearFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

// Workshop start dates are calendar dates (stored at UTC midnight).
export const fmtDate = (v) => (v ? dateFmt.format(new Date(v)) : "—");
export const fmtWeekday = (v) => (v ? weekdayFmt.format(new Date(v)) : "");
// Task due / done times are real instants -> show in IST.
export const fmtDateTime = (v) => (v ? dtFmt.format(new Date(v)).replace(",", "") : "—");
export const fmtDateTimeYear = (v) => (v ? dtYearFmt.format(new Date(v)).replace(",", "") : "—");

export function fmtTime12(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

// "2025-01-06" (what <input type=date> gives) -> weekday name, TZ-safe.
export function dayNameFromYmd(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export const ymdOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "");

// Whole days from today (India date) to a stored calendar date.
export function daysUntil(v) {
  if (!v) return null;
  const todayIst = new Date(new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z");
  return Math.round((new Date(v).getTime() - todayIst.getTime()) / 86_400_000);
}

export function relativeDays(v) {
  const n = daysUntil(v);
  if (n === null) return "";
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

// "IST now" as a datetime-local value for the "mark done" picker.
export function nowLocalInput() {
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
  return p.replace(" ", "T");
}
// datetime-local (read as IST) -> ISO instant
export function istInputToIso(v) {
  return v ? new Date(`${v}:00+05:30`).toISOString() : undefined;
}

// Sheet-style formats (dd/mm/yyyy, hh:mm:ss) so the app reads like the Google Sheet.
const pad2 = (n) => String(n).padStart(2, "0");
// Calendar dates are stored at UTC midnight.
export const dmy = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};
// Real instants shown in India time.
export function dmyhms(v) {
  if (!v) return "";
  const d = new Date(new Date(v).getTime() + 330 * 60_000);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}
export const hms = (hhmm) => (hhmm ? `${hhmm}:00` : "");
// "T-7" -> "7 days before", "T" -> "on the workshop day"
export function timelineWords(tl) {
  const n = Number.parseInt(String(tl ?? "").replace(/t/i, "").replace("+", "").trim(), 10);
  if (!Number.isFinite(n) || n === 0) return "on the workshop day";
  return n < 0 ? `${-n} day${-n === 1 ? "" : "s"} before` : `${n} day${n === 1 ? "" : "s"} after`;
}
