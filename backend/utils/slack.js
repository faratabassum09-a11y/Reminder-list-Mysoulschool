// Slack integration for Help Tickets.
//
//  * New ticket              -> posted to the channel (with action buttons)
//  * Due tomorrow reminder   -> posted to the channel, @-pings the assignee
//  * Overdue reminder (daily)-> posted to the channel, @-pings the assignee
//  * Button clicks in Slack  -> handled by routes/slack.js, which updates the
//                               ticket in the database (so the website shows it)
//
// Posting uses the Incoming Webhook (SLACK_WEBHOOK_URL). Buttons only work if
// the Slack app that owns that webhook has *Interactivity* switched on, with
// its Request URL set to  https://<your-backend>/api/slack/interactions  and
// SLACK_SIGNING_SECRET set in the backend env. See README ("Slack reminders").
//
// Real @mentions need the person's Slack member ID, not their name.
// Preferred: set "Slack ID" on each person in the Doer List (doer.slackId).
// Fallback: SLACK_USER_IDS env as JSON keyed by FIRST NAME (lowercase), e.g.
//   SLACK_USER_IDS={"dolly":"U01ABCDEF","fara":"U02GHIJKL"}
// A person with no ID anywhere is posted as plain text (no ping) and a
// warning is logged.

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
const fmtIST = (d) =>
  new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export const slackEnabled = () => Boolean(process.env.SLACK_WEBHOOK_URL);

// Bare member ID ("U01ABCDEF") for a { name, slackId } person, or "".
// Tolerates "<@U123>" / "@U123" pasted instead of the bare ID.
export function resolveSlackId(person) {
  const name = typeof person === "string" ? person : person?.name;
  let id = typeof person === "object" && person ? String(person.slackId || "").trim() : "";
  if (!id && name) id = USER_IDS[firstName(name)] || "";
  id = id.replace(/^<?@/, "").replace(/>$/, "");
  return /^[UW][A-Z0-9]{6,}$/i.test(id) ? id.toUpperCase() : "";
}

// "<@U123>" is a real ping; plain "@Fara" is just text and notifies nobody.
export function mention(person) {
  const name = typeof person === "string" ? person : person?.name;
  if (!name) return "";
  const id = resolveSlackId(person);
  if (id) return `<@${id}>`;
  console.warn(`[slack] no valid Slack ID for "${name}" — they will NOT be pinged. Add it in Doer List.`);
  return `@${esc(name)}`;
}

const nameOf = (p) => (typeof p === "object" ? p?.name : p) || "";

// ---------------------------------------------------------------- blocks ---
// Buttons carry only the ticket's database id. Who may press them is checked
// server-side in routes/slack.js — never trust the button itself.
function actionButtons(ticketId, { ongoingLabel = "Still Ongoing", showOngoing = true } = {}) {
  const elements = [];
  if (showOngoing) {
    elements.push({
      type: "button",
      action_id: "ticket_ongoing",
      text: { type: "plain_text", text: ongoingLabel, emoji: true },
      value: String(ticketId),
    });
  }
  elements.push({
    type: "button",
    action_id: "ticket_resolved",
    style: "primary",
    text: { type: "plain_text", text: "Resolved", emoji: true },
    value: String(ticketId),
    confirm: {
      title: { type: "plain_text", text: "Mark as resolved?" },
      text: { type: "plain_text", text: "This closes the ticket on the website too." },
      confirm: { type: "plain_text", text: "Yes, resolved" },
      deny: { type: "plain_text", text: "Cancel" },
    },
  });
  return { type: "actions", block_id: `ticket_actions_${ticketId}`, elements };
}

const section = (text) => ({ type: "section", text: { type: "mrkdwn", text: String(text).slice(0, 2900) } });

function detailLines({ ticket, assignedTo, pc }) {
  const issue = String(ticket.issue || "");
  return [
    `Ticket No : #${ticket.ticketNo}`,
    `Help Ticket Raised By : *${esc(ticket.raisedByName || nameOf(ticket.raisedBy))}*`,
    "",
    `Issue : ${esc(issue.length > 1500 ? issue.slice(0, 1500) + "…" : issue)}`,
    "",
    `Assigned To : *${esc(nameOf(assignedTo) || ticket.assignedToName)}*`,
    nameOf(pc) ? `PC : ${esc(nameOf(pc))}` : null,
    ticket.plannedResolution ? `Planned Resolution : ${fmtIST(ticket.plannedResolution)}` : null,
  ].filter((l) => l !== null);
}

