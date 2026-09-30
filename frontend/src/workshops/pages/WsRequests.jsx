import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import PageHeader from "../../components/PageHeader.jsx";
import ConfirmDeleteButton from "../../components/ConfirmDeleteButton.jsx";
import TableSkeleton from "../../components/TableSkeleton.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../components/Toast.jsx";
import { Empty, Modal, TypeChip, WorkshopStatus } from "../ui.jsx";
import { fmtDate, fmtDateTimeYear, fmtTime12, ymdOf, dayNameFromYmd } from "../../utils/wsFormat.js";

function ReviewModal({ workshop, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.wsReject(workshop._id, note);
      onDone();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Reject request" sub={`${workshop.workshopId} · ${fmtDate(workshop.startDate)}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="modal-field">Reason (shown to the requester)
          <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Clashes with another workshop that week" autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="ws-danger" disabled={busy}>{busy ? "Rejecting…" : "Reject request"}</button>
        </div>
      </form>
    </Modal>
  );
}

// Edit date / time / days (also used to reschedule an approved workshop).
export function EditWorkshopModal({ workshop, onClose, onDone }) {
  const toast = useToast();
  const [startDate, setStartDate] = useState(ymdOf(workshop.startDate));
  const [startTime, setStartTime] = useState(workshop.startTime);
  const [days, setDays] = useState(workshop.days);
  const [name, setName] = useState(workshop.name || workshop.typeName);
  const [goal, setGoal] = useState(workshop.goal || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.wsUpdate(workshop._id, { startDate, startTime, days: Number(days), name, goal });
      toast(res.retimedTasks ? `Saved — ${res.retimedTasks} open task${res.retimedTasks === 1 ? "" : "s"} re-timed` : "Saved", "good");
      onDone();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Edit ${workshop.workshopId}`} sub={workshop.status === "approved" ? "Moving the date re-times every task that isn't done yet and re-sends the launch." : undefined} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="modal-field">Workshop Name<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="modal-field">Workshop Goal<textarea rows={3} maxLength={500} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
        <div className="ws-fields ws-fields-2">
          <label className="modal-field">Start date<input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label className="modal-field">Start day<input readOnly className="ws-readonly" value={dayNameFromYmd(startDate) || "—"} /></label>
          <label className="modal-field">Start time (IST)<input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
          <label className="modal-field">Workshop days<input type="number" min={1} max={30} required value={days} onChange={(e) => setDays(e.target.value)} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </Modal>
  );
}

const TABS = [["pending", "Awaiting approval"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]];

export default function WsRequests({ onChanged }) {
  const { isAdmin, user, canRequestWorkshops } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState("pending");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => api.wsList().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const refresh = () => { load(); onChanged?.(); };

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, all: rows?.length || 0 };
    (rows || []).forEach((r) => { c[r.status] += 1; });
    return c;
  }, [rows]);
  const visible = (rows || []).filter((r) => tab === "all" || r.status === tab).sort((a, b) => (tab === "pending" ? new Date(a.startDate) - new Date(b.startDate) : 0));

  const approve = async (w) => {
    setBusyId(w._id);
    try {
      const res = await api.wsApprove(w._id);
      const launch = res.launchSync?.status;
      toast(
        `${res.workshopId} approved — ${res.tasksGenerated} task${res.tasksGenerated === 1 ? "" : "s"} created` +
          (launch === "sent" ? " · launch sent" : launch === "failed" ? " · launch hand-off FAILED" : ""),
        res.tasksGenerated === 0 || launch === "failed" ? "default" : "good"
      );
      if (res.tasksGenerated === 0) toast("This type has no task list yet — add one under Task Lists", "bad");
      refresh();
    } catch (err) {
      toast(err.message, "bad");
      load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (w) => {
    try {
      const res = await api.wsRemove(w._id);
      toast(`Deleted ${w.workshopId}${res.deletedTasks ? ` and ${res.deletedTasks} tasks` : ""}`, "bad");
      refresh();
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Workshop approvals"
        subtitle={isAdmin ? "Approve a request and its fixed task list is created, assigned and sent to Launch Verification." : "Everything submitted so far and where it stands."}
        meta={canRequestWorkshops && <Link to="/workshops/new" className="ws-primary ws-link-btn">+ New workshop</Link>}
      />

      <div className="ws-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={"ws-tab" + (tab === key ? " active" : "")} onClick={() => setTab(key)}>
            {label} <span className="ws-tab-count">{counts[key]}</span>
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}

      {!rows ? (
        <div className="table-wrap"><table className="table ws-table"><tbody><TableSkeleton rows={5} columns={6} /></tbody></table></div>
      ) : visible.length === 0 ? (
        <Empty icon={tab === "pending" ? "🎉" : "🗂"} title={tab === "pending" ? "No requests waiting" : "Nothing here"}>
          {tab === "pending" ? "New requests will show up here for approval." : "Try another tab."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table ws-table">
            <thead>
              <tr>
                <th>Workshop</th><th>Starts</th><th>Length</th><th>Requested by</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {visible.map((w) => {
                const mineOpen = w.status === "pending" && w.requestedByEmail === user.email;
                return (
                  <tr key={w._id} className={w.status === "pending" && isAdmin ? "row-needs-check" : w.status === "rejected" ? "row-rejected" : ""}>
                    <td>
                      <div className="ws-cell-stack">
                        <span><TypeChip code={w.type} /> <strong>{w.workshopId}</strong></span>
                        <span className="muted">{w.name || w.typeName}</span>
                        {w.goal && <span className="muted ws-tiny" title={w.goal}>🎯 {w.goal.length > 70 ? w.goal.slice(0, 70) + "…" : w.goal}</span>}
                      </div>
                    </td>
                    <td className="ws-nowrap">{w.startDay}, {fmtDate(w.startDate)}<div className="muted">{fmtTime12(w.startTime)}</div></td>
                    <td>{w.days} day{w.days > 1 ? "s" : ""}</td>
                    <td>
                      <div className="ws-cell-stack">
                        <span>{w.requestedByName || "—"}</span>
                        <span className="muted">{fmtDateTimeYear(w.createdAt)}</span>
                      </div>
                    </td>
                    <td>
                      <WorkshopStatus status={w.status} />
                      {w.status !== "pending" && w.reviewedByName && <div className="muted ws-tiny">by {w.reviewedByName}</div>}
                      {w.status === "rejected" && w.reviewNote && <div className="ws-reason">“{w.reviewNote}”</div>}
                    </td>
                    <td className="ws-actions">
                      {isAdmin && w.status === "pending" && (
                        <>
                          <button type="button" className="btn-pill" disabled={busyId === w._id} onClick={() => approve(w)}>{busyId === w._id ? "Approving…" : "Approve"}</button>
                          <button type="button" className="link-btn danger" onClick={() => setRejecting(w)}>Reject</button>
                        </>
                      )}
                      {w.status === "approved" && <Link className="link-btn" to={`/workshops/plan/${w.workshopId}`}>Open</Link>}
                      {(isAdmin || mineOpen) && w.status !== "approved" && <button type="button" className="link-btn" onClick={() => setEditing(w)}>Edit</button>}
                      {isAdmin && <ConfirmDeleteButton onConfirm={() => remove(w)} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rejecting && <ReviewModal workshop={rejecting} onClose={() => setRejecting(null)} onDone={() => { toast("Request rejected", "default"); refresh(); }} />}
      {editing && <EditWorkshopModal workshop={editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </div>
  );
}
