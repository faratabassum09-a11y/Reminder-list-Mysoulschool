import express from "express";
import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";
import Doer from "../models/Doer.js";
import { reserveSeq } from "../models/WorkshopCounter.js";
import { getDoerMaps } from "../utils/lookups.js";
import { sendMail } from "../utils/mailer.js";

const router = express.Router();
// Mounted behind requireAuth + requireApp("reminder") in server.js.
//
// Who can see what:
//   member -> only tickets ASSIGNED to their own Doer record (Inbox) or
//             RAISED by it (Raised by me). A ticket raised to someone else
//             never appears for anyone but them, the raiser, and admins.
//   admin  -> everything, via box=all (the "Tickets Raised" page).
// Members are matched to a Doer by email, same pairing Master uses.

const STATUSES = ["Open", "In Progress", "Resolved"];
// "PC Accountable For Help Ticket" on the form only offers these two people.
// Matched on first name, case-insensitive. Override with TICKET_PC_NAMES
// (comma-separated) if the accountable people ever change.
const PC_NAMES = (process.env.TICKET_PC_NAMES || "Dolly,Paridhi")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const isValidId = (id) => mongoose.isValidObjectId(id);
const isAdmin = (req) => req.user?.role === "admin";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function myDoer(req) {
  const { byEmail } = await getDoerMaps();
  return byEmail.get(String(req.user.email || "").toLowerCase()) || null;
}

const isPc = (doer) => PC_NAMES.includes(String(doer?.name || "").trim().split(/\s+/)[0].toLowerCase());

const slim = (d) => (d ? { _id: d._id, name: d.name, department: d.department } : null);

// Turn a stored ticket into the API shape, resolving current doer info
// (falls back to the denormalized name if the doer no longer exists).
function shape(t, byId) {
  const pick = (id, fallbackName) => slim(byId.get(String(id))) || (fallbackName ? { _id: id, name: fallbackName, department: "" } : null);
  return {
    _id: t._id,
    ticketNo: t.ticketNo,
    issue: t.issue,
    status: t.status,
    plannedResolution: t.plannedResolution,
    resolutionNote: t.resolutionNote,
    resolvedAt: t.resolvedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    raisedBy: pick(t.raisedBy, t.raisedByName),
    assignedTo: pick(t.assignedTo, t.assignedToName),
    pcAccountable: t.pcAccountable ? pick(t.pcAccountable, t.pcAccountableName) : null,
  };
}

