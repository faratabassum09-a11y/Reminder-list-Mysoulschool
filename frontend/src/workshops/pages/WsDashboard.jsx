import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api.js";
import PageHeader from "../../components/PageHeader.jsx";
import TableSkeleton from "../../components/TableSkeleton.jsx";
import SortableTh from "../../components/SortableTh.jsx";
import { usePolling } from "../../hooks/usePolling.js";
import { sortRows, toggleSort } from "../../utils/sortRows.js";
import { RANGES } from "../../utils/dateRanges.js";
import { chipStyleFromString } from "../../utils/colorFromString.js";
import { downloadCsv } from "../../utils/csv.js";
import { TypeChip } from "../ui.jsx";

// Same colour rules as the Reminder List dashboard:
//   70% and below -> red · 71–90% -> yellow · above 90% -> green
const band = (p) => { const v = Math.round(p); return v <= 70 ? "bad" : v <= 90 ? "warn" : "good"; };
const fmtPct = (p) => (Number.isInteger(p) ? p : p.toFixed(1)) + "%";

function Ring({ value, label, sub }) {
  const r = 52, c = 2 * Math.PI * r;
  const b = band(value);
  return (
    <div className="ws-ring" role="img" aria-label={`${label}: ${Math.round(value)} percent`}>
      <svg viewBox="0 0 128 128" width="150" height="150">
        <circle cx="64" cy="64" r={r} className="ws-ring-track" />
        <circle cx="64" cy="64" r={r} className={`ws-ring-fill ws-ring-${b}`} strokeDasharray={c} strokeDashoffset={c - (c * Math.min(100, value)) / 100} transform="rotate(-90 64 64)" />
        <text x="64" y="62" textAnchor="middle" className="ws-ring-num">{Math.round(value)}%</text>
        <text x="64" y="80" textAnchor="middle" className="ws-ring-sub">{sub}</text>
      </svg>
      <div className="ws-ring-label">{label}</div>
    </div>
  );
}

function Stack({ onTime, delayed, pending, total }) {
  if (!total) return <div className="ws-stack ws-stack-empty" />;
  const w = (n) => (n / total) * 100 + "%";
  return (
    <div className="ws-stack" title={`${onTime} on time · ${delayed} delayed · ${pending} pending`}>
      <span className="ws-stack-good" style={{ width: w(onTime) }} />
      <span className="ws-stack-bad" style={{ width: w(delayed) }} />
      <span className="ws-stack-pend" style={{ width: w(Math.max(0, pending - 0)) }} />
    </div>
  );
}

