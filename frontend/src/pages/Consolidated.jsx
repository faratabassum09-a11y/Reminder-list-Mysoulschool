import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import SortableTh from "../components/SortableTh.jsx";
import TableScrollControls from "../components/TableScrollControls.jsx";
import { useTableHotkeys } from "../hooks/useTableHotkeys.js";
import { sortRows, toggleSort } from "../utils/sortRows.js";
import { chipStyleFromString } from "../utils/colorFromString.js";

export default function Consolidated() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const tableRef = useRef(null);
  useTableHotkeys(tableRef);

  useEffect(() => {
    api.getConsolidated().then(setRows).catch((e) => setError(e.message));
  }, []);

  const sortedRows = useMemo(() => sortRows(rows, sort), [rows, sort]);

  return (
    <div className="page">
      <PageHeader
        title="Consolidated"
        subtitle="Per-person rollup, computed live from Master — no duplicate data entry"
        meta={rows && <span className="chip"><strong>{rows.length}</strong> doers</span>}
      />
      {error && <p className="error">{error}</p>}

      <div className="table-panel">
        <div className="table-wrap" ref={tableRef}>
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
              {!rows && <TableSkeleton columns={8} rows={10} />}
              {rows && rows.length === 0 && (
                <tr><td colSpan={8} className="empty-state">No task activity recorded yet.</td></tr>
              )}
              {sortedRows?.map((r, i) => (
                <tr key={r._id}>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td><span className="dept-chip" style={chipStyleFromString(r.department)}>{r.department}</span></td>
                  <td>{r.total.toLocaleString()}</td>
                  <td>{r.onTime.toLocaleString()}</td>
                  <td>{r.delayed.toLocaleString()}</td>
                  <td>{r.pending.toLocaleString()}</td>
                  <td>{Math.round(r.onTimePercent)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && rows.length > 8 && <TableScrollControls targetRef={tableRef} />}
      </div>
    </div>
  );
}
