import type { FocusDirection, SplitAxis } from "./layoutTree.js";

export type WorkspaceCommand =
  | { type: "split"; axis: SplitAxis }
  | { type: "close" }
  | { type: "focus"; direction: FocusDirection };

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface Platform {
  isMac: boolean;
}

/**
 * Two disjoint modifier groups on the primary modifier (Cmd on mac, Alt
 * elsewhere):
 *  - `shift-primary`: Shift + primary (no Alt on mac / no Meta elsewhere).
 *  - `primary-alt`: primary + Alt (Meta+Alt on mac, Ctrl+Alt elsewhere), no
 *    Shift.
 */
export type ModifierGroup = "shift-primary" | "primary-alt";

export interface KeyBinding {
  /** What the user is trying to do, in the words the help list shows. */
  label: string;
  group: ModifierGroup;
  /** KeyboardEvent.key this binding matches. */
  key: string;
  /** How that key prints in a shortcut list. */
  keyLabel: string;
  command: WorkspaceCommand;
}

/**
 * THE source of truth for workspace chords. `resolveCommand` dispatches from
 * this table and the Settings page's shortcut list renders from it, so the
 * two cannot drift — and an inert binding cannot be advertised, because
 * advertising it and handling it are the same entry.
 *
 * `⌘⌥↵` ("bind") used to live here: it set `layoutTree`'s `boundPaneId`,
 * which nothing has ever read, so pressing it did nothing observable. It is
 * removed rather than listed.
 */
export const WORKSPACE_KEYBINDINGS: readonly KeyBinding[] = [
  {
    label: "Split pane right",
    group: "shift-primary",
    key: "=",
    keyLabel: "=",
    command: { type: "split", axis: "row" },
  },
  {
    label: "Split pane down",
    group: "shift-primary",
    key: "-",
    keyLabel: "-",
    command: { type: "split", axis: "column" },
  },
  {
    label: "Close focused pane",
    group: "shift-primary",
    key: "Backspace",
    keyLabel: "⌫",
    command: { type: "close" },
  },
  {
    label: "Focus pane to the left",
    group: "primary-alt",
    key: "ArrowLeft",
    keyLabel: "←",
    command: { type: "focus", direction: "left" },
  },
  {
    label: "Focus pane to the right",
    group: "primary-alt",
    key: "ArrowRight",
    keyLabel: "→",
    command: { type: "focus", direction: "right" },
  },
  {
    label: "Focus pane above",
    group: "primary-alt",
    key: "ArrowUp",
    keyLabel: "↑",
    command: { type: "focus", direction: "up" },
  },
  {
    label: "Focus pane below",
    group: "primary-alt",
    key: "ArrowDown",
    keyLabel: "↓",
    command: { type: "focus", direction: "down" },
  },
];

function matchGroup(e: KeyEventLike, p: Platform): ModifierGroup | null {
  if (
    p.isMac
      ? e.shiftKey && e.metaKey && !e.altKey && !e.ctrlKey
      : e.shiftKey && e.altKey && !e.metaKey && !e.ctrlKey
  )
    return "shift-primary";
  if (
    p.isMac
      ? e.metaKey && e.altKey && !e.shiftKey && !e.ctrlKey
      : e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey
  )
    return "primary-alt";
  return null;
}

/** Resolves a keyboard event to a workspace command. */
export function resolveCommand(
  e: KeyEventLike,
  p: Platform,
): WorkspaceCommand | null {
  const group = matchGroup(e, p);
  if (group === null) return null;
  return (
    WORKSPACE_KEYBINDINGS.find(
      (binding) => binding.group === group && binding.key === e.key,
    )?.command ?? null
  );
}

/**
 * The modifier keys a group requires, spelled the way that platform spells
 * them, in the order they are conventionally written.
 */
export function modifierKeyLabels(
  group: ModifierGroup,
  p: Platform,
): readonly string[] {
  if (group === "shift-primary") return p.isMac ? ["⇧", "⌘"] : ["Shift", "Alt"];
  return p.isMac ? ["⌘", "⌥"] : ["Ctrl", "Alt"];
}

/** Every key of a binding's chord, ready to render as individual `<kbd>`s. */
export function shortcutKeys(
  binding: KeyBinding,
  p: Platform,
): readonly string[] {
  return [...modifierKeyLabels(binding.group, p), binding.keyLabel];
}

export function detectPlatform(nav?: { platform?: string }): Platform {
  return { isMac: /mac/i.test(nav?.platform ?? "") };
}
