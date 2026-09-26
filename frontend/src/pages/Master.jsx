import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import TableScrollControls from "../components/TableScrollControls.jsx";
import FilterableTh from "../components/FilterableTh.jsx";
import { useToast } from "../components/Toast.jsx";
import { useTableHotkeys } from "../hooks/useTableHotkeys.js";
import ProofModal from "../components/ProofModal.jsx";
import EditTaskModal from "../components/EditTaskModal.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { useAuth } from "../context/AuthContext.jsx";
import { FREQ_SUGGESTIONS, parseFrequencyInput } from "../utils/frequency.js";

const emptyTask = { taskName: "", department: "", defaultAssignee: "", startDate: "" };
const DEFAULT_FREQ_INPUT = "Daily";

// No approval step anymore — a completed row just shows its On Time /
// Delayed status, with a small "✔ done by the doer" note when it was the
// doer (not an admin) who completed it.
function rowStatus(e) {
  if (e.actual && e.submission?.state === "done") return { label: `✔ ${e.status}`, cls: statusClass(e.status) };
  return { label: e.status, cls: statusClass(e.status) };
}

function statusClass(s) {
  if (s === "On Time") return "badge badge-good";
  if (s === "Delayed") return "badge badge-bad";
  return "badge badge-neutral";
}

