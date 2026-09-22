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
import { getSettings } from "./models/Settings.js";
import { sendDailyReminders } from "./utils/sendDailyReminders.js";
import { requireAuth, requireAdmin } from "./middleware/auth.js";

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
app.use(express.json());
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

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });
