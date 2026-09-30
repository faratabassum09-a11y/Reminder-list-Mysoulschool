import React, { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../components/Toast.jsx";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";
import { fmtDateTimeYear, fmtDate, nowLocalInput, istInputToIso, dmy, dmyhms } from "../utils/wsFormat.js";
import { Modal, TaskStatus, TypeChip } from "./ui.jsx";

// "Mark done" dialog — the in-app version of the Google Form the doers used
// to fill: it records when the task was actually done and scores it.
function CompleteModal({ task, onClose, onDone }) {
  const toast = useToast();
  const [when, setWhen] = useState(nowLocalInput());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const updated = await api.wsCompleteTask(task._id, { actual: istInputToIso(when), note });
      toast(updated.status === "On Time" ? `On time — ${updated.ownerScore} pts` : "Marked done (late — 0 pts)", updated.status === "On Time" ? "good" : "default");
      onDone(updated);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Mark task done" sub={`${task.taskId} · ${task.task}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="form-hint" style={{ marginTop: 0 }}>
          Due <strong>{fmtDateTimeYear(task.planned)}</strong> (India time). Finished before that = full {task.score} pts, after = 0.
        </p>
        <label className="modal-field">When did you finish it? (India time)
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </label>
        <label className="modal-field">Note (optional)
          <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering…" />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Mark done"}</button>
        </div>
      </form>
    </Modal>
  );
}

