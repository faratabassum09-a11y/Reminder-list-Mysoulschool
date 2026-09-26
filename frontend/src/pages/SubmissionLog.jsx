import React, { useEffect, useRef, useState } from "react";
import { api, API_BASE } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import SearchInput from "../components/SearchInput.jsx";
import TableScrollControls from "../components/TableScrollControls.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { useTableHotkeys } from "../hooks/useTableHotkeys.js";

export default function SubmissionLog() {
  const [data, setData] = useState({ rows: null, total: 0, page: 1, pages: 1 });
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const limit = 100;
  const tableRef = useRef(null);
  useTableHotkeys(tableRef);

  // Search fires ~350ms after typing stops, not on every keystroke — the
  // biggest single win for "feels fast" on a search box over 50k+ rows.
  const debouncedQ = useDebouncedValue(q, 350);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ]);

  useEffect(() => {
    const params = new URLSearchParams({ page, limit });
    if (debouncedQ) params.set("q", debouncedQ);
    api
      .getSubmissions(`?${params.toString()}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [page, debouncedQ]);

  useEffect(() => {
    api.getSubmissionsSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => setPageInput(String(page)), [page]);

  const goToPage = (e) => {
    e.preventDefault();
    const n = Math.max(1, Math.min(data.pages || 1, Number(pageInput) || 1));
    setPage(n);
  };

  return (
    <div className="page">
      <PageHeader
        title="Submission Log"
        subtitle='Raw form-submission history from the Consolidated sheet — every "task done" submission, unfiltered'
      />
      {error && <p className="error">{error}</p>}

      <div className="cards">
        <div className="card">
          <div className="card-label">Total submissions</div>
          <div className="card-value">{summary ? summary.total.toLocaleString() : <span className="skeleton-bar" style={{ width: 60, height: 20 }} />}</div>
        </div>
        <div className="card card-good">
          <div className="card-label">Resolved to a doer/task</div>
          <div className="card-value">{summary ? summary.resolved.toLocaleString() : <span className="skeleton-bar" style={{ width: 60, height: 20 }} />}</div>
        </div>
        <div className="card card-bad">
          <div className="card-label">Unresolved (blank name/task)</div>
          <div className="card-value">{summary ? summary.unresolved.toLocaleString() : <span className="skeleton-bar" style={{ width: 60, height: 20 }} />}</div>
        </div>
        <div className="card card-accent">
          <div className="card-label">Unique doers</div>
          <div className="card-value">{summary ? summary.uniqueDoers : <span className="skeleton-bar" style={{ width: 40, height: 20 }} />}</div>
        </div>
      </div>

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search by name or task… (press /)" />
        <div className="row-actions">
          {data.rows && (
            <span className="chip">
              <strong>{data.total.toLocaleString()}</strong> {debouncedQ ? "matches" : "total rows"}
            </span>
          )}
          <a
            className="link-btn generate-btn"
            href={`${API_BASE}/submissions/export.csv${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ""}`}
            title="Download every row matching the current search as a CSV file"
          >
            ⬇ Export CSV
          </a>
        </div>
      </div>

      <div className="table-panel">
        <div className="table-wrap" ref={tableRef}>
          <table className="table">
            <thead>
              <tr>
                <th className="col-sno">S.No</th>
                <th>Task Id</th>
                <th>Timestamp</th>
                <th>Name</th>
                <th className="col-task">Task</th>
              </tr>
            </thead>
            <tbody>
              {!data.rows && <TableSkeleton columns={5} rows={12} />}
              {data.rows && data.rows.length === 0 && (
                <tr><td colSpan={5} className="empty-state">No submissions match “{debouncedQ}”.</td></tr>
              )}
              {data.rows?.map((r, i) => (
                <tr key={r._id}>
                  <td>{(data.page - 1) * limit + i + 1}</td>
                  <td>{r.taskId}</td>
                  <td>{new Date(r.timestamp).toLocaleString()}</td>
                  <td>{r.name || <span className="muted">—</span>}</td>
                  <td className="col-task truncate-cell" title={r.task || ""}>{r.task || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.rows && data.rows.length > 8 && <TableScrollControls targetRef={tableRef} />}
      </div>

      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage(1)} title="First page">« First</button>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>
          Page {data.page} of {data.pages} ({data.total.toLocaleString()} rows)
        </span>
        <form className="page-jump" onSubmit={goToPage}>
          <span>Go to</span>
          <input
            type="number"
            min={1}
            max={data.pages || 1}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
          />
          <button type="submit">Go</button>
        </form>
        <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
        <button disabled={page >= data.pages} onClick={() => setPage(data.pages)} title="Last page">Last »</button>
      </div>
    </div>
  );
}
