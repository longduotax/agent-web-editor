import { useCallback, useEffect, useState } from "react";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

import {
  assignThread,
  bindPane,
  closePane,
  collapsePane,
  focusPane,
  moveFocus,
  restorePane,
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
  focus(paneId: PaneId): void;
  restore(paneId: PaneId): void;
  bind(paneId: PaneId): void;
  resize(splitId: SplitId, sizes: [number, number]): void;
  collapse(paneId: PaneId): void;
  close(paneId: PaneId): void;
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
    case "collapse": {
      const { focusedPaneId } = layout;
      if (focusedPaneId === null) return layout;
      return collapsePane(layout, focusedPaneId);
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
    case "restore": {
      const mostRecentlyDocked = layout.docked[0];
      if (mostRecentlyDocked === undefined) return layout;
      return restorePane(layout, mostRecentlyDocked, makePaneId);
    }
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

  const focus = useCallback((paneId: PaneId) => {
    setLayout((current) => focusPane(current, paneId));
  }, []);

  const restore = useCallback((paneId: PaneId) => {
    setLayout((current) => restorePane(current, paneId, makePaneId));
  }, []);

  const bind = useCallback((paneId: PaneId) => {
    setLayout((current) => bindPane(current, paneId));
  }, []);

  const resize = useCallback((splitId: SplitId, sizes: [number, number]) => {
    setLayout((current) => setSplitSizes(current, splitId, sizes));
  }, []);

  const collapse = useCallback((paneId: PaneId) => {
    setLayout((current) => collapsePane(current, paneId));
  }, []);

  const close = useCallback((paneId: PaneId) => {
    setLayout((current) => closePane(current, paneId));
  }, []);

  return {
    layout,
    dispatch,
    assignThreadToPane,
    focus,
    restore,
    bind,
    resize,
    collapse,
    close,
  };
}
