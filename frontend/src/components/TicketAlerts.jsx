import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { usePolling } from "../hooks/usePolling.js";
import { fmtDateTime } from "./TicketStatus.jsx";

// Reminder banner for the signed-in assignee: tickets that are overdue, due
// today or due tomorrow. Also fires a browser notification (once per ticket
// per kind per day) if the person has allowed notifications.
const seenKey = (kind, id) => `tk-alert:${kind}:${id}:${new Date().toDateString()}`;

function browserNotify(kind, t) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const k = seenKey(kind, t._id);
  try {
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
  } catch { /* storage blocked — notify anyway */ }
  const title = kind === "overdue" ? `Overdue: Help Ticket #${t.ticketNo}` : kind === "dueToday" ? `Due today: Help Ticket #${t.ticketNo}` : `Due tomorrow: Help Ticket #${t.ticketNo}`;
  try { new Notification(title, { body: `${t.issue} — due ${fmtDateTime(t.plannedResolution)}`, tag: `ticket-${kind}-${t._id}` }); } catch { /* ignore */ }
}

export default function TicketAlerts() {
  const [a, setA] = useState({ overdue: [], dueToday: [], dueTomorrow: [] });
  const [perm, setPerm] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [hidden, setHidden] = useState(false);
  const navigate = useNavigate();

  const load = () => api.getTicketAlerts().then((r) => {
    setA(r);
    r.overdue.forEach((t) => browserNotify("overdue", t));
    r.dueToday.forEach((t) => browserNotify("dueToday", t));
    r.dueTomorrow.forEach((t) => browserNotify("dueTomorrow", t));
  }).catch(() => {});
  useEffect(() => { load(); }, []);
  usePolling(load, 60000);

  const total = a.overdue.length + a.dueToday.length + a.dueTomorrow.length;
  if (!total || hidden) return null;

  const enable = async () => { setPerm(await Notification.requestPermission()); load(); };
  const line = (label, list) => list.length > 0 && (
    <div><strong>{label}:</strong> {list.map((t) => `#${t.ticketNo}`).join(", ")}</div>
  );

  return (
    <div className="ticket-alert" role="alert" style={{ margin: "0 0 14px", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--bad, #e5484d)", background: "rgba(229,72,77,.10)", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>⏰ Help ticket reminders</div>
        {line("🚨 Overdue", a.overdue)}
        {line("⚠️ Due today", a.dueToday)}
        {line("📅 Due tomorrow", a.dueTomorrow)}
      </div>
      <div className="row-actions">
        {perm === "default" && <button type="button" className="btn-ghost" onClick={enable}>Enable notifications</button>}
        <button type="button" onClick={() => navigate("/tickets")}>Open inbox</button>
        <button type="button" className="btn-ghost" onClick={() => setHidden(true)}>Dismiss</button>
      </div>
    </div>
  );
}
