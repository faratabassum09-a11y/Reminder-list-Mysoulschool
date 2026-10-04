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
import workshopRoutes from "./routes/workshops.js";
import ticketRoutes from "./routes/tickets.js";
import { getSettings } from "./models/Settings.js";
import { sendDailyReminders } from "./utils/sendDailyReminders.js";
import { requireAuth, requireAdmin, requireApp } from "./middleware/auth.js";
import TaskInstance from "./models/TaskInstance.js";
import User from "./models/User.js";
import { TRACKING_START } from "./utils/trackingStart.js";
import { migrateTaskTimes, generateAllUpcoming } from "./utils/generateOccurrences.js";
import WorkshopCounter from "./models/WorkshopCounter.js";
import { clearAuthCache } from "./middleware/auth.js";

// Help Tickets became its own app AFTER accounts were created with an
// explicit apps list (e.g. ["reminder","workshop"]), which would lock
// everyone out of it. Runs exactly once per database (guarded by a marker
// document): gives every existing account the Help Tickets app. After that
// an admin can switch it on/off per person on the Users page and it sticks.
async function grantTicketsAccessOnce() {
  const prev = await WorkshopCounter.findOneAndUpdate(
    { _id: "migration:tickets-access" },
    { $setOnInsert: { seq: 1 } },
    { upsert: true, new: false }
  );
  if (prev) return; // already done on an earlier start
  const r = await User.updateMany({ apps: { $type: "array" } }, { $addToSet: { apps: "tickets" } });
  clearAuthCache();
  console.log(`[migration] Granted Help Tickets access to ${r.modifiedCount} existing account(s)`);
}

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

// Free-tier hosts (Render) put the server to sleep after ~15 minutes with
// no traffic, and the first request afterwards can take 30-50 seconds —
// that, more than any query, is what makes the site feel slow "first thing
// in the morning". Render sets RENDER_EXTERNAL_URL automatically; when it's
// present the server pings its own public /api/health every 10 minutes so
// it never idles out. Set KEEP_ALIVE=0 to turn this off (e.g. on a paid
// always-on plan where it's not needed).
function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url || process.env.KEEP_ALIVE === "0") return;
  setInterval(() => {
    fetch(`${url.replace(/\/$/, "")}/api/health`).catch(() => {});
  }, 10 * 60 * 1000).unref();
  console.log("[keep-alive] Self-ping enabled");
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
app.use(compression({ threshold: 1024 }));

app.use("/api/auth", authRoutes);
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Everything below requires a signed-in user. Doers/Tasks/Master/
// Consolidated/Submissions are "member" level — day-to-day work, no
// requireAdmin here (individual delete routes add their own admin check
// inside each file). Settings, Reminders (the email job), and Users are
// admin-only in full, since they affect the whole system or other
// people's accounts.
app.use("/api/doers", requireAuth, requireApp("reminder"), doerRoutes);
app.use("/api/tasks", requireAuth, requireApp("reminder"), taskRoutes);
app.use("/api/master", requireAuth, requireApp("reminder"), masterRoutes);
app.use("/api/consolidated", requireAuth, requireApp("reminder"), consolidatedRoutes);
app.use("/api/submissions", requireAuth, requireApp("reminder"), submissionRoutes);
app.use("/api/settings", requireAuth, requireAdmin, settingsRoutes);
app.use("/api/reminders", requireAuth, requireAdmin, reminderRoutes);
app.use("/api/users", requireAuth, requireAdmin, userRoutes);
app.use("/api/notifications", requireAuth, requireAdmin, notificationRoutes);
// Member-level, like Doers/Tasks/Master — every signed-in person can ask
// MySoul Assistant questions, the route itself scopes the data snapshot to their role.
app.use("/api/chatbot", requireAuth, requireApp("reminder"), chatbotRoutes);
// Member-level too — anyone signed in can DM anyone else. The one
// exception is posting a Doer-list broadcast, which the router itself
// gates behind requireAdmin (see routes/messages.js).
app.use("/api/messages", requireAuth, requireApp("reminder"), messageRoutes);
// Help Tickets — its own app ("tickets" access, separate from the Reminder
// List). Member-level: any doer can raise one to any other doer.
// Who may see a given ticket is enforced inside the router: only the doer
// it is assigned to, the doer who raised it, and admins.
app.use("/api/tickets", requireAuth, requireApp("tickets"), ticketRoutes);
// Workshop PMS sub-site. Member-level (anyone signed in can submit a workshop
// request and complete their own tasks); approving, rejecting, deleting,
// templates and the Launch Verification hand-off are admin-only inside the
// router itself.
app.use("/api/workshops", requireAuth, requireApp("workshop"), workshopRoutes);

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
    grantTicketsAccessOnce().catch((err) => console.error("[migration] tickets access failed:", err.message));
    // Nothing may sit past the Schedule Horizon: drop unfinished rows beyond it.
    getSettings()
      .then((st) => st.scheduleHorizon && TaskInstance.deleteMany({ planned: { $gte: new Date(new Date(st.scheduleHorizon).getTime() + 24 * 3600 * 1000) }, actual: null }))
      .then((r) => r && r.deletedCount && console.log(`[horizon] removed ${r.deletedCount} unfinished row(s) past the Schedule Horizon`))
      .catch((err) => console.error("[horizon] cleanup failed:", err.message));
    // One-time-style cleanup (safe to repeat): drop unfinished Master rows planned before the
    // tracking start date so they can never show as Delayed. Finished rows are kept as history
    // (they are hidden from the Dashboard/Master by the date floor anyway).
    TaskInstance.deleteMany({ planned: { $lt: TRACKING_START }, actual: null })
      .then((r) => r.deletedCount && console.log(`[tracking-start] removed ${r.deletedCount} unfinished row(s) before ${TRACKING_START.toISOString()}`))
      .catch((err) => console.error("[tracking-start] cleanup failed:", err.message))
      .finally(() => refreshOverdueStatuses().catch((err) => console.error("[status-sweep] failed:", err.message)));
    // Move existing tasks to start 09:00 / due 23:59 (once), then rebuild their rows.
    migrateTaskTimes()
      .then((r) => (r.migrated ? (console.log(`[times] ${r.migrated} task(s) moved to 09:00 start / 23:59 due`), generateAllUpcoming()) : null))
      .then((g) => g && console.log(`[times] regenerated ${g.created} Master row(s)`))
      .catch((err) => console.error("[times] migration failed:", err.message));
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    startKeepAlive();
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });
