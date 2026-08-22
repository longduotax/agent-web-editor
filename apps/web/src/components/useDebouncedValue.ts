import { useEffect, useState } from "react";

/** Debounce interval for search-as-you-type inputs, in milliseconds. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Returns `value` only once it has stopped changing for `delayMs`.
 *
 * Used to keep a keystroke from starting a fresh request: the file listing is
 * a full recursive walk that takes hundreds of milliseconds to seconds on a
 * real repository, so one query per character both hammered the server and
 * blanked the panel to its loading state between every letter.
 */
export function useDebouncedValue<T>(
  value: T,
  delayMs: number = SEARCH_DEBOUNCE_MS,
): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}
