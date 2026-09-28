import { useMemo, useState } from "react";
import { quickRange, customRange } from "../utils/masterRanges.js";

// Shared state for the date filters used on Master and Task List: ONE quick
// pill (Today / Tomorrow / Last Week / Next Week) or a custom From–To range.
// Picking one clears the other so there's never a confusing combination.
export function useDateFilter(onChange) {
  const [quick, setQuick] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { range, error } = useMemo(() => {
    if (quick) return { range: quickRange(quick), error: "" };
    if (dateFrom || dateTo) {
      const r = customRange(dateFrom, dateTo);
      if (r.from && r.to && r.from >= r.to) return { range: null, error: "The From date is after the To date." };
      return { range: r, error: "" };
    }
    return { range: null, error: "" };
  }, [quick, dateFrom, dateTo]);

  return {
    quick,
    dateFrom,
    dateTo,
    range,
    error,
    active: !!(quick || dateFrom || dateTo),
    // click again to clear
    toggleQuick: (key) => {
      setQuick((cur) => (cur === key ? "" : key));
      setDateFrom("");
      setDateTo("");
      onChange?.();
    },
    setDate: (which, value) => {
      setQuick("");
      if (which === "from") setDateFrom(value);
      else setDateTo(value);
      onChange?.();
    },
    clear: () => {
      setQuick("");
      setDateFrom("");
      setDateTo("");
      onChange?.();
    },
  };
}
