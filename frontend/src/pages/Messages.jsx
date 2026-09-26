import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../components/Toast.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SearchInput from "../components/SearchInput.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { avatarStyleFromString, initials } from "../utils/colorFromString.js";

function timeShort(date) {
  const d = new Date(date);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

// Same relative-time formatting used by NotificationBell/Notifications, so
// "3m ago" reads consistently everywhere in the app.
function timeAgo(date) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const BROADCAST = { type: "broadcast" };

export default function Messages() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [conversations, setConversations] = useState(null);
  const [people, setPeople] = useState([]);
  const [broadcastPreview, setBroadcastPreview] = useState(null); // { unread, lastMessage } — filled in lazily
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(null); // null | { type: "dm", user } | { type: "broadcast" }
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null); // message currently showing its ⋮ menu
  const [editingId, setEditingId] = useState(null); // message currently being edited
  const [confirmDeleteConvo, setConfirmDeleteConvo] = useState(null); // user id armed for conversation delete
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  const loadConversations = () => {
    api.getConversations().then((r) => setConversations(r.conversations || [])).catch(() => {});
  };
  const loadUnread = () => {
    api.getMessagesUnreadCount().then((r) => setBroadcastPreview((p) => ({ ...p, unread: r.broadcast }))).catch(() => {});
  };

  useEffect(() => {
    loadConversations();
    loadUnread();
    api.getMessagePeople().then((r) => setPeople(r.users || [])).catch(() => {});
  }, []);
  usePolling(loadConversations, 5000);
  usePolling(loadUnread, 5000);

  // Keep the open thread live — a reply landing while you're looking at it
  // should just appear, the same way Master/Dashboard stay in sync.
  usePolling(() => {
    if (active?.type === "dm") {
      api.getThread(active.user._id).then((r) => setMessages(r.messages)).catch(() => {});
    } else if (active?.type === "broadcast") {
      api.getBroadcast().then((r) => setMessages(r.messages)).catch(() => {});
    }
  }, 4000);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Close any open bubble menu / in-progress edit when you switch threads.
  useEffect(() => {
    setOpenMenuId(null);
    setEditingId(null);
  }, [active]);

  const selectUser = async (u) => {
    setActive({ type: "dm", user: u });
    setMessages(null);
    setLoadingThread(true);
    try {
      const res = await api.getThread(u._id);
      setMessages(res.messages);
      loadConversations();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setLoadingThread(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const selectBroadcast = async () => {
    setActive(BROADCAST);
    setMessages(null);
    setLoadingThread(true);
    try {
      const res = await api.getBroadcast();
      setMessages(res.messages);
      setBroadcastPreview({ unread: 0, lastMessage: res.messages[res.messages.length - 1] || null });
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setLoadingThread(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // Deep link support: /messages?user=<id> opens straight into that thread
  // (handy for a future "Message" button elsewhere in the app).
  useEffect(() => {
    const uid = searchParams.get("user");
    if (uid && people.length) {
      const match = people.find((p) => p._id === uid);
      if (match) {
        selectUser(match);
        searchParams.delete("user");
        setSearchParams(searchParams, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  const cancelEdit = () => {
    setEditingId(null);
    setText("");
  };

  const startEdit = (m) => {
    setOpenMenuId(null);
    setEditingId(m._id);
    setText(m.text);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const send = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !active || sending) return;
    setSending(true);
    try {
      if (editingId) {
        const res = await api.editMessage(editingId, t);
        setMessages((m) => (m || []).map((msg) => (msg._id === editingId ? res.message : msg)));
        setEditingId(null);
      } else if (active.type === "broadcast") {
        const res = await api.sendBroadcast(t);
        setMessages((m) => [...(m || []), res.message]);
        toast(`Sent to ${res.reachedUserCount} of ${res.doerCount} people on the Doer List`, "good");
      } else {
        const res = await api.sendMessage(active.user._id, t);
        setMessages((m) => [...(m || []), res.message]);
        loadConversations();
      }
      setText("");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleDeleteMessage = async (m, forEveryone) => {
    setOpenMenuId(null);
    try {
      const res = await api.deleteMessage(m._id, forEveryone);
      if (forEveryone) {
        setMessages((list) => (list || []).map((msg) => (msg._id === m._id ? res.message : msg)));
      } else {
        setMessages((list) => (list || []).filter((msg) => msg._id !== m._id));
      }
      if (editingId === m._id) cancelEdit();
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const handleDeleteConversation = async (u, e) => {
    e.stopPropagation();
    if (confirmDeleteConvo !== u._id) {
      setConfirmDeleteConvo(u._id);
      setTimeout(() => setConfirmDeleteConvo((id) => (id === u._id ? null : id)), 3000);
      return;
    }
    setConfirmDeleteConvo(null);
    try {
      await api.deleteConversation(u._id);
      setConversations((list) => (list || []).filter((c) => c.user._id !== u._id));
      if (active?.type === "dm" && active.user._id === u._id) {
        setActive(null);
        setMessages(null);
      }
      toast("Conversation deleted", "good");
    } catch (err) {
      toast(err.message, "bad");
    }
  };

  const q = search.trim().toLowerCase();
  const filteredConversations = useMemo(() => {
    const list = conversations || [];
    if (!q) return list;
    return list.filter((c) => c.user.name.toLowerCase().includes(q) || c.user.email.toLowerCase().includes(q));
  }, [conversations, q]);

  const newPeople = useMemo(() => {
    if (!q) return [];
    const known = new Set((conversations || []).map((c) => c.user._id));
    return people.filter((p) => !known.has(p._id) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)));
  }, [people, conversations, q]);

  const isActiveUser = (u) => active?.type === "dm" && active.user._id === u._id;

  return (
    <div className="page messages-page">
      <PageHeader
        title="Messages"
        subtitle="Chat privately with anyone on the team, or send an announcement to everyone on the Doer List."
      />

      <div className="messages-monitor-banner">
        <span aria-hidden="true">🛡️</span> Make conversations meaningful — everything is monitored.
      </div>

      <div className="messages-layout">
        <aside className="messages-sidebar">
          <div className="messages-search">
            <SearchInput value={search} onChange={setSearch} placeholder="Search people to message…" />
          </div>

          <div className="messages-list">
            <button
              type="button"
              className={"messages-list-item" + (active?.type === "broadcast" ? " active" : "")}
              onClick={selectBroadcast}
            >
              <span className="messages-avatar messages-avatar-broadcast" aria-hidden="true">📢</span>
              <div className="messages-list-item-body">
                <div className="messages-list-item-top">
                  <span className="messages-list-item-name">Doer List Announcements</span>
                </div>
                <div className="messages-list-item-preview">
                  {broadcastPreview?.lastMessage
                    ? broadcastPreview.lastMessage.text
                    : "Team-wide announcements appear here"}
                </div>
              </div>
              {!!broadcastPreview?.unread && <span className="messages-badge">{broadcastPreview.unread > 9 ? "9+" : broadcastPreview.unread}</span>}
            </button>

            {conversations === null && <div className="messages-list-empty">Loading conversations…</div>}

            {conversations !== null && filteredConversations.map((c) => (
              <div className="messages-list-item-wrap" key={c.user._id}>
                <button
                  type="button"
                  className={"messages-list-item" + (isActiveUser(c.user) ? " active" : "")}
                  onClick={() => selectUser(c.user)}
                >
                  <span className="messages-avatar" style={avatarStyleFromString(c.user.name)}>{initials(c.user.name)}</span>
                  <div className="messages-list-item-body">
                    <div className="messages-list-item-top">
                      <span className="messages-list-item-name">{c.user.name}</span>
                      <span className="messages-list-item-time">{timeAgo(c.lastMessage.createdAt)}</span>
                    </div>
                    <div className="messages-list-item-preview">
                      {c.lastMessage.fromMe ? "You: " : ""}
                      {c.lastMessage.text}
                    </div>
                  </div>
                  {!!c.unread && <span className="messages-badge">{c.unread > 9 ? "9+" : c.unread}</span>}
                </button>
                <button
                  type="button"
                  className={"messages-list-item-delete" + (confirmDeleteConvo === c.user._id ? " confirming" : "")}
                  title={confirmDeleteConvo === c.user._id ? "Click again to confirm" : "Delete conversation"}
                  onClick={(e) => handleDeleteConversation(c.user, e)}
                >
                  {confirmDeleteConvo === c.user._id ? "Confirm?" : "🗑"}
                </button>
              </div>
            ))}

            {conversations !== null && filteredConversations.length === 0 && !q && (
              <div className="messages-list-empty">No conversations yet — search above to message someone.</div>
            )}

            {q && newPeople.length > 0 && (
              <>
                <div className="messages-list-divider">Start a new chat</div>
                {newPeople.map((p) => (
                  <button key={p._id} type="button" className="messages-list-item" onClick={() => selectUser(p)}>
                    <span className="messages-avatar" style={avatarStyleFromString(p.name)}>{initials(p.name)}</span>
                    <div className="messages-list-item-body">
                      <div className="messages-list-item-top">
                        <span className="messages-list-item-name">{p.name}</span>
                      </div>
                      <div className="messages-list-item-preview">{p.email}</div>
                    </div>
                  </button>
                ))}
              </>
            )}

            {q && newPeople.length === 0 && filteredConversations.length === 0 && (
              <div className="messages-list-empty">No one matches "{search}".</div>
            )}
          </div>
        </aside>

        <section className="messages-thread">
          {!active && (
            <div className="messages-empty-state">
              <span className="messages-empty-icon" aria-hidden="true">💬</span>
              <p>Pick a conversation on the left, or search for someone to start a new one.</p>
            </div>
          )}

          {active && (
            <>
              <div className="messages-thread-head">
                {active.type === "broadcast" ? (
                  <>
                    <span className="messages-avatar messages-avatar-broadcast" aria-hidden="true">📢</span>
                    <div>
                      <div className="messages-thread-head-name">Doer List Announcements</div>
                      <div className="messages-thread-head-sub">Visible to everyone signed in</div>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="messages-avatar" style={avatarStyleFromString(active.user.name)}>{initials(active.user.name)}</span>
                    <div>
                      <div className="messages-thread-head-name">{active.user.name}</div>
                      <div className="messages-thread-head-sub">{active.user.role === "admin" ? "Admin" : "Member"} · {active.user.email}</div>
                    </div>
                  </>
                )}
              </div>

              <div className="messages-thread-body" ref={bodyRef}>
                {loadingThread && messages === null && <div className="messages-list-empty">Loading…</div>}
                {messages !== null && messages.length === 0 && (
                  <div className="messages-list-empty">
                    {active.type === "broadcast" ? "No announcements yet." : `No messages yet — say hi to ${active.user.name}!`}
                  </div>
                )}
                {messages?.map((m) => {
                  const mine = String(m.sender?._id || m.sender) === String(user.id);
                  const deleted = m.deletedForEveryone;
                  const canEdit = mine && !deleted && (active.type !== "broadcast" || isAdmin);
                  return (
                    <div key={m._id} className={"messages-bubble-row" + (mine ? " mine" : "")}>
                      {!deleted && (
                        <div className="messages-bubble-menu-wrap">
                          <button
                            type="button"
                            className="messages-bubble-menu-btn"
                            aria-label="Message options"
                            onClick={() => setOpenMenuId((id) => (id === m._id ? null : m._id))}
                          >
                            ⋮
                          </button>
                          {openMenuId === m._id && (
                            <div className="messages-bubble-menu" onMouseLeave={() => setOpenMenuId(null)}>
                              {canEdit && (
                                <button type="button" onClick={() => startEdit(m)}>Edit</button>
                              )}
                              <button type="button" onClick={() => handleDeleteMessage(m, false)}>Delete for me</button>
                              {mine && (
                                <button type="button" className="danger" onClick={() => handleDeleteMessage(m, true)}>
                                  Delete for everyone
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className={"messages-bubble" + (mine ? " messages-bubble-me" : " messages-bubble-them") + (deleted ? " messages-bubble-deleted" : "")}>
                        {active.type === "broadcast" && !mine && (
                          <div className="messages-bubble-sender">{m.sender?.name || "Admin"}</div>
                        )}
                        <div className="messages-bubble-text">
                          {deleted ? "This message was deleted" : m.text}
                        </div>
                        <div className="messages-bubble-time">
                          {!deleted && m.edited && <span className="messages-bubble-edited">edited · </span>}
                          {timeShort(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {(active.type === "dm" || isAdmin) ? (
                <form className="messages-input-row" onSubmit={send}>
                  {editingId && (
                    <div className="messages-editing-note">
                      Editing message
                      <button type="button" onClick={cancelEdit}>Cancel</button>
                    </div>
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    value={text}
                    maxLength={4000}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                      editingId
                        ? "Edit your message…"
                        : active.type === "broadcast"
                        ? "Write an announcement to everyone on the Doer List…"
                        : `Message ${active.user.name}…`
                    }
                  />
                  <button type="submit" disabled={!text.trim() || sending} aria-label={editingId ? "Save" : "Send"}>
                    {editingId ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
                      </svg>
                    )}
                  </button>
                </form>
              ) : (
                <div className="messages-readonly-note">Only admins can post to the Doer List announcements.</div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
