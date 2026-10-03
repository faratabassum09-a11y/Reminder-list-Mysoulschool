import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setAuthToken, setUnauthorizedHandler } from "../api.js";

const AuthContext = createContext(null);

// The last known user is kept in localStorage so a returning visitor sees
// the app immediately (from the token + this cached profile) instead of a
// blank "Loading…" screen while /auth/me round-trips — which on a free-tier
// server that has gone to sleep can take most of a minute. The token is
// still verified in the background; if it's rejected the 401 handler signs
// them out as before.
function readCachedUser() {
  try {
    if (!localStorage.getItem("authToken")) return null;
    return JSON.parse(localStorage.getItem("authUser") || "null");
  } catch {
    return null;
  }
}

// Which apps this account can open. Older cached sessions have no `apps`
// value, so they keep both until /auth/me refreshes them.
function userApps(user) {
  if (!user) return [];
  if (user.role === "admin" || !Array.isArray(user.apps)) return ["reminder", "workshop", "tickets"];
  return user.apps;
}

export function AuthProvider({ children }) {
  const cachedUser = readCachedUser();
  const [user, setUser] = useState(cachedUser);
  const [loading, setLoading] = useState(!cachedUser);
  // True once the very first /auth/me is taking noticeably longer than a
  // warm request should — almost always a free-tier backend (Render, etc.)
  // spinning back up after going idle, which can take 30-50s. There's
  // nothing the frontend can do to make that faster, but telling the
  // person what's happening turns "is this broken?" into "oh, it's just
  // waking up" — see the slow-start note in Login.jsx for the real fix
  // (a keep-alive ping) if this happens often.
  const [slow, setSlow] = useState(false);

  // On first load, if a token is already stored (from a previous visit),
  // confirm it's still valid and fetch who's signed in — otherwise the
  // person would need to log in again every time they refresh the page.
  useEffect(() => {
    const stored = localStorage.getItem("authToken");
    if (!stored) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let retryTimer;
    const slowTimer = setTimeout(() => setSlow(true), 3500);
    const finish = () => {
      clearTimeout(slowTimer);
      setLoading(false);
    };
    const attempt = () => {
      api
        .me()
        .then((res) => {
          if (cancelled) return;
          setUser(res.user);
          localStorage.setItem("authUser", JSON.stringify(res.user));
          finish();
        })
        .catch((err) => {
          if (cancelled) return;
          // No connection (or the server isn't answering) is NOT the same as
          // "not signed in" — keep the loading/offline screen up and keep
          // trying, instead of dumping the person on the Login page.
          if (err?.network && !cachedUser) {
            retryTimer = setTimeout(attempt, 4000);
            return;
          }
          finish();
        });
    };
    attempt();
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      clearTimeout(retryTimer);
    };
  }, []);

  // Registered once — any API call anywhere that comes back 401 (expired
  // or invalid session) signs the user out, not just ones on this page.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      localStorage.removeItem("authUser");
      setUser(null);
    });
  }, []);

  const login = async (email, password) => {
    const res = await api.login(email, password);
    setAuthToken(res.token);
    sessionStorage.removeItem("hubChosen"); // fresh sign-in -> show the app chooser
    localStorage.setItem("authUser", JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    sessionStorage.removeItem("hubChosen");
    setAuthToken(null);
    localStorage.removeItem("authUser");
    setUser(null);
  };

  // Lets Account.jsx reflect a saved name/Slack ID immediately after
  // PUT /auth/me succeeds, without a full page reload or re-fetching /me.
  const updateProfile = (patch) =>
    setUser((u) => {
      if (!u) return u;
      const next = { ...u, ...patch };
      localStorage.setItem("authUser", JSON.stringify(next));
      return next;
    });

  return (
    <AuthContext.Provider value={{ user, loading, slow, login, logout, updateProfile, isAdmin: user?.role === "admin", hasReminder: userApps(user).includes("reminder"), hasWorkshop: userApps(user).includes("workshop"), hasTickets: userApps(user).includes("tickets"), canRequestWorkshops: user?.role === "admin" || user?.canRequestWorkshops === true }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
