import type { FocusDirection, SplitAxis } from "./layoutTree.js";

/** What the chat surface's tiling tree can be told to do. */
export type ChatCommand =
  | { type: "split"; axis: SplitAxis }
  | { type: "close" }
  | { type: "focus"; direction: FocusDirection };

/**
 * What the workspace panel can be told to do (WSP-10). The edge is spelled
 * out rather than imported from `features/panel` so this table — the app's
 * one keyboard contract — does not depend on the surfaces it drives.
 */
export type PanelCommand =
  | { type: "panel-tab"; direction: "next" | "previous" }
  | { type: "panel-close-tab" }
  | { type: "panel-move-tab"; direction: "next" | "previous" }
  | { type: "panel-split"; edge: "top" | "bottom" | "left" | "right" }
  | { type: "panel-focus" }
  | { type: "panel-toggle" };

export type WorkspaceCommand = ChatCommand | PanelCommand;

/**
 * Splits a resolved command by the surface that owns it. Both surfaces
 * listen for the same key events — the chat tree and the panel are siblings,
 * neither nested in the other — so each has to recognise its own commands
 * and leave the rest alone.
 */
export function asPanelCommand(
  command: WorkspaceCommand,
): PanelCommand | null {
  switch (command.type) {
    case "panel-tab":
    case "panel-close-tab":
    case "panel-move-tab":
    case "panel-split":
    case "panel-focus":
    case "panel-toggle":
      return command;
    default:
      return null;
  }
}

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
 * Three disjoint modifier groups on the primary modifier (Cmd on mac, Alt
 * elsewhere):
 *  - `shift-primary`: Shift + primary (no Alt on mac / no Meta elsewhere).
 *  - `primary-alt`: primary + Alt (Meta+Alt on mac, Ctrl+Alt elsewhere), no
 *    Shift.
 *  - `shift-primary-alt`: all three, which is the workspace panel's group.
 *
 * Disjointness is the whole point: every group names the modifiers it
 * requires AND the ones it refuses, so no chord can resolve to two commands.
 */
export type ModifierGroup =
  | "shift-primary"
  | "primary-alt"
  | "shift-primary-alt";

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
  // The workspace panel (WSP-10). Every key below is layout-independent on
  // purpose: this group holds Alt, and on macOS Alt composes alternate
  // characters, so `event.key` for a letter or a punctuation mark is not the
  // key the user's keycap shows. Navigation and editing keys report the same
  // `key` under every layout and every modifier.
  {
    label: "Next panel tab",
    group: "shift-primary-alt",
    key: "PageDown",
    keyLabel: "⇟",
    command: { type: "panel-tab", direction: "next" },
  },
  {
    label: "Previous panel tab",
    group: "shift-primary-alt",
    key: "PageUp",
    keyLabel: "⇞",
    command: { type: "panel-tab", direction: "previous" },
  },
  {
    label: "Close panel tab",
    group: "shift-primary-alt",
    key: "Backspace",
    keyLabel: "⌫",
    command: { type: "panel-close-tab" },
  },
  {
    label: "Move panel tab to the next group",
    group: "shift-primary-alt",
    key: "End",
    keyLabel: "End",
    command: { type: "panel-move-tab", direction: "next" },
  },
  {
    label: "Move panel tab to the previous group",
    group: "shift-primary-alt",
    key: "Home",
    keyLabel: "Home",
    command: { type: "panel-move-tab", direction: "previous" },
  },
  {
    label: "Split panel group right",
    group: "shift-primary-alt",
    key: "ArrowRight",
    keyLabel: "→",
    command: { type: "panel-split", edge: "right" },
  },
  {
    label: "Split panel group left",
    group: "shift-primary-alt",
    key: "ArrowLeft",
    keyLabel: "←",
    command: { type: "panel-split", edge: "left" },
  },
  {
    label: "Split panel group down",
    group: "shift-primary-alt",
    key: "ArrowDown",
    keyLabel: "↓",
    command: { type: "panel-split", edge: "bottom" },
  },
  {
    label: "Split panel group up",
    group: "shift-primary-alt",
    key: "ArrowUp",
    keyLabel: "↑",
    command: { type: "panel-split", edge: "top" },
  },
  {
    label: "Focus the workspace panel",
    group: "shift-primary-alt",
    key: "Enter",
    keyLabel: "↵",
    command: { type: "panel-focus" },
  },
  {
    label: "Show or hide the workspace panel",
    group: "shift-primary-alt",
    key: " ",
    keyLabel: "Space",
    command: { type: "panel-toggle" },
  },
];

function matchGroup(e: KeyEventLike, p: Platform): ModifierGroup | null {
  if (
    p.isMac
      ? e.shiftKey && e.metaKey && e.altKey && !e.ctrlKey
      : e.shiftKey && e.ctrlKey && e.altKey && !e.metaKey
  )
    return "shift-primary-alt";
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
  if (group === "shift-primary-alt")
    return p.isMac ? ["⇧", "⌘", "⌥"] : ["Shift", "Ctrl", "Alt"];
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

/**
 * Browser Shift variants of "=" and "-" report as "+" and "_"; the bindings
 * map the un-shifted key alongside a shiftKey flag, so normalize back before
 * resolving a command.
 */
export function normalizeKey(key: string): string {
  if (key === "+") return "=";
  if (key === "_") return "-";
  return key;
}

/**
 * True while the event's target is somewhere the user is typing. Both
 * surfaces' handlers bail out on this rather than hijacking a native
 * text-editing shortcut (e.g. Cmd+Shift+ArrowUp select-to-start).
 *
 * Structural rather than `instanceof HTMLElement` so this module stays
 * usable — and testable — without a DOM realm.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const tagName = "tagName" in target ? target.tagName : undefined;
  const editable =
    "isContentEditable" in target ? target.isContentEditable : undefined;
  return tagName === "INPUT" || tagName === "TEXTAREA" || editable === true;
}
