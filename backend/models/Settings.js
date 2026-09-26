import mongoose from "mongoose";

// Singleton document — one row, always looked up the same way. Mirrors the
// original sheet's "Setup Sheet" tab: the Working Day Calendar's last date
// (here: scheduleHorizon, a date instead of a giant enumerated date list),
// the "skip Sundays" toggle, and the reminder-email send hour.
const settingsSchema = new mongoose.Schema(
  {
    // Equivalent of "Working Day Calendar"'s last row — recurring
    // generation never produces an occurrence past this date.
    scheduleHorizon: { type: Date },
    // Matches Setup Sheet's default ("Yes" if unset).
    skipSundays: { type: Boolean, default: true },
    // Hour (0-23, server time) the daily "tasks due tomorrow" email goes
    // out — equivalent of Setup Sheet C15 / createTrigger(time).
    reminderHour: { type: Number, default: 10, min: 0, max: 23 },
    remindersEnabled: { type: Boolean, default: false },
    // Guards against sending the daily email twice if the server restarts
    // within the same hour — stores "YYYY-MM-DD" of the last successful send.
    lastReminderSentOn: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Settings", settingsSchema);

// Always returns the one Settings doc, creating it with defaults on first use.
export async function getSettings() {
  const Settings = mongoose.model("Settings");
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  return settings;
}
