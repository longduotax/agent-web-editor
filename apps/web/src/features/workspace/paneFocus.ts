/**
 * Escape out of a composer.
 *
 * Workspace chords that would hijack text editing are suppressed while the
 * event target is a text entry (see `isTextEntryTarget`). Split's punctuation
 * chords remain available, but focus movement and close still need a way OUT:
 * Escape used to leave both the value and `document.activeElement` untouched,
 * so Tab was the only exit for those commands.
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
 * Land focus on a pane, given its tile element.
 *
 * The counterpart to `releaseFocusToPane`, for the other direction: a close
 * or direction command moved pane focus and DOM focus has to follow it. Split
 * commands instead use `landFocusOnComposer`, because their new-chat pane is
 * expected to be ready for immediate typing.
 *
 * Scrolling is done as a separate `scrollIntoView`, not by letting `focus()`
 * do it: the surface scrolls horizontally once there are more panes than fit
 * (CWS-07), so a pane the direction keys just reached may be off screen and
 * has to be brought into view — but only by the least it can ("nearest"),
 * never by centring a pane that was already fully visible.
 */
export function landFocusOnPane(tile: Element | null): HTMLElement | null {
  const pane =
    tile instanceof HTMLElement
      ? (tile.querySelector<HTMLElement>(".pane") ?? tile)
      : null;
  if (pane === null) return null;
  pane.focus({ preventScroll: true });
  scrollPaneIntoView(pane);
  return pane;
}

/** Focus the message field in a newly split pane so it is ready for typing. */
export function landFocusOnComposer(
  tile: Element | null,
): HTMLTextAreaElement | null {
  if (!(tile instanceof HTMLElement)) return null;
  const composer = tile.querySelector<HTMLTextAreaElement>("textarea");
  if (composer === null) return null;
  composer.focus({ preventScroll: true });
  scrollPaneIntoView(composer.closest<HTMLElement>(".pane") ?? tile);
  return composer;
}

function scrollPaneIntoView(pane: HTMLElement): void {
  // Guarded because jsdom does not implement it and the surface must not
  // depend on a scroll to be correct.
  if (typeof pane.scrollIntoView === "function")
    pane.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * True for a keydown on a parked pane that means "I want to start typing".
 *
 * Leaving focus on the pane after a split is what keeps the chords alive, but
 * it would be a bad trade if it also cost a Tab to write the message you
 * split the pane in order to write. The pane shell is not in the tab order
 * and the next tab stop is the header's Split button, so "one Tab away" was
 * never true.
 *
 * So a bare printable character, or Enter, hands the pane's composer the
 * focus. The character itself is deliberately NOT consumed: the composer is
 * focused during keydown, before the browser produces text from the event, so
 * it arrives in the textarea on its own — the pane behaves as if you had been
 * typing there all along. Enter is consumed, because letting it through would
 * submit the message you have not written yet.
 *
 * Anything with a modifier is refused: those are chords (this app's, the
 * browser's, or the OS's) and none of them mean "type this".
 */
export function isComposerEntryKey(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  // Length 1 is how a printable character is distinguished from a named key
  // ("Tab", "ArrowLeft", "F3"); it counts UTF-16 units, so an astral-plane
  // character reads as 2 and simply does not trigger this shortcut.
  return event.key.length === 1 || event.key === "Enter";
}

/**
 * True for the keydown that should release the composer: a BARE Escape.
 *
 * Modified Escapes are left alone on purpose. They are not this app's to
 * claim — the OS and the browser bind their own (macOS uses ⌘Esc, and a
 * modified Escape is a plausible future chord) — and "Esc to leave the
 * composer" is what the hint and the Settings row promise, not "any Escape".
 *
 * `isComposing` excludes the Escape that dismisses an IME candidate window,
 * which belongs to the input method and must keep it.
 */
export function isReleaseKey(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  nativeEvent: { isComposing: boolean };
}): boolean {
  return (
    event.key === "Escape" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing
  );
}
