// In dev, Vite proxies "/api" to the local backend (see vite.config.js).
// In production, set VITE_API_URL to the deployed backend's URL
// (for example https://your-app.onrender.com/api) at build time.

const BASE = import.meta.env.VITE_API_URL || "/api";

export { BASE as API_BASE };

let authToken = localStorage.getItem("authToken") || null;
let onUnauthorized = null;

// Called from AuthContext on login/logout.
export function setAuthToken(token) {
  authToken = token;
  // Lists like Tasks are per-person (members only see their own) — never
  // carry one person's cached copy over to the next sign-in.
  listCache.clear();

  if (token) {
    localStorage.setItem("authToken", token);
  } else {
    localStorage.removeItem("authToken");
  }
}

// AuthContext registers a callback here so that ANY request
// that returns 401 sends the user back to login.
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// fetch() only rejects when the request never reached the server (offline,
// DNS failure, server down, CORS block). Turn that into a friendly error
// flagged `.network = true` and tell the NetworkProvider so it can verify
// the connection and show the right "offline" / "server unreachable" UI.
async function netFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    window.dispatchEvent(new CustomEvent("app:network-error"));
    const err = new Error(
      navigator.onLine === false
        ? "You're offline. Check your internet connection and try again."
        : "Can't reach the server right now. Please try again in a moment."
    );
    err.network = true;
    throw err;
  }
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await netFetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    setAuthToken(null);
    onUnauthorized?.();
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));

    throw new Error(
      err.error ||
      err.message ||
      "Request failed"
    );
  }

  return res.json();
}

// --- Small client-side cache for rarely-changing lists -------------------
// Doers and Tasks are requested by nearly every page (dropdowns, name
// lookups) but only change when an admin edits them. Reuse one in-flight or
// recent request instead of re-fetching on every page visit; any write
// below drops the cached copy so edits show up immediately.
const LIST_TTL_MS = 30_000;
const listCache = new Map(); // path -> { at, promise }

function cachedList(path) {
  const hit = listCache.get(path);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.promise;
  const promise = request(path).catch((err) => {
    listCache.delete(path);
    throw err;
  });
  listCache.set(path, { at: Date.now(), promise });
  return promise;
}

// Runs a write, then forgets the cached lists it may have changed.
function writeThen(paths, path, options) {
  return request(path, options).then((res) => {
    paths.forEach((p) => listCache.delete(p));
    return res;
  });
}

