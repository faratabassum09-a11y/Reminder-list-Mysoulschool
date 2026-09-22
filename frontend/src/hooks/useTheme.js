import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "theme"; // "light" | "dark"

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

// Reads the stored theme preference once (defaulting to light), applies it
// to <html data-theme="..."> immediately, and exposes a setter that keeps
// state, localStorage, and the DOM attribute all in sync. Used by Account
// (the toggle control) and by App on first load.
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
