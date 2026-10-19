// Posts a new Help Ticket to a Slack channel via an Incoming Webhook.
// Best effort only: if SLACK_WEBHOOK_URL is blank, or Slack is unreachable,
// it logs and returns — the ticket itself is already saved.
//
// Real @mentions in Slack need the person's Slack member ID, not their name.
// Preferred: set "Slack ID" on each person in the Doer List (stored as
// doer.slackId). Fallback: SLACK_USER_IDS env as JSON keyed by FIRST NAME
// (lowercase), e.g.
//   SLACK_USER_IDS={"dolly":"U01ABCDEF","fara":"U02GHIJKL","paridhi":"U03MNOPQR"}
// A person with no ID anywhere is posted as plain text (no ping), and a
// warning is logged so it's obvious why nobody was notified.

const USER_IDS = (() => {
  try {
    const raw = JSON.parse(process.env.SLACK_USER_IDS || "{}");
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), String(v).trim()]));
  } catch {
    console.warn("[slack] SLACK_USER_IDS is not valid JSON — mentions disabled");
    return {};
  }
})();

// Slack only treats these three characters as special in message text.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const firstName = (name) => String(name || "").trim().split(/\s+/)[0].toLowerCase();

// Accepts { name, slackId } (or a bare name string for old callers).
// "<@U123>" is a real ping; plain "@Fara" is just text and notifies nobody.
function mention(person) {
  const name = typeof person === "string" ? person : person?.name;
  if (!name) return "";
  let id = typeof person === "object" ? String(person.slackId || "").trim() : "";
  if (!id) id = USER_IDS[firstName(name)] || "";
  // Tolerate someone pasting "<@U123>" or "@U123" instead of the bare ID.
  id = id.replace(/^<?@/, "").replace(/>$/, "");
  if (/^[UW][A-Z0-9]{6,}$/i.test(id)) return `<@${id.toUpperCase()}>`;
  console.warn(`[slack] no valid Slack ID for "${name}" — they will NOT be pinged. Add it in Doer List.`);
  return `@${esc(name)}`;
}

// pc / assignedTo: { name, slackId } objects (strings still work, name only).
export async function notifyTicketSlack({ ticketNo, raisedBy, assignedTo, pc, issue, plannedResolution }) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { skipped: true };

  const planned = plannedResolution
    ? new Date(plannedResolution).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : "";

  const pcName = typeof pc === "object" ? pc?.name : pc;
  const assigneeName = typeof assignedTo === "object" ? assignedTo?.name : assignedTo;
  // Same person can be both PC and assignee — only ping once.
  const seen = new Set();
  const pings = [pc, assignedTo]
    .filter((p) => p && (typeof p === "string" ? p : p.name))
    .map(mention)
    .filter((m) => m && !seen.has(m) && seen.add(m))
    .join(" ");
  const lines = [
    `*New Help Ticket is filled* ${pings}`.trim(),
    "",
    `Ticket No : #${ticketNo}`,
    `Help Ticket Raised By : *${esc(raisedBy)}*`,
    "",
    `Issue : ${esc(issue)}`,
    "",
    `Assigned To : *${esc(assigneeName)}*`,
    pcName ? `PC : ${esc(pcName)}` : null,
    planned ? `Planned Resolution : ${planned}` : null,
  ].filter((l) => l !== null);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n"), link_names: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Slack replied ${res.status} ${await res.text().catch(() => "")}`);
    return { ok: true };
  } catch (err) {
    console.warn("[tickets] slack post failed:", err.message);
    return { ok: false, error: err.message };
  }
}
