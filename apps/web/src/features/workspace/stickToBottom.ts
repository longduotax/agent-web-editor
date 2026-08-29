import { useCallback, useEffect, useRef, useState } from "react";

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

export interface StickToBottom<T extends HTMLElement> {
  /**
   * A CALLBACK ref for the scroll container, not an object ref.
   *
   * The scroll listener has to be bound to the node the instant the node
   * exists, and an effect cannot promise that: the pane renders a loading
   * state before its transcript, so a mount-time effect ran once against a
   * null ref and, because its dependencies never changed again, never ran a
   * second time. The listener was then never bound, `stuck` never went false,
   * and every user scroll was overridden by the next frame of streamed
   * content -- the exact defect this hook exists to prevent.
   */
  attach: (node: T | null) => void;
  /**
   * Whether the box is currently following its newest content. False only
   * once the reader has scrolled away from the bottom, which is the one
   * moment a "jump to latest" affordance is worth showing.
   */
  pinned: boolean;
  /** Re-pin and jump to the bottom. Idempotent, and safe before mount. */
  pinToBottom: () => void;
}

/**
 * Keeps a scrolling transcript pinned to its newest content.
 *
 * - `resetKey` identifies the conversation: whenever it changes the box jumps
 *   to the bottom unconditionally (opening a thread lands on the latest turn).
 * - `contentKey` changes whenever the rendered content grows; the box follows
 *   only while the user is already at the bottom, so scrolling up to read
 *   history is never yanked back by a streaming run.
 *
 * The pin is deliberately NOT re-armed by content growth, only by
 * `pinToBottom` or by the reader scrolling back down themselves. That means
 * an unpinned transcript stays unpinned forever unless something re-pins it,
 * which is why sending a message must call `pinToBottom` explicitly: during a
 * fast stream the content grows faster than a reader can scroll, so scrolling
 * back to the bottom by hand is not a route the caller may rely on.
 */
export function useStickToBottom<T extends HTMLElement>(
  resetKey: string,
  contentKey: string,
): StickToBottom<T> {
  const ref = useRef<T | null>(null);
  // Two representations of one fact, on purpose. The ref is what the scroll
  // effects read: it is correct synchronously, inside a scroll handler that
  // may fire many times a frame. The state exists only so that flipping the
  // pin re-renders whatever the caller draws from it, and it is written only
  // on a genuine change so a scroll to a new position inside the same
  // pinned/unpinned regime costs no render.
  const stuck = useRef(true);
  const [pinned, setPinned] = useState(true);
  const setStuck = useCallback((next: boolean) => {
    if (stuck.current === next) return;
    stuck.current = next;
    setPinned(next);
  }, []);

  const pinToBottom = useCallback(() => {
    setStuck(true);
    const element = ref.current;
    if (element !== null) scrollToBottom(element);
  }, [setStuck]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setStuck(true);
    scrollToBottom(element);
  }, [resetKey, setStuck]);

  useEffect(() => {
    const element = ref.current;
    if (element === null || !stuck.current) return;
    scrollToBottom(element);
  }, [contentKey]);

  const release = useRef<(() => void) | null>(null);
  const attach = useCallback(
    (node: T | null) => {
      release.current?.();
      release.current = null;
      ref.current = node;
      if (node === null) return;
      const onScroll = () => {
        setStuck(isAtBottom(node));
      };
      node.addEventListener("scroll", onScroll, { passive: true });
      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(() => {
              if (stuck.current) scrollToBottom(node);
            });
      observer?.observe(node);
      if (node.firstElementChild !== null)
        observer?.observe(node.firstElementChild);
      release.current = () => {
        node.removeEventListener("scroll", onScroll);
        observer?.disconnect();
      };
      // A container that has only just appeared starts on its newest content,
      // which is what opening a thread should land on.
      if (stuck.current) scrollToBottom(node);
    },
    [setStuck],
  );

  return { attach, pinned, pinToBottom };
}
