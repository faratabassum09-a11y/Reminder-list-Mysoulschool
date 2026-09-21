import React, { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { useToast } from "../components/Toast.jsx";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";

export default function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{user?.email} · {user?.role === "admin" ? "Admin" : "Member"}</div>
          </div>
        </div>

        <h3>Change Password</h3>
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
    </div>
  );
}
