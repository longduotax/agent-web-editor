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
import {
  continuationCreationKey,
  newChatDraftKey,
  removeDraft,
} from "./drafts.js";
import { paneThreadId, type PaneId } from "./layoutTree.js";
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
      : paneThreadId(controller.layout.panes[focusedPaneId]);
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

  const openThread = useCallback(
    (threadId: ThreadId) => {
      const current = controllerRef.current;
      const { layout } = current;
      const existingPaneId = Object.entries(layout.panes).find(
        ([, pane]) => pane.type === "thread" && pane.threadId === threadId,
      )?.[0];
      if (existingPaneId !== undefined) {
        current.focus(existingPaneId);
        return;
      }
      const focusedPaneId = layout.focusedPaneId;
      const focusedPane =
        focusedPaneId !== null ? layout.panes[focusedPaneId] : undefined;
      if (focusedPaneId !== null && focusedPane?.type !== "thread") {
        removeDraft(newChatDraftKey(projectId, focusedPaneId));
        removeDraft(continuationCreationKey(projectId, focusedPaneId));
        current.assignThreadToPane(focusedPaneId, threadId);
        return;
      }
      // An assignment for this thread is already in flight, so the pane that
      // will receive it exists (or is about to). Calling newPane() again would
      // make a SECOND one and only the second would get the thread, leaving an
      // orphan "New chat" pane beside it.
      //
      // This is the same hazard `handledNewChatEntryRef` guards below, for the
      // same reason: newPane() is a functional setState, so under StrictMode's
      // mount -> cleanup -> mount the second invocation still reads the
      // pre-update layout and takes the same branch. It only becomes reachable
      // when this effect runs against an EMPTY surface, which is exactly what
      // closing the last pane and letting the route re-resolve produces.
      if (pendingThreadAssignmentRef.current === threadId) return;
      pendingThreadAssignmentRef.current = threadId;
      current.newPane();
    },
    [projectId],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const keyEventLike: KeyEventLike = {
        key: normalizeKey(event.key),
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      };
      const command = resolveCommand(keyEventLike, detectPlatform(navigator));
      if (command === null) return;
      // Split is safe while typing: its punctuation chords are not native
      // text-editing commands, and requiring Escape before every split makes
      // the composer's most common workspace action needlessly indirect.
      // Keep commands that use editing/navigation keys suppressed so native
      // behavior such as delete-to-start remains untouched.
      if (isTextEntryTarget(event.target) && command.type !== "split") return;
      event.preventDefault();
      controllerRef.current.dispatch(command);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const params = useParams();
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
      removeDraft(continuationCreationKey(projectId, paneId));
      const closedThreadId = paneThreadId(
        controllerRef.current.layout.panes[paneId],
      );
      // The close is computed once, by the controller, and the result is what
      // decides the route. Recomputing closePane() here as well was correct
      // only for as long as the controller's close stayed identical to it.
      const after = controllerRef.current.close(paneId);
      // Closing a pane is an instruction, and the URL has to stop describing
      // what was closed -- otherwise a reload re-resolves that URL and brings
      // the pane straight back (N2). This is NOT specific to the new-chat
      // pane: the same thing happens to a thread pane whose thread the URL
      // names. The route only moves when it actually addressed the closed
      // pane; closing a split that the URL was never about must not
      // renavigate underneath the user.
      const routeAddressedClosedPane =
        closedThreadId === null
          ? isNewChatRoute
          : params.threadId === closedThreadId;
      if (!routeAddressedClosedPane) return;
      const nextPaneId = after.focusedPaneId;
      if (nextPaneId === null) {
        // Nothing is left open, and the two last-pane cases are not the same
        // route problem.
        //
        // `/…/threads/:threadId` NAMES something. It is the only record of
        // where the user was, it is what a bookmark or a shared link carries,
        // and NEW-R3-3 depends on it still naming that thread so the sidebar
        // row for it re-opens the pane. It is kept.
        //
        // `/…/new` names nothing. It is an INSTRUCTION -- "open an empty
        // composer here" -- so leaving it in place means a reload re-issues an
        // instruction the user just countermanded by closing the pane, which
        // is N2 verbatim. It goes to the project route, whose own resolution
        // then decides what to show; whatever that is, it is not the blank
        // pane that was just dismissed, and the URL and the surface agree
        // again after a reload.
        if (isNewChatRoute)
          void navigate(`/projects/${projectId}`, { replace: true });
        return;
      }
      const nextThreadId = paneThreadId(after.panes[nextPaneId]);
      void navigate(
        nextThreadId === null
          ? `/projects/${projectId}/new`
          : `/projects/${projectId}/threads/${nextThreadId}`,
        { replace: true },
      );
    },
    [isNewChatRoute, navigate, params.threadId, projectId],
  );

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
    if (isNewChatRoute) return;
    const parsed = ThreadIdSchema.safeParse(params.threadId);
    if (!parsed.success) return;
    openThread(parsed.data);
  }, [isNewChatRoute, params.threadId, location.key, openThread]);

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
  const handledNewChatEntryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isNewChatRoute) {
      handledNewChatEntryRef.current = null;
      return;
    }
    const entryKey = `${projectId}:${location.pathname}`;
    if (handledNewChatEntryRef.current === entryKey) return;
    handledNewChatEntryRef.current = entryKey;
    const current = controllerRef.current;
    const { layout } = current;
    const focusedPaneId = layout.focusedPaneId;
    const focusedPane =
      focusedPaneId !== null ? layout.panes[focusedPaneId] : undefined;
    const pendingSource = ThreadIdSchema.safeParse(params.threadId);
    if (pendingSource.success) {
      const existing = Object.entries(layout.panes).find(
        ([, pane]) =>
          pane.type === "continuation" &&
          pane.sourceThreadId === pendingSource.data,
      )?.[0];
      if (existing !== undefined) {
        current.focus(existing);
        return;
      }
      const sourcePane = Object.entries(layout.panes).find(
        ([, pane]) =>
          pane.type === "thread" && pane.threadId === pendingSource.data,
      )?.[0];
      if (sourcePane !== undefined) {
        current.focus(sourcePane);
        current.beginContinuationInPane(sourcePane, pendingSource.data);
        return;
      }
      if (focusedPaneId !== null && focusedPane?.type !== "thread") {
        current.restoreContinuationInPane(focusedPaneId, pendingSource.data);
      } else {
        current.newContinuationPane(pendingSource.data);
      }
      return;
    }
    if (focusedPaneId !== null && focusedPane?.type === "new") return;
    if (focusedPaneId !== null && focusedPane?.type === "continuation") {
      removeDraft(newChatDraftKey(projectId, focusedPaneId));
      removeDraft(continuationCreationKey(projectId, focusedPaneId));
      current.resetPaneToNew(focusedPaneId);
      return;
    }
    current.newPane();
  }, [isNewChatRoute, location.pathname, params.threadId, projectId]);

  // A pane's "New chat" form starting a thread always assigns the thread to
  // that pane. It also navigates to the thread's route, but only when that
  // pane was the new-chat route's entry pane — starting a thread in an
  // arbitrary split pane must not clobber whatever route/thread is
  // currently addressed. Once navigated, the params.threadId effect above
  // finds the pane already carrying that thread and just focuses it, so
  // this never creates a second pane or loops.
  const handleThreadStarted = useCallback(
    (paneId: PaneId, threadId: ThreadId) => {
      const replacedThreadId = paneThreadId(
        controllerRef.current.layout.panes[paneId],
      );
      controllerRef.current.assignThreadToPane(paneId, threadId);
      if (isNewChatRoute || params.threadId === replacedThreadId) {
        void navigate(`/projects/${projectId}/threads/${threadId}`);
      }
    },
    [isNewChatRoute, navigate, params.threadId, projectId],
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
