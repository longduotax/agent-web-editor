import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

import {
  assignThread,
  bindPane,
  closePane,
  focusPane,
  moveFocus,
  setSplitSizes,
  splitPane,
} from "./layoutTree.js";
import type {
  PaneId,
  PaneRect,
  SplitId,
  WorkspaceLayout,
} from "./layoutTree.js";
import { pruneNewChatDrafts } from "./drafts.js";
import { readLayout, writeLayout } from "./layoutStorage.js";
import type { WorkspaceCommand } from "./keybindings.js";

export interface PaneFocusIntent {
  sequence: number;
  target: "pane" | "composer";
}

export interface WorkspaceLayoutController {
  layout: WorkspaceLayout;
  dispatch(command: WorkspaceCommand): void;
  // Where each pane is on screen. The direction keys are a spatial question
  // and the rendered rects are the only honest answer to it, so the surface
  // reports each pane's tile element here as it mounts and drops it on
  // unmount. `moveFocus` falls back to the tree's own geometry when the
  // registry is incomplete, so this is an improvement to accuracy, not a
  // prerequisite for the feature working.
  // A property rather than a method signature on purpose: the surface
  // destructures it to use as an effect dependency, and a method signature
  // would make that an unbound-method lint error at every call site.
  registerPaneElement: (paneId: PaneId, element: Element | null) => void;
  // Updated whenever a command moves pane focus. Splitting targets the new
  // pane's composer so it is immediately ready for input; close and direction
  // commands target the pane shell so workspace shortcuts remain available.
  // The sequence distinguishes repeated commands that land on the same pane.
  // Sequence 0 means nothing has been commanded yet, allowing cold-load
  // autofocus to behave normally.
  paneFocusIntent: PaneFocusIntent;
  assignThreadToPane(paneId: PaneId, threadId: ThreadId): void;
  newPane(): void;
  focus(paneId: PaneId): void;
  bind(paneId: PaneId): void;
  resize(splitId: SplitId, sizes: [number, number]): void;
  // Returns the layout the close produced, so a caller that has to react to
  // the outcome (e.g. moving the route off a pane that no longer exists) reads
  // it from the same computation that was applied, rather than re-deriving it
  // and hoping the two agree.
  close(paneId: PaneId): WorkspaceLayout;
  // Thin setLayout wrapper: overwrites the layout wholesale, e.g. to restore
  // a snapshot captured before a since-cancelled close (see WorkspaceView's
  // undo-toast flow). Bypasses closePane/etc — callers are responsible for
  // passing a valid WorkspaceLayout.
  replaceLayout(layout: WorkspaceLayout): void;
}

// Module-level (stable across renders) so every pane id is globally unique
// without being recreated per render/hook instance.
function makePaneId(): PaneId {
  return `pane-${crypto.randomUUID()}`;
}

function applyCommand(
  layout: WorkspaceLayout,
  command: WorkspaceCommand,
  measured: Readonly<Record<PaneId, PaneRect>>,
): WorkspaceLayout {
  switch (command.type) {
    case "split": {
      const { focusedPaneId } = layout;
      if (focusedPaneId === null) return layout;
      return splitPane(layout, focusedPaneId, command.axis, makePaneId);
    }
    case "close": {
      const { focusedPaneId } = layout;
      if (focusedPaneId === null) return layout;
      return closePane(layout, focusedPaneId);
    }
    case "focus":
      return moveFocus(layout, command.direction, measured);
    default:
      return layout;
  }
}

// Reads every registered tile's box at the moment the command is dispatched.
// Measured then rather than tracked continuously: a resize observer would
// re-render the whole surface on every drag frame to keep a value only these
// four keys ever read.
function measurePanes(
  elements: ReadonlyMap<PaneId, Element>,
): Record<PaneId, PaneRect> {
  const measured: Record<PaneId, PaneRect> = {};
  for (const [paneId, element] of elements) {
    const box = element.getBoundingClientRect();
    measured[paneId] = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  }
  return measured;
}

