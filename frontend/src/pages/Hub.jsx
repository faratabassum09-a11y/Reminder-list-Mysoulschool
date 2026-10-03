import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import WorkshopLogo from "../components/WorkshopLogo.jsx";
import TicketsLogo from "../components/TicketsLogo.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import SchoolBrand from "../components/SchoolLogo.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api.js";
import "./hub.css";

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function Hub() {
  const { user, logout, isAdmin, hasReminder, hasWorkshop, hasTickets } = useAuth();
  const navigate = useNavigate();
  const [wsStats, setWsStats] = useState(null);
  const [remStats, setRemStats] = useState(null);
  const [tkCount, setTkCount] = useState(null);

  // Light "what's waiting for you" numbers on each card. Failures are silent —
  // the chooser must always open, even if a stat can't load.
  useEffect(() => {
    if (hasWorkshop) api.wsStats().then(setWsStats).catch(() => {});
    if (hasReminder) api.getMyPerformance?.().then(setRemStats).catch(() => {});
    if (hasTickets) api.getTicketCount().then(setTkCount).catch(() => {});
  }, []);

  const open = (to) => {
    sessionStorage.setItem("hubChosen", "1");
    navigate(to);
  };

  const { theme, toggleTheme } = useTheme();
  const first = (user?.name || "").split(" ")[0];

  return (
    <div className="hub">
      <div className="hub-glow" aria-hidden="true" />
      <header className="hub-top">
        <SchoolBrand size={40} tone="dark" />
        <div className="hub-user">
          <span className="hub-user-name">{user?.name}</span>
          <span className="hub-user-role">{isAdmin ? "Admin" : "Member"}</span>
        </div>
        <button type="button" className="hub-ghost" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? "☀ Light" : "☾ Dark"}
        </button>
        <button type="button" className="hub-ghost" onClick={logout}>Sign out</button>
      </header>

      <main className="hub-main">
        <h1 className="hub-title">{greeting()}{first ? `, ${first}` : ""}.</h1>
        <p className="hub-sub">Where would you like to work today?</p>

        <div className="hub-grid">
          {hasReminder && <button type="button" className="hub-card hub-card-reminder" onClick={() => open("/")}>
            <div className="hub-card-head">
              <Logo size={54} />
              <span className="hub-card-arrow" aria-hidden="true">→</span>
            </div>
            <h2>Reminder List</h2>
            <p>Recurring tasks, doers, the Master log and the performance dashboard.</p>
            <ul className="hub-card-points">
              <li>Master &amp; Task List</li>
              <li>Dashboard &amp; Submission Log</li>
              <li>Messages &amp; MySoul Assistant</li>
            </ul>
            <div className="hub-card-foot">
              {remStats ? <span className="hub-pill">Your work is live</span> : <span className="hub-pill hub-pill-quiet">Open</span>}
            </div>
          </button>}

          {hasWorkshop && <button type="button" className="hub-card hub-card-workshop" onClick={() => open("/workshops")}>
            <div className="hub-card-head">
              <WorkshopLogo size={54} />
              <span className="hub-card-arrow" aria-hidden="true">→</span>
            </div>
            <h2>Workshop PMS</h2>
            <p>Plan workshops, get them approved, and run each one's fixed task list to launch.</p>
            <ul className="hub-card-points">
              <li>New workshop &amp; approvals</li>
              <li>Fixed task lists (UTW · ICP · R12 · THW)</li>
              <li>Launch Verification hand-off</li>
            </ul>
            <div className="hub-card-foot">
              {isAdmin && wsStats?.pendingApproval > 0 && (
                <span className="hub-pill hub-pill-alert">{wsStats.pendingApproval} awaiting your approval</span>
              )}
              {wsStats?.myOverdue > 0 && <span className="hub-pill hub-pill-bad">{wsStats.myOverdue} of your tasks overdue</span>}
              {wsStats && !wsStats.myOverdue && !(isAdmin && wsStats.pendingApproval > 0) && (
                <span className="hub-pill">{wsStats.myOpen} open task{wsStats.myOpen === 1 ? "" : "s"} for you</span>
              )}
              {!wsStats && <span className="hub-pill hub-pill-quiet">Open</span>}
            </div>
          </button>}

          {hasTickets && <button type="button" className="hub-card hub-card-tickets" onClick={() => open("/tickets")}>
            <div className="hub-card-head">
              <TicketsLogo size={54} />
              <span className="hub-card-arrow" aria-hidden="true">→</span>
            </div>
            <h2>Help Tickets</h2>
            <p>Raise a problem to a teammate and track it until it's resolved.</p>
            <ul className="hub-card-points">
              <li>Raise a ticket to any doer</li>
              <li>Your inbox — only you see tickets sent to you</li>
              {isAdmin && <li>Tickets Raised overview (admin)</li>}
            </ul>
            <div className="hub-card-foot">
              {tkCount?.inbox > 0 && <span className="hub-pill hub-pill-bad">{tkCount.inbox} waiting on you</span>}
              {isAdmin && tkCount?.open > 0 && <span className="hub-pill hub-pill-alert">{tkCount.open} open across the team</span>}
              {tkCount && !tkCount.inbox && !(isAdmin && tkCount.open > 0) && <span className="hub-pill">Nothing waiting on you</span>}
              {!tkCount && <span className="hub-pill hub-pill-quiet">Open</span>}
            </div>
          </button>}
        </div>
      </main>
    </div>
  );
}
