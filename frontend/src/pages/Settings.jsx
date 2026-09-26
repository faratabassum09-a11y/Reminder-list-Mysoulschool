import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import ToggleSwitch from "../components/ToggleSwitch.jsx";
import { useToast } from "../components/Toast.jsx";

function toDateInputValue(d) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [holidays, setHolidays] = useState(null);
  const [holidayForm, setHolidayForm] = useState({ date: "", label: "" });
  const [mailerConfigured, setMailerConfigured] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  const load = () => {
    api.getSettings().then(setSettings).catch((e) => setError(e.message));
    api.getHolidays().then(setHolidays).catch(() => {});
    api.getMailerStatus().then((r) => setMailerConfigured(r.configured)).catch(() => {});
  };
  useEffect(load, []);

  const saveField = async (patch) => {
    setSaving(true);
    try {
      const updated = await api.updateSettings(patch);
      setSettings(updated);
      toast("Settings saved", "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setSaving(false);
    }
  };

  const addHoliday = async (e) => {
    e.preventDefault();
    try {
      await api.addHoliday(holidayForm);
      setHolidayForm({ date: "", label: "" });
      load();
      toast("Holiday added", "good");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const removeHoliday = async (h) => {
    try {
      await api.removeHoliday(h._id);
      setHolidays((prev) => prev.filter((x) => x._id !== h._id));
      toast(`Removed ${h.label || toDateInputValue(h.date)}`, "default");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const sendNow = async () => {
    setSendingNow(true);
    try {
      const result = await api.sendRemindersNow();
      if (!result.mailerConfigured) {
        toast(`No SMTP configured yet — checked ${result.doersChecked} doers, logged instead of sending`, "default");
      } else {
        toast(`Emailed ${result.emailed} of ${result.doersChecked} doers`, "good");
      }
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setSendingNow(false);
    }
  };

  if (!settings) {
    return (
      <div className="page">
        <PageHeader title="Settings" subtitle="Schedule horizon, working days, and daily reminder emails" />
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Schedule horizon, working days, and daily reminder emails" />
      {error && <p className="error">{error}</p>}

      <div className="settings-grid">
        <section className="settings-card">
          <h3>Recurring schedule</h3>
          <p className="settings-hint">
            Recurring tasks (set up from the Master page) only ever generate up to this date — same idea as the
            original Working Day Calendar's last row.
          </p>
          <label className="settings-row">
            <span>Schedule Horizon</span>
            <input
              type="date"
              value={toDateInputValue(settings.scheduleHorizon)}
              onChange={(e) => saveField({ scheduleHorizon: e.target.value ? e.target.value + 'T05:30:00.000Z' : null })} // IST midnight → UTC
            />
          </label>
          <label className="settings-row">
            <span>Skip Sundays</span>
            <ToggleSwitch
              checked={settings.skipSundays}
              disabled={saving}
              label="Skip Sundays when generating recurring reminders"
              onChange={() => saveField({ skipSundays: !settings.skipSundays })}
            />
          </label>
          <p className="settings-hint">
            When a computed date lands on a non-working day (a Sunday, or a date below), it shifts back to the
            nearest working day — Daily tasks skip that day entirely instead.
          </p>
        </section>

        <section className="settings-card">
          <h3>Holidays</h3>
          <p className="settings-hint">Specific non-working dates within the schedule horizon.</p>
          <form className="inline-form holiday-form" onSubmit={addHoliday}>
            <input type="date" required value={holidayForm.date}
              onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })} />
            <input placeholder="Label (optional)" value={holidayForm.label}
              onChange={(e) => setHolidayForm({ ...holidayForm, label: e.target.value })} />
            <button type="submit">Add Holiday</button>
          </form>
          <ul className="holiday-list">
            {holidays === null && <li className="muted">Loading…</li>}
            {holidays && holidays.length === 0 && <li className="muted">No holidays added.</li>}
            {holidays?.map((h) => (
              <li key={h._id}>
                <span>{new Date(h.date).toLocaleDateString()}{h.label ? ` — ${h.label}` : ""}</span>
                <button type="button" className="link-btn danger" onClick={() => removeHoliday(h)}>Remove</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="settings-card">
          <h3>Daily reminder emails</h3>
          <p className="settings-hint">
            Each evening, at the hour below, every doer with a task planned for tomorrow that isn't marked done yet
            gets a reminder email — same as the original's daily trigger.
          </p>
          <label className="settings-row">
            <span>Enabled</span>
            <ToggleSwitch
              checked={settings.remindersEnabled}
              disabled={saving}
              label="Enable daily reminder emails"
              onChange={() => saveField({ remindersEnabled: !settings.remindersEnabled })}
            />
          </label>
          <label className="settings-row">
            <span>Send at (hour, 24h, server time)</span>
            <input
              type="number" min={0} max={23} style={{ width: 64 }}
              value={settings.reminderHour}
              onChange={(e) => setSettings({ ...settings, reminderHour: Number(e.target.value) })}
              onBlur={() => saveField({ reminderHour: settings.reminderHour })}
            />
          </label>
          <p className={"mailer-status " + (mailerConfigured ? "mailer-ok" : "mailer-off")}>
            {mailerConfigured === null
              ? "Checking email setup…"
              : mailerConfigured
              ? "✓ SMTP is configured — emails will actually send."
              : "SMTP isn't configured yet (see backend/.env.example) — reminders will log instead of sending until it is."}
          </p>
          <button type="button" className="link-btn generate-btn" disabled={sendingNow} onClick={sendNow}>
            {sendingNow ? "Sending…" : "Send Reminders Now (test)"}
          </button>
        </section>
      </div>
    </div>
  );
}
