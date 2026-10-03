import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SearchInput from "../components/SearchInput.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import { StatusBadge, fmtDateTime, isOverdue, STATUS_FILTERS } from "../components/TicketStatus.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { usePolling } from "../hooks/usePolling.js";
import { useDateFilter } from "../hooks/useDateFilter.js";
import TicketDateFilter, { addTicketDateParams, dateKey } from "../components/TicketDateFilter.jsx";

// Admin-only overview of EVERY help ticket raised by anyone to anyone
// (GET /api/tickets?box=all is rejected for non-admins on the server).
export default function TicketsRaised({ onChanged }) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: null, total: 0, pages: 1, summary: {} });
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const debouncedQ = useDebouncedValue(q, 250);
  const dateFilter = useDateFilter(() => setPage(1));
  const [dateBy, setDateBy] = useState("createdAt");
  const dKey = dateKey(dateFilter, dateBy);
  const limit = 25;

  const load = () => {
    if (dateFilter.error) return;
    const p = new URLSearchParams({ box: "all", page, limit });
    if (status) p.set("status", status);
    if (debouncedQ.trim()) p.set("q", debouncedQ.trim());
    addTicketDateParams(p, dateFilter, dateBy);
    api.getTickets(`?${p}`).then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message));
  };
  useEffect(load, [status, page, debouncedQ, dKey]);
  usePolling(load, 20000);
  useEffect(() => { setPage(1); }, [status, debouncedQ, dKey]);

  const total = STATUS_FILTERS.reduce((n, s) => n + (data.summary?.[s] || 0), 0);

  const changeStatus = async (t, next) => {
    setBusyId(t._id);
    try {
      await api.updateTicket(t._id, { status: next });
      load();
      onChanged?.();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete ticket #${t.ticketNo} permanently?`)) return;
    setBusyId(t._id);
    try {
      await api.deleteTicket(t._id);
      toast("Ticket deleted", "good");
      load();
      onChanged?.();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Tickets Raised"
        subtitle="Every help ticket raised between doers, newest first"
        meta={data.rows && <span className="chip"><strong>{total.toLocaleString()}</strong> {debouncedQ || status || dateFilter.active ? "in view" : "total"}</span>}
      />
      {error && <p className="error">{error}</p>}

      <div className="cards">
        <div className="card card-bad"><div className="card-label">Open</div><div className="card-value">{data.rows ? data.summary.Open ?? 0 : "…"}</div></div>
        <div className="card card-accent"><div className="card-label">In progress</div><div className="card-value">{data.rows ? data.summary["In Progress"] ?? 0 : "…"}</div></div>
        <div className="card card-good"><div className="card-label">Resolved</div><div className="card-value">{data.rows ? data.summary.Resolved ?? 0 : "…"}</div></div>
      </div>

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search issue, raised by, assigned to or #… (press /)" />
        <div className="row-actions">
          <button type="button" className={"link-btn generate-btn" + (!status ? " filter-pill-active" : "")} onClick={() => setStatus("")}>All</button>
          {STATUS_FILTERS.map((s) => (
            <button key={s} type="button" className={"link-btn generate-btn" + (status === s ? " filter-pill-active" : "")}
              onClick={() => setStatus(status === s ? "" : s)}>{s}</button>
          ))}
        </div>
      </div>

      <TicketDateFilter filter={dateFilter} dateBy={dateBy} setDateBy={setDateBy} />

      <div className="table-panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Raised</th>
                <th>Raised By</th>
                <th>Assigned To</th>
                <th>PC Accountable</th>
                <th className="col-task">Issue</th>
                <th>Planned Resolution</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!data.rows && <TableSkeleton columns={9} rows={8} />}
              {data.rows && data.rows.length === 0 && (
                <tr><td colSpan={9} className="empty-state">{q.trim() || status || dateFilter.active ? "No tickets match those filters." : "No tickets have been raised yet."}</td></tr>
              )}
              {data.rows?.map((t) => (
                <tr key={t._id}>
                  <td>{t.ticketNo}</td>
                  <td>{fmtDateTime(t.createdAt)}</td>
                  <td>{t.raisedBy?.name || <span className="muted">—</span>}</td>
                  <td>{t.assignedTo?.name || <span className="muted">—</span>}</td>
                  <td>{t.pcAccountable?.name || <span className="muted">—</span>}</td>
                  <td className="col-task ticket-cell-issue" title={t.issue}>
                    {t.issue}
                    {t.resolutionNote && <div className="ticket-cell-note">Note: {t.resolutionNote}</div>}
                  </td>
                  <td className={isOverdue(t) ? "ticket-overdue" : ""}>{fmtDateTime(t.plannedResolution)}</td>
                  <td>
                    <select className="ticket-status-select" value={t.status} disabled={busyId === t._id}
                      onChange={(e) => changeStatus(t, e.target.value)} aria-label={`Status of ticket ${t.ticketNo}`}>
                      {STATUS_FILTERS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <button type="button" className="link-btn danger" disabled={busyId === t._id} onClick={() => remove(t)} title="Delete ticket">🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.rows && data.pages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(1)}>« First</button>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {data.page} of {data.pages} ({data.total.toLocaleString()} tickets)</span>
          <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          <button disabled={page >= data.pages} onClick={() => setPage(data.pages)}>Last »</button>
        </div>
      )}
    </div>
  );
}
