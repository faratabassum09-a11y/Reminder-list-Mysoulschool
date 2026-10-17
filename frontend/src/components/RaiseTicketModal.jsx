import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";

// Same fields as the Google "Help Ticket" form: Raised By, PC Accountable,
// Issue, Problem Assigned To, Planned Date + Time of Resolution.
// Match a typed name to a person: exact full name, else a unique first name.
// Returns { match } on success or { error } when nothing/too many match.
function resolveName(list, text, label) {
  const typed = text.trim().toLowerCase();
  const full = (d) => d.name.trim().toLowerCase();
  const exact = list.filter((d) => full(d) === typed);
  if (exact.length === 1) return { match: exact[0] };
  const partial = list.filter((d) => full(d).split(/\s+/)[0] === typed);
  if (exact.length === 0 && partial.length === 1) return { match: partial[0] };
  if (exact.length > 1 || partial.length > 1) return { error: `More than one person matches "${text.trim()}" in ${label} — type the full name` };
  return { error: `No person named "${text.trim()}" found in ${label}` };
}

export default function RaiseTicketModal({ meta, onClose, onCreated }) {
  const toast = useToast();
  const [raisedName, setRaisedName] = useState("");
  const [pcName, setPcName] = useState("");
  const [issue, setIssue] = useState("");
  const [assignedName, setAssignedName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    // Raised By: admins type any name; everyone else is themselves.
    let raisedBy = meta.me?._id;
    if (meta.canPickRaiser) {
      const r = resolveName(meta.doers, raisedName, "Raised By");
      if (r.error) return setError(r.error);
      raisedBy = r.match._id;
    }

    // Can't raise to yourself, so the raiser is excluded from Assigned To.
    const a = resolveName(meta.doers.filter((d) => d._id !== raisedBy), assignedName, "Assigned To");
    if (a.error) return setError(a.error);

    // PC Accountable is optional.
    let pcAccountable = null;
    if (pcName.trim()) {
      const p = resolveName(meta.pcDoers, pcName, "PC Accountable");
      if (p.error) return setError(p.error);
      pcAccountable = p.match._id;
    }

    setBusy(true);
    try {
      // Date + time are entered in the person's local time; send as an instant.
      const plannedResolution = date ? new Date(`${date}T${time || "18:00"}`).toISOString() : null;
      const ticket = await api.createTicket({
        raisedBy: raisedBy || undefined,
        assignedTo: a.match._id,
        pcAccountable,
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
              <>
                <input
                  list="raised-options"
                  value={raisedName}
                  onChange={(e) => setRaisedName(e.target.value)}
                  placeholder="Type a name"
                  autoComplete="off"
                  required
                />
                <datalist id="raised-options">
                  {meta.doers.map((d) => <option key={d._id} value={d.name} />)}
                </datalist>
              </>
            ) : (
              <input value={meta.me?.name || ""} disabled readOnly />
            )}
          </label>

          <label className="modal-field">Problem Assigned To *
            <input
              list="assignee-options"
              value={assignedName}
              onChange={(e) => setAssignedName(e.target.value)}
              placeholder="Type a name"
              autoComplete="off"
              required
            />
            <datalist id="assignee-options">
              {meta.doers.map((d) => <option key={d._id} value={d.name}>{d.department || ""}</option>)}
            </datalist>
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
            <input
              list="pc-options"
              value={pcName}
              onChange={(e) => setPcName(e.target.value)}
              placeholder="Type a name"
              autoComplete="off"
            />
            <datalist id="pc-options">
              {meta.pcDoers.map((d) => <option key={d._id} value={d.name} />)}
            </datalist>
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
            <button type="submit" className="btn-raise" disabled={busy}>{busy ? "Raising…" : "Raise ticket"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
