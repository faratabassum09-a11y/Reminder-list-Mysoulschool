import { useEffect } from "react";

const editableTags = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// Home/End jump the given scrollable table container to its top/bottom —
// "go to last row" for long tables. Ignored while the user is typing in a
// field (so Home/End still work normally inside inputs).
export function useTableHotkeys(ref) {
  useEffect(() => {
    const handler = (e) => {
      if (editableTags.has(document.activeElement?.tagName)) return;
      const el = ref.current;
      if (!el) return;
      if (e.key === "Home") {
        e.preventDefault();
        el.scrollTo({ top: 0, behavior: "smooth" });
      } else if (e.key === "End") {
        e.preventDefault();
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ref]);
}