export default function Master() {
  const { user, isAdmin } = useAuth();
  const [data, setData] = useState({ rows: null, total: 0, page: 1, pages: 1 });
  const [doers, setDoers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [taskForm, setTaskForm] = useState(emptyTask);
  const [freqInput, setFreqInput] = useState(DEFAULT_FREQ_INPUT);
  const [taskBusy, setTaskBusy] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [error, setError] = useState("");
  const [highlightId, setHighlightId] = useState(null);
  const [highlightRow, setHighlightRow] = useState(null);
  const [modal, setModal] = useState(null); // { mode, row }
  const [generating, setGenerating] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const [colFilters, setColFilters] = useState({ doer: "", task: "", department: "" });
  const toast = useToast();
  const limit = 100;
  const tableRef = useRef(null);
  useTableHotkeys(tableRef);
  const [searchParams, setSearchParams] = useSearchParams();

  // A notification click lands here as ?highlight=<taskInstanceId> —
  // fetch that exact row and pin it above the table, then clear the URL
  // so it doesn't fight with normal filtering afterwards.
  useEffect(() => {
    const id = searchParams.get("highlight");
    if (id) {
      setHighlightId(id);
      api.getMasterOne(id).then(setHighlightRow).catch(() => setHighlightRow(null));
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setColFilter = (key, value) => setColFilters((f) => ({ ...f, [key]: value }));

  // Doers and Tasks are used here only to populate dropdowns and to look up
  // a name/department for display — they don't change from filtering or
  // paging through Master, so they're fetched once on mount rather than on
  // every filter/page change.
  useEffect(() => {
    api.getDoers().then(setDoers).catch(() => {});
    api.getTasks().then(setTasks).catch(() => {});
  }, []);

  // The Doer record matching the signed-in user (matched by email, same
  // pattern the backend already uses for edit permissions) — powers the
  // "My Tasks" quick filter below.
  const myDoer = useMemo(() => doers.find((d) => d.email === user?.email), [doers, user]);

  const load = () => {
    const params = new URLSearchParams({ page, limit });
    if (filterStatus) params.set("status", filterStatus);
    if (todayOnly) params.set("today", "1");
    if (mineOnly && myDoer) params.set("doer", myDoer._id);
    api.getMaster(`?${params.toString()}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, [filterStatus, todayOnly, mineOnly, page]);
  // Everyone sees completions within seconds, no refresh needed.
  usePolling(load, 15000);
  useEffect(() => setPageInput(String(page)), [page]);

  // Tops up Master with any due occurrences for schedule-driven tasks once
  // when the page first loads, so recurring reminders keep appearing on
  // their own without anyone having to remember to add them.
  useEffect(() => {
    api
      .generateUpcoming()
      .then((res) => {
        if (res.created > 0) {
          toast(`${res.created} upcoming reminder${res.created === 1 ? "" : "s"} auto-generated`, "good");
          load();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateNow = async () => {
    setGenerating(true);
    try {
      const res = await api.generateUpcoming(true);
      if (res.horizonMissing) {
        toast("Set a Schedule Horizon in Settings first — recurring tasks need to know how far ahead to generate", "bad");
      } else {
        toast(
          res.created > 0
            ? `${res.created} upcoming reminder${res.created === 1 ? "" : "s"} generated`
            : "Everything's already up to date",
          res.created > 0 ? "good" : "default"
        );
      }
      if (res.created > 0) load();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setGenerating(false);
    }
  };

  // One-time cleanup for duplicate rows from a race-condition bug that's
  // now fixed (concurrent generation calls could double-insert). Safe to
  // click any time — it's a no-op once there's nothing left to remove.
  const dedupeNow = async () => {
    setDeduping(true);
    try {
      const res = await api.dedupeMaster();
      toast(
        res.removed > 0
          ? `Removed ${res.removed} duplicate reminder${res.removed === 1 ? "" : "s"}`
          : "No duplicates found",
        res.removed > 0 ? "good" : "default"
      );
      if (res.removed > 0) load();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setDeduping(false);
    }
  };

  // Changing any filter should always jump back to page 1, so the
  // numbering and the "Page X of Y" count stay in sync with the new
  // result set.
  const changeFilter = (value) => {
    setFilterStatus(value);
    setPage(1);
  };
  const toggleToday = () => {
    setTodayOnly((v) => !v);
    setPage(1);
  };
  const toggleMine = () => {
    setMineOnly((v) => !v);
    setPage(1);
  };

  // Creates the task AND starts its recurring schedule in one step — Task
  // Name, Department, Frequency, Default Assignee, and Date all live here
  // on Master, not split off onto a separate Task List form.
  const freqParsed = useMemo(() => parseFrequencyInput(freqInput), [freqInput]);

  const submitTask = async (e) => {
    e.preventDefault();
    if (!freqParsed) {
      toast('Couldn\'t understand that recurrence — try "Daily", "Weekly on Monday", "Monthly"…', "bad");
      return;
    }
    setTaskBusy(true);
    try {
      const created = await api.createTask({
        ...taskForm,
        frequency: freqParsed.code,
        startDate: taskForm.startDate + "T05:30:00.000Z", // IST midnight → UTC
      });
      setTaskForm(emptyTask);
      setFreqInput(DEFAULT_FREQ_INPUT);
      load();
      toast(`"${created.taskName}" added (ID ${created.taskId}) — reminders generating from ${taskForm.startDate}`, "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setTaskBusy(false);
    }
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

  // Per-column filters (the small ⚲ icon in each header) narrow down the
  // rows already loaded on the current page — a quick, precise way to spot
  // "just this doer" or "just this task" without leaving the page filter
  // and pagination behind.
  const visibleRows = useMemo(() => {
    let rows = data.rows || [];
    const dNeedle = colFilters.doer.trim().toLowerCase();
    const tNeedle = colFilters.task.trim().toLowerCase();
    const deptNeedle = colFilters.department.trim().toLowerCase();
    if (dNeedle) rows = rows.filter((e) => e.doer?.name?.toLowerCase().includes(dNeedle));
    if (tNeedle) rows = rows.filter((e) => e.task?.taskName?.toLowerCase().includes(tNeedle));
    if (deptNeedle) rows = rows.filter((e) => e.doer?.department?.toLowerCase().includes(deptNeedle));
    return rows;
  }, [data.rows, colFilters]);
  const colFiltering = !!(colFilters.doer.trim() || colFilters.task.trim() || colFilters.department.trim());

  return (
    <div className="page">
      <PageHeader
        title="Master"
        subtitle={isAdmin ? "Every reminder occurrence — Planned vs Actual, with live status" : "Your reminder occurrences — Planned vs Actual, with live status"}
        meta={data.rows && <span className="chip"><strong>{data.total.toLocaleString()}</strong> {isAdmin ? "rows" : "of your tasks"}</span>}
      />
      {error && <p className="error">{error}</p>}

      {highlightRow && (
        <div className="highlight-banner">
          <span className="highlight-banner-dot" />
          <span>
            From your notifications: <strong>{highlightRow.doer?.name}</strong> marked{" "}
            <strong>{highlightRow.task?.taskName}</strong> done on {highlightRow.actual ? new Date(highlightRow.actual).toLocaleString() : "-"}.
          </span>
          <button type="button" className="highlight-banner-close" aria-label="Dismiss" onClick={() => { setHighlightId(null); setHighlightRow(null); }}>×</button>
        </div>
      )}

      {isAdmin && (
        <>
          <form className="inline-form schedule-form" onSubmit={submitTask}>
            <input placeholder="Task Name" required value={taskForm.taskName}
              onChange={(e) => setTaskForm({ ...taskForm, taskName: e.target.value })} />
            <input placeholder="Department" required value={taskForm.department}
              onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value })} />
            <span className="freq-input-wrap">
              <input
                list="master-freq-suggestions"
                required
                placeholder="Recurs — e.g. Daily, Weekly on Monday, Monthly"
                value={freqInput}
                onChange={(e) => setFreqInput(e.target.value)}
              />
              <datalist id="master-freq-suggestions">
                {FREQ_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              </datalist>
            </span>
            <select required value={taskForm.defaultAssignee} onChange={(e) => setTaskForm({ ...taskForm, defaultAssignee: e.target.value })}>
              <option value="">Assignee</option>
              {doers.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
            <input required type="date" value={taskForm.startDate}
              onChange={(e) => setTaskForm({ ...taskForm, startDate: e.target.value })} />
            <button type="submit" disabled={taskBusy || !freqParsed}>{taskBusy ? "Adding…" : "+ Add Task & Start Schedule"}</button>
          </form>
          {freqInput && (
            freqParsed
              ? <span className="freq-preview-chip">→ {freqParsed.label}</span>
              : <span className="freq-preview-chip freq-preview-bad">Not recognized yet — try "Daily", "Weekly on Monday", "Monthly", "1st Monday of month"…</span>
          )}
          <p className="form-hint">
            Creates the task and starts generating its Master reminders from the date above, in one step. For "every
            Nth weekday of month" phrasing (e.g. "1st Monday of month"), the weekday comes from whichever day of the
            week that date falls on.
          </p>
        </>
      )}

      <div className="filter-row">
        <label>Filter status: </label>
        <select value={filterStatus} onChange={(e) => changeFilter(e.target.value)}>
          <option value="">All</option>
          <option value="On Time">On Time</option>
          <option value="Delayed">Delayed</option>
          <option value="Pending">Pending</option>
        </select>
        <button
          type="button"
          className={"link-btn generate-btn" + (todayOnly ? " filter-pill-active" : "")}
          onClick={toggleToday}
          title="Show only tasks planned for today"
        >
          📅 {todayOnly ? "Showing Today's Tasks" : "Today's Tasks"}
        </button>
        {isAdmin && myDoer && (
          <button
            type="button"
            className={"link-btn generate-btn" + (mineOnly ? " filter-pill-active" : "")}
            onClick={toggleMine}
            title="Show only tasks assigned to me"
          >
            🙋 {mineOnly ? "Showing My Tasks" : "My Tasks"}
          </button>
        )}
        <button type="button" className="link-btn generate-btn" disabled={generating} onClick={generateNow}
          title="Check schedule-driven tasks and add any occurrences that are due">
          {generating ? "Checking…" : "↻ Generate Upcoming"}
        </button>
        {isAdmin && (
          <button type="button" className="link-btn generate-btn" disabled={deduping} onClick={dedupeNow}
            title="One-time cleanup for any duplicate reminders">
            {deduping ? "Checking…" : "🧹 Remove Duplicates"}
          </button>
        )}
        <a
          className="link-btn generate-btn"
          href={`${API_BASE}/master/export.csv${filterStatus ? `?status=${encodeURIComponent(filterStatus)}` : ""}`}
          title="Download every row matching the current filter as a CSV file"
        >
          ⬇ Export CSV
        </a>
      </div>

      <div className="table-panel">
        <div className="table-wrap" ref={tableRef}>
          <table className="table">
            <thead>
              <tr>
                <th className="col-sno">S.No</th>
                <FilterableTh label="Doer" filterKey="doer" filterValue={colFilters.doer} onFilterChange={setColFilter} />
                <FilterableTh label="Task" className="col-task" filterKey="task" filterValue={colFilters.task} onFilterChange={setColFilter} />
                <FilterableTh label="Department" filterKey="department" filterValue={colFilters.department} onFilterChange={setColFilter} />
                <th>Planned</th><th>Actual</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {!data.rows && <TableSkeleton columns={8} rows={12} />}
              {data.rows && data.rows.length === 0 && (
                <tr><td colSpan={8} className="empty-state">No reminders match this filter.</td></tr>
              )}
              {data.rows && data.rows.length > 0 && visibleRows.length === 0 && (
                <tr><td colSpan={8} className="empty-state">No rows match the column filters you've set.</td></tr>
              )}
              {visibleRows.map((e, i) => {
                const isOwnRow = e.doer?.email === user?.email;
                const rowCls = highlightId && e._id === highlightId ? "row-highlighted" : undefined;
                return (
                  <tr key={e._id} className={rowCls}>
                    <td>{(data.page - 1) * limit + (colFiltering ? data.rows.indexOf(e) : i) + 1}</td>
                    <td>{e.doer?.name}</td>
                    <td className="col-task truncate-cell" title={e.task?.taskName}>{e.task?.taskName}</td>
                    <td>{e.doer?.department}</td>
                    <td>{new Date(e.planned).toLocaleString()}</td>
                    <td>{e.actual ? new Date(e.actual).toLocaleString() : "-"}</td>
                    <td><span className={rowStatus(e).cls}>{rowStatus(e).label}</span></td>
                    <td>
                      {!e.actual && (
                        isOwnRow ? (
                          <button className="btn-pill" onClick={() => setModal({ mode: "submit", row: e })}>
                            ✔ Mark as done
                          </button>
                        ) : isAdmin ? (
                          <span className="admin-only-hint" title={`Waiting for ${e.doer?.name || "the assigned doer"} to mark it done`}>
                            ⏳ Waiting for {e.doer?.name?.split(" ")[0] || "doer"}
                          </span>
                        ) : (
                          <span className="admin-only-hint" title="Only the assigned doer or an admin can update this">🔒</span>
                        )
                      )}
                      {" "}
                      {isAdmin && (
                        <button className="link-btn" onClick={() => setEditRow(e)} title="Edit this task's recurring schedule, or just this occurrence's date/time">
                          Edit
                        </button>
                      )}
                      {" "}
                      <button className="link-btn danger" disabled={!isAdmin} onClick={() => remove(e._id)}
                        title={isAdmin ? undefined : "Only admins can delete"}>Delete</button>
                    </td>
                  </tr>
                );
              })}
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
      {modal && <ProofModal row={modal.row} onClose={() => setModal(null)} onChanged={load} />}
      {editRow && <EditTaskModal row={editRow} doers={doers} onClose={() => setEditRow(null)} onChanged={load} />}
    </div>
  );
}
