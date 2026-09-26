import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setAuthToken, setUnauthorizedHandler } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
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
    const slowTimer = setTimeout(() => setSlow(true), 3500);
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => {})
      .finally(() => {
        clearTimeout(slowTimer);
        setLoading(false);
      });
    return () => clearTimeout(slowTimer);
  }, []);

  // Registered once — any API call anywhere that comes back 401 (expired
  // or invalid session) signs the user out, not just ones on this page.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  const login = async (email, password) => {
    const res = await api.login(email, password);
    setAuthToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    setAuthToken(null);
    setUser(null);
  };

  // Lets Account.jsx reflect a saved name/Slack ID immediately after
  // PUT /auth/me succeeds, without a full page reload or re-fetching /me.
  const updateProfile = (patch) => setUser((u) => (u ? { ...u, ...patch } : u));

  return (
    <AuthContext.Provider value={{ user, loading, slow, login, logout, updateProfile, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
