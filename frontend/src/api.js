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

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`${BASE}${path}`, {
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
    request("/doers"),

  createDoer: (data) =>
    request("/doers", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateDoer: (id, data) =>
    request(`/doers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  removeDoer: (id) =>
    request(`/doers/${id}`, {
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
    request("/tasks"),

  createTask: (data) =>
    request("/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTask: (id, data) =>
    request(`/tasks/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  removeTask: (id) =>
    request(`/tasks/${id}`, {
      method: "DELETE",
    }),

  // ============================================================
  // MASTER / REMINDER LOG
  // ============================================================

  getMaster: (params = "") =>
    request(`/master${params}`),

  getMasterOne: (id) =>
    request(`/master/${id}`),

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
};