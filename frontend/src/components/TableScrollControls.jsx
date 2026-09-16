import React from "react";

// Floating jump-to-top / jump-to-last-row buttons pinned to the corner of a
// scrollable table panel. Also usable via the Home / End keys (see
// useTableHotkeys) — this is the clickable equivalent for large tables.
export default function TableScrollControls({ targetRef }) {
  const scrollTo = (where) => {
    const el = targetRef.current;
    if (!el) return;
    el.scrollTo({ top: where === "top" ? 0 : el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="table-scroll-btns">
      <button type="button" title="Jump to top (Home)" aria-label="Scroll to top" onClick={() => scrollTo("top")}>
        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 19V6M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
      </button>
      <button type="button" title="Jump to last row (End)" aria-label="Scroll to bottom" onClick={() => scrollTo("bottom")}>
        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 5v13M6 13l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
      </button>
    </div>
  );
}
