import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const [summary, setSummary] = useState(null);
  const [archives, setArchives] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  const loadArchives = () => api.getArchives().then(setArchives).catch(() => {});

  useEffect(() => {
    api.getSummary().then(setSummary).catch((e) => setError(e.message));
    loadArchives();
  }, []);

  const pct = summary?.total ? Math.round((summary.onTime / summary.total) * 100) : 0;

  // Logs the current totals as a dated snapshot — the equivalent of the
  // original's weekly "archive" button. Unlike the original, this never
  // resets the live numbers; Master is one continuous dataset here, not a
  // sheet that gets wiped each week, so archiving is just a history log.
  const archiveNow = async () => {
    setArchiving(true);
    try {
      await api.archiveDashboard();
      loadArchives();
      toast("Snapshot saved to Archive", "good");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setArchiving(false);
    }
  };

  const removeArchive = async (a) => {
    try {
      await api.removeArchive(a._id);
      setArchives((prev) => prev.filter((x) => x._id !== a._id));
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle="Overview of all reminder tasks across the team"
        meta={
          isAdmin && (
            <button type="button" className="link-btn generate-btn" disabled={archiving} onClick={archiveNow}
              title="Log today's totals to the Archive below">
              {archiving ? "Saving…" : "📸 Archive Snapshot"}
            </button>
          )
        }
      />
      {error && <p className="error">{error}</p>}

      <div className="cards">
        {[
          { label: "Total Tasks", value: summary?.total, cls: "" },
          { label: "On Time", value: summary?.onTime, cls: "card-good" },
          { label: "Delayed", value: summary?.delayed, cls: "card-bad" },
          { label: "Pending", value: summary?.pending, cls: "card-neutral" },
          { label: "On-Time Rate", value: summary ? `${pct}%` : undefined, cls: "card-accent" },
        ].map((c) => (
          <div className={`card ${c.cls}`} key={c.label}>
            <div className="card-label">{c.label}</div>
            <div className="card-value">
              {c.value === undefined ? <span className="skeleton-bar" style={{ width: 44, height: 22 }} /> : (typeof c.value === "number" ? c.value.toLocaleString() : c.value)}
            </div>
          </div>
        ))}
      </div>

      <h2>By Department</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Department</th>
              <th>Total</th>
              <th>On Time</th>
              <th>Delayed</th>
              <th>On-Time %</th>
            </tr>
          </thead>
          <tbody>
            {!summary && <TableSkeleton columns={5} rows={5} />}
            {summary?.byDepartment.map((d) => (
              <tr key={d._id}>
                <td>{d._id}</td>
                <td>{d.total.toLocaleString()}</td>
                <td>{d.onTime.toLocaleString()}</td>
                <td>{d.delayed.toLocaleString()}</td>
                <td>{d.total ? Math.round((d.onTime / d.total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Archive</h2>
      <p className="form-hint">Point-in-time snapshots of the totals above — nothing here affects the live numbers.</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Snapshot</th>
              <th>Total</th>
              <th>On Time</th>
              <th>Delayed</th>
              <th>Pending</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {archives === null && <TableSkeleton columns={6} rows={3} />}
            {archives && archives.length === 0 && (
              <tr><td colSpan={6} className="empty-state">No snapshots yet — use "Archive Snapshot" above to save one.</td></tr>
            )}
            {archives?.map((a) => (
              <tr key={a._id}>
                <td>{a.label} <span className="muted">({new Date(a.snapshotDate).toLocaleDateString()})</span></td>
                <td>{a.total.toLocaleString()}</td>
                <td>{a.onTime.toLocaleString()}</td>
                <td>{a.delayed.toLocaleString()}</td>
                <td>{a.pending.toLocaleString()}</td>
                <td>
                  {isAdmin ? (
                    <button type="button" className="link-btn danger" onClick={() => removeArchive(a)}>Delete</button>
                  ) : (
                    <span className="admin-only-hint" title="Only admins can delete">🔒</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
