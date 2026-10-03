import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";

// Same fields as the Google "Help Ticket" form: Raised By, PC Accountable,
// Issue, Problem Assigned To, Planned Date + Time of Resolution.
export default function RaiseTicketModal({ meta, onClose, onCreated }) {
  const toast = useToast();
  const [raisedBy, setRaisedBy] = useState(meta.me?._id || "");
  const [pc, setPc] = useState("");
  const [issue, setIssue] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Can't raise to yourself, so drop the raiser from the assignee list.
  const assignees = meta.doers.filter((d) => d._id !== raisedBy);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Date + time are entered in the person's local time; send as an instant.
      const plannedResolution = date ? new Date(`${date}T${time || "18:00"}`).toISOString() : null;
      const ticket = await api.createTicket({
        raisedBy: raisedBy || undefined,
        assignedTo,
        pcAccountable: pc || null,
        issue,
        plannedResolution,
      });
      toast(`Ticket #${ticket.ticketNo} raised to ${ticket.assignedTo?.name}`, "good");
      onCreated(ticket);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Raise a help ticket">
        <div className="modal-head">
          <div>
            <h3>Raise a help ticket</h3>
            <p className="modal-sub">Only the person you assign it to (and admins) will see it.</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={submit}>
          <label className="modal-field">Raised By *
            {meta.canPickRaiser ? (
              <select value={raisedBy} onChange={(e) => setRaisedBy(e.target.value)} required>
                <option value="">Choose</option>
                {meta.doers.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
              </select>
            ) : (
              <input value={meta.me?.name || ""} disabled readOnly />
            )}
          </label>

          <label className="modal-field">Problem Assigned To *
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} required>
              <option value="">Choose</option>
              {assignees.map((d) => (
                <option key={d._id} value={d._id}>{d.name}{d.department ? ` — ${d.department}` : ""}</option>
              ))}
            </select>
          </label>

          <label className="modal-field">Issue *
            <textarea
              rows={4}
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              maxLength={4000}
              placeholder="What do you need help with?"
              required
            />
          </label>

          <label className="modal-field">PC Accountable For Help Ticket
            <select value={pc} onChange={(e) => setPc(e.target.value)}>
              <option value="">Choose</option>
              {meta.pcDoers.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
          </label>

          <div className="ticket-when">
            <label className="modal-field">Planned Date Of Resolution
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="modal-field">Time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
            </label>
          </div>

          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={busy}>{busy ? "Raising…" : "Raise ticket"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
