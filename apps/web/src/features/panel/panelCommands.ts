import { leafIds } from "../layout/binaryTree.js";
import type { PanelCommand } from "../workspace/keybindings.js";
import {
  activateTab,
  closeTab,
  moveTab,
  setPanelOpen,
  splitGroupWithTab,
} from "./panelModel.js";
import type { PanelState } from "./panelModel.js";

// The keyboard half of WSP-10: every panel command is a pure state
// transform, so the chords and the (later) drag gestures drive exactly the
// same operations and cannot drift apart. A command with nothing to act on
// returns the state it was given, by reference — and, where the user could
// reasonably expect something to happen, says why it did not.

/** What a chord did, and anything the user needs told about it. */
export interface PanelCommandResult {
  state: PanelState;
  /**
   * A short message for the panel's live region and its status line, or null
   * when the command did what its name says. Not an error: it is the
   * difference between a chord that worked and a chord that was silently
   * inert.
   */
  announcement: string | null;
}

/**
 * Why a split chord can refuse.
 *
 * The model will not split a group holding a single tab: the tab would leave
 * its group empty and the "new" half would hold exactly what the old one
 * showed. That is the default state of a fresh panel and the state after
 * every migration, so all four split chords were a silent no-op in the most
 * common case there is (D8).
 *
 * It is NOT fixed by opening a copy of the tab in the new group, VS Code
 * style. `openTab` dedupes on `sameTarget`, so two tabs addressing the same
 * thing are unrepresentable by construction — a copy cannot exist, and
 * proposing one again will not make it exist. What the chord owes the user
 * instead is to say why nothing happened, which is this.
 */
export const SPLIT_NEEDS_TWO_TABS =
  "Nothing to split — this group has one tab.";

function unchanged(state: PanelState): PanelCommandResult {
  return { state, announcement: null };
}

function applied(state: PanelState): PanelCommandResult {
  return { state, announcement: null };
}

function activeTabOf(state: PanelState): {
  groupId: string;
  tabId: string;
} | null {
  const groupId = state.focusedGroupId;
  if (groupId === null) return null;
  const tabId = state.groups[groupId]?.activeTabId ?? null;
  return tabId === null ? null : { groupId, tabId };
}

// The neighbour in `order`, wrapping at both ends. Wrapping matters more
// here than on the chat surface: a tab strip is a ring the user cycles
// through, not a map they navigate.
function neighbour<T>(
  order: readonly T[],
  current: T,
  direction: "next" | "previous",
): T | null {
  const index = order.indexOf(current);
  if (index === -1 || order.length === 0) return null;
  const step = direction === "next" ? 1 : -1;
  return order[(index + step + order.length) % order.length] ?? null;
}

export function applyPanelCommand(
  state: PanelState,
  command: PanelCommand,
  makeId: () => string,
): PanelCommandResult {
  switch (command.type) {
    case "panel-toggle":
      return applied(setPanelOpen(state, !state.open));
    case "panel-focus":
      // Where the focus goes is the view's business; all this can do is
      // make sure there is something on screen to focus.
      return applied(setPanelOpen(state, true));
    case "panel-tab": {
      const active = activeTabOf(state);
      if (active === null) return unchanged(state);
      const strip = state.groups[active.groupId]?.tabIds ?? [];
      const target = neighbour(strip, active.tabId, command.direction);
      return target === null
        ? unchanged(state)
        : applied(activateTab(state, target));
    }
    case "panel-close-tab": {
      const active = activeTabOf(state);
      return active === null
        ? unchanged(state)
        : applied(closeTab(state, active.tabId));
    }
    case "panel-move-tab": {
      const active = activeTabOf(state);
      if (active === null) return unchanged(state);
      const groups = leafIds(state.root);
      const target = neighbour(groups, active.groupId, command.direction);
      if (target === null || target === active.groupId) return unchanged(state);
      // Appended at the end of the target strip: an index carried over from
      // another strip would mean nothing to the user.
      const length = state.groups[target]?.tabIds.length ?? 0;
      return applied(moveTab(state, active.tabId, target, length));
    }
    case "panel-split": {
      const active = activeTabOf(state);
      if (active === null) return unchanged(state);
      // Announced rather than silent: see SPLIT_NEEDS_TWO_TABS.
      const strip = state.groups[active.groupId]?.tabIds ?? [];
      if (strip.length < 2)
        return { state, announcement: SPLIT_NEEDS_TWO_TABS };
      return applied(
        splitGroupWithTab(
          state,
          active.tabId,
          active.groupId,
          command.edge,
          makeId,
        ),
      );
    }
  }
}
