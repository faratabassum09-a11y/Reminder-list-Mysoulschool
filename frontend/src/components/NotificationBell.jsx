import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { usePolling } from "../hooks/usePolling.js";

function timeAgo(date) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Admin-only bell. This is the ONE place the "a member marked a task done"
// count lives — Master itself shows no badge, no banner, nothing; every
// bit of that signal lives here and on the dedicated Notifications page.
// Opening the dropdown (or the page) marks everything read, which is also
// the only place the count ever resets.
export default function NotificationBell({ isAdmin }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  const loadCount = () => {
    if (!isAdmin) return;
    api.getUnreadNotifCount().then((r) => setUnread(r.count)).catch(() => {});
  };
  useEffect(loadCount, [isAdmin]);
  usePolling(loadCount, 15000);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    api
      .getNotifications("?limit=8")
      .then((res) => {
        setItems(res.rows || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    // Opening the dropdown is a "seen" action — reset the badge right away
    // so it doesn't relight just because the list re-polls.
    api.markAllNotificationsRead().then(() => setUnread(0)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!isAdmin) return null;

  const goToTask = (n) => {
    setOpen(false);
    const id = n.taskInstance?._id || n.taskInstance;
    if (id) navigate(`/master?highlight=${id}`);
    else navigate("/master");
  };

  const viewAll = () => {
    setOpen(false);
    navigate("/notifications");
  };

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"notif-btn" + (unread > 0 ? " notif-btn-lit" : "")}
        aria-label="Notifications"
        title="Tasks the team has marked done"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="notif-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <span>Notifications</span>
            <button type="button" className="link-btn" onClick={viewAll}>View all</button>
          </div>
          {!loaded ? (
            <div className="notif-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="notif-empty">Nothing new — you're all caught up.</div>
          ) : (
            <ul className="notif-list">
              {items.map((n) => (
                <li key={n._id} className={"notif-item" + (n.read ? "" : " notif-item-unread")} onClick={() => goToTask(n)}>
                  <span className="notif-item-dot" aria-hidden="true" />
                  <div className="notif-item-body">
                    <div className="notif-item-title">
                      <strong>{n.doerName || n.doer?.name || "Someone"}</strong> marked a task done
                    </div>
                    <div className="notif-item-sub">{n.taskName || n.task?.taskName || "Task"} · {timeAgo(n.createdAt)}</div>
                  </div>
                  <span className="notif-item-arrow" aria-hidden="true">→</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="notif-panel-footer" onClick={viewAll}>Open Notifications</button>
        </div>
      )}
    </div>
  );
}
