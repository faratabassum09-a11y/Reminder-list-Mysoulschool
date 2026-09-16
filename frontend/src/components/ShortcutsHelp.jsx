import React, { useEffect, useRef, useState } from "react";

const shortcuts = [
  { keys: "/", desc: "Jump into the search box (on pages that have one)" },
  { keys: "Home", desc: "Scroll the table straight to the top" },
  { keys: "End", desc: "Scroll the table straight to the last row" },
  { keys: "Click a column header", desc: "Sort by that column — click again to reverse, a third click clears it" },
  { keys: "Click the toggle", desc: "Flip a row between Active / Inactive instantly" },
  { keys: "Delete, then Confirm?", desc: "Delete needs a second click within 3s — hard to hit by accident" },
  { keys: "First / Last", desc: "On big paginated tables, jump straight to the first or last page" },
];

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className="shortcuts-wrap" ref={ref}>
      {open && (
        <div className="shortcuts-panel">
          <div className="shortcuts-title">Handy shortcuts</div>
          <ul>
            {shortcuts.map((s) => (
              <li key={s.keys}>
                <kbd>{s.keys}</kbd>
                <span>{s.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="shortcuts-btn"
        aria-label="Keyboard shortcuts and tips"
        title="Keyboard shortcuts and tips"
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
    </div>
  );
}
