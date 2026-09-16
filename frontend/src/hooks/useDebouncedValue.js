import { useEffect, useState } from "react";

// Returns `value`, but only updates after it's stoped changing for `delay`ms.
// Used so search inputs don't fire a request on every keystroke.
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