export default function WsDashboard() {
  const [range, setRange] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });

  const load = () => api.wsDashboard(range).then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { setData(null); load(); }, [range]);
  usePolling(load, 20000);

  const s = data?.summary;
  const people = useMemo(() => sortRows(data?.byPerson || null, sort), [data, sort]);
  const th = (label, key) => <SortableTh label={label} sortKey={key} sort={sort} onSort={(k) => setSort((x) => toggleSort(x, k))} />;

  const exportCsv = () => downloadCsv("workshop-performance.csv",
    ["Name", "Department", "Due", "On Time", "Delayed", "Pending", "On-Time %", "Completed %"],
    (people || []).map((r) => [r.name, r.department, r.total, r.onTime, r.delayed, r.pending, `${Math.round(r.onTimePercent)}%`, `${Math.round(r.completedPercent)}%`]));

  const cards = [
    { label: "Tasks due", value: s?.total, cls: "" },
    { label: "On time", value: s?.onTime, cls: "card-good" },
    { label: "Delayed", value: s?.delayed, cls: "card-bad" },
    { label: "Pending", value: s?.pending, cls: "card-neutral", hint: s?.overdue ? `${s.overdue} overdue` : "" },
    { label: "On-time rate", value: s ? fmtPct(s.onTimePercent) : undefined, cls: "card-accent" },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Workshop dashboard"
        subtitle="How the whole team is doing on workshop tasks. Visible to everyone."
        meta={data && (
          <>
            <span className="chip"><strong>{data.workshops.upcoming}</strong> upcoming</span>
            <span className="chip" style={{ marginLeft: 8 }}><strong>{data.workshops.approved}</strong> approved workshops</span>
          </>
        )}
      />
      {error && <p className="error">{error}</p>}

      <div className="range-pills" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <button key={r.value || "all"} type="button" className={"range-pill" + (range === r.value ? " range-pill-active" : "")} aria-pressed={range === r.value} onClick={() => setRange(r.value)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="cards">
        {cards.map((c) => (
          <div className={`card ${c.cls}`} key={c.label}>
            <div className="card-label">{c.label}</div>
            <div className="card-value">
              {c.value === undefined ? <span className="skeleton-bar" style={{ width: 44, height: 22 }} /> : typeof c.value === "number" ? c.value.toLocaleString() : c.value}
            </div>
            {c.hint && <div className="ws-stat-hint">{c.hint}</div>}
          </div>
        ))}
      </div>

      <section className="ws-panel ws-dash-hero">
        <Ring value={s?.onTimePercent || 0} label="On-time rate" sub="on time ÷ due" />
        <Ring value={s?.completedPercent || 0} label="Completion rate" sub="done ÷ due" />
        <div className="ws-dash-mix">
          <h2>Where the due tasks stand</h2>
          <Stack onTime={s?.onTime || 0} delayed={s?.delayed || 0} pending={s?.pending || 0} total={s?.total || 0} />
          <ul className="ws-legend">
            <li><i className="ws-dot ws-dot-good" /> On time <strong>{s ? fmtPct(s.total ? (s.onTime / s.total) * 100 : 0) : "…"}</strong></li>
            <li><i className="ws-dot ws-dot-bad" /> Delayed <strong>{s ? fmtPct(s.total ? (s.delayed / s.total) * 100 : 0) : "…"}</strong></li>
            <li><i className="ws-dot ws-dot-pend" /> Pending <strong>{s ? fmtPct(s.total ? (s.pending / s.total) * 100 : 0) : "…"}</strong></li>
          </ul>
          <p className="form-hint">Only tasks that have come due are counted, so upcoming workshops don't lower anyone's score.</p>
        </div>
      </section>

      <h2>By workshop type</h2>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Type</th><th>Due</th><th>On time</th><th>Delayed</th><th>Pending</th><th>Progress</th><th>On-time %</th></tr></thead>
          <tbody>
            {!data && <TableSkeleton columns={7} rows={4} />}
            {data?.byType.length === 0 && <tr><td colSpan={7} className="empty-state">No task activity in this range.</td></tr>}
            {data?.byType.map((t) => (
              <tr key={t.type}>
                <td><TypeChip code={t.type} /></td>
                <td>{t.total.toLocaleString()}</td>
                <td>{t.onTime.toLocaleString()}</td>
                <td>{t.delayed.toLocaleString()}</td>
                <td>{t.pending.toLocaleString()}</td>
                <td style={{ minWidth: 140 }}><Stack {...t} /></td>
                <td><span className={`pct-badge pct-badge-${band(t.onTimePercent)}`}>{fmtPct(t.onTimePercent)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PageHeader
        title="Per-person breakdown"
        subtitle="Every workshop task owner, ranked by on-time rate"
        meta={data && (
          <>
            <span className="chip"><strong>{data.byPerson.length}</strong> owners</span>
            {data.byPerson.length > 0 && <button type="button" className="link-btn generate-btn" onClick={exportCsv} style={{ marginLeft: 8 }}>⬇ Export CSV</button>}
          </>
        )}
      />
      <div className="pct-legend" aria-label="On-time percentage colour key">
        <span><i className="dot-bad" /> 70% and below</span>
        <span><i className="dot-warn" /> 71% – 90%</span>
        <span><i className="dot-good" /> Above 90%</span>
      </div>
      <div className="table-panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-sno">S.No</th>
                {th("Name", "name")}{th("Department", "department")}{th("Due", "total")}{th("On time", "onTime")}{th("Delayed", "delayed")}{th("Pending", "pending")}{th("Completed %", "completedPercent")}{th("On-time %", "onTimePercent")}
              </tr>
            </thead>
            <tbody>
              {!data && <TableSkeleton columns={9} rows={6} />}
              {data && people.length === 0 && <tr><td colSpan={9} className="empty-state">No task activity in this range.</td></tr>}
              {people?.map((r, i) => {
                const b = band(r.onTimePercent);
                const mine = r.email === data.me;
                return (
                  <tr key={r.email} className={`perf-row-${b}${mine ? " ws-row-me" : ""}`}>
                    <td>{i + 1}</td>
                    <td>
                      {r.rank && r.rank <= 3 && <span className="rank-medal" title={`#${r.rank} on-time rate`}>{r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : "🥉"}</span>}
                      {r.name}{mine && <em className="ws-you">You</em>}
                    </td>
                    <td><span className="dept-chip" style={chipStyleFromString(r.department)}>{r.department}</span></td>
                    <td>{r.total.toLocaleString()}</td>
                    <td>{r.onTime.toLocaleString()}</td>
                    <td>{r.delayed.toLocaleString()}</td>
                    <td>{r.pending.toLocaleString()}</td>
                    <td>{fmtPct(r.completedPercent)}</td>
                    <td><span className={`pct-badge pct-badge-${b}`}>{fmtPct(r.onTimePercent)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
