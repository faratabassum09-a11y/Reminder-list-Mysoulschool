import express from "express";
import { sendDailyReminders } from "../utils/sendDailyReminders.js";
import { isMailerConfigured } from "../utils/mailer.js";

const router = express.Router();

// Manual trigger — same job the daily cron runs, callable on demand (a
// "Send Now" test button in Settings). Also what the cron itself calls.
router.post("/send-daily", async (req, res) => {
  try {
    const result = await sendDailyReminders();
    res.json({ ...result, mailerConfigured: isMailerConfigured() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/mailer-status", (req, res) => {
  res.json({ configured: isMailerConfigured() });
});

export default router;
