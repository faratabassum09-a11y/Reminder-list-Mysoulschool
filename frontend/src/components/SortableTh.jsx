import React from "react";

// Clickable table header that reports its sort state — click to sort
// ascending, click again for descending, a third click clears it.
export default function SortableTh({ label, sortKey, sort, onSort, className, ...rest }) {
  const active = sort.key === sortKey;
  return (
    <th className={"th-sortable" + (className ? " " + className : "")} onClick={() => onSort(sortKey)} {...rest}>
      {label}
      <span className={"sort-arrow" + (active ? " active" : "")}>
        {active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );
}
