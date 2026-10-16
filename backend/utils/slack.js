// Posts a new Help Ticket to a Slack channel via an Incoming Webhook.
// Best effort only: if SLACK_WEBHOOK_URL is blank, or Slack is unreachable,
// it logs and returns — the ticket itself is already saved.
//
// Real @mentions in Slack need the person's Slack member ID, not their name.
// Put them in SLACK_USER_IDS as JSON keyed by FIRST NAME (lowercase), e.g.
//   SLACK_USER_IDS={"dolly":"U01ABCDEF","fara":"U02GHIJKL","paridhi":"U03MNOPQR"}
// A name with no ID is posted as plain text (no ping).

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

// "@Fara" as a real mention when we know the ID, otherwise plain "@Fara".
function mention(name) {
  if (!name) return "";
  const id = USER_IDS[firstName(name)];
  return id ? `<@${id}>` : `@${esc(name)}`;
}

export async function notifyTicketSlack({ ticketNo, raisedBy, assignedTo, pc, issue, plannedResolution }) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { skipped: true };

  const planned = plannedResolution
    ? new Date(plannedResolution).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : "";

  const pings = [pc, assignedTo].filter(Boolean).map(mention).join(" ");
  const lines = [
    `*New Help Ticket is filled* ${pings}`.trim(),
    "",
    `Ticket No : #${ticketNo}`,
    `Help Ticket Raised By : *${esc(raisedBy)}*`,
    "",
    `Issue : ${esc(issue)}`,
    "",
    `Assigned To : *${esc(assignedTo)}*`,
    pc ? `PC : ${esc(pc)}` : null,
    planned ? `Planned Resolution : ${planned}` : null,
  ].filter((l) => l !== null);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Slack replied ${res.status} ${await res.text().catch(() => "")}`);
    return { ok: true };
  } catch (err) {
    console.warn("[tickets] slack post failed:", err.message);
    return { ok: false, error: err.message };
  }
}
