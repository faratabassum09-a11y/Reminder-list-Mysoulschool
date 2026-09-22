// In dev, Vite proxies "/api" to the local backend (see vite.config.js).
// In production, set VITE_API_URL to the deployed backend's URL (e.g.
// https://your-app.onrender.com/api) at build time so the deployed
// frontend knows where to send requests — Vercel and Render are separate
// domains, so there's no "/api" on the same origin to fall back to.
const BASE = import.meta.env.VITE_API_URL || "/api";
export { BASE as API_BASE };

let authToken = localStorage.getItem("authToken") || null;
let onUnauthorized = null;

// Called once from AuthContext on login/logout — keeps the in-memory token
// and localStorage (so a page refresh doesn't sign you out) in sync.
export function setAuthToken(token) {
  authToken = token;
  if (token) localStorage.setItem("authToken", token);
  else localStorage.removeItem("authToken");
}

// AuthContext registers a callback here so that ANY request anywhere in
// the app that comes back 401 (expired/invalid session) bounces the user
// to the login screen, not just ones from a specific page.
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, { headers, ...options });
  if (res.status === 401) {
    setAuthToken(null);
    onUnauthorized?.();
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const api = {
  // Auth
  login: (email, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request("/auth/me"),
  updateProfile: (data) => request("/auth/me", { method: "PUT", body: JSON.stringify(data) }),
  changePassword: (currentPassword, newPassword) =>
    request("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),

  // Users (admin only — backend enforces this regardless of who calls it)
  getUsers: () => request("/users"),
  createUser: (data) => request("/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  removeUser: (id) => request(`/users/${id}`, { method: "DELETE" }),

  // Doer List
  getDoers: () => request("/doers"),
  createDoer: (data) => request("/doers", { method: "POST", body: JSON.stringify(data) }),
  updateDoer: (id, data) => request(`/doers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  removeDoer: (id) => request(`/doers/${id}`, { method: "DELETE" }),
  emailDoerTasks: (id, status) =>
    request(`/doers/${id}/email-tasks`, { method: "POST", body: JSON.stringify({ status }) }),

  // Task List
  getTasks: () => request("/tasks"),
  createTask: (data) => request("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id, data) => request(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  removeTask: (id) => request(`/tasks/${id}`, { method: "DELETE" }),

  // Master (reminder log)
  getMaster: (params = "") => request(`/master${params}`),
  createMaster: (data) => request("/master", { method: "POST", body: JSON.stringify(data) }),
  completeMaster: (id, actual) =>
    request(`/master/${id}/complete`, { method: "PATCH", body: JSON.stringify({ actual }) }),
  removeMaster: (id) => request(`/master/${id}`, { method: "DELETE" }),
  generateUpcoming: (force) => request(`/master/generate-upcoming${force ? "?force=1" : ""}`, { method: "POST" }),
  dedupeMaster: () => request("/master/dedupe", { method: "POST" }),

  // Consolidated (computed rollup) — now surfaced on the Dashboard page,
  // with an optional date-range pill (see Dashboard.jsx's RANGES list).
  getConsolidated: (range) => request(`/consolidated${range ? `?range=${range}` : ""}`),
  getSummary: (range) => request(`/consolidated/summary${range ? `?range=${range}` : ""}`),
  getMyPerformance: (range) => request(`/consolidated/me${range ? `?range=${range}` : ""}`),
  archiveDashboard: (label) => request("/consolidated/archive", { method: "POST", body: JSON.stringify({ label }) }),
  getArchives: () => request("/consolidated/archive"),
  removeArchive: (id) => request(`/consolidated/archive/${id}`, { method: "DELETE" }),

  // Submission Log (raw Consolidated sheet, paginated)
  getSubmissions: (params = "") => request(`/submissions${params}`),
  getSubmissionsSummary: () => request("/submissions/summary"),

  // Settings — schedule horizon, skip-Sundays, daily reminder hour/toggle
  getSettings: () => request("/settings"),
  updateSettings: (data) => request("/settings", { method: "PUT", body: JSON.stringify(data) }),
  getHolidays: () => request("/settings/holidays"),
  addHoliday: (data) => request("/settings/holidays", { method: "POST", body: JSON.stringify(data) }),
  removeHoliday: (id) => request(`/settings/holidays/${id}`, { method: "DELETE" }),

  // Reminders — the daily "tasks due tomorrow" email
  sendRemindersNow: () => request("/reminders/send-daily", { method: "POST" }),
  getMailerStatus: () => request("/reminders/mailer-status"),
};
