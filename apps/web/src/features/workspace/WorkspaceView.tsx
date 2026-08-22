import { useCallback, useEffect, useRef, type JSX } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ThreadIdSchema,
  type ProjectId,
  type ThreadId,
} from "@pi-web/contracts";

import {
  detectPlatform,
  isTextEntryTarget,
  normalizeKey,
  resolveCommand,
  type KeyEventLike,
} from "./keybindings.js";
import { newChatDraftKey, removeDraft } from "./drafts.js";
import type { PaneId } from "./layoutTree.js";
import { TilingSurface } from "./TilingSurface.js";
import { useWorkspaceLayout } from "./useWorkspaceLayout.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";

export function WorkspaceView(props: {
  projectId: ProjectId;
  // Reports whichever thread the focused pane owns, or null for a threadless
  // pane / an empty surface. The workspace panel is docked outside this
  // component and opens new tabs against whichever thread is focused, so the
  // focus state has to travel upward (see App.tsx's ProjectWorkspace).
  onFocusedThreadChange?: ((threadId: ThreadId | null) => void) | undefined;
}): JSX.Element {
  const { projectId, onFocusedThreadChange } = props;
  const controller = useWorkspaceLayout(projectId);
  const navigate = useNavigate();

  const focusedPaneId = controller.layout.focusedPaneId;
  const focusedThreadId =
    focusedPaneId === null
      ? null
      : (controller.layout.panes[focusedPaneId]?.threadId ?? null);
  useEffect(() => {
    onFocusedThreadChange?.(focusedThreadId);
  }, [focusedThreadId, onFocusedThreadChange]);

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
      if (isTextEntryTarget(event.target)) return;
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

  // Closing a pane is a PURE LAYOUT OPERATION. It used to archive the pane's
  // thread as a side effect, behind a button labelled only "Close", via a
  // fire-and-forget archiveThread() with no .catch and no error surface --
  // so a failed archive still reported success, and a successful one was
  // unrecoverable (there is no unarchive endpoint and no archived-thread
  // list). Archiving is now only ever reached through the sidebar's
  // explicitly labelled Archive action, which defers the call behind an undo
  // toast and surfaces failures. Do not reintroduce a destructive side
  // effect here.
  // Closing also drops the pane's new-chat draft: the key is scoped to a pane
  // id that will never exist again, so leaving it behind is an unbounded
  // storage leak. A pane that has adopted a thread has already cleared its
  // key on submit, so this is a no-op for those.
  const handleClose = useCallback(
    (paneId: PaneId) => {
      removeDraft(newChatDraftKey(projectId, paneId));
      controllerRef.current.close(paneId);
    },
    [projectId],
  );

  const params = useParams();
  // Depends on `location.key` as well as the thread id (NEW-R3-3). Clicking a
  // sidebar row for the thread the URL ALREADY addresses navigates to the
  // same path, so `params.threadId` does not change and an effect keyed only
  // on it never re-runs. After the last pane is closed the URL still names
  // the thread it was showing, so that row -- the selected one, the one a
  // user is most likely to click -- did nothing at all and the empty surface
  // was a dead end. Every navigation (push OR replace, same path or not)
  // mints a fresh key, so this re-runs exactly once per click.
  // openThread is idempotent: it focuses an existing pane for the thread
  // rather than opening a second one, so re-running on unrelated navigations
  // only ever moves focus to the thread the URL names.
  useEffect(() => {
    const parsed = ThreadIdSchema.safeParse(params.threadId);
    if (!parsed.success) return;
    openThread(parsed.data);
  }, [params.threadId, location.key, openThread]);

  // The "/new" route is the tiling surface's entry point for starting a
  // fresh chat: on entering it (or switching projects while already on it),
  // make sure a threadless new-chat pane is focused. Guarded by
  // [isNewChatRoute, projectId] so this runs once per route entry, not on
  // every layout change (e.g. once the pane adopts a thread and the route
  // navigates away, isNewChatRoute flips to false and this won't refire).
  // Guards on the *intent* (this route entry has been handled) rather than on
  // `controllerRef.current.layout`, which is stale on a repeated invocation:
  // newPane() is a functional setState, so under StrictMode's mount ->
  // cleanup -> mount the second run still saw the pre-split layout, failed the
  // threadless-pane check below, and split a SECOND new-chat pane (which then
  // persisted to device-local layout storage). The ref survives the double
  // invocation; it is cleared when the route leaves /new, so a later
  // re-entry (or a project switch while on /new) dispatches again.
  const handledNewChatEntryRef = useRef<ProjectId | null>(null);
  useEffect(() => {
    if (!isNewChatRoute) {
      handledNewChatEntryRef.current = null;
      return;
    }
    if (handledNewChatEntryRef.current === projectId) return;
    handledNewChatEntryRef.current = projectId;
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

  return (
    <div className="workspace-view">
      <div className="workspace-main">
        <TilingSurface
          projectId={projectId}
          controller={controller}
          onClosePane={handleClose}
          onThreadStarted={handleThreadStarted}
        />
      </div>
    </div>
  );
}