export function useWorkspaceLayout(
  projectId: ProjectId,
): WorkspaceLayoutController {
  // Reset to the target project's persisted layout whenever `projectId`
  // changes, without ever rendering the previous project's layout under the
  // new id. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [renderedProjectId, setRenderedProjectId] = useState(projectId);
  const [layout, setLayout] = useState<WorkspaceLayout>(() =>
    readLayout(projectId, makePaneId),
  );
  if (projectId !== renderedProjectId) {
    setRenderedProjectId(projectId);
    setLayout(readLayout(projectId, makePaneId));
  }
  // Always the layout of the render in progress, so `close` computes against
  // what the user is actually looking at.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    writeLayout(projectId, layout);
    // Panes are the only owners of new-chat draft keys, so the set of live
    // pane ids is also the set of keys that may legitimately exist.
    pruneNewChatDrafts(projectId, Object.keys(layout.panes));
  }, [projectId, layout]);

  const paneElements = useRef(new Map<PaneId, Element>());
  const [paneFocusIntent, setPaneFocusIntent] = useState<PaneFocusIntent>({
    sequence: 0,
    target: "pane",
  });

  const registerPaneElement = useCallback(
    (paneId: PaneId, element: Element | null) => {
      if (element === null) paneElements.current.delete(paneId);
      else paneElements.current.set(paneId, element);
    },
    [],
  );

  // Computed against `layoutRef` rather than inside a functional updater, for
  // the same reason `close` is: the OUTCOME decides something outside the
  // layout (whether DOM focus moves), and an updater's return value is not
  // reachable from here. `layoutRef` is assigned during render, so this is
  // the layout that is on screen when the key is pressed.
  const dispatch = useCallback((command: WorkspaceCommand) => {
    const current = layoutRef.current;
    const next = applyCommand(
      current,
      command,
      measurePanes(paneElements.current),
    );
    if (next === current) return;
    layoutRef.current = next;
    setLayout(next);
    // Only when the command actually landed somewhere else. A direction key
    // at the edge of the layout is a no-op now, and a no-op must not yank DOM
    // focus off whatever the user was on.
    if (next.focusedPaneId !== current.focusedPaneId)
      setPaneFocusIntent((intent) => ({
        sequence: intent.sequence + 1,
        target: command.type === "split" ? "composer" : "pane",
      }));
  }, []);

  const assignThreadToPane = useCallback(
    (paneId: PaneId, threadId: ThreadId) => {
      setLayout((current) => assignThread(current, paneId, threadId));
    },
    [],
  );

  const newPane = useCallback(() => {
    setLayout((current) => {
      if (current.root === null) {
        const id = makePaneId();
        return {
          ...current,
          root: { type: "pane", id },
          panes: { ...current.panes, [id]: { threadId: null } },
          focusedPaneId: id,
        };
      }
      if (current.focusedPaneId === null) return current;
      return splitPane(current, current.focusedPaneId, "row", makePaneId);
    });
  }, []);

  const focus = useCallback((paneId: PaneId) => {
    setLayout((current) => focusPane(current, paneId));
  }, []);

  const bind = useCallback((paneId: PaneId) => {
    setLayout((current) => bindPane(current, paneId));
  }, []);

  const resize = useCallback((splitId: SplitId, sizes: [number, number]) => {
    setLayout((current) => setSplitSizes(current, splitId, sizes));
  }, []);

  // The one place a close is computed. It reads the current layout from a ref
  // rather than from a functional updater because the result has to be
  // returned to the caller, and an updater's return value is not reachable
  // synchronously. `layoutRef` is assigned during render, so it is the layout
  // that is on screen when the click handler runs.
  const close = useCallback(
    (paneId: PaneId): WorkspaceLayout => {
      const next = closePane(layoutRef.current, paneId);
      setLayout(next);
      // Persisted HERE, synchronously, as well as by the effect above.
      // Closing a pane is the one layout change that can be followed by a
      // navigation in the same handler (the route has to stop naming a pane
      // that no longer exists -- see WorkspaceView), and that navigation
      // unmounts this hook before its effects flush. Measured: the emptied
      // layout was never written, the remounted view re-read the pane that
      // had just been closed, and closing the last pane put it straight back
      // on screen.
      writeLayout(projectId, next);
      return next;
    },
    [projectId],
  );

  const replaceLayout = useCallback((next: WorkspaceLayout) => {
    setLayout(next);
  }, []);

  return {
    layout,
    dispatch,
    registerPaneElement,
    paneFocusIntent,
    assignThreadToPane,
    newPane,
    focus,
    bind,
    resize,
    close,
    replaceLayout,
  };
}
