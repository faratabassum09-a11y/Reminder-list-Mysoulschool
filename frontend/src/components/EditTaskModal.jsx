import React, { useState } from "react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import { FREQ_LABELS, FREQ_SUGGESTIONS, parseFrequencyInput } from "../utils/frequency.js";

function toDateInput(d) {
  if (!d) return "";
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function toDateTimeLocalInput(d) {
  if (!d) return "";
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// row: a populated Master (TaskInstance) row — row.task is the recurring
// Task definition, row itself is this one occurrence.
export default function EditTaskModal({ row, doers, onClose, onChanged }) {
  const task = row.task || {};
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [taskName, setTaskName] = useState(task.taskName || "");
  const [department, setDepartment] = useState(task.department || "");
  const [assignee, setAssignee] = useState(task.defaultAssignee?._id || task.defaultAssignee || "");
  const [startDate, setStartDate] = useState(toDateInput(task.startDate));
  const [freqInput, setFreqInput] = useState(FREQ_LABELS[task.frequency] || task.frequency || "");
  const [plannedLocal, setPlannedLocal] = useState(toDateTimeLocalInput(row.planned));

  const freqParsed = parseFrequencyInput(freqInput);

  const saveSchedule = async (e) => {
    e.preventDefault();
    if (!freqParsed) {
      setError('Couldn\'t understand that recurrence — try "Daily", "Weekly on Monday", "Monthly"…');
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.updateTask(task._id, {
        taskName,
        department,
        defaultAssignee: assignee || null,
        startDate: startDate ? new Date(startDate).toISOString() : task.startDate,
        frequency: freqParsed.code,
      });
      toast("Task updated — upcoming reminders refreshed to match", "good");
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveOccurrence = async (e) => {
    e.preventDefault();
    if (!plannedLocal) return;
    setBusy(true);
    setError("");
    try {
      await api.updateMaster(row._id, { planned: new Date(plannedLocal).toISOString() });
      toast("This occurrence's date/time was updated", "good");
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h3>Edit task</h3>
            <p className="modal-sub">{task.taskName} · {row.doer?.name}</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={saveSchedule}>
          <p className="form-hint" style={{ marginTop: 0 }}>
            Changes here update the recurring pattern going forward — pending reminders are
            regenerated to match, and the total/consolidated counts update with them. Already
            completed history is never touched.
          </p>
          <label className="modal-field">Task Name
            <input value={taskName} onChange={(e) => setTaskName(e.target.value)} required />
          </label>
          <label className="modal-field">Department
            <input value={department} onChange={(e) => setDepartment(e.target.value)} required />
          </label>
          <label className="modal-field">Assignee
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Assignee</option>
              {doers.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
          </label>
          <label className="modal-field">Recurs
            <input
              list="edit-freq-suggestions"
              value={freqInput}
              onChange={(e) => setFreqInput(e.target.value)}
              placeholder="e.g. Daily, Weekly on Monday, Monthly"
            />
            <datalist id="edit-freq-suggestions">
              {FREQ_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>
          {freqInput && (
            freqParsed
              ? <span className="freq-preview-chip">→ {freqParsed.label}</span>
              : <span className="freq-preview-chip freq-preview-bad">Not recognized yet — try "Daily", "Weekly on Monday", "Monthly"…</span>
          )}
          <label className="modal-field" style={{ marginTop: 12 }}>Schedule starts from
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save recurring settings"}</button>
          </div>
        </form>

        <hr className="modal-divider" />

        <form onSubmit={saveOccurrence}>
          <p className="form-hint" style={{ marginTop: 0 }}>
            Or just fix the date/time of this one occurrence, without changing the recurring pattern.
          </p>
          <label className="modal-field">This occurrence's planned date &amp; time
            <input type="datetime-local" value={plannedLocal} onChange={(e) => setPlannedLocal(e.target.value)} required />
          </label>
          <div className="modal-actions">
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save this occurrence only"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
