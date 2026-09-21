import React, { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || "Couldn't sign in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">RL</div>
          <div>
            <div className="login-title">Reminder List</div>
            <div className="login-subtitle">MySoulSchool Ops Tracker</div>
          </div>
        </div>
        <form onSubmit={submit} className="login-form">
          <label>
            Email
            <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@mysoulschool.in" />
          </label>
          <label>
            Password
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button>
        </form>
        <p className="login-hint">
          Don't have an account? Ask an admin to add you from the <strong>Users</strong> page.
        </p>
      </div>
    </div>
  );
}
