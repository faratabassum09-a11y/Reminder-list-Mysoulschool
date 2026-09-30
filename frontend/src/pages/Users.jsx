import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import ToggleSwitch from "../components/ToggleSwitch.jsx";
import ConfirmDeleteButton from "../components/ConfirmDeleteButton.jsx";
import SearchInput from "../components/SearchInput.jsx";
import { useToast } from "../components/Toast.jsx";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";

const empty = { name: "", email: "", password: "", role: "member", slackId: "", canRequestWorkshops: false, apps: ["reminder", "workshop"] };

const APP_LABEL = { reminder: "Reminder List", workshop: "Workshop PMS" };

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [resetId, setResetId] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [slackEditId, setSlackEditId] = useState(null);
  const [slackEditValue, setSlackEditValue] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const [q, setQ] = useState("");
  const [appTab, setAppTab] = useState("all"); // all | reminder | workshop
  const toast = useToast();

  const load = () => api.getUsers().then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (form.role !== "admin" && form.apps.length === 0) {
      toast("Pick at least one app for this user", "bad");
      return;
    }
    try {
      await api.createUser(form);
      setForm(empty);
      load();
      toast(`Added ${form.name} as ${form.role}`, "good");
    } catch (err) {
      setError(err.message);
      toast(err.message, "bad");
    }
  };

  const toggleActive = async (u) => {
    setBusyId(u._id);
    try {
      const updated = await api.updateUser(u._id, { active: !u.active });
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name} marked ${!u.active ? "active" : "inactive"}`, "default");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const toggleRole = async (u) => {
    setBusyId(u._id);
    try {
      const nextRole = u.role === "admin" ? "member" : "admin";
      const updated = await api.updateUser(u._id, { role: nextRole });
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name} is now ${nextRole === "admin" ? "an Admin" : "a Member"}`, "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const toggleApp = async (u, app) => {
    const has = u.apps.includes(app);
    const next = has ? u.apps.filter((a) => a !== app) : [...u.apps, app];
    if (next.length === 0) {
      toast("A user needs at least one app — deactivate them instead", "bad");
      return;
    }
    setBusyId(u._id);
    try {
      const updated = await api.updateUser(u._id, { apps: next });
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name}: ${APP_LABEL[app]} access ${has ? "removed" : "added"}`, "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const toggleCoordinator = async (u) => {
    setBusyId(u._id);
    try {
      const updated = await api.updateUser(u._id, { canRequestWorkshops: !u.canRequestWorkshops });
      setUsers((prev) => prev.map((x) => (x._id === u._id ? updated : x)));
      toast(`${u.name} ${updated.canRequestWorkshops ? "can now add new workshops" : "can no longer add new workshops"}`, "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (u) => {
    try {
      await api.removeUser(u._id);
      setUsers((prev) => prev.filter((x) => x._id !== u._id));
      toast(`Removed ${u.name}`, "bad");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const submitReset = async (e, id) => {
    e.preventDefault();
    try {
      await api.updateUser(id, { password: resetPassword });
      setResetId(null);
      setResetPassword("");
      toast("Password reset", "good");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const startSlackEdit = (u) => {
    setSlackEditId(u._id);
    setSlackEditValue(u.slackId || "");
  };

  const saveSlackId = async (id) => {
    setSlackSaving(true);
    try {
      const updated = await api.updateUser(id, { slackId: slackEditValue });
      setUsers((prev) => prev.map((x) => (x._id === id ? updated : x)));
      setSlackEditId(null);
      toast("Slack ID saved", "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setSlackSaving(false);
    }
  };

  const needle = q.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    if (!users) return users;
    const byApp = appTab === "all" ? users : users.filter((u) => u.apps.includes(appTab));
    if (!needle) return byApp;
    return byApp.filter((u) =>
      u.name.toLowerCase().includes(needle) ||
      u.email.toLowerCase().includes(needle) ||
      u.role.toLowerCase().includes(needle)
    );
  }, [users, needle, appTab]);

  return (
    <div className="page">
      <PageHeader
        title="Users"
        subtitle="Who can sign in, and what they're allowed to do"
        meta={users && <span className="chip"><strong>{users.length}</strong> accounts</span>}
      />
      {error && <p className="error">{error}</p>}

      <form className="inline-form" onSubmit={submit}>
        <input placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Password (min 8 chars)" required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <input placeholder="Slack ID (optional)" value={form.slackId} onChange={(e) => setForm({ ...form, slackId: e.target.value })} />
        {form.role !== "admin" && ["reminder", "workshop"].map((app) => (
          <label key={app} className="ws-inline-check" title={`Lets this person open ${APP_LABEL[app]}`}>
            <input
              type="checkbox"
              checked={form.apps.includes(app)}
              onChange={(e) =>
                setForm({
                  ...form,
                  apps: e.target.checked ? [...form.apps, app] : form.apps.filter((a) => a !== app),
                })
              }
            /> {APP_LABEL[app]}
          </label>
        ))}
        <label className="ws-inline-check" title="Lets this person fill the New Workshop form in Workshop PMS (admins approve)">
          <input type="checkbox" checked={form.canRequestWorkshops} onChange={(e) => setForm({ ...form, canRequestWorkshops: e.target.checked })} /> Workshop coordinator
        </label>
        <button type="submit">Add User</button>
      </form>
      <p className="form-hint">
        <strong>Admins</strong> can delete data, manage Settings, and manage other accounts. <strong>Members</strong> can
        do day-to-day work — add, edit, complete, export — but not delete anything or reach Settings/Users. Slack ID is
        optional; people can also set their own from the Account page. <strong>App access</strong> decides which app a
        person can open — Reminder List, Workshop PMS, or both (admins always get both). A Workshop-PMS-only person
        never sees the Reminder List.
      </p>

      <div className="range-pills" role="tablist" aria-label="Filter users by app" style={{ marginBottom: 10 }}>
        {[["all", "All users"], ["reminder", "Reminder List users"], ["workshop", "Workshop PMS users"]].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={appTab === id}
            className={"range-pill" + (appTab === id ? " range-pill-active" : "")} onClick={() => setAppTab(id)}>
            {label}{users ? ` (${id === "all" ? users.length : users.filter((u) => u.apps.includes(id)).length})` : ""}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search by name, email, or role… (press /)" />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>S.No</th><th>Name</th><th>Email</th><th>Role</th><th>App access</th><th>Slack ID</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {!users && <TableSkeleton columns={8} rows={5} />}
            {users && filteredUsers.length === 0 && (
              <tr><td colSpan={8} className="empty-state">No users match "{q}".</td></tr>
            )}
            {filteredUsers?.map((u, i) => (
              <tr key={u._id} className={u.active === false ? "row-inactive" : ""}>
                <td>{i + 1}</td>
                <td>
                  <div className="name-cell">
                    <span className="avatar" style={avatarStyleFromString(u.name)}>{initials(u.name)}</span>
                    {u.name}{u._id === currentUser?.id && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>You</span>}
                  </div>
                </td>
                <td>{u.email}</td>
                <td>
                  <button type="button" className={"role-toggle " + (u.role === "admin" ? "role-admin" : "role-member")}
                    disabled={busyId === u._id} onClick={() => toggleRole(u)} title="Click to change role">
                    {u.role === "admin" ? "Admin" : "Member"}
                  </button>
                  {u.role !== "admin" && (
                    <button type="button" className={"role-toggle " + (u.canRequestWorkshops ? "role-admin" : "role-member")}
                      style={{ marginLeft: 6 }} disabled={busyId === u._id} onClick={() => toggleCoordinator(u)}
                      title="Click to allow / stop this person adding new workshops in Workshop PMS">
                      {u.canRequestWorkshops ? "Workshop coordinator ✓" : "+ Coordinator"}
                    </button>
                  )}
                </td>
                <td>
                  {["reminder", "workshop"].map((app) => {
                    const on = u.apps.includes(app);
                    const locked = u.role === "admin"; // admins always have both
                    return (
                      <button key={app} type="button"
                        className={"role-toggle " + (on ? "role-admin" : "role-member")}
                        style={{ marginRight: 6 }}
                        disabled={busyId === u._id || locked}
                        onClick={() => toggleApp(u, app)}
                        title={locked ? "Admins always have both apps" : `Click to ${on ? "remove" : "give"} ${APP_LABEL[app]} access`}>
                        {on ? "✓ " : "+ "}{APP_LABEL[app]}
                      </button>
                    );
                  })}
                </td>
                <td>
                  {slackEditId === u._id ? (
                    <div className="row-actions">
                      <input className="cell-edit-input" placeholder="Slack ID" value={slackEditValue}
                        onChange={(e) => setSlackEditValue(e.target.value)} style={{ width: 120 }} />
                      <button type="button" className="link-btn" disabled={slackSaving} onClick={() => saveSlackId(u._id)}>
                        {slackSaving ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className="link-btn" disabled={slackSaving} onClick={() => setSlackEditId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => startSlackEdit(u)}>
                      {u.slackId || <span className="muted">— add —</span>}
                    </button>
                  )}
                </td>
                <td>
                  <div className="status-cell">
                    <ToggleSwitch
                      checked={u.active !== false}
                      disabled={busyId === u._id}
                      label={`Toggle ${u.name} active status`}
                      onChange={() => toggleActive(u)}
                    />
                    <span className={"badge " + (u.active !== false ? "badge-good" : "badge-bad")}>
                      {u.active !== false ? "Active" : "Inactive"}
                    </span>
                  </div>
                </td>
                <td>
                  {resetId === u._id ? (
                    <form className="reset-pw-form" onSubmit={(e) => submitReset(e, u._id)}>
                      <input type="password" placeholder="New password" required minLength={8}
                        value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
                      <button type="submit" className="link-btn">Save</button>
                      <button type="button" className="link-btn" onClick={() => { setResetId(null); setResetPassword(""); }}>Cancel</button>
                    </form>
                  ) : (
                    <div className="row-actions">
                      <button type="button" className="link-btn" onClick={() => setResetId(u._id)}>Reset Password</button>
                      {u._id !== currentUser?.id && <ConfirmDeleteButton onConfirm={() => remove(u)} />}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
