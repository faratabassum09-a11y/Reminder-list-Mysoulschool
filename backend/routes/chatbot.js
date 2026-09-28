import express from "express";
import Doer from "../models/Doer.js";
import TaskInstance from "../models/TaskInstance.js";
import Notification from "../models/Notification.js";

const router = express.Router();

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─── PER-USER RATE LIMITER ──────────────────────────────────────────────────
// Gemini free tier = 15 req/min globally. With multiple users hitting at once,
// they burn through the quota fast. This queue serialises requests per user
// AND applies a global token bucket so we never exceed the API's own limit.
//
// Strategy:
//   1. Per-user queue  — only 1 in-flight request per user at a time
//   2. Global cooldown — min 4 s between ANY two Gemini calls (= ≤15/min)
//   3. Exponential backoff on 429/503 from Gemini itself

const USER_QUEUES = new Map();      // userId → Promise (the last queued work)
const USER_LAST_REQ = new Map();    // userId → timestamp (rate-limit per user)
const USER_REQ_INTERVAL = 8_000;   // 8 s between requests from the SAME user
let globalLastCall = 0;             // timestamp of last successful Gemini call
const GLOBAL_MIN_GAP = 4_200;      // 4.2 s global gap → ≤ ~14 calls/min (safe)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Waits until both global and per-user cooldowns have passed, then stamps them.
async function acquireSlot(userId) {
  const now = Date.now();
  const userLast = USER_LAST_REQ.get(userId) || 0;
  const userWait  = Math.max(0, userLast + USER_REQ_INTERVAL - now);
  const globalWait = Math.max(0, globalLastCall + GLOBAL_MIN_GAP - now);
  const wait = Math.max(userWait, globalWait);
  if (wait > 0) await sleep(wait);
  USER_LAST_REQ.set(userId, Date.now());
  globalLastCall = Date.now();
}

// Enqueues work for a specific user so their requests run one at a time,
// and the global cooldown is respected across all users.
function enqueue(userId, fn) {
  const prev = USER_QUEUES.get(userId) || Promise.resolve();
  const next = prev.then(() => fn());
  // Store the chain but don't let a rejection break it
  USER_QUEUES.set(userId, next.catch(() => {}));
  return next;
}
// ────────────────────────────────────────────────────────────────────────────

const SITE_KNOWLEDGE = `
Ops Tracker is an internal MERN task/reminder tracking app. It replaces a
manual Google Sheet: recurring tasks are defined once and the system
auto-generates one row ("occurrence") per due date, which people then mark
done.

Pages:
- Dashboard (/): live totals (On Time / Delayed / Pending), a leaderboard,
  and a date-range picker (Today, This Week, Last Month, Year, etc).
- Master (/master): the full reminder log. Admins add new recurring tasks here.
  Anyone can mark their own occurrences done.
- Task List (/tasks): read-only catalog of recurring task definitions.
- Doer List (/doers): roster of people tasks are assigned to.
- Submission Log (/submissions): raw "marked done" event history, exportable as CSV.
- Notifications (/notifications, admin-only): inbox of completion events.
- Settings (/settings, admin-only): schedule horizon, Sunday skipping, email hour.
- Users (/users, admin-only): manage logins.
- Account (/account): profile, password change, personal performance breakdown.

Roles: "admin" sees everything. "member" only sees their own occurrences.
Status logic: On Time = marked done at/before planned date. Delayed = done after
or still open past deadline. Pending = not due yet.
On-time rate = onTime ÷ total × 100 (counting only occurrences due up to today).
`.trim();

function startOfToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function endOfToday() {
  const d = startOfToday(); d.setDate(d.getDate() + 1); return d;
}

