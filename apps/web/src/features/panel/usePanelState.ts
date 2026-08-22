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
  /**
   * Says something in the panel's live region, changing nothing else.
   *
   * The drag (WSP-03) is the caller: a pointer gesture is invisible to a
   * screen reader unless the pick-up, each drop target it crosses, and its
   * outcome are narrated (WSP-10). It shares the region the refused split
   * already uses rather than adding a second one, because two live regions
   * on one surface interrupt each other.
   */
  announce: (message: string) => void;
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
   * Bumped when the keyboard asks for the panel to take focus, and after any
   * chord that changed the panel's structure. A counter rather than a flag,
   * so two consecutive requests are two events; the view decides what
   * "focused" means (the active tab of the focused group).
   */
  focusRequest: number;
}

/**
 * The commands that must be followed by a deliberate focus move (F5, WSP-10).
 *
 * Closing, splitting, and moving all destroy or reparent the element the
 * keyboard was on, and the browser's answer to that is `<body>` — verified
 * with a capture-phase `focusin` logger, so it was a real drop and not an
 * artifact. A keyboard user then had to re-issue the focus-panel chord after
 * every structural operation. Switching tabs is deliberately not here: it
 * destroys nothing, and the roving tabindex already carries focus.
 */
const FOCUS_MOVING_COMMANDS: ReadonlySet<string> = new Set([
  "panel-close-tab",
  "panel-split",
  "panel-move-tab",
]);

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
  /**
   * Bumped by whichever chord owes the keyboard a new home. It lives in the
   * same state as the panel because it is decided by the same updater: the
   * chord listener cannot close over the panel, so whether a command changed
   * anything is only knowable inside the functional update (F5).
   */
  focusRequest: number;
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
    focusRequest: 0,
    announcement: null,
  }));
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
      announce: (message) => {
        setSession((current) => ({
          ...current,
          // Two identical messages in a row are two events, and a live
          // region re-announces only text it sees change — a drag crossing
          // back onto a target it just left says the same words again.
          announcement: {
            text: message,
            id: (current.announcement?.id ?? 0) + 1,
          },
        }));
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
      setSession((current) => {
        const result = applyPanelCommand(current.panel, command, makeId);
        const changed = result.state !== current.panel;
        // A structural command that actually did something owes the keyboard
        // a new home; one that was refused or was a no-op does not, because
        // whatever the user was on is still there (F5).
        const focusRequest =
          command.type === "panel-focus" ||
          (changed && FOCUS_MOVING_COMMANDS.has(command.type))
            ? current.focusRequest + 1
            : current.focusRequest;
        if (result.announcement === null)
          return !changed && focusRequest === current.focusRequest
            ? current
            : { ...current, panel: result.state, focusRequest };
        return {
          panel: result.state,
          focusRequest,
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
    focusRequest: session.focusRequest,
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
