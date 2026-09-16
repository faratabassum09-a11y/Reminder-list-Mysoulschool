// Generic client-side sort for small/medium result sets (Doer List, Task
// List, Consolidated) — dotted keys like "defaultAssignee.name" reach into
// nested fields. Numbers sort numerically, everything else alphabetically.
export function sortRows(rows, sort) {
  if (!rows || !sort?.key) return rows;
  const { key, dir } = sort;
  const get = (obj) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
  });
}

// Click cycles: unsorted -> ascending -> descending -> unsorted.
export function toggleSort(prev, key) {
  if (prev.key !== key) return { key, dir: 1 };
  if (prev.dir === 1) return { key, dir: -1 };
  return { key: null, dir: 1 };
}
