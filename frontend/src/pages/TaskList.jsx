import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import ToggleSwitch from "../components/ToggleSwitch.jsx";
import ConfirmDeleteButton from "../components/ConfirmDeleteButton.jsx";
import SearchInput from "../components/SearchInput.jsx";
import SortableTh from "../components/SortableTh.jsx";
import FilterableTh from "../components/FilterableTh.jsx";
import TableScrollControls from "../components/TableScrollControls.jsx";
import { useToast } from "../components/Toast.jsx";
import { useTableHotkeys } from "../hooks/useTableHotkeys.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { sortRows, toggleSort } from "../utils/sortRows.js";
import { chipStyleFromString } from "../utils/colorFromString.js";
import { downloadCsv } from "../utils/csv.js";
import { useAuth } from "../context/AuthContext.jsx";
import { FREQ_LABELS as freqLabels } from "../utils/frequency.js";

export default function TaskList() {
  const { isAdmin } = useAuth();
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [colFilters, setColFilters] = useState({ department: "", assignee: "" });
  const setColFilter = (key, value) => setColFilters((f) => ({ ...f, [key]: value }));
  const toast = useToast();
  const tableRef = useRef(null);
  useTableHotkeys(tableRef);
  const debouncedQ = useDebouncedValue(q, 200);

  const load = () => {
    api.getTasks().then(setTasks).catch((e) => setError(e.message));
  };
  useEffect(load, []);

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
    const deptNeedle = colFilters.department.trim().toLowerCase();
    const assigneeNeedle = colFilters.assignee.trim().toLowerCase();
    if (deptNeedle) rows = rows.filter((t) => t.department?.toLowerCase().includes(deptNeedle));
    if (assigneeNeedle) rows = rows.filter((t) => t.defaultAssignee?.name?.toLowerCase().includes(assigneeNeedle));
    return sortRows(rows, sort);
  }, [tasks, debouncedQ, sort, colFilters]);

  const exportCsv = () => {
    downloadCsv(
      "task-list.csv",
      ["ID", "Task", "Department", "Frequency", "Default Assignee", "Start Date", "Active"],
      visibleTasks.map((t) => [
        t.taskId,
        t.taskName,
        t.department,
        freqLabels[t.frequency] || t.frequency,
        t.defaultAssignee?.name || "",
        t.startDate ? new Date(t.startDate).toLocaleDateString() : "",
        t.active !== false ? "Yes" : "No",
      ])
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Task List"
        subtitle='Catalog of recurring tasks (the "what" and "how often")'
        meta={tasks && <span className="chip"><strong>{visibleTasks.length}</strong> {debouncedQ ? `of ${tasks.length}` : "tasks"}</span>}
      />
      {error && <p className="error">{error}</p>}
      <p className="form-hint">
        This is a read-only view of the catalog. To add a new task (with its schedule), go to <strong>Master</strong>.
      </p>

      {tasks && tasks.length > 0 && (
        <div className="toolbar">
          <SearchInput value={q} onChange={setQ} placeholder="Search by task, ID, department, or assignee… (press /)" />
          <button type="button" className="link-btn generate-btn" onClick={exportCsv}>⬇ Export CSV</button>
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
                <FilterableTh
                  label="Department" sortKey="department" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))}
                  filterKey="department" filterValue={colFilters.department} onFilterChange={setColFilter}
                />
                <SortableTh label="Freq" sortKey="frequency" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <FilterableTh
                  label="Default Assignee" sortKey="defaultAssignee.name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))}
                  filterKey="assignee" filterValue={colFilters.assignee} onFilterChange={setColFilter}
                />
                <SortableTh label="Start Date" sortKey="startDate" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="Status" sortKey="active" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!tasks && <TableSkeleton columns={9} rows={8} />}
              {tasks && visibleTasks.length === 0 && (
                <tr><td colSpan={9} className="empty-state">
                  {debouncedQ ? `No tasks match “${debouncedQ}”.` : "No tasks yet — add one from Master."}
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
                    {t.startDate ? (
                      <span className="badge badge-neutral" title="Master reminders auto-generate from this date">
                        {new Date(t.startDate).toLocaleDateString()} · Auto
                      </span>
                    ) : "-"}
                  </td>
                  <td>
                    <div className="status-cell">
                      <ToggleSwitch
                        checked={t.active !== false}
                        disabled={busyId === t._id || !isAdmin}
                        label={`Toggle ${t.taskName} active status`}
                        onChange={() => toggleActive(t)}
                      />
                      <span className={"badge " + (t.active !== false ? "badge-good" : "badge-bad")}>
                        {t.active !== false ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </td>
                  <td>
                    {isAdmin ? (
                      <ConfirmDeleteButton onConfirm={() => remove(t)} />
                    ) : (
                      <span className="admin-only-hint" title="Only admins can delete">🔒</span>
                    )}
                  </td>
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
