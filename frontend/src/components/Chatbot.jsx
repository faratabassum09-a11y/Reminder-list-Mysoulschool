import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

const BOT_NAME = "Ozzy";

const SUGGESTIONS = [
  "What tasks did I complete?",
  "What's my percentage?",
  "Give me a percentage breakdown",
  "What's still pending?",
  "Any delayed tasks?",
  "Open Dashboard",
];
const ADMIN_SUGGESTIONS = [
  "What tasks did I complete?",
  "Give me a percentage breakdown",
  "Any new notifications?",
  "What's due today?",
  "How's the team doing?",
  "Open Dashboard",
];

// Site knowledge — what each page/feature actually does. Lets Ozzy answer
// "what is X" / "how do I do Y" without hitting any API at all.
const PAGE_INFO = {
  dashboard: "The Dashboard shows the big picture: total tasks, On Time vs Delayed vs Pending, a leaderboard, and a date-range picker (Today, This Week, Last Month, etc). It's a live rollup, not a separate sheet.",
  master: "Master is the full reminder log — every task occurrence, Planned vs Actual, with live status. Admins can add new recurring tasks here (task name, department, frequency, assignee, start date) and everyone can mark their own tasks done.",
  "task list": "Task List is the read-only catalog of recurring tasks — the \"what\" and \"how often\", not individual occurrences. To add a new task with its schedule, use Master instead.",
  "task": "Task List is the read-only catalog of recurring tasks — the \"what\" and \"how often\", not individual occurrences. To add a new task with its schedule, use Master instead.",
  "doer list": "Doer List is the roster of people tasks get assigned to — name, department, email. Doers are who tasks are for; Users are who can log in.",
  "doer": "Doer List is the roster of people tasks get assigned to — name, department, email. Doers are who tasks are for; Users are who can log in.",
  "submission log": "Submission Log is the raw \"task done\" submission history — every completion event, searchable by name or task, exportable as CSV.",
  settings: "Settings controls the schedule horizon (how far ahead reminders auto-generate), whether Sundays are skipped, and the daily reminder email hour/toggle. Admin-only.",
  users: "Users is where admins manage who can log in — name, email, role (admin/member), password. Admin-only.",
  notifications: "Notifications is your inbox of \"someone marked a task done\" events. The bell icon in the sidebar shows the unread count — opening it (or the full page) marks everything read. Clicking a notification jumps straight to that task on Master.",
  account: "Account shows your profile, lets you change your password, and shows your own performance breakdown if you're a doer.",
};

function firstName(name) {
  return (name || "").trim().split(" ")[0] || "there";
}
function pct(n) {
  return Math.round(n || 0);
}
function taskLines(rows, opts = {}) {
  const { limit = 6, showDoer = false, field = "planned", labelPrefix = "due" } = opts;
  return rows.slice(0, limit).map((r) => {
    const bits = [r.task?.taskName || "Task"];
    if (showDoer) bits.push(`— ${r.doer?.name || ""}`);
    bits.push(`(${new Date(r[field]).toLocaleDateString()}${labelPrefix ? ` ${labelPrefix}` : ""})`);
    return `• ${bits.join(" ")}`;
  });
}

// A small, fast, rule-based assistant — it answers by reading the same
// endpoints the Dashboard/Account/Master pages already use, so every
// number it gives matches what those pages show. No free-text question is
// sent anywhere external; everything is matched locally by keyword.
function buildHelpMessage(isAdmin) {
  return (
    `I can look up almost anything about your account and this site. Try asking me:\n` +
    (isAdmin ? ADMIN_SUGGESTIONS : SUGGESTIONS).map((s) => `• ${s}`).join("\n") +
    `\n\n🧭 I can also take you places — just say "open dashboard", "open master", "go to account", etc. and I'll jump you straight there. Or ask me "what is <page>?" to find out what any page does first.`
  );
}