const uniquePings = (people) => {
  const seen = new Set();
  return people
    .filter((p) => p && nameOf(p))
    .map(mention)
    .filter((m) => m && !seen.has(m) && seen.add(m))
    .join(" ");
};

// Whole-day difference between two instants, measured on the IST calendar.
const IST_MS = 330 * 60 * 1000;
const istDay = (d) => Math.floor((new Date(d).getTime() + IST_MS) / 86_400_000);
export const daysOverdue = (planned, now = new Date()) => Math.max(istDay(now) - istDay(planned), 0);

/**
 * kind: "new" | "dueSoon" | "overdue"
 * ticket: plain ticket doc (needs _id, ticketNo, issue, raisedByName, ...)
 * assignedTo / pc: { name, slackId }
 */
export function buildTicketMessage(kind, { ticket, assignedTo, pc, now = new Date() }) {
  const lines = detailLines({ ticket, assignedTo, pc });
  let headline, fallback;

  if (kind === "dueSoon") {
    const pings = uniquePings([assignedTo]);
    headline = `⏰ *Help Ticket due tomorrow* ${pings}`.trim();
    fallback = `Help Ticket #${ticket.ticketNo} is due tomorrow (${nameOf(assignedTo)})`;
    lines.push("", `Status : ${ticket.status}`, "_Please update it below once there is progress._");
  } else if (kind === "overdue") {
    const n = daysOverdue(ticket.plannedResolution, now);
    const pings = uniquePings([assignedTo]);
    headline = `🚨 *Help Ticket OVERDUE${n ? ` by ${n} day${n === 1 ? "" : "s"}` : ""}* ${pings}`.trim();
    fallback = `Help Ticket #${ticket.ticketNo} is overdue (${nameOf(assignedTo)})`;
    lines.push("", `Status : ${ticket.status}`, "_Is it still ongoing, or already resolved? Tap a button below._");
  } else {
    const pings = uniquePings([pc, assignedTo]);
    headline = `*New Help Ticket is filled* ${pings}`.trim();
    fallback = `New Help Ticket #${ticket.ticketNo} for ${nameOf(assignedTo)}`;
  }

  const blocks = [section(headline), section(lines.join("\n"))];
  blocks.push(
    kind === "new"
      ? actionButtons(ticket._id, { ongoingLabel: "In Progress" })
      : actionButtons(ticket._id, { showOngoing: true })
  );
  return { text: fallback, blocks };
}

// What the original message becomes after someone presses a button.
export function buildUpdatedMessage({ ticket, assignedTo, pc, status, actorName }) {
  const lines = detailLines({ ticket, assignedTo, pc });
  const by = actorName ? ` by *${esc(actorName)}*` : "";
  if (status === "Resolved") {
    lines.push("", `✅ *Resolved*${by} — updated on the website.`);
    return {
      text: `Help Ticket #${ticket.ticketNo} resolved`,
      blocks: [section(`✅ *Help Ticket #${ticket.ticketNo} — Resolved*`), section(lines.join("\n"))],
    };
  }
  lines.push("", `🔄 *Still ongoing*${by} — status set to *In Progress* on the website.`);
  return {
    text: `Help Ticket #${ticket.ticketNo} still ongoing`,
    blocks: [
      section(`🔄 *Help Ticket #${ticket.ticketNo} — In Progress*`),
      section(lines.join("\n")),
      // Keep a Resolved button so it can be closed straight from here later.
      actionButtons(ticket._id, { showOngoing: false }),
    ],
  };
}

export function buildClosedNote(text) {
  return { text, blocks: [section(text)] };
}

// ------------------------------------------------------------------ post ---
export async function postToSlack(payload) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { skipped: true };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Slack replied ${res.status} ${await res.text().catch(() => "")}`);
    return { ok: true };
  } catch (err) {
    console.warn("[slack] post failed:", err.message);
    return { ok: false, error: err.message };
  }
}

// Answer a button click by editing / replying to the original message.
export async function respondToInteraction(responseUrl, payload) {
  try {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Slack replied ${res.status}`);
  } catch (err) {
    console.warn("[slack] response_url failed:", err.message);
  }
}

// New ticket just raised. `ticket` must be the saved document (plain object).
export function notifyTicketSlack({ ticket, assignedTo, pc }) {
  return postToSlack(buildTicketMessage("new", { ticket, assignedTo, pc }));
}
