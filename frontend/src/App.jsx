import React, { Suspense, lazy, useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const DoerList = lazy(() => import("./pages/DoerList.jsx"));
const TaskList = lazy(() => import("./pages/TaskList.jsx"));
const Master = lazy(() => import("./pages/Master.jsx"));
const SubmissionLog = lazy(() => import("./pages/SubmissionLog.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const Users = lazy(() => import("./pages/Users.jsx"));
const Notifications = lazy(() => import("./pages/Notifications.jsx"));
const Messages = lazy(() => import("./pages/Messages.jsx"));
const Account = lazy(() => import("./pages/Account.jsx"));
const Hub = lazy(() => import("./pages/Hub.jsx"));
const WorkshopApp = lazy(() => import("./workshops/WorkshopApp.jsx"));
import Login from "./pages/Login.jsx";
import ShortcutsHelp from "./components/ShortcutsHelp.jsx";
import Logo from "./components/Logo.jsx";
import NotificationBell from "./components/NotificationBell.jsx";
const Chatbot = lazy(() => import("./components/Chatbot.jsx"));
import { useTheme } from "./context/ThemeContext.jsx";
import { useSlashToFocusSearch } from "./hooks/useSlashToFocusSearch.js";
import { usePolling } from "./hooks/usePolling.js";
import { useAuth } from "./context/AuthContext.jsx";
import { api } from "./api.js";
import { avatarStyleFromString, initials } from "./utils/colorFromString.js";

const icons = {
  dashboard: <path d="M3 13h7V3H3v10Zm0 8h7v-6H3v6Zm11 0h7V11h-7v10Zm0-18v6h7V3h-7Z" />,
  master: <path d="M4 4h16v4H4V4Zm0 6h10v10H4V10Zm12 0h4v4h-4v-4Zm0 6h4v4h-4v-4Z" />,
  tasks: <path d="M9 11.2 6.8 9l-1.4 1.4L9 14l7-7-1.4-1.4L9 11.2ZM4 20h16v2H4v-2Z" />,
  doers: <path d="M12 12a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6Zm0 2.4c-3.6 0-9.6 1.8-9.6 5.4V22h19.2v-2.2c0-3.6-6-5.4-9.6-5.4Z" />,
  submissions: <path d="M4 6h16M4 12h10M4 18h13" />,
  settings: <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.5H9.1l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2L2.6 15l2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h5.8l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z" />,
  users: <path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3 0-8 1.5-8 4.5V21h16v-2.5c0-3-5-4.5-8-4.5Zm8.5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-.6 0-1.5.08-2.4.3 1.5 1 2.4 2.4 2.4 4.2V21h5v-2.5c0-2.6-3-4.5-5-4.5Z" />,
  messages: <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4.4 3.5A.6.6 0 0 1 3.6 20V6a1 1 0 0 1 1-1Z" />,
};

const baseLinks = [
  { to: "/", label: "Dashboard", end: true, icon: "dashboard" },
  { to: "/master", label: "Master", icon: "master" },
  { to: "/tasks", label: "Task List", icon: "tasks" },
  { to: "/submissions", label: "Submission Log", icon: "submissions" },
  { to: "/messages", label: "Messages", icon: "messages" },
];
const adminLinks = [
  { to: "/doers", label: "Doer List", icon: "doers" },
  { to: "/settings", label: "Settings", icon: "settings" },
  { to: "/users", label: "Users", icon: "users" },
];

// Wraps admin-only pages — someone could type /settings or /users into the
// address bar directly even with the link hidden from the sidebar, so this
// is the actual guard (on top of the backend also enforcing it on every
// request regardless of what the frontend does).
function AdminRoute({ isAdmin, children }) {
  return isAdmin ? children : <Navigate to="/" replace />;
}

// Each page is its own chunk so the first paint only downloads what's needed
// for the page you land on. Once the app is idle, the rest are fetched in
// the background so moving between pages feels instant.
const prefetchPages = () => {
  import("./pages/Master.jsx");
  import("./pages/Dashboard.jsx");
  import("./pages/TaskList.jsx");
  import("./pages/DoerList.jsx");
  import("./pages/SubmissionLog.jsx");
  import("./pages/Messages.jsx");
  import("./pages/Account.jsx");
  import("./components/Chatbot.jsx");
};

function PageFallback() {
  return (
    <div className="page">
      <div className="skeleton-bar" style={{ width: 180, height: 26, marginBottom: 18 }} />
      <div className="skeleton-bar" style={{ width: "100%", height: 220 }} />
    </div>
  );
}

function AuthLoadingScreen({ slow }) {
  return (
    <div className="auth-loading">
      <Logo size={56} className="auth-logo" />
      <div className="auth-loading-spinner" aria-hidden="true" />
      <div className="auth-loading-text">{slow ? "Waking up the server…" : "Loading…"}</div>
      {slow && (
        <div className="auth-loading-hint">
          First load after a while can take up to a minute on a free-tier server. It'll be quick from here on.
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { user, loading, slow, logout, isAdmin, hasReminder, hasWorkshop, canRequestWorkshops } = useAuth();
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "1"
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  // Total unread across DMs + Doer List announcements, for the sidebar's
  // Messages badge — same polling pattern as NotificationBell's count.
  const [msgUnread, setMsgUnread] = useState(0);
  const loadMsgUnread = () => {
    if (!user || !hasReminder) return;
    api.getMessagesUnreadCount().then((r) => setMsgUnread(r.total)).catch(() => {});
  };
  useEffect(loadMsgUnread, [user]);
  usePolling(loadMsgUnread, 12000);
  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const [themeHintSeen, setThemeHintSeen] = useState(
    () => localStorage.getItem("theme-toggle-seen") === "1"
  );
  const handleToggleTheme = () => {
    toggleTheme();
    if (!themeHintSeen) {
      setThemeHintSeen(true);
      localStorage.setItem("theme-toggle-seen", "1");
    }
  };

  useSlashToFocusSearch();

  useEffect(() => {
    if (!user || !hasReminder) return;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    idle(prefetchPages);
  }, [user]);

  if (loading) return <AuthLoadingScreen slow={slow} />;
  if (!user) return <Login />;

  // Separate access per app: a workshop-only account (e.g. the workshop
  // coordinator) goes straight to Workshop PMS and never sees the Reminder
  // List; a reminder-only account never sees Workshop PMS. Everyone with
  // both still gets the app chooser below.
  if (!hasReminder && hasWorkshop && !(pathname === "/workshops" || pathname.startsWith("/workshops/"))) {
    // The workshop coordinator lands straight on the New Workshop form.
    return <Navigate to={canRequestWorkshops ? "/workshops/new" : "/workshops"} replace />;
  }
  if (hasReminder && !hasWorkshop && (pathname === "/hub" || pathname === "/workshops" || pathname.startsWith("/workshops/"))) {
    return <Navigate to="/" replace />;
  }
  if (!hasReminder && !hasWorkshop) {
    return (
      <div className="auth-loading">
        <Logo size={56} className="auth-logo" />
        <div className="auth-loading-text">Your account doesn't have access to any app yet.</div>
        <div className="auth-loading-hint">Ask an admin to give you access.</div>
        <button type="button" onClick={logout} style={{ marginTop: 16 }}>Sign out</button>
      </div>
    );
  }

  // After sign-in the person chooses an app: Reminder List (everything
  // below) or the Workshop PMS sub-site (its own layout + routes).
  if (pathname === "/hub") {
    return (
      <Suspense fallback={<AuthLoadingScreen slow={false} />}>
        <Hub />
      </Suspense>
    );
  }
  if (pathname === "/workshops" || pathname.startsWith("/workshops/")) {
    return (
      <Suspense fallback={<AuthLoadingScreen slow={false} />}>
        <Routes>
          <Route path="/workshops/*" element={<WorkshopApp />} />
        </Routes>
      </Suspense>
    );
  }
  // First landing of a session goes to the chooser; deep links (e.g. a
  // notification pointing at /master) still open directly.
  if (pathname === "/" && hasReminder && hasWorkshop && !sessionStorage.getItem("hubChosen")) return <Navigate to="/hub" replace />;

  const links = isAdmin ? [...baseLinks, ...adminLinks] : baseLinks;

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
            <Logo size={36} />
            {!collapsed && (
              <div className="brand-text">
                <div className="brand-title">Reminder List</div>
                <div className="brand-sub">Ops Tracker</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
            {isAdmin && !collapsed && <NotificationBell isAdmin={isAdmin} />}
            <button
              type="button"
              className={"theme-toggle" + (!themeHintSeen ? " theme-toggle-hint" : "")}
              onClick={handleToggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Click to switch to light mode" : "Click to switch to dark mode"}
            >
              {!themeHintSeen && <span className="theme-toggle-pulse" aria-hidden="true" />}
              {theme === "dark" ? (
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4.2" />
                  <path d="M12 2.5v2.2M12 19.3v2.2M4.4 4.4l1.55 1.55M18.05 18.05l1.55 1.55M2.5 12h2.2M19.3 12h2.2M4.4 19.6l1.55-1.55M18.05 5.95l1.55-1.55" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
                </svg>
              )}
            </button>
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
                  {icons[l.icon]}
                </svg>
                {l.to === "/messages" && msgUnread > 0 && collapsed && <span className="nav-icon-dot" aria-hidden="true" />}
              </span>
              {!collapsed && <span>{l.label}</span>}
              {l.to === "/messages" && msgUnread > 0 && !collapsed && (
                <span className="nav-badge">{msgUnread > 9 ? "9+" : msgUnread}</span>
              )}
            </NavLink>
          ))}
          {hasWorkshop && <button
            type="button"
            className="nav-link nav-link-switch"
            title={collapsed ? "All apps" : undefined}
            onClick={() => { sessionStorage.removeItem("hubChosen"); navigate("/hub"); }}
          >
            <span className="nav-icon-wrap">
              <svg className="nav-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
              </svg>
            </span>
            {!collapsed && <span>All apps</span>}
          </button>}
        </nav>

        <div className="sidebar-user">
          <NavLink to="/account" className="sidebar-user-link" onClick={() => setMobileOpen(false)} title={collapsed ? user.name : undefined}>
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
        <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/consolidated" element={<Navigate to="/" replace />} />
          <Route path="/master" element={<Master />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/doers" element={<AdminRoute isAdmin={isAdmin}><DoerList /></AdminRoute>} />
          <Route path="/submissions" element={<SubmissionLog />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/account" element={<Account />} />
          <Route path="/settings" element={<AdminRoute isAdmin={isAdmin}><Settings /></AdminRoute>} />
          <Route path="/users" element={<AdminRoute isAdmin={isAdmin}><Users /></AdminRoute>} />
          <Route path="/notifications" element={<AdminRoute isAdmin={isAdmin}><Notifications /></AdminRoute>} />
        </Routes>
        </Suspense>
      </main>
      <ShortcutsHelp />
      <Suspense fallback={null}>
        <Chatbot />
      </Suspense>
    </div>
  );
}
