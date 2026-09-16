import React, { useEffect, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import DoerList from "./pages/DoerList.jsx";
import TaskList from "./pages/TaskList.jsx";
import Master from "./pages/Master.jsx";
import Consolidated from "./pages/Consolidated.jsx";
import SubmissionLog from "./pages/SubmissionLog.jsx";
import ShortcutsHelp from "./components/ShortcutsHelp.jsx";
import { useSlashToFocusSearch } from "./hooks/useSlashToFocusSearch.js";

const icons = {
  dashboard: <path d="M3 13h7V3H3v10Zm0 8h7v-6H3v6Zm11 0h7V11h-7v10Zm0-18v6h7V3h-7Z" />,
  master: <path d="M4 4h16v4H4V4Zm0 6h10v10H4V10Zm12 0h4v4h-4v-4Zm0 6h4v4h-4v-4Z" />,
  tasks: <path d="M9 11.2 6.8 9l-1.4 1.4L9 14l7-7-1.4-1.4L9 11.2ZM4 20h16v2H4v-2Z" />,
  doers: <path d="M12 12a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6Zm0 2.4c-3.6 0-9.6 1.8-9.6 5.4V22h19.2v-2.2c0-3.6-6-5.4-9.6-5.4Z" />,
  consolidated: <path d="M5 3h6l6 6v12H5V3Zm6 0v6h6M8 13h8M8 17h8" />,
  submissions: <path d="M4 6h16M4 12h10M4 18h13" />,
};

const links = [
  { to: "/", label: "Dashboard", end: true, icon: "dashboard" },
  { to: "/master", label: "Master", icon: "master" },
  { to: "/tasks", label: "Task List", icon: "tasks" },
  { to: "/doers", label: "Doer List", icon: "doers" },
  { to: "/consolidated", label: "Consolidated", icon: "consolidated" },
  { to: "/submissions", label: "Submission Log", icon: "submissions" },
];

export default function App() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "1"
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useSlashToFocusSearch();

  return (
    <div className={"layout" + (collapsed ? " sidebar-collapsed" : "")}>
      <button
        type="button"
        className="mobile-menu-btn"
        aria-label="Toggle menu"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
      </button>

      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-mark">RL</div>
            {!collapsed && (
              <div className="brand-text">
                <div className="brand-title">Reminder List</div>
                <div className="brand-sub">Ops Tracker</div>
              </div>
            )}
          </div>
          <button
            type="button"
            className="collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" style={{ transform: collapsed ? "rotate(180deg)" : "none" }}>
              <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
        </div>
        <nav>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              title={collapsed ? l.label : undefined}
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              onClick={() => setMobileOpen(false)}
            >
              <svg className="nav-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {icons[l.icon]}
              </svg>
              {!collapsed && <span>{l.label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/master" element={<Master />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/doers" element={<DoerList />} />
          <Route path="/consolidated" element={<Consolidated />} />
          <Route path="/submissions" element={<SubmissionLog />} />
        </Routes>
      </main>
      <ShortcutsHelp />
    </div>
  );
}
