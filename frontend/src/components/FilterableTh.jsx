import React, { useEffect, useRef, useState } from "react";

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
  const sortable = !!(sort && onSort && sortKey);
  const active = sortable && sort.key === sortKey;
  const hasFilter = !!(filterValue && filterValue.trim());

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
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
            className={"th-filter-btn" + (hasFilter ? " th-filter-btn-active" : "")}
            aria-label={`Filter by ${label}`}
            title={`Filter by ${label}`}
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          >
            ⚲
          </button>
          {open && (
            <div className="th-filter-popover" onClick={(e) => e.stopPropagation()}>
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
            </div>
          )}
        </span>
      </span>
    </th>
  );
}
