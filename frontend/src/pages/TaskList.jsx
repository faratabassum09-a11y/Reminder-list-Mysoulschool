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
import { chipStyleFromString } from "../utils/colorFromString.js";

const empty = { taskId: "", taskName: "", department: "", frequency: "D", defaultAssignee: "" };

const freqLabels = {
  D: "Daily", W: "Weekly", M: "Monthly", Q: "Quarterly", Y: "Yearly",
  E1st: "1st of month", E2nd: "2nd of month", E3rd: "3rd of month", E4th: "4th of month",
};

export default function TaskList() {
  const [tasks, setTasks] = useState(null);
  const [doers, setDoers] = useState([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const toast = useToast();
  const tableRef = useRef(null);
  useTableHotkeys(tableRef);
  const debouncedQ = useDebouncedValue(q, 200);

  const load = () => {
    api.getTasks().then(setTasks).catch((e) => setError(e.message));
    api.getDoers().then(setDoers).catch(() => {});
  };
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.createTask({ ...form, taskId: Number(form.taskId) });
      setForm(empty);
      load();
      toast(`Added task "${form.taskName}"`, "good");
    } catch (err) {
      setError(err.message);
      toast(err.message, "bad");
    }
  };

  const toggleActive = async (t) => {
    setBusyId(t._id);
    try {
      await api.updateTask(t._id, { active: !t.active });
      setTasks((prev) => prev.map((x) => (x._id === t._id ? { ...x, active: !t.active } : x)));
      toast(`${t.taskName} marked ${!t.active ? "active" : "inactive"}`, "default");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (t) => {
    try {
      await api.removeTask(t._id);
      setTasks((prev) => prev.filter((x) => x._id !== t._id));
      toast(`Deleted "${t.taskName}"`, "bad");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const visibleTasks = useMemo(() => {
    let rows = tasks || [];
    if (debouncedQ.trim()) {
      const needle = debouncedQ.trim().toLowerCase();
      rows = rows.filter(
        (t) =>
          t.taskName?.toLowerCase().includes(needle) ||
          t.department?.toLowerCase().includes(needle) ||
          String(t.taskId).includes(needle) ||
          t.defaultAssignee?.name?.toLowerCase().includes(needle)
      );
    }
    return sortRows(rows, sort);
  }, [tasks, debouncedQ, sort]);

  return (
    <div className="page">
      <PageHeader
        title="Task List"
        subtitle='Catalog of recurring tasks (the "what" and "how often")'
        meta={tasks && <span className="chip"><strong>{visibleTasks.length}</strong> {debouncedQ ? `of ${tasks.length}` : "tasks"}</span>}
      />
      {error && <p className="error">{error}</p>}

      <form className="inline-form" onSubmit={submit}>
        <input placeholder="Task ID" required type="number" value={form.taskId}
          onChange={(e) => setForm({ ...form, taskId: e.target.value })} />
        <input placeholder="Task Name" required value={form.taskName}
          onChange={(e) => setForm({ ...form, taskName: e.target.value })} />
        <input placeholder="Department" required value={form.department}
          onChange={(e) => setForm({ ...form, department: e.target.value })} />
        <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
          <option value="D">Daily</option>
          <option value="W">Weekly</option>
          <option value="M">Monthly</option>
          <option value="Q">Quarterly</option>
          <option value="Y">Yearly</option>
          <option value="E1st">Every 1st of month</option>
          <option value="E2nd">Every 2nd of month</option>
          <option value="E3rd">Every 3rd of month</option>
          <option value="E4th">Every 4th of month</option>
        </select>
        <select value={form.defaultAssignee} onChange={(e) => setForm({ ...form, defaultAssignee: e.target.value })}>
          <option value="">Default Assignee</option>
          {doers.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
        </select>
        <button type="submit">Add Task</button>
      </form>

      {tasks && tasks.length > 0 && (
        <div className="toolbar">
          <SearchInput value={q} onChange={setQ} placeholder="Search by task, ID, department, or assignee… (press /)" />
        </div>
      )}

      <div className="table-panel">
        <div className="table-wrap" ref={tableRef}>
          <table className="table">
            <thead>
              <tr>
                <th className="col-sno">S.No</th>
                <SortableTh label="ID" sortKey="taskId" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="Task" sortKey="taskName" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} className="col-task" />
                <SortableTh label="Department" sortKey="department" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="Freq" sortKey="frequency" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="Default Assignee" sortKey="defaultAssignee.name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="Status" sortKey="active" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!tasks && <TableSkeleton columns={8} rows={8} />}
              {tasks && visibleTasks.length === 0 && (
                <tr><td colSpan={8} className="empty-state">
                  {debouncedQ ? `No tasks match “${debouncedQ}”.` : "No tasks added yet — add one above."}
                </td></tr>
              )}
              {visibleTasks.map((t, i) => (
                <tr key={t._id} className={t.active === false ? "row-inactive" : ""}>
                  <td>{i + 1}</td>
                  <td>{t.taskId}</td>
                  <td className="col-task truncate-cell" title={t.taskName}>{t.taskName}</td>
                  <td><span className="dept-chip" style={chipStyleFromString(t.department)}>{t.department}</span></td>
                  <td><span className="freq-badge">{freqLabels[t.frequency] || t.frequency}</span></td>
                  <td>{t.defaultAssignee?.name || "-"}</td>
                  <td>
                    <div className="status-cell">
                      <ToggleSwitch
                        checked={t.active !== false}
                        disabled={busyId === t._id}
                        label={`Toggle ${t.taskName} active status`}
                        onChange={() => toggleActive(t)}
                      />
                      <span className={"badge " + (t.active !== false ? "badge-good" : "badge-bad")}>
                        {t.active !== false ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </td>
                  <td><ConfirmDeleteButton onConfirm={() => remove(t)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tasks && tasks.length > 8 && <TableScrollControls targetRef={tableRef} />}
      </div>
    </div>
  );
}