// Downloads a file from an authenticated endpoint (a plain <a href> can't
// send the Authorization header, so it used to bounce with "Not signed in").
export async function downloadFile(path, filename) {
  const res = await netFetch(`${BASE}${path}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Download failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  // ============================================================
  // AUTH
  // ============================================================

  login: (email, password) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    }),

  me: () =>
    request("/auth/me"),

  updateProfile: (data) =>
    request("/auth/me", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  changePassword: (currentPassword, newPassword) =>
    request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword,
        newPassword,
      }),
    }),

  // ============================================================
  // USERS
  // ============================================================

  getUsers: () =>
    request("/users"),

  createUser: (data) =>
    request("/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateUser: (id, data) =>
    request(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  removeUser: (id) =>
    request(`/users/${id}`, {
      method: "DELETE",
    }),

  // ============================================================
  // DOER LIST
  // ============================================================

  getDoers: () =>
    cachedList("/doers"),

  createDoer: (data) =>
    writeThen(["/doers"], "/doers", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateDoer: (id, data) =>
    writeThen(["/doers", "/tasks"], `/doers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  removeDoer: (id) =>
    writeThen(["/doers", "/tasks"], `/doers/${id}`, {
      method: "DELETE",
    }),

  emailDoerTasks: (id, status) =>
    request(`/doers/${id}/email-tasks`, {
      method: "POST",
      body: JSON.stringify({
        status,
      }),
    }),

  // ============================================================
  // TASK LIST
  // ============================================================

  getTasks: () =>
    cachedList("/tasks"),

  // Ids of tasks that have a reminder inside a date window (Task List filter).
  getScheduledTaskIds: (params = "") =>
    request(`/tasks/scheduled${params}`),

  createTask: (data) =>
    writeThen(["/tasks"], "/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTask: (id, data) =>
    writeThen(["/tasks"], `/tasks/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  removeTask: (id) =>
    writeThen(["/tasks"], `/tasks/${id}`, {
      method: "DELETE",
    }),

  // ============================================================
  // MASTER / REMINDER LOG
  // ============================================================

  getMaster: (params = "") =>
    request(`/master${params}`),

  getMasterOne: (id) =>
    request(`/master/${id}`),

  // Exports exactly the rows matching the given filter query string.
  downloadMasterCsv: (params = "") =>
    downloadFile(`/master/export.csv${params}`, "master.csv"),

  createMaster: (data) =>
    request("/master", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  completeMaster: (id, actual) =>
    request(`/master/${id}/complete`, {
      method: "PATCH",
      body: JSON.stringify({
        actual,
      }),
    }),

  submitDone: (id, data) =>
    request(`/master/${id}/submit-done`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getProof: (id) =>
    request(`/master/${id}/proof`),

  updateMaster: (id, data) =>
    request(`/master/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  removeMaster: (id) =>
    request(`/master/${id}`, {
      method: "DELETE",
    }),

  generateUpcoming: (force) =>
    request(
      `/master/generate-upcoming${force ? "?force=1" : ""}`,
      {
        method: "POST",
      }
    ),

  dedupeMaster: () =>
    request("/master/dedupe", {
      method: "POST",
    }),

  // ============================================================
  // NOTIFICATIONS
  // ============================================================

  getNotifications: (params = "") =>
    request(`/notifications${params}`),

  getUnreadNotifCount: () =>
    request("/notifications/unread-count"),

  markNotificationRead: (id) =>
    request(`/notifications/${id}/read`, {
      method: "PATCH",
    }),

  markAllNotificationsRead: () =>
    request("/notifications/read-all", {
      method: "POST",
    }),

  // Permanently clears the whole notification inbox.
  clearNotifications: () =>
    request("/notifications", {
      method: "DELETE",
    }),

  // Dismisses a single notification.
  removeNotification: (id) =>
    request(`/notifications/${id}`, {
      method: "DELETE",
    }),

  // ============================================================
  // CONSOLIDATED
  // ============================================================

  getConsolidated: (range) =>
    request(
      `/consolidated${range ? `?range=${range}` : ""}`
    ),

  getSummary: (range) =>
    request(
      `/consolidated/summary${range ? `?range=${range}` : ""}`
    ),

  getMyPerformance: (range) =>
    request(
      `/consolidated/me${range ? `?range=${range}` : ""}`
    ),

  archiveDashboard: (label) =>
    request("/consolidated/archive", {
      method: "POST",
      body: JSON.stringify({
        label,
      }),
    }),

  getArchives: () =>
    request("/consolidated/archive"),

  removeArchive: (id) =>
    request(`/consolidated/archive/${id}`, {
      method: "DELETE",
    }),

  // ============================================================
  // SUBMISSION LOG
  // ============================================================

  getSubmissions: (params = "") =>
    request(`/submissions${params}`),

  getSubmissionsSummary: () =>
    request("/submissions/summary"),

  // ============================================================
  // SETTINGS
  // ============================================================

  getSettings: () =>
    request("/settings"),

  updateSettings: (data) =>
    request("/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getHolidays: () =>
    request("/settings/holidays"),

  addHoliday: (data) =>
    request("/settings/holidays", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeHoliday: (id) =>
    request(`/settings/holidays/${id}`, {
      method: "DELETE",
    }),

  // ============================================================
  // REMINDERS
  // ============================================================

  sendRemindersNow: () =>
    request("/reminders/send-daily", {
      method: "POST",
    }),

  getMailerStatus: () =>
    request("/reminders/mailer-status"),

  // ============================================================
  // CHATBOT
  // ============================================================

  askChatbot: (message, history) =>
    request("/chatbot/ask", {
      method: "POST",
      body: JSON.stringify({
        message,
        history,
      }),
    }),

  // ============================================================
  // HELP TICKETS
  // ============================================================

  getTicketMeta: () => request("/tickets/meta"),
  getTicketCount: () => request("/tickets/count"),
  // params: "?box=inbox|sent|all&status=&q=&page=&limit="
  getTickets: (params = "") => request(`/tickets${params}`),
  createTicket: (data) => request("/tickets", { method: "POST", body: JSON.stringify(data) }),
  updateTicket: (id, data) => request(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTicket: (id) => request(`/tickets/${id}`, { method: "DELETE" }),

  // ============================================================
  // MESSAGES
  // ============================================================

  getMessagePeople: () =>
    request("/messages/people"),

  getConversations: () =>
    request("/messages/conversations"),

  getMessagesUnreadCount: () =>
    request("/messages/unread-count"),

  getThread: (userId) =>
    request(`/messages/thread/${userId}`),

  sendMessage: (userId, text) =>
    request(`/messages/thread/${userId}`, {
      method: "POST",
      body: JSON.stringify({
        text,
      }),
    }),

  getBroadcast: () =>
    request("/messages/broadcast"),

  sendBroadcast: (text) =>
    request("/messages/broadcast", {
      method: "POST",
      body: JSON.stringify({
        text,
      }),
    }),

  // ============================================================
  // DELETE CONVERSATION
  // ============================================================

  // Deletes/clears the conversation ONLY for the current user.
  // The other person's messages remain untouched.
  deleteConversation: (userId) =>
    request(`/messages/thread/${userId}`, {
      method: "DELETE",
    }),

  // ============================================================
  // EDIT MESSAGE
  // ============================================================

  editMessage: (id, text) =>
    request(`/messages/message/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        text,
      }),
    }),

  // ============================================================
  // DELETE MESSAGE
  // ============================================================

  // IMPORTANT:
  //
  // forEveryone = true
  //   DELETE /messages/message/:id?forEveryone=1
  //
  // forEveryone = false
  //   DELETE /messages/message/:id?forEveryone=0
  //
  // We intentionally use the query parameter instead of relying
  // on a DELETE request body.
  deleteMessage: (id, forEveryone = false) =>
    request(
      `/messages/message/${id}?forEveryone=${forEveryone ? "1" : "0"}`,
      {
        method: "DELETE",
      }
    ),

  // ============================================================
  // WORKSHOP PMS
  // ============================================================

  wsMeta: () => request("/workshops/meta"),
  wsStats: () => request("/workshops/stats"),
  wsDashboard: (range) => request("/workshops/dashboard" + (range ? `?range=${range}` : "")),

  wsList: (params = "") => request(`/workshops${params}`),
  wsNextId: (type) => request(`/workshops/next-id?type=${encodeURIComponent(type)}`),
  wsGet: (id) => request(`/workshops/${encodeURIComponent(id)}`),
  wsCreate: (data) => request("/workshops", { method: "POST", body: JSON.stringify(data) }),
  wsUpdate: (id, data) => request(`/workshops/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  wsApprove: (id, note) => request(`/workshops/${id}/approve`, { method: "POST", body: JSON.stringify({ note }) }),
  wsReject: (id, note) => request(`/workshops/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) }),
  wsRemove: (id) => request(`/workshops/${id}`, { method: "DELETE" }),
  wsResendLaunch: (id) => request(`/workshops/${id}/resend-launch`, { method: "POST" }),
  wsRemoteLaunches: () => request("/workshops/launches/remote"),

  wsVerifyLaunch: (id, verified = true) => request(`/workshops/${id}/verify-launch`, { method: "POST", body: JSON.stringify({ verified }) }),
  wsGenerateTasks: (id) => request(`/workshops/${id}/generate-tasks`, { method: "POST" }),
  wsTasks: (params = "") => request(`/workshops/tasks${params}`),
  wsCompleteTask: (id, data = {}) => request(`/workshops/tasks/${id}/complete`, { method: "POST", body: JSON.stringify(data) }),
  wsReopenTask: (id) => request(`/workshops/tasks/${id}/reopen`, { method: "POST" }),
  wsUpdateTask: (id, data) => request(`/workshops/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  wsTemplates: () => request("/workshops/templates"),
  wsSaveTemplate: (code, data) => request(`/workshops/templates/${code}`, { method: "PUT", body: JSON.stringify(data) }),
  wsResponses: (params = "") => request(`/workshops/responses${params}`),
  wsSubmitResponse: (data) => request("/workshops/responses", { method: "POST", body: JSON.stringify(data) }),
  wsCounters: () => request("/workshops/counters"),
  wsSaveCounters: (data) => request("/workshops/counters", { method: "PUT", body: JSON.stringify(data) }),
};
