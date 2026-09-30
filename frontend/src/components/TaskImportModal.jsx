import React, { useRef, useState } from "react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Couldn't read that file"));
    r.readAsDataURL(file);
  });

// Import tasks straight from the "Reminder List - Task List" PDF (or pasted
// text): 1) read it, 2) preview what was found, 3) add every row to the Task
// List and create its Master rows up to the Schedule Horizon.
export default function TaskImportModal({ onClose, onDone }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [mode, setMode] = useState("pdf"); // pdf | text
  const [pasted, setPasted] = useState("");
  const [parsed, setParsed] = useState(null); // { rows, skipped, sentMarkers }
  const [startDate, setStartDate] = useState("2026-10-02");
  const [keepWeekdays, setKeepWeekdays] = useState(false);
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const readSource = async () => {
    setError("");
    setParsed(null);
    setResult(null);
    setBusy(true);
    try {
      let body;
      if (mode === "pdf") {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error("Choose the PDF file first");
        if (file.size > 2 * 1024 * 1024) throw new Error("That PDF is over 2 MB — use “Paste text” instead");
        body = { pdfBase64: await fileToBase64(file) };
      } else {
        if (!pasted.trim()) throw new Error("Paste the task rows first");
        body = { text: pasted };
      }
      const r = await api.importTaskParse(body);
      if (!r.rows.length) throw new Error("No task rows were found in that file. Try “Paste text”.");
      setParsed(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const payload = (extra = {}) => ({ rows: parsed.rows, startDate, keepWeekdays, reset, ...extra });

  const run = async () => {
    setError("");
    setBusy(true);
    try {
      const p = await api.importTaskList(payload({ dryRun: true }));
      const msg =
        `Import ${parsed.rows.length} tasks?\n\n• ${p.created} new tasks will be added\n• ${p.updated} tasks already in your list will restart from ${startDate}` +
        (reset ? `\n• ${p.resetTasksDeleted} tasks from an earlier import will be deleted first` : "") +
        `\n• Schedule Horizon: ${p.horizon || "NOT SET — set it in Settings first, or no Master rows will be created"}` +
        (p.repeatedRows && !keepWeekdays ? `\n• ${p.repeatedRows} repeated rows will create identical reminders (tick “Keep each task's weekday” to avoid that)` : "") +
        (p.missingDoers.length ? `\n• Skipped (not in Doer List): ${p.missingDoers.join(", ")}` : "") +
        `\n\nIt runs in the background and can take a few minutes — keep this window open.`;
      if (!window.confirm(msg)) return;
      await api.importTaskList(payload());
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        let j;
        try { j = await api.importTaskListStatus(); } catch { continue; }
        if (j.state === "running") setProgress(`Importing… ${j.done || 0} of ${j.total || "…"} tasks · ${(j.generated || 0).toLocaleString()} Master rows so far`);
        else {
          if (j.state === "error") throw new Error(j.error || "Import failed");
          setResult(j);
          setProgress("");
          toast(`Done: ${j.created} added, ${j.updated} updated, ${(j.generated || 0).toLocaleString()} Master rows created`, "good");
          onDone?.();
          break;
        }
      }
    } catch (err) {
      setError(err.message);
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  const byPerson = parsed ? Object.entries(parsed.rows.reduce((m, r) => ((m[r.doerName] = (m[r.doerName] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 720, width: "94vw", maxHeight: "90vh", overflow: "auto" }}>
        <div className="modal-head">
          <div>
            <h3>Import tasks from PDF</h3>
            <p className="modal-sub">Upload the “Reminder List – Task List” PDF. Every row becomes a task, and its Master rows are generated up to your Schedule Horizon.</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        {!result && (
          <>
            <div className="toolbar" style={{ gap: 8, marginBottom: 10 }}>
              <button type="button" className={"link-btn" + (mode === "pdf" ? " generate-btn" : "")} onClick={() => setMode("pdf")} disabled={busy}>📄 PDF file</button>
              <button type="button" className={"link-btn" + (mode === "text" ? " generate-btn" : "")} onClick={() => setMode("text")} disabled={busy}>📋 Paste text</button>
            </div>
            {mode === "pdf" ? (
              <label className="modal-field">PDF file
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={() => setParsed(null)} />
              </label>
            ) : (
              <label className="modal-field">Task rows (Task · Doer · Department · Frequency · Date · Status)
                <textarea rows={7} value={pasted} onChange={(e) => { setPasted(e.target.value); setParsed(null); }} placeholder="Paste the rows copied from the Google Sheet or the PDF…" />
              </label>
            )}
            <button type="button" className="btn-pill" onClick={readSource} disabled={busy}>{busy && !parsed ? "Reading…" : "1. Read the file"}</button>
          </>
        )}

        {parsed && !result && (
          <div style={{ marginTop: 16 }}>
            <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
              Found {parsed.rows.length} tasks{parsed.sentMarkers ? ` (the file has ${parsed.sentMarkers} “Sent” rows)` : ""}
              {parsed.skipped.length ? ` · ${parsed.skipped.length} could not be read` : ""}
            </p>
            <p className="form-hint" style={{ marginTop: 0 }}>{byPerson.map(([n, c]) => `${n} ${c}`).join(" · ")}</p>
            {parsed.skipped.length > 0 && (
              <details style={{ marginBottom: 10 }}>
                <summary>Rows that could not be read ({parsed.skipped.length})</summary>
                <ul style={{ fontSize: 12, margin: "6px 0", paddingLeft: 18 }}>
                  {parsed.skipped.map((s, i) => <li key={i}>{s.reason}: {s.line}</li>)}
                </ul>
              </details>
            )}
            <div className="table-wrap" style={{ maxHeight: 180, overflow: "auto", marginBottom: 12 }}>
              <table>
                <thead><tr><th>Task</th><th>Person</th><th>Freq</th><th>Time</th></tr></thead>
                <tbody>
                  {parsed.rows.slice(0, 8).map((r, i) => (
                    <tr key={i}><td>{r.taskName}</td><td>{r.doerName}</td><td>{r.frequency}</td><td>{r.startTime || "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>Showing the first 8 of {parsed.rows.length}.</p>

            <label className="modal-field" style={{ maxWidth: 220 }}>Start date for every task
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label style={{ display: "flex", gap: 8, fontSize: 13, margin: "6px 0" }}>
              <input type="checkbox" checked={keepWeekdays} onChange={(e) => setKeepWeekdays(e.target.checked)} />
              <span>Keep each task's own weekday / day of the month (recommended when the same task appears several times on different days)</span>
            </label>
            <label style={{ display: "flex", gap: 8, fontSize: 13, margin: "6px 0 14px" }}>
              <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
              <span>Clean re-import: first delete tasks from this list that an earlier import added in the last 14 days (only ones with no completed history)</span>
            </label>
            <button type="button" className="btn-pill" onClick={run} disabled={busy}>{busy ? progress || "Working…" : `2. Import all ${parsed.rows.length} tasks`}</button>
          </div>
        )}

        {result && (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontWeight: 700, margin: "0 0 6px" }}>Done.</p>
            <ul style={{ fontSize: 13.5, paddingLeft: 18, margin: 0 }}>
              <li>{result.created} tasks added, {result.updated} existing tasks restarted from {startDate}</li>
              <li>{(result.generated || 0).toLocaleString()} Master rows created{result.horizon ? ` up to ${result.horizon}` : ""}</li>
              {result.verify && <li>Check: {result.verify.tasksInList} of {result.verify.expectedTasks} tasks are in the Task List; {result.verify.tasksWithMasterRows} have Master rows{result.verify.tasksWithoutRows ? ` (${result.verify.tasksWithoutRows} have none — see below)` : ""}</li>}
              {result.horizonMissing && <li><strong>The Schedule Horizon isn't set</strong> — set it in Settings, then open Master; the rows are created automatically.</li>}
              {result.missingDoers?.length > 0 && <li>Skipped, not in Doer List: {result.missingDoers.join(", ")}</li>}
            </ul>
            {result.verify?.tasksWithoutRows > 0 && !result.horizonMissing && (
              <p className="form-hint">Tasks with no Master rows are usually weekly/monthly tasks whose first date is after your Schedule Horizon. Extend the horizon in Settings.</p>
            )}
            <button type="button" className="btn-pill" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
          </div>
        )}

        {progress && busy && parsed && <p className="form-hint">{progress}</p>}
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      </div>
    </div>
  );
}
