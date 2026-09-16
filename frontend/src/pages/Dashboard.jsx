import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getSummary().then(setSummary).catch((e) => setError(e.message));
  }, []);

  const pct = summary?.total ? Math.round((summary.onTime / summary.total) * 100) : 0;

  return (
    <div className="page">
      <PageHeader title="Dashboard" subtitle="Overview of all reminder tasks across the team" />
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
    </div>
  );
}
