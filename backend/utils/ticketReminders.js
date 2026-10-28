// Help Ticket reminders -> Slack.
//
// For every ticket that is still Open or In Progress AND has a planned
// resolution date:
//   * DAY BEFORE : planned date (IST calendar day) is tomorrow -> one
//                  "due tomorrow" post, @-pinging the assignee.
//   * OVERDUE    : planned time has passed -> one post per IST day until the
//                  ticket is resolved, @-pinging the assignee.
// Both posts carry "Still Ongoing" / "Resolved" buttons (see routes/slack.js).
//
// Exactly-once: each reminder is CLAIMED with an atomic conditional update
// before posting, so two server instances (or a restart mid-run) can never
// double-send. If the Slack post fails, the claim is rolled back and the next
// run retries.
//
// Tickets with no planned resolution date are never reminded (nothing to be
// "late" against).

import Ticket from "../models/Ticket.js";
import { getDoerMaps } from "./lookups.js";
import { buildTicketMessage, postToSlack, slackEnabled } from "./slack.js";

const IST_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;
const istKey = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const istHour = (d) => new Date(new Date(d).getTime() + IST_MS).getUTCHours();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const REMINDER_START_HOUR = Math.min(Math.max(parseInt(process.env.TICKET_REMINDER_HOUR ?? "9", 10) || 9, 0), 23);
// Don't wake people at night if the server only comes back late.
export const REMINDER_END_HOUR = 21;

export function inReminderWindow(now = new Date()) {
  const h = istHour(now);
  return h >= REMINDER_START_HOUR && h < REMINDER_END_HOUR;
}

const person = (doer, fallbackName) => ({ name: doer?.name || fallbackName || "", slackId: doer?.slackId || "" });

async function sendOne(kind, ticket, claimFilter, claimSet, rollbackSet, byId, now) {
  // Atomic claim — only one caller wins.
  const claimed = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: { $ne: "Resolved" }, ...claimFilter },
    { $set: claimSet },
    { new: true }
  ).lean();
  if (!claimed) return "skipped";

  const msg = buildTicketMessage(kind, {
    ticket: claimed,
    assignedTo: person(byId.get(String(claimed.assignedTo)), claimed.assignedToName),
    pc: claimed.pcAccountable ? person(byId.get(String(claimed.pcAccountable)), claimed.pcAccountableName) : null,
    now,
  });
  const r = await postToSlack(msg);
  if (r.ok) return "sent";
  await Ticket.updateOne({ _id: ticket._id }, { $set: rollbackSet }); // retry next run
  return "failed";
}

/**
 * Scan and post due reminders. Safe to call as often as you like.
 * Returns counts: { dueSoon, overdue, failed, checked, skipped? }
 */
export async function runTicketReminders({ now = new Date() } = {}) {
  if (!slackEnabled()) return { skipped: "SLACK_WEBHOOK_URL not set", dueSoon: 0, overdue: 0, failed: 0, checked: 0 };

  const todayKey = istKey(now);
  const tomorrowKey = istKey(new Date(now.getTime() + DAY_MS));

  const candidates = await Ticket.find({
    status: { $in: ["Open", "In Progress"] },
    plannedResolution: { $ne: null, $lt: new Date(now.getTime() + 2 * DAY_MS) },
  }).lean();

  const { byId } = await getDoerMaps();
  const out = { dueSoon: 0, overdue: 0, failed: 0, checked: candidates.length };
  let posted = 0;

  for (const t of candidates) {
    const planned = new Date(t.plannedResolution);
    const plannedIso = planned.toISOString();
    let result = null;

    if (planned.getTime() < now.getTime()) {
      if (t.lastOverdueReminderOn !== todayKey) {
        result = await sendOne(
          "overdue", t,
          { lastOverdueReminderOn: { $ne: todayKey } },
          { lastOverdueReminderOn: todayKey },
          { lastOverdueReminderOn: t.lastOverdueReminderOn || "" },
          byId, now
        );
        if (result === "sent") out.overdue++;
      }
    } else if (istKey(planned) === tomorrowKey && t.dueSoonRemindedFor !== plannedIso) {
      result = await sendOne(
        "dueSoon", t,
        { dueSoonRemindedFor: { $ne: plannedIso }, plannedResolution: planned },
        { dueSoonRemindedFor: plannedIso },
        { dueSoonRemindedFor: t.dueSoonRemindedFor || "" },
        byId, now
      );
      if (result === "sent") out.dueSoon++;
    }

    if (result === "failed") out.failed++;
    if (result === "sent" || result === "failed") {
      posted++;
      await sleep(1100); // Slack webhooks allow ~1 message/second
    }
  }

  if (posted) console.log(`[ticket-reminders] due-tomorrow: ${out.dueSoon}, overdue: ${out.overdue}, failed: ${out.failed}`);
  return out;
}
