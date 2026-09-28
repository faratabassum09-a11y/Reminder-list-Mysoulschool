import React from "react";
import { QUICK_RANGES, quickRange, formatRange } from "../utils/masterRanges.js";

// The four quick toggles. Rendered as a fragment so it can sit inside
// whichever filter row the page already has.
export function QuickRangePills({ filter }) {
  return (
    <div className="quick-range-pills">
      {QUICK_RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          className={"link-btn generate-btn quick-range-pill" + (filter.quick === r.key ? " filter-pill-active" : "")}
          aria-pressed={filter.quick === r.key}
          onClick={() => filter.toggleQuick(r.key)}
          title={`Show only tasks planned for ${quickRange(r.key).label}`}
        >
          <span className="quick-range-pill-icon" aria-hidden="true">📅</span> {r.label}
        </button>
      ))}
    </div>
  );
}

// From / To calendar row. `noun` is what's being filtered, for the hint.
export function DateRangeRow({ filter, noun = "tasks planned" }) {
  return (
    <div className="filter-row date-range-row">
      <label htmlFor="date-from">From</label>
      <input id="date-from" type="date" value={filter.dateFrom} max={filter.dateTo || undefined}
        onChange={(e) => filter.setDate("from", e.target.value)} />
      <label htmlFor="date-to">To</label>
      <input id="date-to" type="date" value={filter.dateTo} min={filter.dateFrom || undefined}
        onChange={(e) => filter.setDate("to", e.target.value)} />
      {filter.active && (
        <button type="button" className="link-btn date-range-clear-btn" onClick={filter.clear}>✕ Clear dates</button>
      )}
      {filter.error ? (
        <span className="date-range-chip date-range-chip-bad">⚠ {filter.error}</span>
      ) : filter.range ? (
        <span className="date-range-chip">
          <span className="date-range-chip-icon" aria-hidden="true">📅</span>
          Showing {noun} <strong>{formatRange(filter.range)}</strong>
        </span>
      ) : (
        <span className="form-hint" style={{ margin: 0 }}>Pick a From / To date, or use a quick filter above.</span>
      )}
    </div>
  );
}