// Admin: move the due time of one task.
function DueModal({ task, onClose, onDone }) {
  const toast = useToast();
  const iso = new Date(task.planned);
  // show current due in IST for editing
  const local = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(iso).replace(" ", "T");
  const [when, setWhen] = useState(local);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(await api.wsUpdateTask(task._id, { planned: istInputToIso(when) }));
      toast("Due time updated", "good");
      onClose();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Change due time" sub={`${task.taskId} · ${task.task}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="modal-field">New due date &amp; time (India time)
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function TaskTable({ tasks, onChange, showWorkshop = true, compact = false, view = "cards" }) {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [completing, setCompleting] = useState(null);
  const [editingDue, setEditingDue] = useState(null);

  const replace = (updated) => onChange(tasks.map((t) => (t._id === updated._id ? { ...t, ...updated } : t)));

  const reopen = async (t) => {
    try {
      replace(await api.wsReopenTask(t._id));
      toast("Task re-opened", "default");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  if (view === "sheet") {
    return (
      <>
        <div className="table-wrap ws-sheet-wrap">
          <table className="table ws-table ws-sheet">
            <thead>
              <tr>
                <th>Workshop ID</th><th>Workshop Date</th><th>Workshop Task ID</th><th>Task</th><th>Timeline</th><th>Task Owner</th><th>Email</th><th>Department</th>
                <th className="ws-num">Task Score</th><th>Planned Date</th><th>Actual Date</th><th>Status</th><th className="ws-num">Owner Score</th><th className="ws-num">Workshop Score</th><th>Buddy Email</th><th />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const mine = t.ownerEmail && t.ownerEmail === user.email;
                const canComplete = !t.actual && (isAdmin || mine);
                return (
                  <tr key={t._id} className={t.status === "Overdue" ? "ws-row-overdue" : t.actual ? "ws-row-done" : ""}>
                    <td className="ws-nowrap"><TypeChip code={t.workshopType} /> <strong>{t.workshopId}</strong></td>
                    <td className="ws-nowrap">{dmy(t.workshopDate)}</td>
                    <td className="ws-mono ws-nowrap">{t.taskId}</td>
                    <td className="ws-sheet-task" title={t.description || t.task}>
                      <span className="ws-task-name">{t.task}</span>
                      {t.description && <div className="muted wst-desc">{t.description}</div>}
                    </td>
                    <td><span className="ws-timeline">{t.timeline}</span></td>
                    <td className="ws-nowrap">{t.owner || <span className="muted">Unassigned</span>}{mine && <em className="ws-you"> you</em>}</td>
                    <td className="ws-nowrap muted">{t.ownerEmail}</td>
                    <td className="ws-nowrap">{t.department}</td>
                    <td className="ws-num">{t.score}</td>
                    <td className="ws-nowrap">{dmyhms(t.planned)}</td>
                    <td className="ws-nowrap">{t.actual ? dmyhms(t.actual) : <span className="muted">—</span>}</td>
                    <td><TaskStatus status={t.status} /></td>
                    <td className="ws-num">{t.actual ? <strong className={t.ownerScore ? "ws-pos" : "ws-zero"}>{t.ownerScore}</strong> : <span className="muted">—</span>}</td>
                    <td className="ws-num">{t.actual ? (t.workshopScore ?? t.score) : <span className="muted">—</span>}</td>
                    <td className="ws-nowrap muted">{t.buddyEmail || "—"}</td>
                    <td className="ws-actions">
                      {canComplete && <button type="button" className="btn-pill" onClick={() => setCompleting(t)}>Done</button>}
                      {isAdmin && !t.actual && <button type="button" className="link-btn" onClick={() => setEditingDue(t)}>Reschedule</button>}
                      {isAdmin && t.actual && <button type="button" className="link-btn" onClick={() => reopen(t)}>Re-open</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {completing && <CompleteModal task={completing} onClose={() => setCompleting(null)} onDone={replace} />}
        {editingDue && <DueModal task={editingDue} onClose={() => setEditingDue(null)} onDone={replace} />}
      </>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table ws-table">
          <thead>
            <tr>
              {showWorkshop && <th>Workshop</th>}
              <th>Task</th>
              {!compact && <th>Timeline</th>}
              <th>Owner</th>
              <th>Due</th>
              <th>Status</th>
              {!compact && <th>Done at</th>}
              <th className="ws-num">Score</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const mine = t.ownerEmail && t.ownerEmail === user.email;
              const canComplete = !t.actual && (isAdmin || mine);
              return (
                <tr key={t._id} className={t.status === "Overdue" ? "ws-row-overdue" : t.actual ? "ws-row-done" : ""}>
                  {showWorkshop && (
                    <td>
                      <div className="ws-cell-stack">
                        <span><TypeChip code={t.workshopType} /> <strong>{t.workshopId}</strong></span>
                        <span className="muted">{fmtDate(t.workshopDate)}</span>
                      </div>
                    </td>
                  )}
                  <td>
                    <div className="ws-cell-stack">
                      <span className="ws-task-name">{t.task}</span>
                      <span className="muted ws-mono">{t.taskId}</span>
                      {t.description && !compact && <span className="muted wst-desc" title={t.description}>{t.description}</span>}
                    </div>
                  </td>
                  {!compact && <td><span className="ws-timeline">{t.timeline}</span></td>}
                  <td>
                    {t.owner ? (
                      <span className="ws-owner">
                        <span className="avatar ws-avatar" style={avatarStyleFromString(t.owner)}>{initials(t.owner)}</span>
                        <span>{t.owner}{mine && <em className="ws-you"> you</em>}</span>
                      </span>
                    ) : (
                      <span className="muted">Unassigned</span>
                    )}
                  </td>
                  <td className="ws-nowrap">{fmtDateTimeYear(t.planned)}</td>
                  <td><TaskStatus status={t.status} /></td>
                  {!compact && <td className="ws-nowrap">{t.actual ? fmtDateTimeYear(t.actual) : <span className="muted">—</span>}</td>}
                  <td className="ws-num">
                    {t.actual ? <strong className={t.ownerScore ? "ws-pos" : "ws-zero"}>{t.ownerScore}</strong> : <span className="muted">—</span>}
                    <span className="muted"> / {t.score}</span>
                  </td>
                  <td className="ws-actions">
                    {canComplete && <button type="button" className="btn-pill" onClick={() => setCompleting(t)}>Done</button>}
                    {isAdmin && !t.actual && <button type="button" className="link-btn" onClick={() => setEditingDue(t)}>Reschedule</button>}
                    {isAdmin && t.actual && <button type="button" className="link-btn" onClick={() => reopen(t)}>Re-open</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {completing && <CompleteModal task={completing} onClose={() => setCompleting(null)} onDone={replace} />}
      {editingDue && <DueModal task={editingDue} onClose={() => setEditingDue(null)} onDone={replace} />}
    </>
  );
}
