import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import TableScrollControls from "../components/TableScrollControls.jsx";
import { useTableHotkeys } from "../hooks/useTableHotkeys.js";

const empty = { doer: "", task: "", planned: "" };

function statusClass(s) {
  if (s === "On Time") return "badge badge-good";
  if (s === "Delayed") return "badge badge-bad";
  return "badge badge-neutral";
}

export default function Master() {
  const [data, setData] = useState({ rows: null, total: 0, page: 1, pages: 1 });
  const [doers, setDoers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState(empty);
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [error, setError] = useState("");
  const limit = 100;
  const tableRef = useRef(null);
  useTableHotkeys(tableRef);

  const load = () => {
    const params = new URLSearchParams({ page, limit });
    if (filterStatus) params.set("status", filterStatus);
    api.getMaster(`?${params.toString()}`).then(setData).catch((e) => setError(e.message));
    api.getDoers().then(setDoers).catch(() => {});
    api.getTasks().then(setTasks).catch(() => {});
  };
  useEffect(load, [filterStatus, page]);
  useEffect(() => setPageInput(String(page)), [page]);

  // Changing the filter should always jump back to page 1, so the numbering
  // and the "Page X of Y" count stay in sync with the new result set.
  const changeFilter = (value) => {
    setFilterStatus(value);
    setPage(1);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.createMaster({ ...form, planned: new Date(form.planned).toISOString() });
      setForm(empty);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const complete = async (id) => {
    await api.completeMaster(id);
    load();
  };

  const remove = async (id) => {
    await api.removeMaster(id);
    load();
  };

  const goToPage = (e) => {
    e.preventDefault();
    const n = Math.max(1, Math.min(data.pages || 1, Number(pageInput) || 1));
    setPage(n);
  };

  return (
    <div className="page">
      <PageHeader
        title="Master"
        subtitle="Every reminder occurrence — Planned vs Actual, with live status"
        meta={data.rows && <span className="chip"><strong>{data.total.toLocaleString()}</strong> rows</span>}
      />
      {error && <p className="error">{error}</p>}

      <form className="inline-form" onSubmit={submit}>
        <select required value={form.doer} onChange={(e) => setForm({ ...form, doer: e.target.value })}>
          <option value="">Select Doer</option>
          {doers.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
        </select>
        <select required value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })}>
          <option value="">Select Task</option>
          {tasks.map((t) => <option key={t._id} value={t._id}>{t.taskName}</option>)}
        </select>
        <input required type="datetime-local" value={form.planned}
          onChange={(e) => setForm({ ...form, planned: e.target.value })} />
        <button type="submit">Add Reminder</button>
      </form>

      <div className="filter-row">
        <label>Filter status: </label>
        <select value={filterStatus} onChange={(e) => changeFilter(e.target.value)}>
          <option value="">All</option>
          <option value="On Time">On Time</option>
          <option value="Delayed">Delayed</option>
          <option value="Pending">Pending</option>
        </select>
      </div>

      <div className="table-panel">
        <div className="table-wrap" ref={tableRef}>
          <table className="table">
            <thead>
              <tr>
                <th className="col-sno">S.No</th>
                <th>Doer</th><th className="col-task">Task</th><th>Department</th><th>Planned</th><th>Actual</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {!data.rows && <TableSkeleton columns={8} rows={12} />}
              {data.rows && data.rows.length === 0 && (
                <tr><td colSpan={8} className="empty-state">No reminders match this filter.</td></tr>
              )}
              {data.rows?.map((e, i) => (
                <tr key={e._id}>
                  <td>{(data.page - 1) * limit + i + 1}</td>
                  <td>{e.doer?.name}</td>
                  <td className="col-task truncate-cell" title={e.task?.taskName}>{e.task?.taskName}</td>
                  <td>{e.doer?.department}</td>
                  <td>{new Date(e.planned).toLocaleString()}</td>
                  <td>{e.actual ? new Date(e.actual).toLocaleString() : "-"}</td>
                  <td><span className={statusClass(e.status)}>{e.status}</span></td>
                  <td>
                    {!e.actual && <button className="link-btn" onClick={() => complete(e._id)}>Mark Complete</button>}
                    {" "}
                    <button className="link-btn danger" onClick={() => remove(e._id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.rows && data.rows.length > 8 && <TableScrollControls targetRef={tableRef} />}
      </div>

      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage(1)} title="First page">« First</button>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>
          Page {data.page} of {data.pages} ({data.total.toLocaleString()} rows)
        </span>
        <form className="page-jump" onSubmit={goToPage}>
          <span>Go to</span>
          <input
            type="number"
            min={1}
            max={data.pages || 1}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
          />
          <button type="submit">Go</button>
        </form>
        <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
        <button disabled={page >= data.pages} onClick={() => setPage(data.pages)} title="Last page">Last »</button>
      </div>
    </div>
  );
}
