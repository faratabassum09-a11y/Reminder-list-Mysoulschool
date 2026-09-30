import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api.js";
import PageHeader from "../../components/PageHeader.jsx";
import SearchInput from "../../components/SearchInput.jsx";
import TableSkeleton from "../../components/TableSkeleton.jsx";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { usePolling } from "../../hooks/usePolling.js";
import { downloadCsv } from "../../utils/csv.js";
import { dmy, dmyhms } from "../../utils/wsFormat.js";
import TaskTable from "../TaskTable.jsx";
import { Empty } from "../ui.jsx";

const STATUS = [["", "All"], ["open", "Open"], ["Overdue", "Overdue"], ["Pending", "Upcoming"], ["On Time", "On time"], ["Delayed", "Done late"]];

export default function WsTasks({ onChanged }) {
  const { canRequestWorkshops } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState(() => localStorage.getItem("ws-task-view") || (canRequestWorkshops ? "sheet" : "cards"));
  const pickView = (v) => { setView(v); localStorage.setItem("ws-task-view", v); };
  const [tasks, setTasks] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [typeCodes, setTypeCodes] = useState(["UTW", "ICP", "R12", "THW"]);
  const dq = useDebouncedValue(q, 250);
  const status = params.get("status") || "";
  const mine = params.get("mine") === "1";
  const type = params.get("type") || "";

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const load = () => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (mine) p.set("mine", "1");
    if (type) p.set("type", type);
    if (dq.trim()) p.set("q", dq.trim());
    p.set("page", String(page));
    p.set("limit", String(PAGE_SIZE));
    api.wsTasks(`?${p}`)
      .then((r) => {
        setTasks(r.rows);
        setMeta({ total: r.total, page: r.page, pages: r.pages });
        if (r.page !== page) setPage(r.page);
        setError("");
      })
      .catch((e) => setError(e.message));
  };
  useEffect(() => { api.wsMeta().then((m) => setTypeCodes(m.types.map((t) => t.code))).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [status, mine, type, dq]);
  useEffect(load, [status, mine, type, dq, page]);
  usePolling(load, 60000);

  const owners = useMemo(() => new Set((tasks || []).map((t) => t.owner)).size, [tasks]);
  const change = (next) => { setTasks(next); onChanged?.(); };

  const exportCsv = () =>
    downloadCsv(
      "workshop-tasks.csv",
      ["Workshop ID", "Workshop Date", "Workshop Task ID", "Task", "Timeline", "Task Owner", "Email", "Department", "Task Score", "Planned Date", "Actual Date", "Status", "Owner Score", "Workshop Score", "Buddy Email"],
      (tasks || []).map((t) => [t.workshopId, dmy(t.workshopDate), t.taskId, t.task, t.timeline, t.owner, t.ownerEmail, t.department, t.score, dmyhms(t.planned), t.actual ? dmyhms(t.actual) : "", t.status, t.ownerScore ?? "", t.workshopScore ?? "", t.buddyEmail || ""])
    );

  return (
    <div className="page">
      <PageHeader title={canRequestWorkshops ? "Workshop tasks" : "My tasks"} subtitle={canRequestWorkshops ? "Every fixed task across all workshops, stored exactly like the Workshop Tasks sheet." : "The tasks assigned to you. Finish one before its due time to earn its full score."} />
      <div className="toolbar">
        <div className="range-pills">
          {STATUS.map(([k, l]) => (
            <button key={k || "all"} type="button" className={"range-pill" + (status === k ? " range-pill-active" : "")} onClick={() => setParam("status", k)}>{l}</button>
          ))}
        </div>
        <div className="filter-row">
          {canRequestWorkshops && <label className="ws-inline-check"><input type="checkbox" checked={mine} onChange={(e) => setParam("mine", e.target.checked ? "1" : "")} /> Only mine</label>}
          <select value={type} onChange={(e) => setParam("type", e.target.value)} aria-label="Workshop type">
            <option value="">All types</option>
            {typeCodes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <SearchInput value={q} onChange={setQ} placeholder="Search task, ID, owner…" />
          {canRequestWorkshops && (
            <div className="range-pills" role="group" aria-label="View">
              <button type="button" className={"range-pill" + (view === "sheet" ? " range-pill-active" : "")} onClick={() => pickView("sheet")}>Sheet</button>
              <button type="button" className={"range-pill" + (view === "cards" ? " range-pill-active" : "")} onClick={() => pickView("cards")}>Cards</button>
            </div>
          )}
          <button type="button" className="btn-ghost ws-small-btn" onClick={exportCsv} disabled={!tasks?.length}>Export CSV</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {tasks && <p className="muted ws-count">{meta.total.toLocaleString()} task{meta.total === 1 ? "" : "s"} · showing {tasks.length ? (meta.page - 1) * PAGE_SIZE + 1 : 0}–{(meta.page - 1) * PAGE_SIZE + tasks.length}{owners > 0 ? ` · ${owners} owner${owners === 1 ? "" : "s"} on this page` : ""}</p>}

      {!tasks ? (
        <div className="table-wrap"><table className="table ws-table"><tbody><TableSkeleton rows={8} columns={7} /></tbody></table></div>
      ) : tasks.length === 0 ? (
        <Empty icon="🔎" title="No tasks match">Change the filters, or approve a workshop to generate its task list.</Empty>
      ) : (
        <>
          <TaskTable tasks={tasks} onChange={change} view={canRequestWorkshops ? view : "cards"} showWorkshop />
          {meta.pages > 1 && (
            <div className="ws-pager">
              <button type="button" className="btn-ghost ws-small-btn" disabled={meta.page <= 1} onClick={() => setPage(1)}>« First</button>
              <button type="button" className="btn-ghost ws-small-btn" disabled={meta.page <= 1} onClick={() => setPage(meta.page - 1)}>‹ Prev</button>
              <span className="ws-pager-info">Page {meta.page} of {meta.pages}</span>
              <button type="button" className="btn-ghost ws-small-btn" disabled={meta.page >= meta.pages} onClick={() => setPage(meta.page + 1)}>Next ›</button>
              <button type="button" className="btn-ghost ws-small-btn" disabled={meta.page >= meta.pages} onClick={() => setPage(meta.pages)}>Last »</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
