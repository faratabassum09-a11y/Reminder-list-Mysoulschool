import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A column header that both sorts (click the label, same as SortableTh)
// and filters (click the small ⚲ symbol beside it to open a tiny inline
// search box scoped to just that column). Filtering by a column highlights
// its icon so it's obvious which filters are currently active.
export default function FilterableTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
  filterKey,
  filterValue,
  onFilterChange,
  placeholder,
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const sortable = !!(sort && onSort && sortKey);
  const active = sortable && sort.key === sortKey;
  const hasFilter = !!(filterValue && filterValue.trim());

  // The popover is rendered in a portal with fixed positioning so the
  // table's scroll container / sticky header can't clip it or let it slide
  // underneath neighbouring cells.
  const place = () => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const w = 200;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    setPos({ top: r.bottom + 6, left });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDocClick = (e) => {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <th className={"th-sortable th-filterable" + (className ? " " + className : "")} {...rest}>
      <span className="th-head-row">
        <span
          className={"th-label" + (sortable ? "" : " th-label-static")}
          onClick={sortable ? () => onSort(sortKey) : undefined}
          title={sortable ? `Sort by ${label}` : undefined}
        >
          {label}
          {sortable && (
            <span className={"sort-arrow" + (active ? " active" : "")}>
              {active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
            </span>
          )}
        </span>
        <span className="th-filter-wrap" ref={wrapRef}>
          <button
            type="button"
            ref={btnRef}
            className={"th-filter-btn" + (hasFilter ? " th-filter-btn-active" : "")}
            aria-label={`Filter by ${label}`}
            title={`Filter by ${label}`}
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          >
            ⚲
          </button>
          {open && pos && createPortal(
            <div
              ref={popRef}
              className="th-filter-popover"
              style={{ top: pos.top, left: pos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                type="text"
                value={filterValue || ""}
                placeholder={placeholder || `Filter ${label}…`}
                onChange={(e) => onFilterChange(filterKey, e.target.value)}
              />
              {hasFilter && (
                <button
                  type="button"
                  className="th-filter-clear"
                  aria-label={`Clear ${label} filter`}
                  onClick={() => onFilterChange(filterKey, "")}
                >
                  ×
                </button>
              )}
            </div>,
            document.body
          )}
        </span>
      </span>
    </th>
  );
}
