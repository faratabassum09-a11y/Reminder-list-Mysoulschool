import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { useToast } from "../components/Toast.jsx";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";
import { COMPACT_RANGES } from "../utils/dateRanges.js";

// Turns an on-time percentage into a grade badge. Only graded once there's
// enough data to mean something — a couple of tasks either way shouldn't
// swing between "Excellent" and "At Risk".
function gradeFor(total, onTimePercent) {
  if (total < 3) return { label: "Not enough data yet", cls: "perf-grade-neutral" };
  if (onTimePercent >= 90) return { label: "🌟 Excellent", cls: "perf-grade-excellent" };
  if (onTimePercent >= 75) return { label: "Good", cls: "perf-grade-good" };
  if (onTimePercent >= 50) return { label: "Needs Improvement", cls: "perf-grade-warn" };
  return { label: "At Risk", cls: "perf-grade-bad" };
}

export default function Account() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();

  const [perfRange, setPerfRange] = useState("");
  const [perf, setPerf] = useState(null);
  const [perfError, setPerfError] = useState("");

  useEffect(() => {
    setPerf(null);
    api.getMyPerformance(perfRange).then(setPerf).catch((e) => setPerfError(e.message));
  }, [perfRange]);

  const pct = perf?.total ? Math.round(perf.onTimePercent) : 0;
  const grade = perf ? gradeFor(perf.total, perf.onTimePercent) : null;

  const [profileForm, setProfileForm] = useState({ name: user?.name || "", slackId: user?.slackId || "" });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submitProfile = async (e) => {
    e.preventDefault();
    setProfileError("");
    setProfileBusy(true);
    try {
      const res = await api.updateProfile({ name: profileForm.name, slackId: profileForm.slackId });
      updateProfile(res.user);
      toast("Profile updated", "good");
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.newPassword !== form.confirm) {
      setError("New password and confirmation don't match");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(form.currentPassword, form.newPassword);
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      toast("Password updated", "good");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Account" subtitle="Your profile and login details" />

      <div className="settings-card" style={{ maxWidth: 460 }}>
        <div className="name-cell" style={{ marginBottom: 18 }}>
          <span className="avatar" style={{ ...avatarStyleFromString(user?.name || ""), width: 40, height: 40, fontSize: 14 }}>
            {initials(user?.name || "")}
          </span>
          <div>
            <div style={{ fontWeight: 700 }}>{user?.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {user?.email} · {user?.role === "admin" ? "Admin" : "Member"}
              {user?.createdAt && <> · Member since {new Date(user.createdAt).toLocaleDateString()}</>}
            </div>
          </div>
        </div>

        <h3>Edit Profile</h3>
        <form onSubmit={submitProfile} className="stacked-form">
          <label>
            Display name
            <input required value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} />
          </label>
          <label>
            Slack ID
            <input
              placeholder="e.g. U012ABCDEF or @yourname"
              value={profileForm.slackId}
              onChange={(e) => setProfileForm({ ...profileForm, slackId: e.target.value })}
            />
          </label>
          <p className="form-hint">
            Used to identify you for Slack-based notifications, if/when that's wired up — safe to leave blank.
          </p>
          {profileError && <p className="error">{profileError}</p>}
          <button type="submit" disabled={profileBusy}>{profileBusy ? "Saving…" : "Save Profile"}</button>
        </form>

        <h3 style={{ marginTop: 28 }}>Change Password</h3>
        <form onSubmit={submit} className="stacked-form">
          <label>
            Current password
            <input type="password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          </label>
          <label>
            New password
            <input type="password" required minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </label>
          <label>
            Confirm new password
            <input type="password" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Update Password"}</button>
        </form>
      </div>

      <div className="settings-card" style={{ maxWidth: 620, marginTop: 22 }}>
        <div className="perf-header">
          <h3 style={{ margin: 0 }}>Your Performance</h3>
          {grade && <span className={"perf-grade " + grade.cls}>{grade.label}</span>}
        </div>
        <p className="form-hint" style={{ margin: "2px 0 14px" }}>
          Your on-time record on Master, computed live — pick a range to see how you're tracking.
        </p>
        {perfError && <p className="error">{perfError}</p>}

        <div className="range-pills" role="group" aria-label="Performance range">
          {COMPACT_RANGES.map((r) => (
            <button
              key={r.value || "all"}
              type="button"
              className={"range-pill" + (perfRange === r.value ? " range-pill-active" : "")}
              aria-pressed={perfRange === r.value}
              onClick={() => setPerfRange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {perf && perf.doer === null ? (
          <p className="form-hint" style={{ margin: 0 }}>
            No Doer record is linked to your account, so there's nothing to track here yet.
          </p>
        ) : (
          <div className="cards">
            {[
              { label: "Total Tasks", value: perf?.total, cls: "" },
              { label: "On Time", value: perf?.onTime, cls: "card-good" },
              { label: "Delayed", value: perf?.delayed, cls: "card-bad" },
              { label: "Pending", value: perf?.pending, cls: "card-neutral" },
              { label: "On-Time Rate", value: perf ? `${pct}%` : undefined, cls: "card-accent" },
            ].map((c) => (
              <div className={`card ${c.cls}`} key={c.label}>
                <div className="card-label">{c.label}</div>
                <div className="card-value">
                  {c.value === undefined ? (
                    <span className="skeleton-bar" style={{ width: 44, height: 22 }} />
                  ) : (
                    typeof c.value === "number" ? c.value.toLocaleString() : c.value
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
