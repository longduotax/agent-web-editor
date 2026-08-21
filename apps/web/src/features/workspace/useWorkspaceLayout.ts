import { useCallback, useEffect, useState } from "react";
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
import type { PaneId, SplitId, WorkspaceLayout } from "./layoutTree.js";
import { readLayout, writeLayout } from "./layoutStorage.js";
import type { WorkspaceCommand } from "./keybindings.js";

export interface WorkspaceLayoutController {
  layout: WorkspaceLayout;
  dispatch(command: WorkspaceCommand): void;
  assignThreadToPane(paneId: PaneId, threadId: ThreadId): void;
  newPane(): void;
  focus(paneId: PaneId): void;
  bind(paneId: PaneId): void;
  resize(splitId: SplitId, sizes: [number, number]): void;
  close(paneId: PaneId): void;
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
    case "bind": {
      const { focusedPaneId } = layout;
      if (focusedPaneId === null) return layout;
      return bindPane(layout, focusedPaneId);
    }
    case "focus":
      return moveFocus(layout, command.direction);
    default:
      return layout;
  }
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

  useEffect(() => {
    writeLayout(projectId, layout);
  }, [projectId, layout]);

  const dispatch = useCallback((command: WorkspaceCommand) => {
    setLayout((current) => applyCommand(current, command));
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

  const close = useCallback((paneId: PaneId) => {
    setLayout((current) => closePane(current, paneId));
  }, []);

  const replaceLayout = useCallback((next: WorkspaceLayout) => {
    setLayout(next);
  }, []);

  return {
    layout,
    dispatch,
    assignThreadToPane,
    newPane,
    focus,
    bind,
    resize,
    close,
    replaceLayout,
  };
}
