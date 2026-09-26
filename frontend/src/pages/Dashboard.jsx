import { usePolling } from "../hooks/usePolling.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import SortableTh from "../components/SortableTh.jsx";
import TableScrollControls from "../components/TableScrollControls.jsx";
import { useTableHotkeys } from "../hooks/useTableHotkeys.js";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { sortRows, toggleSort } from "../utils/sortRows.js";
import { chipStyleFromString } from "../utils/colorFromString.js";
import { downloadCsv } from "../utils/csv.js";
import { RANGES } from "../utils/dateRanges.js";

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const [range, setRange] = useState("");
  const [summary, setSummary] = useState(null);
  const [people, setPeople] = useState(null);
  const [archives, setArchives] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState("");
  const [peopleError, setPeopleError] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const toast = useToast();
  const peopleTableRef = useRef(null);
  useTableHotkeys(peopleTableRef);

  const loadArchives = () => api.getArchives().then(setArchives).catch(() => {});

  // Cards and the per-person table both re-fetch whenever the selected
  // date range changes — the range applies to both together, since they're
  // two views of the same underlying rollup.
  useEffect(() => {
    setSummary(null);
    setPeople(null);
    api.getSummary(range).then(setSummary).catch((e) => setError(e.message));
    api.getConsolidated(range).then(setPeople).catch((e) => setPeopleError(e.message));
  }, [range]);

  // Keep the numbers live when admins approve tasks elsewhere.
  usePolling(() => {
    api.getSummary(range).then(setSummary).catch(() => {});
    api.getConsolidated(range).then(setPeople).catch(() => {});
  }, 20000);

  useEffect(() => {
    loadArchives();
  }, []);

  const pct = summary?.total ? Math.round((summary.onTime / summary.total) * 100) : 0;
  const sortedPeople = useMemo(() => sortRows(people, sort), [people, sort]);

  // Per-person on-time % coloring, visible to admins and members alike:
  // 40 and below is flagged red, 80 and above is green, everything in
  // between (the "remaining" band) is yellow/neutral.
  const pctBand = (p) => (p <= 40 ? "bad" : p >= 80 ? "good" : "warn");

  const exportPeopleCsv = () => {
    downloadCsv(
      "consolidated.csv",
      ["Name", "Department", "Total", "On Time", "Delayed", "Pending", "On-Time %"],
      sortedPeople.map((r) => [r.name, r.department, r.total, r.onTime, r.delayed, r.pending, `${Math.round(r.onTimePercent)}%`])
    );
  };

  // Logs the current totals as a dated snapshot — the equivalent of the
  // original's weekly "archive" button. Unlike the original, this never
  // resets the live numbers; Master is one continuous dataset here, not a
  // sheet that gets wiped each week, so archiving is just a history log.
  // Always logs the all-time totals (see routes/consolidated.js), so a
  // snapshot means the same thing regardless of which range pill happens
  // to be selected when the button is clicked.
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
              title="Log today's all-time totals to the Archive below">
              {archiving ? "Saving…" : "📸 Archive Snapshot"}
            </button>
          )
        }
      />
      {error && <p className="error">{error}</p>}

      <div className="range-pills" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <button
            key={r.value || "all"}
            type="button"
            className={"range-pill" + (range === r.value ? " range-pill-active" : "")}
            aria-pressed={range === r.value}
            onClick={() => setRange(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>

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
            {summary?.byDepartment.length === 0 && (
              <tr><td colSpan={5} className="empty-state">No task activity in this range.</td></tr>
            )}
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

      <PageHeader
        title="Per-Person Breakdown"
        subtitle="Consolidated rollup by doer, computed live from Master — no duplicate data entry"
        meta={people && (
          <>
            <span className="chip"><strong>{people.length}</strong> doers</span>
            {people.length > 0 && (
              <button type="button" className="link-btn generate-btn" onClick={exportPeopleCsv} style={{ marginLeft: 8 }}>
                ⬇ Export CSV
              </button>
            )}
          </>
        )}
      />
      {peopleError && <p className="error">{peopleError}</p>}
      <div className="table-panel">
        <div className="table-wrap" ref={peopleTableRef}>
          <table className="table">
            <thead>
              <tr>
                <th className="col-sno">S.No</th>
                <SortableTh label="Name" sortKey="name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="Department" sortKey="department" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="Total" sortKey="total" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="On Time" sortKey="onTime" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="Delayed" sortKey="delayed" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="Pending" sortKey="pending" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortableTh label="On-Time %" sortKey="onTimePercent" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
              </tr>
            </thead>
            <tbody>
              {!people && <TableSkeleton columns={8} rows={8} />}
              {people && people.length === 0 && (
                <tr><td colSpan={8} className="empty-state">No task activity in this range.</td></tr>
              )}
              {sortedPeople?.map((r, i) => {
                const band = pctBand(r.onTimePercent);
                return (
                  <tr key={r._id} className={`perf-row-${band}`}>
                    <td>{i + 1}</td>
                    <td>
                      {r.total > 0 && r.rank <= 3 && (
                        <span className="rank-medal" title={`#${r.rank} on-time rate`}>
                          {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : "🥉"}
                        </span>
                      )}
                      {r.name}
                    </td>
                    <td><span className="dept-chip" style={chipStyleFromString(r.department)}>{r.department}</span></td>
                    <td>{r.total.toLocaleString()}</td>
                    <td>{r.onTime.toLocaleString()}</td>
                    <td>{r.delayed.toLocaleString()}</td>
                    <td>{r.pending.toLocaleString()}</td>
                    <td><span className={`pct-badge pct-badge-${band}`}>{Math.round(r.onTimePercent)}%</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {people && people.length > 8 && <TableScrollControls targetRef={peopleTableRef} />}
      </div>

      <h2>Archive</h2>
      <p className="form-hint">Point-in-time snapshots of the all-time totals — nothing here affects the live numbers or changes with the date range above.</p>
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
