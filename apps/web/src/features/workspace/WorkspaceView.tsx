import { useCallback, useEffect, useRef, type JSX } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import {
  ThreadIdSchema,
  type ProjectId,
  type ThreadId,
} from "@pi-web/contracts";

import { archiveThread } from "../../api/client.js";
import { DockRow } from "./Dock.js";
import {
  detectPlatform,
  resolveCommand,
  type KeyEventLike,
} from "./keybindings.js";
import type { PaneId } from "./layoutTree.js";
import { TilingSurface } from "./TilingSurface.js";
import { useWorkspaceLayout } from "./useWorkspaceLayout.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";

// Browser Shift variants of "=" and "-" report as "+" and "_"; the
// keybindings map the un-shifted key alongside a shiftKey flag, so normalize
// back before resolving a command.
function normalizeKey(key: string): string {
  if (key === "+") return "=";
  if (key === "_") return "-";
  return key;
}

export function WorkspaceView(props: { projectId: ProjectId }): JSX.Element {
  const { projectId } = props;
  const controller = useWorkspaceLayout(projectId);

  // Always-fresh reference so effects/callbacks with stable identities never
  // dispatch against a stale controller from an earlier render.
  const controllerRef = useRef<WorkspaceLayoutController>(controller);
  controllerRef.current = controller;

  // Set by openThread when it has to create a fresh pane for a thread; the
  // pane id doesn't exist yet at call time (newPane() is async, functional
  // setState), so the assignment is completed by the effect below once the
  // new focused pane id is visible in `controller.layout`.
  const pendingThreadAssignmentRef = useRef<ThreadId | null>(null);

  useEffect(() => {
    const pendingThreadId = pendingThreadAssignmentRef.current;
    if (pendingThreadId === null) return;
    const paneId = controller.layout.focusedPaneId;
    if (paneId === null) return;
    pendingThreadAssignmentRef.current = null;
    controller.assignThreadToPane(paneId, pendingThreadId);
    // The dependency below is always invoked as
    // controller.assignThreadToPane(...) above, never detached from its
    // object; it's listed only so the effect tracks the (referentially
    // stable) callback instead of the whole controller object identity.
    // eslint-disable-next-line @typescript-eslint/unbound-method
  }, [controller.layout, controller.assignThreadToPane]);

  const openThread = useCallback((threadId: ThreadId) => {
    const current = controllerRef.current;
    const { layout } = current;
    const existingPaneId = Object.entries(layout.panes).find(
      ([, pane]) => pane.threadId === threadId,
    )?.[0];
    if (existingPaneId !== undefined) {
      if (layout.docked.includes(existingPaneId))
        current.restore(existingPaneId);
      current.focus(existingPaneId);
      return;
    }
    const focusedPaneId = layout.focusedPaneId;
    const focusedPane =
      focusedPaneId !== null ? layout.panes[focusedPaneId] : undefined;
    if (focusedPaneId !== null && focusedPane?.threadId === null) {
      current.assignThreadToPane(focusedPaneId, threadId);
      return;
    }
    pendingThreadAssignmentRef.current = threadId;
    current.newPane();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Never hijack native text-editing shortcuts (e.g. Cmd+Shift+ArrowUp/
      // Down select-to-start/end, Cmd+Shift+Backspace delete-to-start)
      // while the user is typing in a composer or the sidebar's rename
      // input — let the browser/input handle those untouched.
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      const keyEventLike: KeyEventLike = {
        key: normalizeKey(event.key),
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      };
      const command = resolveCommand(keyEventLike, detectPlatform(navigator));
      if (command === null) return;
      event.preventDefault();
      controllerRef.current.dispatch(command);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const archivingPanesRef = useRef<Set<PaneId>>(new Set());
  const archive = useMutation({
    mutationFn: (threadId: ThreadId) => archiveThread(projectId, threadId),
  });

  const handleClose = useCallback(
    (paneId: PaneId, threadId: ThreadId | null) => {
      if (threadId === null) {
        controllerRef.current.close(paneId);
        return;
      }
      if (archivingPanesRef.current.has(paneId)) return;
      archivingPanesRef.current.add(paneId);
      archive.mutate(threadId, {
        onSettled: () => {
          archivingPanesRef.current.delete(paneId);
          controllerRef.current.close(paneId);
        },
      });
    },
    [archive],
  );

  const params = useParams();
  useEffect(() => {
    const parsed = ThreadIdSchema.safeParse(params.threadId);
    if (!parsed.success) return;
    openThread(parsed.data);
  }, [params.threadId, openThread]);

  // The "/new" route is the tiling surface's entry point for starting a
  // fresh chat: on entering it (or switching projects while already on it),
  // make sure a threadless new-chat pane is focused. Guarded by
  // [isNewChatRoute, projectId] so this runs once per route entry, not on
  // every layout change (e.g. once the pane adopts a thread and the route
  // navigates away, isNewChatRoute flips to false and this won't refire).
  const location = useLocation();
  const isNewChatRoute = location.pathname.endsWith("/new");
  useEffect(() => {
    if (!isNewChatRoute) return;
    const layout = controllerRef.current.layout;
    const focusedPaneId = layout.focusedPaneId;
    const focusedPane =
      focusedPaneId !== null ? layout.panes[focusedPaneId] : undefined;
    if (focusedPaneId !== null && focusedPane?.threadId === null) return;
    controllerRef.current.newPane();
  }, [isNewChatRoute, projectId]);

  return (
    <div className="workspace-view">
      <TilingSurface
        projectId={projectId}
        controller={controller}
        onClosePane={handleClose}
      />
      <DockRow projectId={projectId} controller={controller} />
    </div>
  );
}