// Very light fuzzy matching for page names, so "whats the doerlist for"
// still finds "doer list".
function findPageInfo(q) {
  const key = Object.keys(PAGE_INFO)
    .sort((a, b) => b.length - a.length) // longer/more specific keys first
    .find((k) => q.includes(k.replace(/\s+/g, "")) || q.includes(k));
  return key ? PAGE_INFO[key] : null;
}

const NAV_TARGETS = [
  { re: /dashboard|home page/, path: "/", label: "Dashboard" },
  { re: /\bmaster\b/, path: "/master", label: "Master" },
  { re: /task list|\btasks?\b/, path: "/tasks", label: "Task List" },
  { re: /doer/, path: "/doers", label: "Doer List" },
  { re: /submission/, path: "/submissions", label: "Submission Log" },
  { re: /notification/, path: "/notifications", label: "Notifications" },
  { re: /setting/, path: "/settings", label: "Settings" },
  { re: /\busers?\b/, path: "/users", label: "Users" },
  { re: /account|profile|my page/, path: "/account", label: "Account" },
];

export default function Chatbot() {
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [greeted, setGreeted] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open && !greeted) {
      setGreeted(true);
      setMessages([
        {
          role: "bot",
          text: `Hi ${firstName(user?.name)}! I'm ${BOT_NAME} 🦉 — how could I help you?\n\n${buildHelpMessage(isAdmin)}`,
        },
      ]);
    }
  }, [open, greeted, user, isAdmin]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const push = (role, text) => setMessages((m) => [...m, { role, text }]);

  // Returns { text, navTo? } so send() can both reply and (optionally)
  // navigate the person where they asked to go.
  const answer = async (raw) => {
    const q = raw.toLowerCase().trim();

    // small talk
    if (/^(hi|hey|hello|yo|sup|hola)\b/.test(q)) {
      return { text: `Hey ${firstName(user?.name)}! ${buildHelpMessage(isAdmin)}` };
    }
    // bot identity — answered instantly, without needing the AI fallback
    if (/who (are|r) (you|u)\b|your name|who (made|built|created|developed) you|who'?s your (developer|creator|maker)/.test(q)) {
      return { text: "I'm Ozzy 🦉, developed by Fara." };
    }
    if (/thank|thanks|thx|appreciate/.test(q)) {
      return { text: "Anytime! 🦉 Anything else you'd like to check?" };
    }
    if (/^(bye|goodbye|see ya|later)\b/.test(q)) {
      return { text: "See you around! I'll be right here in the corner if you need me again." };
    }

    // "take me to X" / "open X" / "go to X" — explicit navigation
    const navMatch = /\b(open|go to|take me to|show me the|navigate to)\b/.test(q) && NAV_TARGETS.find((t) => t.re.test(q));
    if (navMatch) {
      if ((navMatch.path === "/settings" || navMatch.path === "/users") && !isAdmin) {
        return { text: `${navMatch.label} is admin-only, so I can't take you there — but I can tell you what it's for if you'd like.` };
      }
      return { text: `On it — opening ${navMatch.label}.`, navTo: navMatch.path };
    }

    // site / feature explanations — "what is X", "what does X do", "how do I..."
    if (/what (is|does|are)|tell me about|explain|features? of|how do i|how does .* work/.test(q)) {
      const info = findPageInfo(q);
      if (info) return { text: info };
      if (/features?|this (website|site|app|tool)|what can (this|it) do/.test(q)) {
        return {
          text:
            `Here's the rundown of what's here:\n` +
            `• Dashboard — live totals & leaderboard\n` +
            `• Master — the full reminder log, mark tasks done here\n` +
            `• Task List — the catalog of recurring tasks\n` +
            `• Doer List — who tasks are assigned to\n` +
            `• Submission Log — raw completion history\n` +
            (isAdmin ? `• Notifications — your "task marked done" inbox\n• Settings — schedule & reminder-email config\n• Users — manage logins\n` : "") +
            `• Account — your profile & performance\n\n` +
            `Ask "what is <page name>?" for more on any of these.`,
        };
      }
      if (/how do i (mark|complete|finish|close).*task|mark.*done/.test(q)) {
        return { text: "On Master, find the row for your task and click \"Mark as done\" — a note, link, or screenshot is optional. It completes the task right away and (if you're not an admin) notifies the admin." };
      }
      if (/how do i add a task|create a task|new task/.test(q)) {
        return isAdmin
          ? { text: "On Master, use the \"+ Add Task & Start Schedule\" form at the top — name, department, how it recurs (e.g. \"Daily\", \"Weekly on Monday\"), the default assignee, and a start date. It starts generating reminders immediately." }
          : { text: "Adding new tasks is admin-only — ping an admin to set one up on Master." };
      }
    }

    // how is percentage calculated — explicit, checked early (and with a
    // word-boundary-safe pattern) so it can't get shadowed by the broader
    // "delay/late" or "percent" keyword rules below.
    if (/how.*(calculat|comput|work).*(percent|%|rate)|percent.*(calculat|comput)/.test(q)) {
      return {
        text:
          `Your on-time rate = (tasks completed On Time) ÷ (total tasks counted so far) × 100.\n` +
          `A task counts as "On Time" if it was marked done at or before its planned time, "Delayed" if done after (or still open past the deadline), and "Pending" if it's not due yet. ` +
          `Only tasks due up to today are counted, so future-scheduled reminders don't drag your score down before they're even due.`,
      };
    }

    // "what tasks did I complete"
    if (/complet|done task|finished/.test(q) && !/percent|%/.test(q)) {
      try {
        const res = await api.getMaster("?limit=100");
        const mine = (res.rows || []).filter((r) => r.actual && (isAdmin ? true : r.doer?.email === user?.email));
        if (mine.length === 0) return { text: "You haven't completed any tasks yet — mark one done on Master and I'll list it here." };
        const recent = mine.slice(0, 6);
        const lines = recent.map((r) => `• ${r.task?.taskName || "Task"} — ${new Date(r.actual).toLocaleDateString()} (${r.status})`);
        return { text: `Here's what's been completed most recently${mine.length > recent.length ? ` (showing ${recent.length} of ${mine.length})` : ""}:\n${lines.join("\n")}` };
      } catch {
        return { text: "I couldn't load your task history just now — try again in a moment." };
      }
    }

    // pending
    if (/pending|left to do|still (need|have) to|not done/.test(q)) {
      try {
        const res = await api.getMaster("?status=Pending&limit=100");
        const mine = (res.rows || []).filter((r) => isAdmin ? true : r.doer?.email === user?.email);
        if (mine.length === 0) return { text: "Nothing pending right now — you're all caught up! 🎉" };
        const lines = taskLines(mine, { showDoer: isAdmin, field: "planned", labelPrefix: "" });
        return { text: `You've got ${mine.length} pending task${mine.length === 1 ? "" : "s"}:\n${lines.join("\n")}` };
      } catch {
        return { text: "I couldn't load pending tasks just now — try again in a moment." };
      }
    }

    // delayed
    if (/\bdelay(ed)?\b|\blate\b|\boverdue\b/.test(q)) {
      try {
        const res = await api.getMaster("?status=Delayed&limit=100");
        const mine = (res.rows || []).filter((r) => isAdmin ? true : r.doer?.email === user?.email);
        if (mine.length === 0) return { text: "No delayed tasks on record — nice and on track!" };
        const lines = mine.slice(0, 6).map((r) => `• ${r.task?.taskName || "Task"}${isAdmin ? ` — ${r.doer?.name || ""}` : ""} — was due ${new Date(r.planned).toLocaleDateString()}`);
        return { text: `${mine.length} delayed task${mine.length === 1 ? "" : "s"}:\n${lines.join("\n")}` };
      } catch {
        return { text: "I couldn't load that just now — try again in a moment." };
      }
    }

    // today
    if (/today/.test(q)) {
      try {
        const res = await api.getMaster("?today=1&limit=100");
        const rows = res.rows || [];
        if (rows.length === 0) return { text: "Nothing scheduled for today." };
        const lines = rows.slice(0, 6).map((r) => `• ${r.task?.taskName || "Task"}${isAdmin ? ` — ${r.doer?.name || ""}` : ""} (${r.status})`);
        return { text: `${rows.length} task${rows.length === 1 ? "" : "s"} today:\n${lines.join("\n")}` };
      } catch {
        return { text: "I couldn't load today's tasks just now — try again in a moment." };
      }
    }

    // notifications (admin) — replaces the old approval "review" queue
    if (isAdmin && /notif|waiting on me|any new|inbox/.test(q)) {
      try {
        const res = await api.getUnreadNotifCount();
        return {
          text: res.count > 0
            ? `You've got ${res.count} new notification${res.count === 1 ? "" : "s"} — tasks the team's marked done. Want me to open your Notifications?`
            : "Nothing new in your notifications right now.",
          navTo: res.count > 0 ? "/notifications" : undefined,
        };
      } catch {
        return { text: "I couldn't check that just now — try again in a moment." };
      }
    }

    // team / department breakdown (admin-facing numbers, uses the same
    // endpoint the Dashboard does)
    if (/team|department|everyone|whole company|org(anization)?/.test(q) && /doing|breakdown|overview|status|how('?s| is)/.test(q)) {
      try {
        const s = await api.getSummary("");
        if (!s.total) return { text: "No data yet to summarize across the team." };
        const deptLines = (s.byDepartment || []).slice(0, 8).map((d) => `• ${d._id}: ${d.total} task${d.total === 1 ? "" : "s"}, ${pct((d.onTime / (d.total || 1)) * 100)}% on time`);
        return {
          text:
            `Team-wide (${s.total.toLocaleString()} tasks): ${pct((s.onTime / s.total) * 100)}% on time, ${s.delayed} delayed, ${s.pending} pending.\n` +
            (deptLines.length ? `\nBy department:\n${deptLines.join("\n")}` : ""),
        };
      } catch {
        return { text: "I couldn't load the team summary just now — try again in a moment." };
      }
    }

    // leaderboard / top performer
    if (/leaderboard|top perform|who'?s (the )?(best|top)|ranked?/.test(q)) {
      try {
        const rows = await api.getConsolidated("");
        if (!rows.length) return { text: "No performance data yet to rank anyone by." };
        const top = rows.slice(0, 5).map((r) => `${r.rank}. ${r.name} — ${pct(r.onTimePercent)}% on time (${r.total} task${r.total === 1 ? "" : "s"})`);
        return { text: `Top of the leaderboard:\n${top.join("\n")}` };
      } catch {
        return { text: "I couldn't load the leaderboard just now — try again in a moment." };
      }
    }

    // percentage breakdown (more detail) — check before plain percentage
    if (/breakdown|distribution|split/.test(q)) {
      try {
        const p = await api.getMyPerformance("");
        if (p.doer === null) return { text: "There's no Doer record linked to your account yet, so there's nothing to break down." };
        if (!p.total) return { text: "No completed or scheduled tasks yet to build a breakdown from." };
        return {
          text:
            `Here's your all-time breakdown (${p.total} task${p.total === 1 ? "" : "s"} total):\n` +
            `• On time: ${p.onTime} (${pct((p.onTime / p.total) * 100)}%)\n` +
            `• Delayed: ${p.delayed} (${pct((p.delayed / p.total) * 100)}%)\n` +
            `• Pending: ${p.pending} (${pct((p.pending / p.total) * 100)}%)\n` +
            `• Overall on-time rate: ${pct(p.onTimePercent)}%`,
        };
      } catch {
        return { text: "I couldn't load your performance numbers just now — try again in a moment." };
      }
    }

    // plain percentage / performance
    if (/percent|%|how am i doing|\bscore\b|\brate\b|performance/.test(q)) {
      try {
        const p = await api.getMyPerformance("");
        if (p.doer === null) return { text: "There's no Doer record linked to your account yet, so I can't compute a percentage." };
        if (!p.total) return { text: "Not enough data yet to calculate a percentage — complete a few tasks and check back." };
        return { text: `Your on-time rate is ${pct(p.onTimePercent)}% (${p.onTime} on time out of ${p.total} total).` };
      } catch {
        return { text: "I couldn't load your performance numbers just now — try again in a moment." };
      }
    }

    // who am I / my role
    if (/who am i|my role|am i (an? )?admin/.test(q)) {
      return { text: `You're signed in as ${user?.name || "—"} (${isAdmin ? "Admin" : "Member"}).` };
    }

    if (/help|what can you|guide me/.test(q)) {
      return { text: buildHelpMessage(isAdmin) };
    }

    // Nothing above matched — hand it to Ozzy's AI brain (Gemini), which
    // gets a live snapshot of this user's real data server-side so it
    // answers from actual numbers instead of guessing. Covers anything
    // about the site, this account's data, or genuinely random questions.
    return askAi(raw);
  };

  // messagesRef mirrors `messages` so askAi (called from inside `answer`,
  // before the new bot reply is pushed) always sees the latest history
  // without needing messages in its own dependency chain.
  const messagesRef = useRef([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const askAi = async (raw) => {
    const history = messagesRef.current.slice(-8).map((m) => ({ role: m.role, text: m.text }));
    try {
      const res = await api.askChatbot(raw, history);
      return { text: res.text };
    } catch {
      return {
        text:
          "I couldn't reach my AI brain just now — but I can still help with things like completed/pending/delayed tasks, your percentage, notifications, the leaderboard, or \"what is <page>?\".",
      };
    }
  };

  const send = async (text) => {
    const t = (text ?? input).trim();
    if (!t) return;
    push("user", t);
    setInput("");
    setThinking(true);
    try {
      const { text: reply, navTo } = await answer(t);
      push("bot", reply);
      if (navTo) setTimeout(() => navigate(navTo), 900);
    } finally {
      setThinking(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    send();
  };

  return (
    <div className="chatbot-wrap">
      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-head">
            <span className="chatbot-head-avatar">
              <span className="chatbot-head-avatar-emoji">🦉</span>
              <span className="chatbot-head-avatar-ring" aria-hidden="true" />
            </span>
            <div className="chatbot-head-text">
              <div className="chatbot-head-title">{BOT_NAME}</div>
              <div className="chatbot-head-sub"><span className="chatbot-online-dot" />Your Ops Tracker assistant</div>
            </div>
            <button type="button" className="chatbot-close" aria-label="Close chat" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="chatbot-messages" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={"chatbot-msg chatbot-msg-" + m.role}>
                {m.text.split("\n").map((line, j) => <div key={j}>{line}</div>)}
              </div>
            ))}
            {thinking && (
              <div className="chatbot-msg chatbot-msg-bot chatbot-typing">
                <span /><span /><span />
              </div>
            )}
          </div>
          {messages.length <= 1 && (
            <div className="chatbot-chips">
              {(isAdmin ? ADMIN_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <button key={s} type="button" className="chatbot-chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          )}
          <form className="chatbot-input-row" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              placeholder={`Ask ${BOT_NAME} anything…`}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" aria-label="Send" disabled={!input.trim() || thinking}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" />
              </svg>
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="chatbot-fab"
        aria-label={open ? `Close ${BOT_NAME}` : `Open ${BOT_NAME}, your assistant`}
        title={`${BOT_NAME} — ask me about your tasks`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chatbot-fab-glow" aria-hidden="true" />
        {open ? "×" : "🦉"}
      </button>
    </div>
  );
}