// ---------------------------------------------------------------- meta ---
// Everything the "Raise a ticket" form needs: who I am as a doer, who I can
// raise to, and who can be named as PC Accountable.
router.get("/meta", async (req, res) => {
  try {
    const [me, doers] = await Promise.all([
      myDoer(req),
      Doer.find({ active: { $ne: false } }).select("name department").sort({ name: 1 }).lean(),
    ]);
    res.json({
      me: slim(me),
      doers: doers.map(slim),
      pcDoers: doers.filter(isPc).map(slim),
      canPickRaiser: isAdmin(req),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------- counts ---
// Polled by the sidebar badge. `inbox` = tickets waiting on ME (not yet
// resolved). `open` (admin only) = every unresolved ticket in the system.
router.get("/count", async (req, res) => {
  try {
    const me = await myDoer(req);
    const [inbox, open] = await Promise.all([
      me ? Ticket.countDocuments({ assignedTo: me._id, status: { $ne: "Resolved" } }) : 0,
      isAdmin(req) ? Ticket.countDocuments({ status: { $ne: "Resolved" } }) : 0,
    ]);
    res.json({ inbox, open });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------- list ---
// box=inbox (default) | sent | all (admin only)
router.get("/", async (req, res) => {
  try {
    const box = ["inbox", "sent", "all"].includes(req.query.box) ? req.query.box : "inbox";
    if (box === "all" && !isAdmin(req)) return res.status(403).json({ error: "Admins only" });

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const q = (req.query.q || "").toString().trim();
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;

    const match = {};
    if (box !== "all") {
      const me = await myDoer(req);
      // No Doer record linked to this account -> nothing is addressed to
      // (or from) them. Empty list, not an error.
      if (!me) return res.json({ rows: [], total: 0, page, limit, pages: 1, summary: { Open: 0, "In Progress": 0, Resolved: 0 } });
      match[box === "inbox" ? "assignedTo" : "raisedBy"] = me._id;
    }
    if (status) match.status = status;

    // Calendar filter: ?dateFrom=<ISO>&dateTo=<ISO> (from inclusive, to
    // exclusive — same convention as Master). dateField picks which date
    // it applies to: when the ticket was raised, or its planned resolution.
    const dateField = req.query.dateField === "plannedResolution" ? "plannedResolution" : "createdAt";
    const from = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
    const to = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;
    if ((from && isNaN(from)) || (to && isNaN(to))) return res.status(400).json({ error: "Invalid date filter" });
    if (from || to) {
      match[dateField] = {};
      if (from) match[dateField].$gte = from;
      if (to) match[dateField].$lt = to;
    }

    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [{ issue: re }, { raisedByName: re }, { assignedToName: re }, { pcAccountableName: re }];
      const n = parseInt(q.replace(/^#/, ""), 10);
      if (!Number.isNaN(n)) match.$or.push({ ticketNo: n });
    }

    // Status counts for the summary chips honour the box + search but not
    // the status filter itself, so the chips stay meaningful when one is on.
    const { status: _s, ...matchNoStatus } = match;

    const [rows, total, grouped, { byId }] = await Promise.all([
      Ticket.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Ticket.countDocuments(match),
      Ticket.aggregate([{ $match: matchNoStatus }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
      getDoerMaps(),
    ]);

    const summary = { Open: 0, "In Progress": 0, Resolved: 0 };
    grouped.forEach((g) => { summary[g._id] = g.n; });

    res.json({
      rows: rows.map((t) => shape(t, byId)),
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
      summary,
    });
  } catch (err) {
    console.error("[tickets/]", err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------- create ---
router.post("/", async (req, res) => {
  try {
    const { raisedBy, assignedTo, pcAccountable, issue, plannedResolution } = req.body || {};
    const { byId } = await getDoerMaps();

    // Raised By: a member can only raise as themselves; an admin picks.
    let raiser;
    if (isAdmin(req)) {
      if (!raisedBy || !isValidId(raisedBy)) return res.status(400).json({ error: "Choose who is raising this ticket" });
      raiser = byId.get(String(raisedBy));
    } else {
      raiser = await myDoer(req);
      if (!raiser) return res.status(403).json({ error: "Your account isn't linked to a Doer, so you can't raise tickets. Ask an admin to add you to the Doer List with your login email." });
    }
    if (!raiser) return res.status(400).json({ error: "Raised By doer not found" });

    if (!assignedTo || !isValidId(assignedTo)) return res.status(400).json({ error: "Choose who this problem is assigned to" });
    const assignee = byId.get(String(assignedTo));
    if (!assignee || assignee.active === false) return res.status(400).json({ error: "Assigned To doer not found" });
    if (String(assignee._id) === String(raiser._id)) return res.status(400).json({ error: "You can't raise a ticket to yourself" });

    const text = String(issue || "").trim();
    if (!text) return res.status(400).json({ error: "Please describe the issue" });
    if (text.length > 4000) return res.status(400).json({ error: "Issue is too long (4000 characters max)" });

    let pc = null;
    if (pcAccountable) {
      if (!isValidId(pcAccountable)) return res.status(400).json({ error: "Invalid PC Accountable" });
      pc = byId.get(String(pcAccountable));
      if (!pc || !isPc(pc)) return res.status(400).json({ error: "PC Accountable must be one of the designated people" });
    }

    let planned = null;
    if (plannedResolution) {
      planned = new Date(plannedResolution);
      if (Number.isNaN(planned.getTime())) return res.status(400).json({ error: "Planned resolution date/time is invalid" });
    }

    const ticketNo = await reserveSeq("ticket");
    const ticket = await Ticket.create({
      ticketNo,
      raisedBy: raiser._id,
      assignedTo: assignee._id,
      pcAccountable: pc?._id || null,
      raisedByName: raiser.name,
      assignedToName: assignee.name,
      pcAccountableName: pc?.name || "",
      createdBy: req.user._id,
      issue: text,
      plannedResolution: planned,
    });

    // Tell the assignee by email — best effort only: if SMTP isn't set up
    // or Gmail is unreachable, the ticket is still created and shows in
    // their Inbox.
    if (assignee.email) {
      sendMail({
        to: assignee.email,
        subject: `Help Ticket #${ticketNo} from ${raiser.name}`,
        text:
          `${raiser.name} raised a help ticket to you.\n\n` +
          `Issue: ${text}\n` +
          (pc ? `PC accountable: ${pc.name}\n` : "") +
          (planned ? `Planned resolution: ${planned.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\n` : "") +
          `\nOpen the Reminder List app and go to Help Tickets to respond.`,
        html:
          `<p><strong>${esc(raiser.name)}</strong> raised a help ticket to you.</p>` +
          `<p><strong>Issue:</strong><br>${esc(text).replace(/\n/g, "<br>")}</p>` +
          (pc ? `<p><strong>PC accountable:</strong> ${esc(pc.name)}</p>` : "") +
          (planned ? `<p><strong>Planned resolution:</strong> ${esc(planned.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}</p>` : "") +
          `<p>Open the Reminder List app and go to <em>Help Tickets</em> to respond.</p>`,
      }).catch((err) => console.warn("[tickets] email failed:", err.message));
    }

    res.status(201).json(shape(ticket.toObject(), byId));
  } catch (err) {
    console.error("[tickets/create]", err);
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------------- update ----
// Status / resolution note / planned date — only by the person the ticket
// is assigned to, or an admin. The raiser can't mark their own ticket
// resolved.
router.patch("/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "Invalid ticket ID" });
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    const me = await myDoer(req);
    const isAssignee = me && String(ticket.assignedTo) === String(me._id);
    const isRaiser = me && String(ticket.raisedBy) === String(me._id);
    // Anyone who isn't involved gets a 404 so a ticket's existence isn't leaked.
    if (!isAdmin(req) && !isAssignee && !isRaiser) return res.status(404).json({ error: "Ticket not found" });
    if (!isAdmin(req) && !isAssignee) return res.status(403).json({ error: "Only the person this ticket is assigned to can update it" });

    const { status, resolutionNote, plannedResolution } = req.body || {};
    if (status !== undefined) {
      if (!STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
      ticket.status = status;
      ticket.resolvedAt = status === "Resolved" ? new Date() : null;
    }
    if (resolutionNote !== undefined) ticket.resolutionNote = String(resolutionNote || "").trim().slice(0, 2000);
    if (plannedResolution !== undefined) {
      if (plannedResolution === null || plannedResolution === "") ticket.plannedResolution = null;
      else {
        const d = new Date(plannedResolution);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Planned resolution date/time is invalid" });
        ticket.plannedResolution = d;
      }
    }
    await ticket.save();

    const { byId } = await getDoerMaps();
    res.json(shape(ticket.toObject(), byId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------- delete ---
// Admin: any ticket. Raiser: only their own, and only while still Open
// (a "withdraw" — once someone has started on it, it stays on record).
router.delete("/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "Invalid ticket ID" });
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    if (!isAdmin(req)) {
      const me = await myDoer(req);
      if (!me || String(ticket.raisedBy) !== String(me._id)) return res.status(404).json({ error: "Ticket not found" });
      if (ticket.status !== "Open") return res.status(403).json({ error: "This ticket is already being worked on, so it can't be withdrawn" });
    }
    await ticket.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
