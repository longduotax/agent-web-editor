import { useEffect, useMemo, useState } from "react";

import {
  asPanelCommand,
  detectPlatform,
  isTextEntryTarget,
  normalizeKey,
  resolveCommand,
  type KeyEventLike,
} from "../workspace/keybindings.js";
import { applyPanelCommand } from "./panelCommands.js";
import {
  activateTab,
  bindTabContext,
  closeGroup,
  closeTab,
  focusGroup,
  moveTab,
  openTab,
  setGroupSizes,
  setPanelOpen,
  setPanelWidth,
  splitGroupWithTab,
  updateTab,
  type GroupId,
  type PanelEdge,
  type PanelState,
  type TabPatch,
} from "./panelModel.js";
import type { NewPanelTab, TabContext, TabId } from "./panelTabs.js";
import { readPanelState, writePanelState } from "./panelStorage.js";

// The panel's controller: state, device-local persistence, and a command
// API. Mirrors `useWorkspaceLayout` deliberately — the two surfaces tile the
// same way and persist the same way, and a reader who knows one should not
// have to learn a second shape to read the other.

export interface PanelActions {
  openTab(tab: NewPanelTab, options?: { groupId?: GroupId }): void;
  closeTab(tabId: TabId): void;
  activateTab(tabId: TabId): void;
  moveTab(tabId: TabId, groupId: GroupId, index: number): void;
  splitWithTab(tabId: TabId, groupId: GroupId, edge: PanelEdge): void;
  closeGroup(groupId: GroupId): void;
  focusGroup(groupId: GroupId): void;
  resizeGroups(splitId: string, sizes: [number, number]): void;
  setWidth(width: number): void;
  setOpen(open: boolean): void;
  updateTab(tabId: TabId, patch: TabPatch): void;
  /** Binds every tab still carrying a null context (see D-1 below). */
  bindPendingContexts(context: TabContext): void;
}

export interface PanelController {
  state: PanelState;
  /** Stable across renders: tab bodies are memoised on it. */
  actions: PanelActions;
  /**
   * Bumped when the keyboard asks for the panel to take focus. A counter
   * rather than a flag, so two consecutive requests are two events; the view
   * decides what "focused" means (the active tab of the focused group).
   */
  focusRequest: number;
}

function makeId(): string {
  return crypto.randomUUID();
}

export function usePanelState(): PanelController {
  const [state, setState] = useState<PanelState>(() => readPanelState());
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    writePanelState(state);
  }, [state]);

  const actions = useMemo<PanelActions>(
    () => ({
      openTab(tab, options) {
        setState((current) => openTab(current, tab, makeId, options));
      },
      closeTab(tabId) {
        setState((current) => closeTab(current, tabId));
      },
      activateTab(tabId) {
        setState((current) => activateTab(current, tabId));
      },
      moveTab(tabId, groupId, index) {
        setState((current) => moveTab(current, tabId, groupId, index));
      },
      splitWithTab(tabId, groupId, edge) {
        setState((current) =>
          splitGroupWithTab(current, tabId, groupId, edge, makeId),
        );
      },
      closeGroup(groupId) {
        setState((current) => closeGroup(current, groupId));
      },
      focusGroup(groupId) {
        setState((current) => focusGroup(current, groupId));
      },
      resizeGroups(splitId, sizes) {
        setState((current) => setGroupSizes(current, splitId, sizes));
      },
      setWidth(width) {
        setState((current) => setPanelWidth(current, width));
      },
      setOpen(open) {
        setState((current) => setPanelOpen(current, open));
      },
      updateTab(tabId, patch) {
        setState((current) => updateTab(current, tabId, patch));
      },
      bindPendingContexts(context) {
        setState((current) => bindPendingContexts(current, context));
      },
    }),
    [],
  );

  // The chords live in the app's one bindings table, which both surfaces
  // read; each acts on its own commands and leaves the other's alone. The
  // listener is on the window because the panel must answer a chord that
  // opens it while it is closed — and therefore inert and unfocusable.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      const keyEventLike: KeyEventLike = {
        key: normalizeKey(event.key),
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      };
      const resolved = resolveCommand(keyEventLike, detectPlatform(navigator));
      if (resolved === null) return;
      const command = asPanelCommand(resolved);
      if (command === null) return;
      event.preventDefault();
      if (command.type === "panel-focus")
        setFocusRequest((current) => current + 1);
      setState((current) => applyPanelCommand(current, command, makeId));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return { state, actions, focusRequest };
}

/**
 * D-1. A tab restored by the v1 inspector migration has no context: the
 * shipped inspector followed the focused pane, so it never recorded which
 * thread its content belonged to. Rather than invent one or drop the user's
 * tab, such a tab binds to the focused pane's thread the first time one is
 * available and is fixed from then on, like every other tab (WSP-02).
 *
 * `bindTabContext` rather than `updateTab`: binding can turn the tab into a
 * duplicate of one the user already opened, and the model is where that
 * collision is resolved. Each tab is re-read from the accumulated state
 * because binding one can close another.
 */
function bindPendingContexts(
  state: PanelState,
  context: TabContext,
): PanelState {
  let next = state;
  for (const id of Object.keys(state.tabs)) {
    const tab = next.tabs[id];
    if (tab === undefined || tab.context !== null) continue;
    next = bindTabContext(next, id, context);
  }
  return next;
}
