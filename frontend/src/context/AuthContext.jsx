import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setAuthToken, setUnauthorizedHandler } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On first load, if a token is already stored (from a previous visit),
  // confirm it's still valid and fetch who's signed in — otherwise the
  // person would need to log in again every time they refresh the page.
  useEffect(() => {
    const stored = localStorage.getItem("authToken");
    if (!stored) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => {})
      .finally(() => setLoading(false));
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

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
