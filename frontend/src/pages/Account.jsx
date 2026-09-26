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
  if (total < 3) return null; // too little data to grade — show no badge at all
  if (onTimePercent >= 90) return { label: "🌟 Excellent", cls: "perf-grade-excellent" };
  if (onTimePercent >= 75) return { label: "Good", cls: "perf-grade-good" };
  if (onTimePercent >= 50) return { label: "Needs Improvement", cls: "perf-grade-warn" };
  return { label: "At Risk", cls: "perf-grade-bad" };
}

const TABS = [
  { id: "profile", label: "Profile", icon: "M12 12a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6Zm0 2.4c-3.6 0-9.6 1.8-9.6 5.4V22h19.2v-2.2c0-3.6-6-5.4-9.6-5.4Z" },
  { id: "security", label: "Security", icon: "M12 2 4 5v6c0 5 3.4 9.4 8 10.5C16.6 20.4 20 16 20 11V5l-8-3Zm0 4.6a2.6 2.6 0 0 1 1.3 4.85V14a1.3 1.3 0 0 1-2.6 0v-2.55A2.6 2.6 0 0 1 12 6.6Z" },
  { id: "performance", label: "Performance", icon: "M4 20V10m6 10V4m6 16v-7" },
];

// A ring drawn from two overlapping circles (track + progress arc) — used
// instead of a plain number so the on-time rate reads at a glance the way
// a real settings page would show it, not just a stat in a box.
function ProgressRing({ pct = 0, size = 96, stroke = 9, color = "var(--accent)" }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(Math.max(pct, 0), 100) / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="progress-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="progress-ring-label">
        {pct}%
      </text>
    </svg>
  );
}

