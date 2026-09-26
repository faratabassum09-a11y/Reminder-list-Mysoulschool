import "dotenv/config";
import express from "express";
import cors from "cors";
import compression from "compression";
import mongoose from "mongoose";
import cron from "node-cron";

import doerRoutes from "./routes/doers.js";
import taskRoutes from "./routes/tasks.js";
import masterRoutes from "./routes/master.js";
import consolidatedRoutes from "./routes/consolidated.js";
import submissionRoutes from "./routes/submissions.js";
import settingsRoutes from "./routes/settings.js";
import reminderRoutes from "./routes/reminders.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import notificationRoutes from "./routes/notifications.js";
import chatbotRoutes from "./routes/chatbot.js";
import messageRoutes from "./routes/messages.js";
import { getSettings } from "./models/Settings.js";
import { sendDailyReminders } from "./utils/sendDailyReminders.js";
import { requireAuth, requireAdmin } from "./middleware/auth.js";
import TaskInstance from "./models/TaskInstance.js";

// TaskInstance.status is computed once, on save (see the model's pre-save
// hook) — a row created weeks ago with nobody having touched it since
// stays "Pending" in the database forever, even once its due date is long
// past, because nothing re-saves it to trigger the recompute. Left alone,
// that means the Delayed/Pending breakdown (and anything that filters by
// status) slowly drifts out of sync with reality. This sweeps the whole
// collection for exactly that case — due, not done, still marked
// Pending — and flips it to Delayed directly with an update, without
// loading each document into memory. Cheap (one indexed query) and safe to
// run as often as we like since it's a no-op once everything's caught up.
async function refreshOverdueStatuses() {
  const result = await TaskInstance.updateMany(
    { status: "Pending", actual: null, planned: { $lt: new Date() } },
    { $set: { status: "Delayed" } }
  );
  if (result.modifiedCount > 0) {
    console.log(`[status-sweep] Marked ${result.modifiedCount} overdue task(s) as Delayed`);
  }
}

const app = express();

// In production, Render (backend) and Vercel (frontend) live on different
// domains, so the browser needs an explicit CORS allow-list. Set
// FRONTEND_URL in Render's environment variables to your Vercel URL(s),
// comma-separated if you have more than one (e.g. a preview + prod domain).
// With no FRONTEND_URL set, all origins are allowed — fine for local dev.
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((s) => s.trim())
  : null;

app.use(
  cors({
    origin: allowedOrigins || true,
  })
);
// Proof screenshots arrive as (client-resized) data URLs, so allow more than the 100kb default.
app.use(express.json({ limit: "3mb" }));
// Gzip every response — the Master and Submission Log pages return
// hundreds-to-thousands of JSON rows and the CSV exports are much larger
// still; compressing those cuts transfer time noticeably, especially for
// people on slower connections.
app.use(compression());

app.use("/api/auth", authRoutes);
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Everything below requires a signed-in user. Doers/Tasks/Master/
// Consolidated/Submissions are "member" level — day-to-day work, no
// requireAdmin here (individual delete routes add their own admin check
// inside each file). Settings, Reminders (the email job), and Users are
// admin-only in full, since they affect the whole system or other
// people's accounts.
app.use("/api/doers", requireAuth, doerRoutes);
app.use("/api/tasks", requireAuth, taskRoutes);
app.use("/api/master", requireAuth, masterRoutes);
app.use("/api/consolidated", requireAuth, consolidatedRoutes);
app.use("/api/submissions", requireAuth, submissionRoutes);
app.use("/api/settings", requireAuth, requireAdmin, settingsRoutes);
app.use("/api/reminders", requireAuth, requireAdmin, reminderRoutes);
app.use("/api/users", requireAuth, requireAdmin, userRoutes);
app.use("/api/notifications", requireAuth, requireAdmin, notificationRoutes);
// Member-level, like Doers/Tasks/Master — every signed-in person can ask
// Ozzy questions, the route itself scopes the data snapshot to their role.
app.use("/api/chatbot", requireAuth, chatbotRoutes);
// Member-level too — anyone signed in can DM anyone else. The one
// exception is posting a Doer-list broadcast, which the router itself
// gates behind requireAdmin (see routes/messages.js).
app.use("/api/messages", requireAuth, messageRoutes);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";

// Equivalent of the original's time-based trigger (createTrigger/setTrigger):
// checked once an hour, fires the daily "tasks due tomorrow" email once the
// current hour matches Settings.reminderHour, and only once per calendar
// day (guarded by lastReminderSentOn) so a server restart within that hour
// can't double-send.
//
// Caveat worth knowing on Render's free tier: the service spins down when
// idle, so this only fires reliably while the service happens to be awake
// at the top of that hour. An external scheduler (e.g. Render Cron Jobs,
// or a service like cron-job.org) hitting POST /api/reminders/send-daily
// directly is more reliable than relying on this in-process check alone.
cron.schedule("0 * * * *", async () => {
  try {
    const settings = await getSettings();
    if (!settings.remindersEnabled) return;
    const now = new Date();
    if (now.getHours() !== settings.reminderHour) return;
    const today = now.toISOString().slice(0, 10);
    if (settings.lastReminderSentOn === today) return;

    const result = await sendDailyReminders();
    settings.lastReminderSentOn = today;
    await settings.save();
    console.log(`[reminders] Sent daily reminders: ${result.emailed}/${result.doersChecked} doers emailed`);
  } catch (err) {
    console.error("[reminders] Daily reminder cron failed:", err.message);
  }
});

// Runs on the same hourly tick as the reminder check above — keeps the
// Delayed/Pending breakdown accurate throughout the day without needing
// its own separate schedule.
cron.schedule("0 * * * *", () => {
  refreshOverdueStatuses().catch((err) => console.error("[status-sweep] failed:", err.message));
});

mongoose
  .connect(MONGO_URI, {
    // Default is 30s — on a slow/cold DB (e.g. a paused Atlas free-tier
    // cluster) that meant the very first request after a while could sit
    // for half a minute before even failing. 10s still comfortably covers
    // a normal connect, and fails fast enough to show a real error instead
    // of the frontend just spinning.
    serverSelectionTimeoutMS: 10_000,
  })
  .then(() => {
    console.log("MongoDB connected");
    refreshOverdueStatuses().catch((err) => console.error("[status-sweep] failed:", err.message));
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });
