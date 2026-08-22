import { useCallback, useEffect, useMemo, useState } from "react";

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

// Declared as function properties rather than methods on purpose: callers
// destructure them (`const { bindPendingContexts } = actions`) to use as
// effect dependencies, which is only sound because none of them reads
// `this`.
export interface PanelActions {
  openTab: (tab: NewPanelTab, options?: { groupId?: GroupId }) => void;
  closeTab: (tabId: TabId) => void;
  activateTab: (tabId: TabId) => void;
  moveTab: (tabId: TabId, groupId: GroupId, index: number) => void;
  splitWithTab: (tabId: TabId, groupId: GroupId, edge: PanelEdge) => void;
  closeGroup: (groupId: GroupId) => void;
  focusGroup: (groupId: GroupId) => void;
  resizeGroups: (splitId: string, sizes: [number, number]) => void;
  setWidth: (width: number) => void;
  setOpen: (open: boolean) => void;
  updateTab: (tabId: TabId, patch: TabPatch) => void;
  /** Binds every tab still carrying a null context (see D-1 below). */
  bindPendingContexts: (context: TabContext) => void;
}

export interface PanelController {
  state: PanelState;
  /**
   * What the last chord could not do, or null. Rendered into the panel's
   * live region and its status line so a refused command is announced
   * rather than silently inert (WSP-10, D8). It clears itself: an
   * announcement is an event, not a state the panel stays in.
   */
  announcement: string | null;
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

/** How long a refused chord's message stays on screen. */
const ANNOUNCEMENT_MS = 5_000;

/**
 * The panel plus whatever the last chord had to say about itself.
 *
 * They are ONE piece of state on purpose. The chord listener is installed
 * once and cannot close over the panel, so it has to update functionally —
 * and a functional update has no way to hand anything back to the caller.
 * Keeping the announcement in the same state means the updater that decides
 * a command was refused is also the one that records it, with no ref
 * standing in for the current state and no chance of reading a stale one.
 */
interface PanelSession {
  panel: PanelState;
  announcement: {
    text: string;
    // Two identical refusals in a row are two events, and a live region only
    // re-announces text it sees change. The counter is what makes the second
    // one a change.
    id: number;
  } | null;
}

export function usePanelState(): PanelController {
  const [session, setSession] = useState<PanelSession>(() => ({
    panel: readPanelState(),
    announcement: null,
  }));
  const [focusRequest, setFocusRequest] = useState(0);
  const state = session.panel;

  useEffect(() => {
    writePanelState(state);
  }, [state]);

  // Every non-chord action is a plain state transform that has nothing to
  // announce, so it leaves the current announcement alone (its own timer
  // clears it).
  const transform = useCallback(
    (change: (current: PanelState) => PanelState) => {
      setSession((current) => {
        const panel = change(current.panel);
        return panel === current.panel ? current : { ...current, panel };
      });
    },
    [],
  );

  const actions = useMemo<PanelActions>(
    () => ({
      openTab: (tab, options) => {
        transform((current) => openTab(current, tab, makeId, options));
      },
      closeTab: (tabId) => {
        transform((current) => closeTab(current, tabId));
      },
      activateTab: (tabId) => {
        transform((current) => activateTab(current, tabId));
      },
      moveTab: (tabId, groupId, index) => {
        transform((current) => moveTab(current, tabId, groupId, index));
      },
      splitWithTab: (tabId, groupId, edge) => {
        transform((current) =>
          splitGroupWithTab(current, tabId, groupId, edge, makeId),
        );
      },
      closeGroup: (groupId) => {
        transform((current) => closeGroup(current, groupId));
      },
      focusGroup: (groupId) => {
        transform((current) => focusGroup(current, groupId));
      },
      resizeGroups: (splitId, sizes) => {
        transform((current) => setGroupSizes(current, splitId, sizes));
      },
      setWidth: (width) => {
        transform((current) => setPanelWidth(current, width));
      },
      setOpen: (open) => {
        transform((current) => setPanelOpen(current, open));
      },
      updateTab: (tabId, patch) => {
        transform((current) => updateTab(current, tabId, patch));
      },
      bindPendingContexts: (context) => {
        transform((current) => bindPendingContexts(current, context));
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
      setSession((current) => {
        const result = applyPanelCommand(current.panel, command, makeId);
        if (result.announcement === null)
          return result.state === current.panel
            ? current
            : { ...current, panel: result.state };
        return {
          panel: result.state,
          announcement: {
            text: result.announcement,
            id: (current.announcement?.id ?? 0) + 1,
          },
        };
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const announcement = session.announcement;
  useEffect(() => {
    if (announcement === null) return;
    const timer = window.setTimeout(() => {
      setSession((current) =>
        current.announcement === announcement
          ? { ...current, announcement: null }
          : current,
      );
    }, ANNOUNCEMENT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [announcement]);

  return {
    state,
    actions,
    focusRequest,
    announcement: announcement?.text ?? null,
  };
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
    if (next.tabs[id]?.context !== null) continue;
    next = bindTabContext(next, id, context);
  }
  return next;
}
