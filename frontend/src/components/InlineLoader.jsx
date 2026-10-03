import React from "react";

// Small "● ● ●  Loading…" for spots that don't deserve a skeleton
// (dropdowns, side lists, thread panes).
export default function InlineLoader({ label = "Loading", block = false }) {
  return (
    <span className={"il" + (block ? " il-block" : "")} role="status">
      <span className="il-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
    </span>
  );
}
