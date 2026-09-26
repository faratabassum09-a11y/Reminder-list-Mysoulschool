import express from "express";
import Doer from "../models/Doer.js";
import TaskInstance from "../models/TaskInstance.js";
import Notification from "../models/Notification.js";

const router = express.Router();

// Overridable via env so a model rename/deprecation on Google's side is a
// config change, not a code change. gemini-3.8-flash is the current fast/
// cheap general-purpose model — good fit for short conversational answers.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Static knowledge about the app itself — every page, what it's for, who
// can see it, and the couple of pieces of business logic (status/percent)
// that people actually ask about. This is what lets the model answer "what
// is X" / "how do I do Y" for the whole site, not just the few pages the
// rule-based matcher in Chatbot.jsx already covers verbatim.
const SITE_KNOWLEDGE = `
Ops Tracker is an internal MERN task/reminder tracking app. It replaces a
manual Google Sheet: recurring tasks are defined once and the system
auto-generates one row ("occurrence") per due date, which people then mark
done.

Pages:
- Dashboard (/): live totals (On Time / Delayed / Pending), a leaderboard,
  and a date-range picker (Today, This Week, Last Month, Year, etc). Not a
  separate sheet — it's a live rollup of Master.
- Master (/master): the full reminder log, one row per task occurrence,
  Planned vs Actual date and computed Status. Admins add new recurring
  tasks here (name, department, frequency, default assignee, start date).
  Anyone can mark their own occurrences done (optionally with a note,
  link, or screenshot as proof).
- Task List (/tasks): read-only catalog of recurring task *definitions*
  (the "what" and "how often"), not individual occurrences.
- Doer List (/doers): the roster of people tasks are assigned to (name,
  department, email, optional "buddy" backup). Doers are who tasks are
  for; Users are who can log in — not always the same set.
- Submission Log (/submissions): raw "marked done" event history,
  searchable, exportable as CSV.
- Notifications (/notifications, admin-only): inbox of "someone marked a
  task done" events; the sidebar bell shows the unread count.
- Settings (/settings, admin-only): schedule horizon (how far ahead
  occurrences are generated), whether Sundays are skipped, and the daily
  reminder email hour/toggle.
- Users (/users, admin-only): who can log in — name, email, role
  (admin/member), password.
- Account (/account): your own profile, password change, and (if you're a
  linked doer) your own performance breakdown.

Roles: "admin" sees and manages everything. "member" only sees their own
occurrences (matched to a Doer record by email) and cannot reach
Settings/Users/Notifications.

Status logic: an occurrence is "On Time" if marked done at/before its
planned date, "Delayed" if done after (or still open past the deadline),
"Pending" if not due yet. On-time rate = onTime ÷ total × 100, counting
only occurrences due up to today (future-scheduled ones don't drag the
score down before they're even due).
`.trim();

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

