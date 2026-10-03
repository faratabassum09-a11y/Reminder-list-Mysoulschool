import React from "react";

const TONE = { Open: "badge-bad", "In Progress": "badge-neutral", Resolved: "badge-good" };

export function StatusBadge({ status }) {
  return <span className={"badge " + (TONE[status] || "badge-neutral")}>{status}</span>;
}

export function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

// A planned resolution in the past on a ticket that isn't resolved yet.
export function isOverdue(t) {
  return t.status !== "Resolved" && t.plannedResolution && new Date(t.plannedResolution).getTime() < Date.now();
}

export const STATUS_FILTERS = ["Open", "In Progress", "Resolved"];
