import express from "express";
import Holiday from "../models/Holiday.js";
import Settings, { getSettings } from "../models/Settings.js";

const router = express.Router();

// GET current settings (schedule horizon, skip-Sundays, reminder hour/toggle)
router.get("/", async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
});

// UPDATE settings (partial)
router.put("/", async (req, res) => {
  try {
    const settings = await getSettings();
    const allowed = ["scheduleHorizon", "skipSundays", "reminderHour", "remindersEnabled"];
    for (const key of allowed) {
      if (key in req.body) settings[key] = req.body[key];
    }
    await settings.save();
    res.json(settings);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Holidays — explicit non-working dates within the schedule horizon.
router.get("/holidays", async (req, res) => {
  const holidays = await Holiday.find().sort({ date: 1 }).lean();
  res.json(holidays);
});

router.post("/holidays", async (req, res) => {
  try {
    const holiday = await Holiday.create({ date: req.body.date, label: req.body.label || "" });
    res.status(201).json(holiday);
  } catch (err) {
    // Duplicate date (unique index) is the most common failure here.
    res.status(400).json({ error: err.code === 11000 ? "That date is already marked as a holiday" : err.message });
  }
});

router.delete("/holidays/:id", async (req, res) => {
  const deleted = await Holiday.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Holiday not found" });
  res.json({ ok: true });
});

export default router;