export default function Account() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("profile");

  const [perfRange, setPerfRange] = useState("");
  const [perf, setPerf] = useState(null);
  const [perfError, setPerfError] = useState("");

  useEffect(() => {
    setPerf(null);
    api.getMyPerformance(perfRange).then(setPerf).catch((e) => setPerfError(e.message));
  }, [perfRange]);

  const pct = perf?.total ? Math.round(perf.onTimePercent) : 0;
  // Admins aren't Doers being graded on task turnaround, so the standing
  // badge doesn't apply to them — only show it for regular members.
  const grade = perf && user?.role !== "admin" ? gradeFor(perf.total, perf.onTimePercent) : null;

  const [profileForm, setProfileForm] = useState({ name: user?.name || "", slackId: user?.slackId || "" });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const profileDirty = profileForm.name !== (user?.name || "") || profileForm.slackId !== (user?.slackId || "");

  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pwStrength = (() => {
    const v = form.newPassword;
    if (!v) return 0;
    let s = 0;
    if (v.length >= 8) s++;
    if (v.length >= 12) s++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
    if (/[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
    return Math.min(s, 4);
  })();
  const pwLabels = ["Too short", "Weak", "Okay", "Good", "Strong"];
  const pwColors = ["var(--bad)", "var(--bad)", "var(--warn)", "var(--good)", "var(--good)"];

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
    <div className="page account-page">
      <PageHeader title="Account" subtitle="Your profile, security, and performance" />

      <div className="account-hero">
        <div className="account-hero-glow" aria-hidden="true" />
        <span className="avatar account-hero-avatar" style={avatarStyleFromString(user?.name || "")}>
          {initials(user?.name || "")}
        </span>
        <div className="account-hero-info">
          <div className="account-hero-name">
            {user?.name}
            <span className={"role-pill" + (user?.role === "admin" ? " role-pill-admin" : "")}>
              {user?.role === "admin" ? "Admin" : "Member"}
            </span>
          </div>
          <div className="account-hero-email">{user?.email}</div>
          {user?.createdAt && (
            <div className="account-hero-since">Member since {new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</div>
          )}
        </div>
        {grade && (
          <div className="account-hero-grade">
            <span className={"perf-grade " + grade.cls}>{grade.label}</span>
            <span className="account-hero-grade-label">Overall standing</span>
          </div>
        )}
      </div>

      <div className="account-tabs" role="tablist" aria-label="Account sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={"account-tab" + (tab === t.id ? " account-tab-active" : "")}
            onClick={() => setTab(t.id)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="settings-card account-panel">
          <h3>Edit Profile</h3>
          <p className="settings-hint">This is how you show up across the app — sidebar, assignments, and reports.</p>
          <form onSubmit={submitProfile} className="stacked-form account-form">
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
              <span className="field-hint">Used to identify you for Slack-based notifications, if/when that's wired up — safe to leave blank.</span>
            </label>
            {profileError && <p className="error">{profileError}</p>}
            <div className="account-form-actions">
              <button type="submit" disabled={profileBusy || !profileDirty}>{profileBusy ? "Saving…" : "Save Profile"}</button>
              {profileDirty && !profileBusy && <span className="account-unsaved">Unsaved changes</span>}
            </div>
          </form>
        </div>
      )}

      {tab === "security" && (
        <div className="settings-card account-panel">
          <h3>Change Password</h3>
          <p className="settings-hint">Choose something you don't use anywhere else — at least 8 characters.</p>
          <form onSubmit={submit} className="stacked-form account-form">
            <label>
              Current password
              <input type="password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
            </label>
            <label>
              New password
              <input type="password" required minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
              {form.newPassword && (
                <span className="pw-strength">
                  <span className="pw-strength-bars">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className="pw-strength-bar"
                        style={{ background: i < pwStrength ? pwColors[pwStrength] : "var(--line)" }}
                      />
                    ))}
                  </span>
                  <span style={{ color: pwColors[pwStrength] }}>{pwLabels[pwStrength]}</span>
                </span>
              )}
            </label>
            <label>
              Confirm new password
              <input type="password" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
              {form.confirm && (
                <span className={"field-hint" + (form.confirm === form.newPassword ? " field-hint-good" : " field-hint-bad")}>
                  {form.confirm === form.newPassword ? "Passwords match" : "Doesn't match yet"}
                </span>
              )}
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Update Password"}</button>
          </form>
        </div>
      )}

      {tab === "performance" && (
        <div className="settings-card account-panel account-panel-wide">
          <div className="perf-header">
            <h3 style={{ margin: 0 }}>Your Performance</h3>
          </div>
          <p className="settings-hint">Your on-time record on Master, computed live — pick a range to see how you're tracking.</p>
          <p className="perf-note">Only counts tasks due up to today — anything scheduled for later hasn't happened yet, so it's left out rather than counted against you.</p>
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
            <div className="perf-layout">
              <div className="perf-ring-block">
                <ProgressRing pct={pct} color={pct >= 75 ? "var(--good)" : pct >= 50 ? "var(--warn)" : "var(--bad)"} />
                <div className="perf-ring-caption">On-time rate</div>
              </div>
              <div className="perf-cards-block">
                <div className="cards perf-cards">
                  {[
                    { label: "Total Tasks", value: perf?.total, cls: "" },
                    { label: "On Time", value: perf?.onTime, cls: "card-good" },
                    { label: "Delayed", value: perf?.delayed, cls: "card-bad" },
                    { label: "Pending", value: perf?.pending, cls: "card-neutral" },
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
                {perf && perf.total > 0 && (
                  <div className="perf-distribution">
                    <div className="perf-distribution-bar">
                      <span
                        className="perf-distribution-segment"
                        style={{ width: `${(perf.onTime / perf.total) * 100}%`, background: "var(--good)" }}
                        title={`On Time: ${perf.onTime}`}
                      />
                      <span
                        className="perf-distribution-segment"
                        style={{ width: `${(perf.delayed / perf.total) * 100}%`, background: "var(--bad)" }}
                        title={`Delayed: ${perf.delayed}`}
                      />
                      <span
                        className="perf-distribution-segment"
                        style={{ width: `${(perf.pending / perf.total) * 100}%`, background: "var(--warn)" }}
                        title={`Pending: ${perf.pending}`}
                      />
                    </div>
                    <div className="perf-distribution-legend">
                      <span><i style={{ background: "var(--good)" }} />On Time</span>
                      <span><i style={{ background: "var(--bad)" }} />Delayed</span>
                      <span><i style={{ background: "var(--warn)" }} />Pending</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
