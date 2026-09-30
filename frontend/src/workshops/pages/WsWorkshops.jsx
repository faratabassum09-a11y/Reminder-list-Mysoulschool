import { useAuth } from "../../context/AuthContext.jsx";
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import PageHeader from "../../components/PageHeader.jsx";
import SearchInput from "../../components/SearchInput.jsx";
import { Empty, ProgressBar, SyncBadge, TypeChip } from "../ui.jsx";
import { fmtDate, fmtTime12, relativeDays, daysUntil, dmy, hms } from "../../utils/wsFormat.js";
import { WorkshopStatus } from "../ui.jsx";

const FILTERS = [["upcoming", "Upcoming"], ["past", "Past"], ["all", "All"]];

// The Plan sheet's STATUS column.
const planStatus = (w) => (w.progress.total > 0 && w.progress.done === w.progress.total ? "Done" : daysUntil(w.startDate) < 0 ? "In progress" : "Upcoming");

export default function WsWorkshops() {
  const { canRequestWorkshops } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("upcoming");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState(() => localStorage.getItem("ws-plan-view") || "cards");
  const pickView = (v) => { setView(v); localStorage.setItem("ws-plan-view", v); };

  useEffect(() => { api.wsList("?status=approved").then(setRows).catch((e) => setError(e.message)); }, []);

  const types = useMemo(() => [...new Set((rows || []).map((r) => r.type))], [rows]);
  const visible = useMemo(() => {
    let list = rows || [];
    if (filter === "upcoming") list = list.filter((w) => daysUntil(w.startDate) >= 0);
    if (filter === "past") list = list.filter((w) => daysUntil(w.startDate) < 0);
    if (type) list = list.filter((w) => w.type === type);
    if (q.trim()) list = list.filter((w) => [w.workshopId, w.name, w.goal].join(" ").toLowerCase().includes(q.trim().toLowerCase()));
    return [...list].sort((a, b) => (filter === "past" ? new Date(b.startDate) - new Date(a.startDate) : new Date(a.startDate) - new Date(b.startDate)));
  }, [rows, filter, type, q]);

  return (
    <div className="page">
      <PageHeader title="Workshops" subtitle="Every approved workshop and how far along its task list is." />
      <div className="toolbar">
        <div className="range-pills">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" className={"range-pill" + (filter === k ? " range-pill-active" : "")} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="filter-row">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Workshop type">
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <SearchInput value={q} onChange={setQ} placeholder="Search ID, name, goal…" />
          <div className="range-pills" role="group" aria-label="View">
            <button type="button" className={"range-pill" + (view === "cards" ? " range-pill-active" : "")} onClick={() => pickView("cards")}>Cards</button>
            <button type="button" className={"range-pill" + (view === "plan" ? " range-pill-active" : "")} onClick={() => pickView("plan")}>Plan sheet</button>
          </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {!rows ? (
        <div className="ws-card-grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton-bar" style={{ height: 150, borderRadius: 14 }} />)}</div>
      ) : visible.length === 0 ? (
        <Empty icon="🗓" title="No workshops match">Approved workshops appear here. {canRequestWorkshops && <Link to="/workshops/new">Add one</Link>}</Empty>
      ) : view === "plan" ? (
        <div className="table-wrap">
          <table className="table ws-table">
            <thead><tr><th>Workshop ID</th><th>Workshop Goal</th><th>Workshop Days</th><th>Workshop Name</th><th>Start Date</th><th>Start Time</th><th>Start Day</th><th>Status</th></tr></thead>
            <tbody>
              {visible.map((w) => (
                <tr key={w._id}>
                  <td className="ws-nowrap"><TypeChip code={w.type} /> <Link to={`/workshops/plan/${w.workshopId}`}><strong>{w.workshopId}</strong></Link></td>
                  <td style={{ minWidth: 200, whiteSpace: "normal" }}>{w.goal || <span className="muted">—</span>}</td>
                  <td>{w.days}</td>
                  <td>{w.name || w.typeName}</td>
                  <td className="ws-nowrap">{dmy(w.startDate)}</td>
                  <td className="ws-nowrap">{hms(w.startTime)}</td>
                  <td>{w.startDay}</td>
                  <td><span className={"ws-badge ws-b-" + (planStatus(w) === "Done" ? "good" : planStatus(w) === "Upcoming" ? "review" : "pending")}>{planStatus(w)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ws-card-grid">
          {visible.map((w) => (
            <Link key={w._id} to={`/workshops/plan/${w.workshopId}`} className={`ws-wcard ws-wcard-${w.type}`}>
              <div className="ws-wcard-top">
                <TypeChip code={w.type} />
                <strong>{w.workshopId}</strong>
                <span className="ws-when">{relativeDays(w.startDate)}</span>
              </div>
              {(w.name && w.name !== w.typeName) && <div className="ws-wcard-date">{w.name}</div>}
              <div className="ws-wcard-date">{w.startDay}, {fmtDate(w.startDate)}</div>
              {w.goal && <div className="muted wst-desc" title={w.goal} style={{ whiteSpace: "normal" }}>🎯 {w.goal.length > 90 ? w.goal.slice(0, 90) + "…" : w.goal}</div>}
              <div className="muted">{fmtTime12(w.startTime)} · {w.days} day{w.days > 1 ? "s" : ""}</div>
              <ProgressBar done={w.progress.done} total={w.progress.total} overdue={w.progress.overdue} />
              <div className="ws-wcard-foot">
                {w.progress.overdue > 0 ? <span className="ws-badge ws-b-overdue">{w.progress.overdue} overdue</span> : <span />}
                <SyncBadge sync={w.launchSync} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
