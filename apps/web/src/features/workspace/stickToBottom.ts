import { useEffect, useRef, type RefObject } from "react";

/** The parts of a scroll container this module reads and writes. */
export interface ScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * How far above the true bottom still counts as "at the bottom". Absorbs
 * sub-pixel rounding and the one-frame gap between content growing and the
 * scroll position catching up.
 */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

/** Whether the box is scrolled to (or within a hair of) its bottom. */
export function isAtBottom(
  box: ScrollBox,
  threshold: number = STICK_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  return box.scrollHeight - box.clientHeight - box.scrollTop <= threshold;
}

/** Pins the box to its bottom. */
export function scrollToBottom(box: ScrollBox): void {
  box.scrollTop = box.scrollHeight;
}

/**
 * Keeps a scrolling transcript pinned to its newest content.
 *
 * - `resetKey` identifies the conversation: whenever it changes the box jumps
 *   to the bottom unconditionally (opening a thread lands on the latest turn).
 * - `contentKey` changes whenever the rendered content grows; the box follows
 *   only while the user is already at the bottom, so scrolling up to read
 *   history is never yanked back by a streaming run.
 */
export function useStickToBottom<T extends HTMLElement>(
  resetKey: string,
  contentKey: string,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const stuck = useRef(true);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    stuck.current = true;
    scrollToBottom(element);
  }, [resetKey]);

  useEffect(() => {
    const element = ref.current;
    if (element === null || !stuck.current) return;
    scrollToBottom(element);
  }, [contentKey]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const onScroll = () => {
      stuck.current = isAtBottom(element);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
    };
  }, []);

  return ref;
}
