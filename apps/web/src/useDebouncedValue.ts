import { useEffect, useState } from "react";

/**
 * 47c fix #6 — Min Score request storm. A native `<input type=range>` fires an `input` event per
 * pixel of drag (mouse or touch), far more granular than one keyboard step; without coalescing, a
 * single drag fired 3-4 uncoalesced /options + /availability + /seatmap requests per integer step
 * and tripped a real 429 in production. Returns a copy of `value` that only updates once `value` has
 * been stable for `delayMs` — every fetch-triggering effect downstream keys off the debounced value
 * instead of the raw, so a rapid burst of drag/click input coalesces into exactly one request once
 * the user pauses. The raw value is left untouched for immediately-responsive UI (slider position,
 * stepper count) — only the network-triggering value is delayed.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
