import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SearchInput from "../components/SearchInput.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import RaiseTicketModal from "../components/RaiseTicketModal.jsx";
import { StatusBadge, fmtDateTime, isOverdue, STATUS_FILTERS } from "../components/TicketStatus.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { usePolling } from "../hooks/usePolling.js";

// The member-facing page. Two tabs:
//   Inbox          -> tickets other doers raised TO me (only I can see these)
//   Raised by me   -> tickets I raised to others
// Admins see everything on the separate "Tickets Raised" page.
export default function HelpTickets({ onChanged }) {
  const toast = useToast();
  const [meta, setMeta] = useState(null);
  const [box, setBox] = useState("inbox");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: null, total: 0, pages: 1, summary: {} });
  const [error, setError] = useState("");
  const [raising, setRaising] = useState(false);
  const [openId, setOpenId] = useState(null);
  const debouncedQ = useDebouncedValue(q, 250);
  const limit = 20;

  useEffect(() => { api.getTicketMeta().then(setMeta).catch((e) => setError(e.message)); }, []);

  const load = () => {
    const p = new URLSearchParams({ box, page, limit });
    if (status) p.set("status", status);
    if (debouncedQ.trim()) p.set("q", debouncedQ.trim());
    api.getTickets(`?${p}`).then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message));
  };
  useEffect(load, [box, status, page, debouncedQ]);
  usePolling(load, 20000);
  useEffect(() => { setPage(1); }, [box, status, debouncedQ]);

  const switchBox = (b) => { setBox(b); setData((d) => ({ ...d, rows: null })); setOpenId(null); };
  const refresh = () => { load(); onChanged?.(); };

  const canRaise = meta && (meta.me || meta.canPickRaiser);

  return (
    <div className="page">
      <PageHeader
        title="Help Tickets"
        subtitle="Raise a problem to a teammate — it appears only to them"
        meta={canRaise && <button type="button" onClick={() => setRaising(true)}>＋ Raise ticket</button>}
      />
      {error && <p className="error">{error}</p>}
      {meta && !meta.me && !meta.canPickRaiser && (
        <p className="form-hint">
          Your login isn't linked to a Doer record yet, so you can't raise or receive tickets.
          Ask an admin to add you to the Doer List using your login email.
        </p>
      )}

      <div className="range-pills" role="tablist">
        {[["inbox", "Inbox"], ["sent", "Raised by me"]].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={box === k}
            className={box === k ? "range-pill range-pill-active" : "range-pill"} onClick={() => switchBox(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search issue, person or #number… (press /)" />
        <div className="row-actions">
          <button type="button" className={"link-btn generate-btn" + (!status ? " filter-pill-active" : "")} onClick={() => setStatus("")}>
            All
          </button>
          {STATUS_FILTERS.map((s) => (
            <button key={s} type="button" className={"link-btn generate-btn" + (status === s ? " filter-pill-active" : "")}
              onClick={() => setStatus(status === s ? "" : s)}>
              {s} <strong>{data.summary?.[s] ?? 0}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="ticket-list">
        {!data.rows && <TableSkeleton columns={1} rows={5} />}
        {data.rows && data.rows.length === 0 && (
          <div className="empty-state">
            {q.trim() || status
              ? "No tickets match those filters."
              : box === "inbox"
                ? "Nothing here — no one has raised a ticket to you."
                : "You haven't raised any tickets yet."}
          </div>
        )}
        {data.rows?.map((t) => (
          <TicketCard key={t._id} t={t} box={box} open={openId === t._id}
            onToggle={() => setOpenId(openId === t._id ? null : t._id)}
            onChanged={refresh} toast={toast} />
        ))}
      </div>

      {data.rows && data.rows.length > 0 && data.pages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {data.page} of {data.pages} ({data.total.toLocaleString()} total)</span>
          <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

      {raising && meta && (
        <RaiseTicketModal
          meta={meta}
          onClose={() => setRaising(false)}
          onCreated={() => { setRaising(false); switchBox("sent"); refresh(); }}
        />
      )}
    </div>
  );
}

function TicketCard({ t, box, open, onToggle, onChanged, toast }) {
  const [note, setNote] = useState(t.resolutionNote || "");
  const [busy, setBusy] = useState(false);
  const inbox = box === "inbox";

  const setStatus = async (status) => {
    setBusy(true);
    try {
      await api.updateTicket(t._id, { status, resolutionNote: note });
      toast(`Ticket #${t.ticketNo} marked ${status}`, "good");
      onChanged();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!window.confirm(`Withdraw ticket #${t.ticketNo}? This deletes it.`)) return;
    setBusy(true);
    try {
      await api.deleteTicket(t._id);
      toast("Ticket withdrawn", "good");
      onChanged();
    } catch (err) {
      toast(err.message, "bad");
      setBusy(false);
    }
  };

  return (
    <div className={"ticket-card" + (open ? " open" : "") + (inbox && t.status === "Open" ? " ticket-new" : "")}>
      <button type="button" className="ticket-head" onClick={onToggle} aria-expanded={open}>
        <span className="ticket-no">#{t.ticketNo}</span>
        <span className="ticket-main">
          <span className="ticket-issue">{t.issue}</span>
          <span className="ticket-meta">
            {inbox ? <>From <strong>{t.raisedBy?.name}</strong></> : <>To <strong>{t.assignedTo?.name}</strong></>}
            {" · "}{fmtDateTime(t.createdAt)}
            {t.plannedResolution && (
              <> · <span className={isOverdue(t) ? "ticket-overdue" : ""}>Due {fmtDateTime(t.plannedResolution)}</span></>
            )}
          </span>
        </span>
        <StatusBadge status={t.status} />
      </button>

      {open && (
        <div className="ticket-body">
          <p className="ticket-full">{t.issue}</p>
          <dl className="ticket-facts">
            <div><dt>Raised by</dt><dd>{t.raisedBy?.name || "—"}</dd></div>
            <div><dt>Assigned to</dt><dd>{t.assignedTo?.name || "—"}</dd></div>
            <div><dt>PC accountable</dt><dd>{t.pcAccountable?.name || "—"}</dd></div>
            <div><dt>Planned resolution</dt><dd className={isOverdue(t) ? "ticket-overdue" : ""}>{fmtDateTime(t.plannedResolution)}</dd></div>
            {t.resolvedAt && <div><dt>Resolved</dt><dd>{fmtDateTime(t.resolvedAt)}</dd></div>}
          </dl>

          {inbox ? (
            <>
              <label className="modal-field">Resolution note (optional)
                <textarea rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)}
                  placeholder="What was done / what's the update?" />
              </label>
              <div className="ticket-actions">
                {t.status !== "In Progress" && t.status !== "Resolved" && (
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus("In Progress")}>Start working</button>
                )}
                {t.status !== "Resolved"
                  ? <button type="button" disabled={busy} onClick={() => setStatus("Resolved")}>Mark resolved</button>
                  : <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus("Open")}>Reopen</button>}
              </div>
            </>
          ) : (
            <>
              {t.resolutionNote && <p className="ticket-note"><strong>Note from {t.assignedTo?.name}:</strong> {t.resolutionNote}</p>}
              {t.status === "Open" && (
                <div className="ticket-actions">
                  <button type="button" className="btn-ghost danger" disabled={busy} onClick={withdraw}>Withdraw ticket</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
