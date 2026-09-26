import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import TableSkeleton from "../components/TableSkeleton.jsx";
import SearchInput from "../components/SearchInput.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

function timeAgo(date) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// The "clear page" for notifications — everything the bell's dropdown
// only shows a preview of. Loading this page also marks everything read,
// same as opening the bell dropdown; that's the only place the badge
// count resets, never on Master.
export default function Notifications() {
  const [data, setData] = useState({ rows: null, total: 0, page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const limit = 30;
  const debouncedQ = useDebouncedValue(q, 250);

  const load = () => {
    const params = new URLSearchParams({ page, limit });
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    api.getNotifications(`?${params.toString()}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, [page, debouncedQ]);
  useEffect(() => { api.markAllNotificationsRead().catch(() => {}); }, []);

  // Searching should always jump back to page 1, same as every other
  // filtered list in the app.
  useEffect(() => { setPage(1); }, [debouncedQ]);

  const openTask = (n) => {
    const id = n.taskInstance?._id || n.taskInstance;
    navigate(id ? `/master?highlight=${id}` : "/master");
  };

  return (
    <div className="page">
      <PageHeader
        title="Notifications"
        subtitle="Every task the team has marked done, newest first"
        meta={data.rows && <span className="chip"><strong>{data.total.toLocaleString()}</strong> total</span>}
      />
      {error && <p className="error">{error}</p>}

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search by doer or task name… (press /)" />
      </div>

      <div className="notif-page-list">
        {!data.rows && <TableSkeleton columns={1} rows={8} />}
        {data.rows && data.rows.length === 0 && (
          <div className="empty-state">
            {q.trim()
              ? `No notifications match "${q}".`
              : "No notifications yet — they'll show up here as soon as someone marks a task done."}
          </div>
        )}
        {data.rows && data.rows.map((n) => (
          <button key={n._id} type="button" className="notif-page-row" onClick={() => openTask(n)}>
            <span className="notif-page-avatar" aria-hidden="true">✔</span>
            <div className="notif-page-body">
              <div className="notif-page-title">
                <strong>{n.doerName || n.doer?.name || "Someone"}</strong> marked <strong>{n.taskName || n.task?.taskName || "a task"}</strong> as done
              </div>
              <div className="notif-page-sub">
                {n.doer?.department ? `${n.doer.department} · ` : ""}{new Date(n.createdAt).toLocaleString()} · {timeAgo(n.createdAt)}
              </div>
            </div>
            <span className="notif-page-arrow" aria-hidden="true">View task →</span>
          </button>
        ))}
      </div>

      {data.rows && data.rows.length > 0 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(1)} title="First page">« First</button>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {data.page} of {data.pages} ({data.total.toLocaleString()} total)</span>
          <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          <button disabled={page >= data.pages} onClick={() => setPage(data.pages)} title="Last page">Last »</button>
        </div>
      )}
    </div>
  );
}
