/**
 * Escape out of a composer.
 *
 * Every workspace chord is suppressed while the event target is a text entry
 * (see `isTextEntryTarget`), which is correct — nothing should hijack
 * select-to-start while you are typing. But the composer had no way OUT:
 * Escape left both the value and `document.activeElement` untouched, so Tab
 * was the only exit and every pane shortcut the Settings page advertises was
 * unreachable the moment you started typing.
 *
 * Focus goes to the pane shell rather than to `document.body`, for two
 * reasons: `body` is not a landmark, so a screen reader user is dropped
 * nowhere; and the pane section carries the thread's accessible name, so
 * landing on it says which pane the following shortcuts will act on.
 *
 * The draft is deliberately untouched. Escape releases focus; it does not
 * discard work. Draft persistence is one of the few things about this surface
 * that already works well and clearing on Escape would silently destroy a
 * message that survives a full page reload.
 */
export function releaseFocusToPane(from: HTMLElement): HTMLElement | null {
  const pane = from.closest<HTMLElement>(".pane");
  if (pane === null) {
    // No pane shell (a composer rendered standalone, e.g. in a test): still
    // honour the intent and give focus up.
    from.blur();
    return null;
  }
  // `preventScroll` because the tiling surface scrolls horizontally once more
  // panes are open than fit (CWS-07), and moving focus must not yank the
  // surface sideways under the user.
  pane.focus({ preventScroll: true });
  return pane;
}

/**
 * True for the keydown that should release the composer: a bare Escape, and
 * not the Escape that cancels an IME candidate window (which the input method
 * owns and must keep).
 */
export function isReleaseKey(event: {
  key: string;
  nativeEvent: { isComposing: boolean };
}): boolean {
  return event.key === "Escape" && !event.nativeEvent.isComposing;
}
