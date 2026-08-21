import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ThreadIdSchema,
  type ProjectId,
  type ThreadId,
} from "@pi-web/contracts";

import { archiveThread } from "../../api/client.js";
import {
  isEnvironmentOpen,
  readEnvironmentVisibility,
  writeEnvironmentVisibility,
} from "../settings/environmentPreferences.js";
import { EnvironmentPanel } from "./EnvironmentPanel.js";
import {
  detectPlatform,
  resolveCommand,
  type KeyEventLike,
} from "./keybindings.js";
import { tiledPaneIds, type PaneId, type WorkspaceLayout } from "./layoutTree.js";
import { TilingSurface } from "./TilingSurface.js";
import { UndoToast } from "./UndoToast.js";
import { useWorkspaceLayout } from "./useWorkspaceLayout.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";

// Captured at the moment a threaded pane is closed, so an in-flight undo
// toast can either flush (archive now) or be cancelled (restore `previous`,
// never archiving) without a server round trip either way.
interface PendingClose {
  paneId: PaneId;
  threadId: ThreadId;
  previous: WorkspaceLayout;
}

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
  const navigate = useNavigate();

  // Always-fresh reference so effects/callbacks with stable identities never
  // dispatch against a stale controller from an earlier render.
  const controllerRef = useRef<WorkspaceLayoutController>(controller);
  controllerRef.current = controller;

  // Whether the current route is the tiling surface's new-chat entry point;
  // computed early because both the entry-pane effect below and
  // handleThreadStarted need it.
  const location = useLocation();
  const isNewChatRoute = location.pathname.endsWith("/new");

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

  // There is no unarchive endpoint, so undo must prevent the archive rather
  // than reverse it: closing a threaded pane is immediate (the pane leaves
  // the layout right away), while the actual archiveThread call is deferred
  // until the undo toast times out. Only one close can be pending at a
  // time — pendingCloseRef mirrors the pendingClose state so handleClose
  // (called synchronously from a click) can read/flush the previous pending
  // close without waiting on a render.
  const pendingCloseRef = useRef<PendingClose | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);

  const clearPending = useCallback(() => {
    pendingCloseRef.current = null;
    setPendingClose(null);
  }, []);

  // Archives the given pending close's thread right now (either because its
  // toast timed out, or because it's being flushed by a newer close) and
  // clears it from pending state.
  const archivePending = useCallback(
    (pending: PendingClose) => {
      clearPending();
      void archiveThread(projectId, pending.threadId);
    },
    [clearPending, projectId],
  );

  const handleClose = useCallback(
    (paneId: PaneId, threadId: ThreadId | null) => {
      // Only one close may be pending its toast at a time: a second close
      // flushes (archives now) whatever was already pending.
      const existing = pendingCloseRef.current;
      if (existing !== null) archivePending(existing);

      if (threadId === null) {
        controllerRef.current.close(paneId);
        return;
      }

      const previous = controllerRef.current.layout;
      controllerRef.current.close(paneId);
      const pending: PendingClose = { paneId, threadId, previous };
      pendingCloseRef.current = pending;
      setPendingClose(pending);
    },
    [archivePending],
  );

  const handleToastDismiss = useCallback(() => {
    const pending = pendingCloseRef.current;
    if (pending === null) return;
    archivePending(pending);
  }, [archivePending]);

  const handleToastUndo = useCallback(() => {
    const pending = pendingCloseRef.current;
    if (pending === null) return;
    // Cancel the deferred archive outright (never fires) and restore the
    // pane exactly as it was, splits and all — a pure client operation.
    clearPending();
    controllerRef.current.replaceLayout(pending.previous);
  }, [clearPending]);

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
  useEffect(() => {
    if (!isNewChatRoute) return;
    const layout = controllerRef.current.layout;
    const focusedPaneId = layout.focusedPaneId;
    const focusedPane =
      focusedPaneId !== null ? layout.panes[focusedPaneId] : undefined;
    if (focusedPaneId !== null && focusedPane?.threadId === null) return;
    controllerRef.current.newPane();
  }, [isNewChatRoute, projectId]);

  // A pane's "New chat" form starting a thread always assigns the thread to
  // that pane. It also navigates to the thread's route, but only when that
  // pane was the new-chat route's entry pane — starting a thread in an
  // arbitrary split pane must not clobber whatever route/thread is
  // currently addressed. Once navigated, the params.threadId effect above
  // finds the pane already carrying that thread and just focuses it, so
  // this never creates a second pane or loops.
  const handleThreadStarted = useCallback(
    (paneId: PaneId, threadId: ThreadId) => {
      controllerRef.current.assignThreadToPane(paneId, threadId);
      if (isNewChatRoute) {
        void navigate(`/projects/${projectId}/threads/${threadId}`);
      }
    },
    [isNewChatRoute, navigate, projectId],
  );

  // The Environment panel is single, shared, and focus-following (CWS-06) —
  // exactly one instance for the whole surface, docked as a right column
  // (never a floating overlay), never one per pane. Its visibility is a
  // device-local preference: "auto" opens it while the surface is a single
  // pane and hides it once split; "shown"/"hidden" are an explicit,
  // persisted override from the toggle below.
  const [environmentVisibility, setEnvironmentVisibility] = useState(
    readEnvironmentVisibility,
  );
  const tiledPaneCount = tiledPaneIds(controller.layout).length;
  const environmentOpen = isEnvironmentOpen(
    environmentVisibility,
    tiledPaneCount,
  );
  const toggleEnvironment = useCallback(() => {
    setEnvironmentVisibility((current) => {
      const next = isEnvironmentOpen(current, tiledPaneCount)
        ? "hidden"
        : "shown";
      writeEnvironmentVisibility(next);
      return next;
    });
  }, [tiledPaneCount]);
  const hideEnvironment = useCallback(() => {
    setEnvironmentVisibility("hidden");
    writeEnvironmentVisibility("hidden");
  }, []);

  return (
    <div className="workspace-view">
      <div className="workspace-main">
        <TilingSurface
          projectId={projectId}
          controller={controller}
          onClosePane={handleClose}
          onThreadStarted={handleThreadStarted}
        />
        <button
          type="button"
          className="icon-btn environment-toggle"
          aria-label="Toggle environment panel"
          aria-pressed={environmentOpen}
          title="Toggle environment panel"
          onClick={toggleEnvironment}
        >
          <svg
            className="ico"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16" />
          </svg>
        </button>
      </div>
      {environmentOpen && (
        <EnvironmentPanel
          projectId={projectId}
          controller={controller}
          onClose={hideEnvironment}
        />
      )}
      {pendingClose !== null && (
        // Keyed by paneId so a flush that swaps one pending close for
        // another (see handleClose) remounts the toast instead of reusing
        // its fiber — otherwise the timer effect's [timeoutMs] dependency
        // never changes and the *first* pane's countdown keeps running,
        // leaving the second pane with whatever time was left rather than
        // a fresh timeoutMs window.
        <UndoToast
          key={pendingClose.paneId}
          message="Archived"
          onUndo={handleToastUndo}
          onDismiss={handleToastDismiss}
        />
      )}
    </div>
  );
}
