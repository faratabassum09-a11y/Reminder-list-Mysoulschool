import React, { Suspense, lazy, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import WorkshopLogo from "../components/WorkshopLogo.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { api } from "../api.js";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";
import "./workshops.css";

const WsOverview = lazy(() => import("./pages/WsOverview.jsx"));
const WsDashboard = lazy(() => import("./pages/WsDashboard.jsx"));
const WsNew = lazy(() => import("./pages/WsNew.jsx"));
const WsRequests = lazy(() => import("./pages/WsRequests.jsx"));
const WsWorkshops = lazy(() => import("./pages/WsWorkshops.jsx"));
const WsWorkshopDetail = lazy(() => import("./pages/WsWorkshopDetail.jsx"));
const WsTasks = lazy(() => import("./pages/WsTasks.jsx"));
const WsLaunches = lazy(() => import("./pages/WsLaunches.jsx"));
const WsTemplates = lazy(() => import("./pages/WsTemplates.jsx"));
const WsResponses = lazy(() => import("./pages/WsResponses.jsx"));
const Account = lazy(() => import("../pages/Account.jsx"));

const I = {
  dashboard: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  overview: "M3 13h7V3H3v10Zm0 8h7v-6H3v6Zm11 0h7V11h-7v10Zm0-18v6h7V3h-7Z",
  new: "M12 5v14M5 12h14",
  requests: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9",
  workshops: "M4 20V8l8-5 8 5v12M9 20v-6h6v6",
  tasks: "M9 11.2 6.8 9l-1.4 1.4L9 14l7-7-1.4-1.4L9 11.2ZM4 20h16v2H4v-2Z",
  launches: "M5 19c0-6 4-11 14-14-3 10-8 14-14 14ZM9 15l-4 4M14 10a1 1 0 1 0 0-.01",
  templates: "M4 5h16M4 10h16M4 15h10M4 20h7",
  responses: "M4 4h16v12H8l-4 4V4Zm4 4h8M8 12h5",
};

function PageFallback() {
  return (
    <div className="page">
      <div className="skeleton-bar" style={{ width: 200, height: 26, marginBottom: 18 }} />
      <div className="skeleton-bar" style={{ width: "100%", height: 220 }} />
    </div>
  );
}

export default function WorkshopApp() {
  const { user, logout, isAdmin, canRequestWorkshops, hasReminder, hasTickets } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ws-sidebar-collapsed") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [stats, setStats] = useState(null);

  const loadStats = () => api.wsStats().then(setStats).catch(() => {});
  useEffect(() => { loadStats(); }, []);
  usePolling(loadStats, 20000);
  useEffect(() => { localStorage.setItem("ws-sidebar-collapsed", collapsed ? "1" : "0"); }, [collapsed]);

  const links = [
    { to: "/workshops", label: "Overview", end: true, icon: "overview" },
    { to: "/workshops/dashboard", label: "Dashboard", icon: "dashboard" },
    ...(canRequestWorkshops ? [{ to: "/workshops/new", label: "New Workshop", icon: "new" }] : []),
    ...(canRequestWorkshops ? [{ to: "/workshops/requests", label: isAdmin ? "Approvals" : "My Requests", icon: "requests", badge: isAdmin ? stats?.pendingApproval : 0 }] : []),
    ...(canRequestWorkshops ? [{ to: "/workshops/plan", label: "Workshops", icon: "workshops" }] : []),
    { to: "/workshops/tasks", label: canRequestWorkshops ? "Tasks" : "My Tasks", icon: "tasks", badge: stats?.myOverdue, bad: true },
    { to: "/workshops/responses", label: canRequestWorkshops ? "Form Responses" : "My Responses", icon: "responses" },
    ...(isAdmin
      ? [
          { to: "/workshops/launches", label: "Launches", icon: "launches" },
          { to: "/workshops/templates", label: "Task Lists", icon: "templates" },
        ]
      : []),
  ];

  const backToHub = () => {
    sessionStorage.removeItem("hubChosen");
    navigate("/hub");
  };

  return (
    <div className={"layout ws-scope" + (collapsed ? " sidebar-collapsed" : "")}>
      <button type="button" className="mobile-menu-btn" aria-label="Toggle menu" onClick={() => setMobileOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
      </button>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
        <div className="sidebar-top">
          <div className="brand">
            <WorkshopLogo size={36} />
            {!collapsed && (
              <div className="brand-text">
                <div className="brand-title">Workshop PMS</div>
                <div className="brand-sub">Plan, approve, launch</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
            <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button type="button" className="collapse-btn" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <svg viewBox="0 0 24 24" width="16" height="16" style={{ transform: collapsed ? "rotate(180deg)" : "none" }}>
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
          </div>
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
              <span className="nav-icon-wrap">
                <svg className="nav-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d={I[l.icon]} />
                </svg>
                {l.badge > 0 && collapsed && <span className="nav-icon-dot" aria-hidden="true" />}
              </span>
              {!collapsed && <span>{l.label}</span>}
              {l.badge > 0 && !collapsed && <span className={"nav-badge" + (l.bad ? " ws-badge-bad" : "")}>{l.badge > 9 ? "9+" : l.badge}</span>}
            </NavLink>
          ))}
          {(hasReminder || hasTickets) && (
          <button type="button" className="nav-link ws-switch" onClick={backToHub} title="Switch app">
            <span className="nav-icon-wrap">
              <svg className="nav-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
              </svg>
            </span>
            {!collapsed && <span>All apps</span>}
          </button>
          )}
        </nav>

        <div className="sidebar-user">
          <NavLink to="/workshops/account" className="sidebar-user-link" title={collapsed ? user.name : undefined}>
            <span className="avatar" style={avatarStyleFromString(user.name)}>{initials(user.name)}</span>
            {!collapsed && (
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.name}</div>
                <div className="sidebar-user-role">{isAdmin ? "Admin" : canRequestWorkshops ? "Workshop coordinator" : "Member"}</div>
              </div>
            )}
          </NavLink>
          <button type="button" className="sidebar-logout" onClick={logout} title="Sign out">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      <main className="content">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route index element={<WsOverview stats={stats} />} />
            <Route path="dashboard" element={<WsDashboard />} />
            <Route path="new" element={canRequestWorkshops ? <WsNew onSaved={loadStats} /> : <Navigate to="/workshops" replace />} />
            <Route path="requests" element={canRequestWorkshops ? <WsRequests onChanged={loadStats} /> : <Navigate to="/workshops" replace />} />
            <Route path="responses" element={<WsResponses onChanged={loadStats} />} />
            <Route path="plan" element={canRequestWorkshops ? <WsWorkshops /> : <Navigate to="/workshops/tasks" replace />} />
            <Route path="plan/:id" element={canRequestWorkshops ? <WsWorkshopDetail onChanged={loadStats} /> : <Navigate to="/workshops/tasks" replace />} />
            <Route path="tasks" element={<WsTasks onChanged={loadStats} />} />
            <Route path="launches" element={isAdmin ? <WsLaunches /> : <Navigate to="/workshops" replace />} />
            <Route path="templates" element={isAdmin ? <WsTemplates /> : <Navigate to="/workshops" replace />} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<Navigate to="/workshops" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