async function myPerformance(doerId) {
  const [row] = await TaskInstance.aggregate([
    { $match: { doer: doerId, planned: { $lt: endOfToday() } } },
    {
      $group: {
        _id: null,
        total:   { $sum: 1 },
        onTime:  { $sum: { $cond: [{ $eq: ["$status", "On Time"] }, 1, 0] } },
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

async function buildContext(user) {
  const isAdmin = user.role === "admin";
  const ctx = {
    today: new Date().toISOString().slice(0, 10),
    you: { name: user.name, email: user.email, role: user.role },
  };

  if (!isAdmin) {
    const doer = await Doer.findOne({ email: user.email }).lean();
    if (!doer) { ctx.note = "No linked Doer record."; return ctx; }
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

  const [doers, statusCounts, unreadNotifs] = await Promise.all([
    Doer.find().select("name department").lean(),
    TaskInstance.aggregate([
      { $match: { planned: { $lt: endOfToday() } } },
      {
        $group: {
          _id: "$doer",
          total:   { $sum: 1 },
          onTime:  { $sum: { $cond: [{ $eq: ["$status", "On Time"] }, 1, 0] } },
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
        name: d.name, department: d.department,
        total: r.total, onTime: r.onTime, delayed: r.delayed, pending: r.pending,
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
    `You are MySoul Assistant 🦉, the friendly assistant embedded in Ops Tracker. ` +
    `You're talking to ${user.name} (${user.role}).\n\n` +
    `=== SITE KNOWLEDGE ===\n${SITE_KNOWLEDGE}\n\n` +
    `=== LIVE DATA SNAPSHOT ===\n${JSON.stringify(contextSnapshot, null, 2)}\n\n` +
    `Rules:\n` +
    `- If asked who you are: "I'm MySoul Assistant, developed by Fara."\n` +
    `- Answer using live data. Never invent numbers.\n` +
    `- If data isn't in the snapshot, say so and name where to check.\n` +
    `- You can only inform, not take actions.\n` +
    `- Keep answers short: a few sentences or a short bullet list.\n` +
    `- A member only sees their own data.\n` +
    `- Off-topic questions: answer naturally and briefly.`
  );
}

// Gemini caller with retry + backoff
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
      if (!retryable || i === attempts - 1) return { ok: false, status: res.status, errText };
      lastErr = { status: res.status, errText };
      // Exponential backoff: 2s, 4s, 8s…
      await sleep(2000 * Math.pow(2, i));
    } catch (err) {
      clearTimeout(timer);
      if (i === attempts - 1) return { ok: false, status: 0, errText: err.message };
      lastErr = { status: 0, errText: err.message };
      await sleep(2000 * Math.pow(2, i));
    }
  }
  return { ok: false, status: lastErr?.status || 0, errText: lastErr?.errText || "unknown" };
}

router.post("/ask", async (req, res) => {
  const message = (req.body?.message || "").toString().trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: "Message is required" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.json({
      text: "AI-powered answers aren't turned on yet — an admin needs to set GEMINI_API_KEY on the backend.",
    });
  }

  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
  const userId = String(req.user._id || req.user.id || "anon");

  // Check per-user rate before even queuing
  const userLast = USER_LAST_REQ.get(userId) || 0;
  const sinceUserLast = Date.now() - userLast;
  if (sinceUserLast < USER_REQ_INTERVAL) {
    const waitSec = Math.ceil((USER_REQ_INTERVAL - sinceUserLast) / 1000);
    return res.json({
      text: `⏳ Please wait ${waitSec} second${waitSec === 1 ? "" : "s"} before sending another question — the AI needs a moment to breathe between requests.`,
    });
  }

  try {
    // Enqueue this user's request so their requests are sequential, and the
    // global slot acquisition ensures we don't spam Gemini across all users.
    const result = await enqueue(userId, async () => {
      await acquireSlot(userId);
      const contextSnapshot = await buildContext(req.user);
      const systemPrompt = buildSystemPrompt(req.user, contextSnapshot);

      const contents = [
        ...history
          .filter((h) => h && typeof h.text === "string" && (h.role === "user" || h.role === "bot"))
          .map((h) => ({ role: h.role === "bot" ? "model" : "user", parts: [{ text: h.text.slice(0, 1500) }] })),
        { role: "user", parts: [{ text: message }] },
      ];

      return callGemini(apiKey, {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 350 },
      });
    });

    if (!result.ok) {
      console.error("[chatbot] Gemini error after retries:", result.status, String(result.errText).slice(0, 300));
      const isQuota = result.status === 429 || result.status === 503;
      return res.json({
        text: isQuota
          ? "⏳ The AI is temporarily overloaded — please wait 10–15 seconds and try again."
          : "I couldn't reach my AI brain just now — try again in a moment.",
      });
    }

    const text = (result.data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();

    if (!text) return res.json({ text: "I didn't get an answer for that — could you rephrase?" });
    res.json({ text });
  } catch (err) {
    console.error("[chatbot] /ask failed:", err.message);
    res.json({ text: "Something went wrong — try again in a moment." });
  }
});

export default router;
