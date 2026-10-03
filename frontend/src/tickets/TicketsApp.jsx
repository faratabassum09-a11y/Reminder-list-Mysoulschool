import React, { Suspense, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import TicketsLogo from "../components/TicketsLogo.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { api } from "../api.js";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";
import { lazyRetry } from "../utils/lazyRetry.js";
import PageLoader from "../components/PageLoader.jsx";
import RouteBoundary from "../components/RouteBoundary.jsx";
import "./tickets.css";

const HelpTickets = lazyRetry(() => import("../pages/HelpTickets.jsx"));
const TicketsRaised = lazyRetry(() => import("../pages/TicketsRaised.jsx"));
const Account = lazyRetry(() => import("../pages/Account.jsx"));

const I = {
  tickets: "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8ZM9 6v12",
  raised: "M4 6h16M4 12h16M4 18h10",
};

// The Help Tickets app: its own sidebar + routes (mounted at /tickets/*),
// separate from the Reminder List. Any doer can raise a ticket to any other
// doer; the server only shows a ticket to its assignee, its raiser, and
// admins (see backend/routes/tickets.js).
export default function TicketsApp() {
  const { user, logout, isAdmin, hasReminder, hasWorkshop } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("tk-sidebar-collapsed") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [count, setCount] = useState({ inbox: 0, open: 0 });

  const loadCount = () => api.getTicketCount().then(setCount).catch(() => {});
  useEffect(() => { loadCount(); }, []);
  usePolling(loadCount, 15000);
  useEffect(() => { localStorage.setItem("tk-sidebar-collapsed", collapsed ? "1" : "0"); }, [collapsed]);

  const links = [
    { to: "/tickets", label: "Help Tickets", end: true, icon: "tickets", badge: count.inbox },
    ...(isAdmin ? [{ to: "/tickets/raised", label: "Tickets Raised", icon: "raised", badge: count.open }] : []),
  ];

  const backToHub = () => {
    sessionStorage.removeItem("hubChosen");
    navigate("/hub");
  };

  return (
    <div className={"layout tk-scope" + (collapsed ? " sidebar-collapsed" : "")}>
      <button type="button" className="mobile-menu-btn" aria-label="Toggle menu" onClick={() => setMobileOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
      </button>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
        <div className="sidebar-top">
          <div className="brand">
            <TicketsLogo size={36} />
            {!collapsed && (
              <div className="brand-text">
                <div className="brand-title">Help Tickets</div>
                <div className="brand-sub">Ask, assign, resolve</div>
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
              {l.badge > 0 && !collapsed && <span className="nav-badge">{l.badge > 9 ? "9+" : l.badge}</span>}
            </NavLink>
          ))}
          {(hasReminder || hasWorkshop) && (
            <button type="button" className="nav-link tk-switch" onClick={backToHub} title="Switch app">
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
          <NavLink to="/tickets/account" className="sidebar-user-link" title={collapsed ? user.name : undefined}>
            <span className="avatar" style={avatarStyleFromString(user.name)}>{initials(user.name)}</span>
            {!collapsed && (
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.name}</div>
                <div className="sidebar-user-role">{isAdmin ? "Admin" : "Member"}</div>
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
        <RouteBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route index element={<HelpTickets onChanged={loadCount} />} />
            <Route path="raised" element={isAdmin ? <TicketsRaised onChanged={loadCount} /> : <Navigate to="/tickets" replace />} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<Navigate to="/tickets" replace />} />
          </Routes>
        </Suspense>
        </RouteBoundary>
      </main>
    </div>
  );
}
