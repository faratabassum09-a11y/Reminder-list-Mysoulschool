import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api.js";
import PageHeader from "../../components/PageHeader.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import TaskTable from "../TaskTable.jsx";
import { Empty, ProgressBar, StatCard, TypeChip } from "../ui.jsx";
import { fmtDate, fmtWeekday, fmtTime12, relativeDays, daysUntil } from "../../utils/wsFormat.js";

export default function WsOverview({ stats }) {
  const { isAdmin, user, canRequestWorkshops } = useAuth();
  const navigate = useNavigate();
  const [workshops, setWorkshops] = useState(null);
  const [myTasks, setMyTasks] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    if (canRequestWorkshops) api.wsList("?status=approved").then(setWorkshops).catch((e) => setError(e.message));
    api.wsTasks("?mine=1&status=open").then((r) => setMyTasks(r.slice(0, 8))).catch(() => setMyTasks([]));
  };
  useEffect(load, []);

  const upcoming = (workshops || []).filter((w) => daysUntil(w.startDate) >= 0).sort((a, b) => new Date(a.startDate) - new Date(b.startDate)).slice(0, 6);

  return (
    <div className="page">
      <PageHeader title="Workshop overview" subtitle="What's coming up, what's waiting on you, and how each workshop's prep is going." />

      {isAdmin && stats?.pendingApproval > 0 && (
        <button type="button" className="check-alert" onClick={() => navigate("/workshops/requests")}>
          <span className="check-alert-dot" />
          <span><strong>{stats.pendingApproval}</strong> workshop request{stats.pendingApproval === 1 ? "" : "s"} waiting for your approval</span>
          <span className="check-alert-cta">Review →</span>
        </button>
      )}

      {!canRequestWorkshops ? (
        <div className="cards">
          <StatCard label="My open tasks" value={stats ? stats.myOpen : "…"} tone="accent" onClick={() => navigate("/workshops/tasks?status=open")} />
          <StatCard label="My overdue" value={stats ? stats.myOverdue : "…"} tone={stats?.myOverdue ? "bad" : "good"} onClick={() => navigate("/workshops/tasks?status=Overdue")} />
        </div>
      ) : (
      <div className="cards">
        <StatCard label="Upcoming workshops" value={stats ? stats.upcoming : "…"} tone="accent" />
        <StatCard label="Open tasks" value={stats ? stats.openTasks : "…"} tone="neutral" hint={stats ? `${stats.dueThisWeek} due in 7 days` : ""} onClick={() => navigate("/workshops/tasks")} />
        <StatCard label="Overdue" value={stats ? stats.overdueTasks : "…"} tone={stats?.overdueTasks ? "bad" : "good"} onClick={() => navigate("/workshops/tasks?status=Overdue")} />
        <StatCard label="On-time rate" value={stats ? (stats.onTimePct === null ? "—" : stats.onTimePct + "%") : "…"} tone="good" hint={stats ? `${stats.doneTasks} tasks completed` : ""} />
      </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className={canRequestWorkshops ? "ws-two-col" : ""}>
        {canRequestWorkshops && <section className="ws-panel">
          <div className="ws-panel-head">
            <h2>Next workshops</h2>
            <Link to="/workshops/plan">All workshops →</Link>
          </div>
          {!workshops ? (
            <div className="skeleton-bar" style={{ height: 160 }} />
          ) : upcoming.length === 0 ? (
            <Empty icon="📅" title="Nothing scheduled">
              Add a workshop and, once approved, its fixed task list is created automatically. {canRequestWorkshops && <Link to="/workshops/new">Add a workshop</Link>}
            </Empty>
          ) : (
            <ul className="ws-upcoming">
              {upcoming.map((w) => (
                <li key={w._id}>
                  <Link to={`/workshops/plan/${w.workshopId}`} className="ws-upcoming-item">
                    <div className="ws-date-tile">
                      <span>{fmtWeekday(w.startDate)}</span>
                      <strong>{new Date(w.startDate).getUTCDate()}</strong>
                      <span>{new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(w.startDate))}</span>
                    </div>
                    <div className="ws-upcoming-body">
                      <div className="ws-upcoming-title">
                        <TypeChip code={w.type} /> <strong>{w.workshopId}</strong>
                        <span className="ws-when">{relativeDays(w.startDate)}</span>
                      </div>
                      <div className="muted">{w.days} day{w.days > 1 ? "s" : ""} · starts {fmtTime12(w.startTime)}</div>
                      <ProgressBar done={w.progress.done} total={w.progress.total} overdue={w.progress.overdue} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>}

        <section className="ws-panel">
          <div className="ws-panel-head">
            <h2>Your open tasks</h2>
            <Link to="/workshops/tasks?mine=1">See all →</Link>
          </div>
          {!myTasks ? (
            <div className="skeleton-bar" style={{ height: 160 }} />
          ) : myTasks.length === 0 ? (
            <Empty icon="✅" title="You're all caught up">No open workshop tasks are assigned to {user.name.split(" ")[0]}.</Empty>
          ) : (
            <TaskTable tasks={myTasks} onChange={(t) => { setMyTasks(t.filter((x) => !x.actual)); }} compact />
          )}
        </section>
      </div>
    </div>
  );
}
