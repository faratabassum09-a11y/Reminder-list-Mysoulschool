import React, { useEffect } from "react";

export function Modal({ title, sub, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " ws-modal-wide" : "")} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {sub && <p className="modal-sub">{sub}</p>}
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const TASK_TONE = { Pending: "pending", Overdue: "overdue", "On Time": "good", Delayed: "delayed" };
const WS_TONE = { pending: "review", approved: "good", rejected: "overdue" };
const WS_LABEL = { pending: "Awaiting approval", approved: "Approved", rejected: "Rejected" };

export const TaskStatus = ({ status }) => <span className={`ws-badge ws-b-${TASK_TONE[status] || "pending"}`}>{status}</span>;
export const WorkshopStatus = ({ status }) => <span className={`ws-badge ws-b-${WS_TONE[status] || "pending"}`}>{WS_LABEL[status] || status}</span>;

const SYNC = {
  sent: ["good", "Sent"],
  failed: ["overdue", "Failed"],
  skipped: ["pending", "Not configured"],
  not_sent: ["pending", "Not sent"],
  internal: ["good", "In app"],
};
export const SyncBadge = ({ sync }) => {
  const [tone, label] = SYNC[sync?.status || "not_sent"];
  return <span className={`ws-badge ws-b-${tone}`} title={sync?.error || ""}>{label}</span>;
};

export function TypeChip({ code }) {
  return <span className={`ws-type ws-type-${code}`}>{code}</span>;
}

export function ProgressBar({ done, total, overdue = 0 }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const late = total ? Math.round((overdue / total) * 100) : 0;
  return (
    <div className="ws-progress" title={`${done} of ${total} done${overdue ? ` · ${overdue} overdue` : ""}`}>
      <div className="ws-progress-bar">
        <span className="ws-progress-done" style={{ width: pct + "%" }} />
        {late > 0 && <span className="ws-progress-late" style={{ width: late + "%" }} />}
      </div>
      <span className="ws-progress-text">{total ? `${done}/${total}` : "No tasks"}</span>
    </div>
  );
}

export function Empty({ icon = "🗂", title, children }) {
  return (
    <div className="ws-empty">
      <div className="ws-empty-icon" aria-hidden="true">{icon}</div>
      <strong>{title}</strong>
      {children && <div className="ws-empty-body">{children}</div>}
    </div>
  );
}

export function StatCard({ label, value, tone = "accent", hint, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`card card-${tone} ws-stat${onClick ? " ws-stat-click" : ""}`} onClick={onClick}>
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {hint && <div className="ws-stat-hint">{hint}</div>}
    </Tag>
  );
}
