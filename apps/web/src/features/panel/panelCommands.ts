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
// returns the state it was given, by reference.

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
): PanelState {
  switch (command.type) {
    case "panel-toggle":
      return setPanelOpen(state, !state.open);
    case "panel-focus":
      // Where the focus goes is the view's business; all this can do is
      // make sure there is something on screen to focus.
      return setPanelOpen(state, true);
    case "panel-tab": {
      const active = activeTabOf(state);
      if (active === null) return state;
      const strip = state.groups[active.groupId]?.tabIds ?? [];
      const target = neighbour(strip, active.tabId, command.direction);
      return target === null ? state : activateTab(state, target);
    }
    case "panel-close-tab": {
      const active = activeTabOf(state);
      return active === null ? state : closeTab(state, active.tabId);
    }
    case "panel-move-tab": {
      const active = activeTabOf(state);
      if (active === null) return state;
      const groups = leafIds(state.root);
      const target = neighbour(groups, active.groupId, command.direction);
      if (target === null || target === active.groupId) return state;
      // Appended at the end of the target strip: an index carried over from
      // another strip would mean nothing to the user.
      const length = state.groups[target]?.tabIds.length ?? 0;
      return moveTab(state, active.tabId, target, length);
    }
    case "panel-split": {
      const active = activeTabOf(state);
      if (active === null) return state;
      return splitGroupWithTab(
        state,
        active.tabId,
        active.groupId,
        command.edge,
        makeId,
      );
    }
  }
}
