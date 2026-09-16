// In dev, Vite proxies "/api" to the local backend (see vite.config.js).
// In production, set VITE_API_URL to the deployed backend's URL (e.g.
// https://your-app.onrender.com/api) at build time so the deployed
// frontend knows where to send requests — Vercel and Render are separate
// domains, so there's no "/api" on the same origin to fall back to.
const BASE = import.meta.env.VITE_API_URL || "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const api = {
  // Doer List
  getDoers: () => request("/doers"),
  createDoer: (data) => request("/doers", { method: "POST", body: JSON.stringify(data) }),
  updateDoer: (id, data) => request(`/doers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  removeDoer: (id) => request(`/doers/${id}`, { method: "DELETE" }),

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

  // Consolidated (computed rollup)
  getConsolidated: () => request("/consolidated"),
  getSummary: () => request("/consolidated/summary"),

  // Submission Log (raw Consolidated sheet, paginated)
  getSubmissions: (params = "") => request(`/submissions${params}`),
  getSubmissionsSummary: () => request("/submissions/summary"),
};
