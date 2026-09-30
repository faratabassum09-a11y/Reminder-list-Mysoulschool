import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import ConfirmDeleteButton from "../../components/ConfirmDeleteButton.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../components/Toast.jsx";
import TaskTable from "../TaskTable.jsx";
import { EditWorkshopModal } from "./WsRequests.jsx";
import { Empty, ProgressBar, StatCard, SyncBadge, TypeChip, WorkshopStatus } from "../ui.jsx";
import { fmtDate, fmtDateTimeYear, fmtTime12, relativeDays } from "../../utils/wsFormat.js";

export default function WsWorkshopDetail({ onChanged }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [w, setW] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [resending, setResending] = useState(false);

  const load = () => api.wsGet(id).then(setW).catch((e) => setError(e.message));
  useEffect(() => { setW(null); load(); }, [id]);

  if (error) return <div className="page"><p className="error">{error}</p><Link to="/workshops/plan">← Back to workshops</Link></div>;
  if (!w) return <div className="page"><div className="skeleton-bar" style={{ height: 120, marginBottom: 16 }} /><div className="skeleton-bar" style={{ height: 260 }} /></div>;

  const done = w.tasks.filter((t) => t.actual).length;
  const overdue = w.tasks.filter((t) => t.status === "Overdue").length;
  const onTime = w.tasks.filter((t) => t.outcome === "On Time").length;
  const earned = w.tasks.reduce((s, t) => s + (t.ownerScore || 0), 0);
  const possible = w.tasks.filter((t) => t.actual).reduce((s, t) => s + t.score, 0);

  const resend = async () => {
    setResending(true);
    try {
      const res = await api.wsResendLaunch(w._id);
      setW((prev) => ({ ...prev, launchSync: res.launchSync }));
      toast(res.launchSync.status === "sent" ? "Launch sent to Launch Verification" : `Launch not sent: ${res.launchSync.error}`, res.launchSync.status === "sent" ? "good" : "bad");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setResending(false);
    }
  };

  const generate = async () => {
    try {
      await api.wsGenerateTasks(w._id);
      toast("Tasks created and assigned", "good");
      load();
      onChanged?.();
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const remove = async () => {
    try {
      await api.wsRemove(w._id);
      toast(`Deleted ${w.workshopId}`, "bad");
      onChanged?.();
      navigate("/workshops/plan");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  return (
    <div className="page">
      <Link to="/workshops/plan" className="ws-back">← All workshops</Link>

      <section className={`ws-hero ws-hero-${w.type}`}>
        <div className="ws-hero-main">
          <div className="ws-hero-tags"><TypeChip code={w.type} /> <WorkshopStatus status={w.status} /> {w.status === "approved" && <SyncBadge sync={w.launchSync} />}</div>
          <h1>{w.workshopId}</h1>
          <p className="ws-hero-sub">{w.name || w.typeName} · {w.days} day{w.days > 1 ? "s" : ""}</p>
          {w.goal && <p className="ws-hero-sub">🎯 {w.goal}</p>}
          <dl className="ws-hero-meta">
            <div><dt>Starts</dt><dd>{w.startDay}, {fmtDate(w.startDate)} · {fmtTime12(w.startTime)}</dd></div>
            <div><dt>When</dt><dd>{relativeDays(w.startDate)}</dd></div>
            <div><dt>Requested by</dt><dd>{w.requestedByName || "—"}</dd></div>
            {w.reviewedAt && <div><dt>Approved</dt><dd>{fmtDateTimeYear(w.reviewedAt)}{w.reviewedByName ? ` · ${w.reviewedByName}` : ""}</dd></div>}
          </dl>
        </div>
        {isAdmin && (
          <div className="ws-hero-actions">
            <button type="button" onClick={() => setEditing(true)}>Reschedule</button>
            <button type="button" className="btn-ghost" disabled={resending} onClick={resend}>{resending ? "Sending…" : "Resend launch"}</button>
            <ConfirmDeleteButton onConfirm={remove} label="Delete workshop" />
          </div>
        )}
      </section>

      {w.launchSync?.status === "failed" && <p className="ws-warn">The hand-off to Launch Verification failed: {w.launchSync.error}. Use “Resend launch” once it's fixed.</p>}

      <div className="cards" style={{ marginTop: 16 }}>
        <StatCard label="Tasks done" value={`${done}/${w.tasks.length}`} tone="accent" />
        <StatCard label="Overdue" value={overdue} tone={overdue ? "bad" : "good"} />
        <StatCard label="On time" value={done ? `${Math.round((onTime / done) * 100)}%` : "—"} tone="good" />
        <StatCard label="Score earned" value={possible ? `${earned}/${possible}` : "—"} tone="neutral" />
      </div>
      <ProgressBar done={done} total={w.tasks.length} overdue={overdue} />

      <h2 className="ws-section">Task list</h2>
      {w.tasks.length === 0 ? (
        <Empty icon="📝" title="No tasks on this workshop">
          {w.status === "approved" ? "Its task list was empty when it was approved. Add tasks under Task Lists — they are created here automatically — or create them now." : "Tasks are created when the request is approved."}
          {isAdmin && w.status === "approved" && <div style={{ marginTop: 10 }}><button type="button" onClick={generate}>Create tasks now</button></div>}
        </Empty>
      ) : (
        <TaskTable tasks={w.tasks} onChange={(tasks) => setW((p) => ({ ...p, tasks }))} showWorkshop={false} />
      )}
      {editing && <EditWorkshopModal workshop={w} onClose={() => setEditing(false)} onDone={() => { load(); onChanged?.(); }} />}
    </div>
  );
}
