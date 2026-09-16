import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import ToggleSwitch from "../components/ToggleSwitch.jsx";
import ConfirmDeleteButton from "../components/ConfirmDeleteButton.jsx";
import SearchInput from "../components/SearchInput.jsx";
import SortableTh from "../components/SortableTh.jsx";
import TableScrollControls from "../components/TableScrollControls.jsx";
import { useToast } from "../components/Toast.jsx";
import { useTableHotkeys } from "../hooks/useTableHotkeys.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { sortRows, toggleSort } from "../utils/sortRows.js";
import { avatarStyleFromString, chipStyleFromString, initials } from "../utils/colorFromString.js";

const empty = { name: "", email: "", department: "", buddyEmailsText: "" };

// "a@x.com, b@x.com" -> ["a@x.com", "b@x.com"]
function parseBuddyEmails(text) {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function DoerList() {
  const [doers, setDoers] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const toast = useToast();
  const tableRef = useRef(null);
  useTableHotkeys(tableRef);
  const debouncedQ = useDebouncedValue(q, 200);

  const load = () => api.getDoers().then(setDoers).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const { buddyEmailsText, ...rest } = form;
      await api.createDoer({ ...rest, buddyEmails: parseBuddyEmails(buddyEmailsText) });
      setForm(empty);
      load();
      toast(`Added ${rest.name} to the doer list`, "good");
    } catch (err) {
      setError(err.message);
      toast(err.message, "bad");
    }
  };

  const toggleActive = async (d) => {
    setBusyId(d._id);
    try {
      await api.updateDoer(d._id, { active: !d.active });
      setDoers((prev) => prev.map((x) => (x._id === d._id ? { ...x, active: !d.active } : x)));
      toast(`${d.name} marked ${!d.active ? "active" : "inactive"}`, "default");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (d) => {
    try {
      await api.removeDoer(d._id);
      setDoers((prev) => prev.filter((x) => x._id !== d._id));
      toast(`Deleted ${d.name}`, "bad");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const visibleDoers = useMemo(() => {
    let rows = doers || [];
    if (debouncedQ.trim()) {
      const needle = debouncedQ.trim().toLowerCase();
      rows = rows.filter(
        (d) =>
          d.name?.toLowerCase().includes(needle) ||
          d.email?.toLowerCase().includes(needle) ||
          d.department?.toLowerCase().includes(needle)
      );
    }
    return sortRows(rows, sort);
  }, [doers, debouncedQ, sort]);

  return (
    <div className="page">
      <PageHeader
        title="Doer List"
        subtitle="People who own reminder tasks"
        meta={doers && <span className="chip"><strong>{visibleDoers.length}</strong> {debouncedQ ? `of ${doers.length}` : "doers"}</span>}
      />
      {error && <p className="error">{error}</p>}

      <form className="inline-form" onSubmit={submit}>
        <input placeholder="Name" required value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Email" required type="email" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Department" required value={form.department}
          onChange={(e) => setForm({ ...form, department: e.target.value })} />
        <input placeholder="Buddy Emails (comma-separated)" value={form.buddyEmailsText}
          onChange={(e) => setForm({ ...form, buddyEmailsText: e.target.value })} />
        <button type="submit">Add Doer</button>
      </form>

      {doers && doers.length > 0 && (
        <div className="toolbar">
          <SearchInput value={q} onChange={setQ} placeholder="Search by name, email, or department… (press /)" />
        </div>
      )}

      <div className="table-panel">
        <div className="table-wrap" ref={tableRef}>
          <table className="table">
            <thead>
              <tr>
                <th className="col-sno">S.No</th>
                <SortableTh label="Name" sortKey="name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <th>Email</th>
                <SortableTh label="Department" sortKey="department" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <th className="col-buddy">Buddy Emails</th>
                <SortableTh label="Status" sortKey="active" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!doers && <TableSkeleton columns={7} rows={8} />}
              {doers && visibleDoers.length === 0 && (
                <tr><td colSpan={7} className="empty-state">
                  {debouncedQ ? `No doers match “${debouncedQ}”.` : "No doers added yet — add one above."}
                </td></tr>
              )}
              {visibleDoers.map((d, i) => (
                <tr key={d._id} className={d.active === false ? "row-inactive" : ""}>
                  <td>{i + 1}</td>
                  <td>
                    <div className="name-cell">
                      <span className="avatar" style={avatarStyleFromString(d.name)}>{initials(d.name)}</span>
                      {d.name}
                    </div>
                  </td>
                  <td>{d.email}</td>
                  <td><span className="dept-chip" style={chipStyleFromString(d.department)}>{d.department}</span></td>
                  <td className="col-buddy truncate-cell" title={d.buddyEmails?.join(", ")}>
                    {d.buddyEmails && d.buddyEmails.length ? d.buddyEmails.join(", ") : "-"}
                  </td>
                  <td>
                    <div className="status-cell">
                      <ToggleSwitch
                        checked={d.active !== false}
                        disabled={busyId === d._id}
                        label={`Toggle ${d.name} active status`}
                        onChange={() => toggleActive(d)}
                      />
                      <span className={"badge " + (d.active !== false ? "badge-good" : "badge-bad")}>
                        {d.active !== false ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </td>
                  <td><ConfirmDeleteButton onConfirm={() => remove(d)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {doers && doers.length > 8 && <TableScrollControls targetRef={tableRef} />}
      </div>
    </div>
  );
}