// Same shape/logic as GET /api/consolidated/me, duplicated locally rather
// than imported so this route has no dependency on the router file.
async function myPerformance(doerId) {
  const [row] = await TaskInstance.aggregate([
    { $match: { doer: doerId, planned: { $lt: endOfToday() } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        onTime: { $sum: { $cond: [{ $eq: ["$status", "On Time"] }, 1, 0] } },
        delayed: { $sum: { $cond: [{ $eq: ["$status", "Delayed"] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
      },
    },
  ]);
  const total = row?.total || 0;
  const onTime = row?.onTime || 0;
  const delayed = row?.delayed || 0;
  const pending = row?.pending || 0;
  return { total, onTime, delayed, pending, onTimePercent: total ? Math.round((onTime / total) * 1000) / 10 : 0 };
}

async function recentRows(filter, limit = 8) {
  const rows = await TaskInstance.find(filter)
    .populate("doer", "name department")
    .populate("task", "taskName department")
    .sort({ planned: -1 })
    .limit(limit)
    .lean();
  return rows.map((r) => ({
    task: r.task?.taskName || "Task",
    doer: r.doer?.name,
    department: r.task?.department || r.doer?.department,
    planned: r.planned?.toISOString().slice(0, 10),
    actual: r.actual ? r.actual.toISOString().slice(0, 10) : null,
    status: r.status,
  }));
}

// Builds a small, role-scoped JSON snapshot of this user's real data —
// same numbers the Dashboard/Account/Master pages would show them right
// now. Grounding the model in this (rather than letting it answer from
// nothing) is what keeps its answers honest instead of hallucinated.
async function buildContext(user) {
  const isAdmin = user.role === "admin";
  const ctx = {
    today: new Date().toISOString().slice(0, 10),
    you: { name: user.name, email: user.email, role: user.role },
  };

  if (!isAdmin) {
    const doer = await Doer.findOne({ email: user.email }).lean();
    if (!doer) {
      ctx.note = "This user has no linked Doer record, so they have no personal task data yet.";
      return ctx;
    }
    const [perf, completed, pending, delayed] = await Promise.all([
      myPerformance(doer._id),
      recentRows({ doer: doer._id, actual: { $ne: null } }, 8),
      recentRows({ doer: doer._id, status: "Pending" }, 8),
      recentRows({ doer: doer._id, status: "Delayed" }, 8),
    ]);
    ctx.yourPerformance = perf;
    ctx.yourRecentCompleted = completed;
    ctx.yourPendingTasks = pending;
    ctx.yourDelayedTasks = delayed;
    return ctx;
  }

  // Admin: team-wide numbers, per-person rollup (small collection, safe to
  // send in full), and a slice of the highest-signal recent activity.
  const [doers, statusCounts, unreadNotifs] = await Promise.all([
    Doer.find().select("name department").lean(),
    TaskInstance.aggregate([
      { $match: { planned: { $lt: endOfToday() } } },
      {
        $group: {
          _id: "$doer",
          total: { $sum: 1 },
          onTime: { $sum: { $cond: [{ $eq: ["$status", "On Time"] }, 1, 0] } },
          delayed: { $sum: { $cond: [{ $eq: ["$status", "Delayed"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
        },
      },
    ]),
    Notification.countDocuments({ read: false }),
  ]);
  const doerMap = new Map(doers.map((d) => [String(d._id), d]));
  const perPerson = statusCounts
    .map((r) => {
      const d = doerMap.get(String(r._id));
      if (!d) return null;
      return {
        name: d.name,
        department: d.department,
        total: r.total,
        onTime: r.onTime,
        delayed: r.delayed,
        pending: r.pending,
        onTimePercent: r.total ? Math.round((r.onTime / r.total) * 1000) / 10 : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.onTimePercent - a.onTimePercent);

  const teamTotals = perPerson.reduce(
    (acc, p) => ({ total: acc.total + p.total, onTime: acc.onTime + p.onTime, delayed: acc.delayed + p.delayed, pending: acc.pending + p.pending }),
    { total: 0, onTime: 0, delayed: 0, pending: 0 }
  );

  const [recentDelayed, recentPending, recentCompleted] = await Promise.all([
    recentRows({ status: "Delayed" }, 8),
    recentRows({ status: "Pending", planned: { $lt: endOfToday() } }, 8),
    recentRows({ actual: { $ne: null } }, 8),
  ]);

  ctx.teamTotals = teamTotals;
  ctx.perPersonRollup = perPerson;
  ctx.unreadNotifications = unreadNotifs;
  ctx.recentDelayed = recentDelayed;
  ctx.recentPendingDueAlready = recentPending;
  ctx.recentCompleted = recentCompleted;
  return ctx;
}

function buildSystemPrompt(user, contextSnapshot) {
  return (
    `You are Ozzy 🦉, the friendly assistant embedded in Ops Tracker, an internal task/reminder tracking web app. ` +
    `You're talking to ${user.name} (${user.role}).\n\n` +
    `=== SITE KNOWLEDGE (how the app works) ===\n${SITE_KNOWLEDGE}\n\n` +
    `=== LIVE DATA SNAPSHOT (this user's real data, just fetched — treat as ground truth) ===\n${JSON.stringify(contextSnapshot, null, 2)}\n\n` +
    `Rules:\n` +
    `- If asked who you are, your name, or who made/built/developed you, answer exactly: "I'm Ozzy, developed by Fara." Keep it to that one line unless they ask a genuine follow-up.\n` +
    `- Answer using the live data snapshot whenever the question is about tasks, numbers, people, or status. Never invent a number, name, or date that isn't in the snapshot.\n` +
    `- If something is asked that the snapshot doesn't cover (e.g. a person not listed, older history than what's shown), say plainly that you don't have that in view right now and name the page where they could check it, instead of guessing.\n` +
    `- You cannot take actions (can't mark a task done, change data, or send email) — you can only inform. If asked to do something, explain how they'd do it themselves on the relevant page.\n` +
    `- Keep answers short: a few sentences or a short bullet list. No markdown headers, no code blocks.\n` +
    `- A member only ever sees their own data — never imply visibility into other people's tasks.\n` +
    `- If the question has nothing to do with the site (general knowledge, small talk, etc.), it's fine to just answer it naturally and briefly.`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini's free tier occasionally returns 429 (rate limit) or 503 (model
// overloaded) — both are transient, not something wrong with our request,
// so they're worth one or two quick retries before giving up. Anything
// else (bad request, auth, etc) fails immediately since retrying won't help.
async function callGemini(apiKey, body, { attempts = 3, timeoutMs = 20_000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) return { ok: true, data: await res.json() };

      const errText = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status === 503;
      if (!retryable || i === attempts - 1) {
        return { ok: false, status: res.status, errText };
      }
      lastErr = { status: res.status, errText };
      await sleep(600 * Math.pow(2, i)); // 600ms, 1200ms, ...
    } catch (err) {
      clearTimeout(timer);
      // Network error or our own timeout firing — also worth a retry.
      if (i === attempts - 1) return { ok: false, status: 0, errText: err.message };
      lastErr = { status: 0, errText: err.message };
      await sleep(600 * Math.pow(2, i));
    }
  }
  return { ok: false, status: lastErr?.status || 0, errText: lastErr?.errText || "unknown error" };
}

router.post("/ask", async (req, res) => {
  const message = (req.body?.message || "").toString().trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: "Message is required" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.json({
      text: "AI-powered answers aren't turned on yet for this site — an admin needs to set GEMINI_API_KEY on the backend. I can still help with the usual questions in the meantime!",
    });
  }

  // Last few turns only — enough for follow-up questions ("what about
  // delayed ones?") without the payload growing unbounded.
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];

  try {
    const contextSnapshot = await buildContext(req.user);
    const systemPrompt = buildSystemPrompt(req.user, contextSnapshot);

    const contents = [
      ...history
        .filter((h) => h && typeof h.text === "string" && (h.role === "user" || h.role === "bot"))
        .map((h) => ({ role: h.role === "bot" ? "model" : "user", parts: [{ text: h.text.slice(0, 2000) }] })),
      { role: "user", parts: [{ text: message }] },
    ];

    const result = await callGemini(apiKey, {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
    });

    if (!result.ok) {
      console.error("[chatbot] Gemini API error after retries:", result.status, String(result.errText).slice(0, 500));
      const text =
        result.status === 503 || result.status === 429
          ? "My AI brain is getting slammed with requests right now — give it a few seconds and try again."
          : "I couldn't reach my AI brain just now — try again in a moment, or ask me one of the usual questions.";
      return res.json({ text });
    }

    const text = (result.data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.json({ text: "I didn't quite get an answer for that — could you rephrase, or try a more specific question?" });
    }
    res.json({ text });
  } catch (err) {
    console.error("[chatbot] /ask failed:", err.message);
    res.json({ text: "Something went wrong answering that — try again in a moment." });
  }
});

export default router;
