// Turns rows copied straight from the Google Sheet task lists into template
// rows. The sheets keep their columns as: B Task | C Timeline | D Time |
// E Owner | F Score — copy B:F, or A:H to bring the Task ID and Description too
// (a header row is fine, it's skipped).
export function parseSheetPaste(text, doers = []) {
  const byName = new Map(doers.map((d) => [d.name.trim().toLowerCase(), d]));
  const rows = [];
  const unmatched = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let cells = (raw.includes("\t") ? raw.split("\t") : raw.split(",")).map((c) => c.trim().replace(/^"|"$/g, ""));
    // Whole task-list sheet copied (A:H): Task ID | Task | Timeline | Task Time | Owner | Score | (total) | Description
    let taskId = "";
    let description = "";
    if (/^[A-Za-z0-9]{2,5}-TS-\d+$/.test(cells[0] || "")) {
      taskId = cells[0].toUpperCase();
      description = cells[7] || "";
      cells = cells.slice(1);
    }
    const [task = "", timeline = "", time = "", owner = "", score = ""] = cells;
    if (!task || task.toLowerCase() === "task") continue;
    const doer = owner ? byName.get(owner.toLowerCase()) : null;
    if (owner && !doer) unmatched.add(owner);
    rows.push({
      key: Math.random().toString(36).slice(2),
      taskId,
      description,
      task,
      timeline: timeline || "T",
      time: normalizeTimeInput(time),
      doer: doer?._id || "",
      ownerName: doer ? "" : owner,
      score: Number(score) || 0,
    });
  }
  return { rows, unmatched: [...unmatched] };
}

export function normalizeTimeInput(value) {
  const s = String(value || "").trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/.exec(s);
  if (!m) return "";
  let h = Number(m[1]);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23) return "";
  return `${String(h).padStart(2, "0")}:${String(m[2] || "00").padStart(2, "0")}`;
}
