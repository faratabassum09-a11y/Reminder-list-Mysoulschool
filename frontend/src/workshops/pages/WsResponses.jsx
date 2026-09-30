import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api.js";
import PageHeader from "../../components/PageHeader.jsx";
import SearchInput from "../../components/SearchInput.jsx";
import TableSkeleton from "../../components/TableSkeleton.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../components/Toast.jsx";
import { usePolling } from "../../hooks/usePolling.js";
import { downloadCsv } from "../../utils/csv.js";
import { fmtDateTimeYear, dmy, dmyhms, hms } from "../../utils/wsFormat.js";
import { Empty, TypeChip, WorkshopStatus } from "../ui.jsx";

// The in-app version of the two Google Forms:
//  • Task responses  — the "task done" form (Workshop Task ID + when it was done).
//    Submitting it marks the task done and scores it.
//  • New workshop responses — every "new workshop" form entry and where it stands.
export default function WsResponses({ onChanged }) {
  const { isAdmin, canRequestWorkshops } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "new" && canRequestWorkshops ? "new" : "task");
  const [busyId, setBusyId] = useState(null);
  const [responses, setResponses] = useState(null);
  const [workshops, setWorkshops] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const load = () => {
    api.wsResponses().then(setResponses).catch((e) => setError(e.message));
    if (canRequestWorkshops) api.wsList().then(setWorkshops).catch(() => {});
  };
  useEffect(load, []);
  usePolling(load, 30000);


  // Admin-only: approving a form response creates its fixed task list automatically.
  const approve = async (w) => {
    setBusyId(w._id);
    try {
      const res = await api.wsApprove(w._id);
      toast(`${res.workshopId} approved — ${res.tasksGenerated} task${res.tasksGenerated === 1 ? "" : "s"} created`, res.tasksGenerated ? "good" : "default");
      if (!res.tasksGenerated) toast("This type has no task list yet — add one under Task Lists", "bad");
      load();
      onChanged?.();
    } catch (err) {
      toast(err.message, "bad");
      load();
    } finally {
      setBusyId(null);
    }
  };
  const reject = async (w) => {
    const note = window.prompt(`Reason for rejecting ${w.workshopId} (shown to the requester):`, "");
    if (note === null) return;
    try {
      await api.wsReject(w._id, note);
      toast("Request rejected", "default");
      load();
      onChanged?.();
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const needle = q.trim().toLowerCase();
  const rRows = useMemo(
    () => (responses || []).filter((r) => !needle || [r.taskId, r.workshopId, r.taskName, r.owner, r.submittedByName].join(" ").toLowerCase().includes(needle)),
    [responses, needle]
  );
  const wRows = useMemo(
    () => (workshops || []).filter((w) => !needle || [w.workshopId, w.typeName, w.name, w.goal, w.requestedByName, w.status].join(" ").toLowerCase().includes(needle)),
    [workshops, needle]
  );

  const exportCsv = () =>
    tab === "task"
      ? downloadCsv("workshop-task-responses.csv",
          ["Timestamp", "Task ID", "Workshop ID", "Task", "Owner", "Planned", "Actual", "Outcome", "Score", "Owner Score", "Submitted by", "Note"],
          rRows.map((r) => [fmtDateTimeYear(r.createdAt), r.taskId, r.workshopId, r.taskName, r.owner, fmtDateTimeYear(r.planned), fmtDateTimeYear(r.actual), r.outcome, r.score, r.ownerScore, r.submittedByName, r.note]))
      : downloadCsv("new-workshop-responses.csv",
          ["Timestamp", "Email address", "Workshop Days", "Select Workshop", "Start Date", "Start Time", "Start Day", "Workshop ID", "Workshop Goal", "Workshop Name", "Status", "Reviewed by"],
          wRows.map((w) => [dmyhms(w.submittedAt || w.createdAt), w.requestedByEmail, w.days, w.typeName, dmy(w.startDate), hms(w.startTime), w.startDay, w.workshopId, w.goal, w.name || w.typeName, w.status, w.reviewedByName]));

  return (
    <div className="page">
      <PageHeader
        title="Form responses"
        subtitle={isAdmin ? "Every task-done and new-workshop form submission. Approving a new workshop creates its fixed tasks automatically." : canRequestWorkshops ? "Task-done responses, and every new-workshop form you submitted with its approval status." : "Your task-done responses. Mark a task done from the Tasks page; you only see your own responses."}
      />

      {error && <p className="error">{error}</p>}

      <div className="toolbar">
        <div className="range-pills">
          <button type="button" className={"range-pill" + (tab === "task" ? " range-pill-active" : "")} onClick={() => setTab("task")}>Task responses</button>
          {canRequestWorkshops && <button type="button" className={"range-pill" + (tab === "new" ? " range-pill-active" : "")} onClick={() => setTab("new")}>New workshop form responses{isAdmin && workshops ? ` (${workshops.filter((w) => w.status === "pending").length} pending)` : ""}</button>}
        </div>
        <div className="filter-row">
          <SearchInput value={q} onChange={setQ} placeholder="Search…" />
          <button type="button" className="btn-ghost ws-small-btn" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      {tab === "task" ? (
        !responses ? (
          <div className="table-wrap"><table className="table ws-table"><tbody><TableSkeleton rows={6} columns={8} /></tbody></table></div>
        ) : rRows.length === 0 ? (
          <Empty icon="📝" title="No task responses yet">Mark a task done from My Tasks and it will appear here.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table ws-table">
              <thead><tr><th>Timestamp</th><th>Task ID</th><th>Workshop</th><th>Task</th><th>Owner</th><th>Planned</th><th>Actual</th><th>Outcome</th><th>Score</th></tr></thead>
              <tbody>
                {rRows.map((r) => (
                  <tr key={r._id}>
                    <td>{fmtDateTimeYear(r.createdAt)}</td>
                    <td>{r.taskId}</td>
                    <td><TypeChip code={r.workshopType} /> {r.workshopId}</td>
                    <td>{r.taskName}</td>
                    <td>{r.owner}</td>
                    <td>{fmtDateTimeYear(r.planned)}</td>
                    <td>{fmtDateTimeYear(r.actual)}</td>
                    <td>{r.outcome}</td>
                    <td>{r.ownerScore}/{r.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : !workshops ? (
        <div className="table-wrap"><table className="table ws-table"><tbody><TableSkeleton rows={6} columns={7} /></tbody></table></div>
      ) : wRows.length === 0 ? (
        <Empty icon="🗓" title="No workshop responses yet">{canRequestWorkshops ? "Add one from New Workshop." : "Approved workshops will appear here."}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table ws-table">
            <thead><tr><th>Timestamp</th><th>Email address</th><th>Workshop Days</th><th>Select Workshop</th><th>Start Date</th><th>Start Time</th><th>Start Day</th><th>Workshop ID</th><th>Workshop Goal</th><th>Workshop Name</th><th>Status</th>{isAdmin && <th />}</tr></thead>
            <tbody>
              {wRows.map((w) => (
                <tr key={w._id} className={w.status === "pending" && isAdmin ? "row-needs-check" : w.status === "rejected" ? "row-rejected" : ""}>
                  <td className="ws-nowrap">{dmyhms(w.submittedAt || w.createdAt)}</td>
                  <td className="ws-nowrap">{w.requestedByEmail || "—"}</td>
                  <td>{w.days}</td>
                  <td className="ws-nowrap">{w.typeName}</td>
                  <td className="ws-nowrap">{dmy(w.startDate)}</td>
                  <td className="ws-nowrap">{hms(w.startTime)}</td>
                  <td>{w.startDay}</td>
                  <td className="ws-nowrap"><TypeChip code={w.type} /> <strong>{w.workshopId}</strong></td>
                  <td style={{ minWidth: 200, whiteSpace: "normal" }}>{w.goal || <span className="muted">—</span>}</td>
                  <td>{w.name || w.typeName}</td>
                  <td>
                    <WorkshopStatus status={w.status} />
                    {w.status !== "pending" && w.reviewedByName && <div className="muted ws-tiny">by {w.reviewedByName}{w.status === "approved" ? ` · ${w.tasksGenerated} tasks` : ""}</div>}
                    {w.status === "rejected" && w.reviewNote && <div className="ws-reason">“{w.reviewNote}”</div>}
                  </td>
                  {isAdmin && (
                    <td className="ws-actions">
                      {w.status === "pending" && (
                        <>
                          <button type="button" className="btn-pill" disabled={busyId === w._id} onClick={() => approve(w)}>{busyId === w._id ? "Approving…" : "Approve"}</button>
                          <button type="button" className="link-btn danger" onClick={() => reject(w)}>Reject</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
