import { useEffect, useRef, type RefObject } from "react";

/**
 * Tallest a composer may grow before it scrolls internally, as a fraction of
 * the viewport height. Both composers (thread and new-chat) share it so they
 * behave identically.
 */
export const COMPOSER_MAX_HEIGHT_VH = 40;

/**
 * Grows a textarea with its content, from a one-line idle height up to
 * `COMPOSER_MAX_HEIGHT_VH`, then scrolls internally. Shrinks back when the
 * draft is cleared.
 */
export function useAutoGrow<T extends HTMLTextAreaElement>(
  value: string,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    // Collapse first so scrollHeight reports the content's natural height
    // rather than the height set on the previous keystroke.
    element.style.height = "auto";
    const cap = Math.round((window.innerHeight * COMPOSER_MAX_HEIGHT_VH) / 100);
    const natural = element.scrollHeight;
    element.style.height = `${String(Math.min(natural, cap))}px`;
    element.style.overflowY = natural > cap ? "auto" : "hidden";
  }, [value]);
  return ref;
}
