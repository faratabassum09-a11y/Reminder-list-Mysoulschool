// Which apps a user may open. Admins always get both; legacy accounts with no
// `apps` value keep both so nothing breaks for existing people.
export const ALL_APPS = ["reminder", "workshop", "tickets"];

export function appsOf(user) {
  if (!user) return [];
  if (user.role === "admin") return ALL_APPS;
  if (!Array.isArray(user.apps)) return ALL_APPS;
  return ALL_APPS.filter((a) => user.apps.includes(a));
}

export const hasApp = (user, app) => appsOf(user).includes(app);

// Clean an `apps` value from a request body.
export function cleanApps(input) {
  if (!Array.isArray(input)) return undefined;
  return ALL_APPS.filter((a) => input.includes(a));
}
