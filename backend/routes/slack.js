import express from "express";
import crypto from "crypto";
import { URLSearchParams } from "url";
import Ticket from "../models/Ticket.js";
import Doer from "../models/Doer.js";
import { resolveSlackId, respondToInteraction, buildUpdatedMessage, buildClosedNote } from "../utils/slack.js";
import { runTicketReminders, inReminderWindow } from "../utils/ticketReminders.js";

// Mounted in server.js BEFORE express.json(), because Slack signs the exact
// raw request body and we must verify those bytes untouched.
const router = express.Router();
router.use(express.raw({ type: "*/*", limit: "1mb" }));

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function verifySlack(req) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return { ok: false, status: 503, error: "SLACK_SIGNING_SECRET is not set on the server" };
  const ts = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  if (!ts || !sig || !Buffer.isBuffer(req.body)) return { ok: false, status: 401, error: "Missing Slack signature" };
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return { ok: false, status: 401, error: "Stale request" }; // replay guard
  const expected = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${req.body.toString("utf8")}`).digest("hex");
  return safeEqual(expected, sig) ? { ok: true } : { ok: false, status: 401, error: "Bad signature" };
}

const ephemeral = (text) => ({ response_type: "ephemeral", replace_original: false, text });

// Slack user -> Doer, via the Slack ID stored on the Doer (or SLACK_USER_IDS fallback).
async function doerForSlackUser(slackUserId) {
  const doers = await Doer.find({ active: { $ne: false } }).lean();
  return doers.find((d) => resolveSlackId(d) === String(slackUserId).toUpperCase()) || null;
}

async function handleAction(payload) {
  const responseUrl = payload.response_url;
  const action = (payload.actions || [])[0];
  if (!action || !responseUrl) return;
  const kind = action.action_id === "ticket_resolved" ? "Resolved" : action.action_id === "ticket_ongoing" ? "In Progress" : null;
  if (!kind) return;

  const clicker = await doerForSlackUser(payload.user?.id);
  if (!clicker) {
    return respondToInteraction(responseUrl, ephemeral("I can't tell who you are — ask an admin to add your Slack ID in the Doer List, then try again."));
  }

  if (!/^[a-f0-9]{24}$/i.test(String(action.value))) return;
  const ticket = await Ticket.findById(action.value);
  if (!ticket) {
    return respondToInteraction(responseUrl, { replace_original: true, ...buildClosedNote("This help ticket no longer exists.") });
  }

  // Same rule as the website: ONLY the assignee may update it (not admins).
  if (String(ticket.assignedTo) !== String(clicker._id)) {
    return respondToInteraction(responseUrl, ephemeral(`Only ${ticket.assignedToName || "the assignee"} can update ticket #${ticket.ticketNo}.`));
  }

  // Already closed on the website? Don't reopen it from a stale Slack button.
  if (ticket.status === "Resolved" && kind !== "Resolved") {
    return respondToInteraction(responseUrl, {
      replace_original: true,
      ...buildUpdatedMessage({ ticket: ticket.toObject(), assignedTo: { name: ticket.assignedToName }, pc: { name: ticket.pcAccountableName }, status: "Resolved", actorName: "" }),
    });
  }

  if (ticket.status !== kind) {
    ticket.status = kind;
    ticket.resolvedAt = kind === "Resolved" ? new Date() : null;
    if (kind === "Resolved" && !ticket.resolutionNote) ticket.resolutionNote = `Marked resolved from Slack by ${clicker.name}.`;
  }
  ticket.lastUpdatedVia = `Slack (${clicker.name})`;
  await ticket.save();

  const [assignee, pc] = await Promise.all([
    Doer.findById(ticket.assignedTo).lean(),
    ticket.pcAccountable ? Doer.findById(ticket.pcAccountable).lean() : null,
  ]);
  await respondToInteraction(responseUrl, {
    replace_original: true,
    ...buildUpdatedMessage({
      ticket: ticket.toObject(),
      assignedTo: { name: assignee?.name || ticket.assignedToName, slackId: assignee?.slackId },
      pc: pc ? { name: pc.name, slackId: pc.slackId } : { name: ticket.pcAccountableName },
      status: kind,
      actorName: clicker.name,
    }),
  });
}

// Slack posts button clicks here (Interactivity -> Request URL).
router.post("/interactions", (req, res) => {
  const v = verifySlack(req);
  if (!v.ok) return res.status(v.status).json({ error: v.error });

  let payload;
  try {
    payload = JSON.parse(new URLSearchParams(req.body.toString("utf8")).get("payload") || "");
  } catch {
    return res.status(400).json({ error: "Bad payload" });
  }
  // Slack requires an answer within 3 seconds — acknowledge now, work after.
  res.status(200).end();
  if (payload.type !== "block_actions") return;
  handleAction(payload).catch((err) => console.error("[slack/interactions]", err));
});

// For an external scheduler (Render free tier sleeps, so in-process cron can
// miss its hour): GET/POST /api/slack/reminders?key=<TICKET_CRON_SECRET>.
// Honors the 9:00–21:00 IST window unless &force=1.
router.all("/reminders", async (req, res) => {
  const secret = process.env.TICKET_CRON_SECRET;
  const key = String(req.query.key || req.headers["x-cron-key"] || "");
  if (!secret) return res.status(503).json({ error: "TICKET_CRON_SECRET is not set" });
  if (!safeEqual(key, secret)) return res.status(401).json({ error: "Bad key" });
  try {
    if (req.query.force !== "1" && !inReminderWindow()) return res.json({ skipped: "outside reminder hours" });
    res.json(await runTicketReminders());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
