import React from "react";
import { QuickRangePills, DateRangeRow } from "./DateFilter.jsx";

export const DATE_BY = [
  { key: "createdAt", label: "Date raised", noun: "tickets raised" },
  { key: "plannedResolution", label: "Planned resolution", noun: "tickets due" },
];

// Adds the calendar filter params (same From/To + quick pills as Master) to
// a URLSearchParams.
export function addTicketDateParams(params, filter, dateBy) {
  if (filter.range?.from) params.set("dateFrom", filter.range.from.toISOString());
  if (filter.range?.to) params.set("dateTo", filter.range.to.toISOString());
  if (filter.range) params.set("dateField", dateBy);
}

// A stable string for effect dependencies (the range holds Date objects).
export const dateKey = (filter, dateBy) =>
  filter.range ? `${filter.range.from?.getTime() || ""}|${filter.range.to?.getTime() || ""}|${dateBy}` : "";

// Quick pills + "filter by" switch + From/To calendar row.
export default function TicketDateFilter({ filter, dateBy, setDateBy }) {
  const current = DATE_BY.find((d) => d.key === dateBy) || DATE_BY[0];
  return (
    <div className="ticket-date-filter">
      <div className="filter-row">
        <QuickRangePills filter={filter} />
        <label htmlFor="ticket-date-by">Filter by</label>
        <select id="ticket-date-by" value={dateBy} onChange={(e) => setDateBy(e.target.value)}>
          {DATE_BY.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </div>
      <DateRangeRow filter={filter} noun={current.noun} />
    </div>
  );
}
