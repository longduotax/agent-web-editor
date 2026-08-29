import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ProjectIdSchema,
  ThreadIdSchema,
  type ProjectId,
  type RuntimeKind,
  type ThreadId,
} from "@pi-web/contracts";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  archiveThread,
  addProjectByPath,
  browseProject,
  discoverSessions,
  getArchivedThreads,
  getSnapshot,
  getWorkspace,
  importThread,
  removeProject,
  renameThread,
  setExpanded,
  unarchiveThread,
} from "./api/client.js";
import { ErrorNotice } from "./components/ErrorNotice.js";
import { ThreadRenameForm } from "./components/ThreadRenameForm.js";
import { Loading } from "./components/Loading.js";
import { Status } from "./components/Status.js";
import { SettingsPage } from "./features/settings/SettingsPage.js";
import { PanelRightIcon } from "./features/panel/PanelRightIcon.js";
import { PANEL_DEFAULT_WIDTH } from "./features/panel/panelModel.js";
import { clampPanelWidth } from "./features/panel/panelGeometry.js";
import { threadTabContext } from "./features/panel/tabContext.js";
import { usePanelState } from "./features/panel/usePanelState.js";
import { WorkspacePanel } from "./features/panel/WorkspacePanel.js";
import { UndoToast } from "./features/workspace/UndoToast.js";
import { WorkspaceView } from "./features/workspace/WorkspaceView.js";
import {
  deriveRunStatus,
  PANE_STATUS_LABEL,
  PANE_STATUS_TOKEN,
} from "./features/workspace/runStatus.js";

export { Composer } from "./features/workspace/ThreadPane.js";

// A thread whose archive is staged behind its own undo toast, or whose
// archive has just failed. The title travels with it so both the toast and
// any error can name the thread without a second lookup — the row is gone
// from `workspace.data.threads` while the archive is staged.
interface PendingArchive {
  projectId: ProjectId;
  threadId: ThreadId;
  title: string;
}

// How close the thread context menu may come to the edge of the window.
const VIEWPORT_INSET = 8;

// Keeps an already-rendered menu inside the window, using the size the browser
// actually laid it out at. An earlier version carried `.thread-context-menu`'s
// min-width and item metrics as JS constants; those are the stylesheet's to
// change, and a copy of them here is a copy that drifts. Measuring costs one
// layout read in an effect that already runs on open.
function clampToViewport(
  anchor: { left: number; top: number },
  size: { width: number; height: number },
) {
  return {
    left: Math.max(
      VIEWPORT_INSET,
      Math.min(anchor.left, window.innerWidth - size.width - VIEWPORT_INSET),
    ),
    top: Math.max(
      VIEWPORT_INSET,
      Math.min(anchor.top, window.innerHeight - size.height - VIEWPORT_INSET),
    ),
  };
}

function Sidebar({
  selectedProjectId,
  selectedThreadId,
}: {
  selectedProjectId?: ProjectId | undefined;
  selectedThreadId?: ThreadId | undefined;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
  });
  const browse = useMutation({
    mutationFn: browseProject,
    onSuccess: async (result) => {
      if (result.outcome === "selected")
        await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });
  // The path fallback's own state. Kept beside `browse` rather than inside a
  // child component so both routes invalidate the same query and so the
  // disclosure can close itself on success.
  // The disclosure is left UNCONTROLLED and closed through the DOM node.
  // Driving `open` from React state means React owns a value the browser also
  // writes (a click on the summary), and the two desynchronise the moment one
  // of them moves without the other -- which is exactly what happens in an
  // environment that does not fire `toggle`. `<details>` already remembers
  // its own state; the only thing this needs is to shut it once.
  const pathFormRef = useRef<HTMLDetailsElement>(null);
  const [pathDraft, setPathDraft] = useState("");
  const addByPath = useMutation({
    mutationFn: addProjectByPath,
    onSuccess: async () => {
      // Clear and collapse: the project's row appearing in the list below is
      // the confirmation, and a field still holding the path that worked
      // invites a second submit that would only report "already registered".
      setPathDraft("");
      if (pathFormRef.current !== null) pathFormRef.current.open = false;
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });
  // A failed browse used to survive every navigation and clear only on a
  // reload or a successful browse -- a red block in the primary navigation,
  // for an action the user had already abandoned, reading as "something is
  // broken with my project". Moving anywhere in the workspace is enough to
  // say they have moved on. Read through a ref so this effect depends on the
  // ROUTE only: putting the mutation's own error in the dependency list would
  // fire the moment the error arrived and clear the notice before it painted.
  const browseRef = useRef(browse);
  useEffect(() => {
    browseRef.current = browse;
  });
  useEffect(() => {
    const current = browseRef.current;
    // Never while the dialog is still open: resetting a pending mutation
    // re-arms the Browse button behind a chooser that is still on screen.
    if (!current.isPending && current.error !== null) current.reset();
  }, [selectedProjectId, selectedThreadId]);
  const [discoveringProjectId, setDiscoveringProjectId] = useState<
    ProjectId | undefined
  >(undefined);
  const [renamingThread, setRenamingThread] = useState<{
    projectId: ProjectId;
    threadId: ThreadId;
    title: string;
  } | null>(null);
  const [threadMenu, setThreadMenu] = useState<{
    projectId: ProjectId;
    threadId: ThreadId;
    title: string;
    running: boolean;
    left: number;
    top: number;
  } | null>(null);
  const threadMenuRef = useRef<HTMLDivElement>(null);
  // Which project's Archived section is open, if any. One query for the whole
  // sidebar (the same shape as the session-import section above): archived
  // threads are a recovery surface, not part of the normal listing, so they
  // are never fetched until the section is opened.
  const [archivedProjectId, setArchivedProjectId] = useState<
    ProjectId | undefined
  >(undefined);
  const archivedThreads = useQuery({
    queryKey: ["archived-threads", archivedProjectId],
    queryFn: async () => {
      if (archivedProjectId === undefined)
        throw new Error("A project must be selected to list archived threads.");
      return await getArchivedThreads(archivedProjectId);
    },
    enabled: archivedProjectId !== undefined,
  });
  const sessions = useQuery({
    queryKey: ["sessions", discoveringProjectId],
    queryFn: async () => {
      if (discoveringProjectId === undefined)
        throw new Error(
          "A project must be selected before importing a session.",
        );
      return await discoverSessions(discoveringProjectId);
    },
    enabled: discoveringProjectId !== undefined,
  });
  const importSession = useMutation({
    mutationFn: async ({
      projectId,
      sessionId,
      runtime,
    }: {
      projectId: ProjectId;
      sessionId: string;
      runtime: RuntimeKind;
    }) => await importThread(projectId, sessionId, runtime),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace"] }),
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      ]);
      setDiscoveringProjectId(undefined);
      void navigate(
        `/projects/${result.thread.projectId}/threads/${result.thread.id}`,
      );
    },
  });
  // Archiving is the app's one destructive thread action, so undo PREVENTS
  // the call rather than reversing it: the row leaves the list immediately,
  // the request is deferred until that thread's toast times out, and Undo
  // cancels it outright. (Archiving is reversible now — see Restore below —
  // but a prevented archive is still cheaper and keeps the thread's place in
  // the list.)
  //
  // Every staged archive is INDEPENDENT (NEW-R3-1). A single pending slot
  // meant archiving a second thread flushed the first one's request
  // immediately, cutting an undo window the user was still inside, and the
  // mutation.reset() that followed detached the observer before the flushed
  // request could reject — so that failure surfaced nowhere at all. Each
  // entry now owns its own toast, its own 6s timer and its own named error.
  const [pendingArchives, setPendingArchives] = useState<PendingArchive[]>([]);
  // Threads whose archive request is IN FLIGHT, kept hidden for exactly as
  // long as it takes the listing to agree.
  //
  // `pendingArchives` stops hiding a row the instant the request is SENT,
  // because the toast's dismissal both un-stages the archive and fires the
  // mutation in one handler. But the authoritative listing does not drop the
  // thread until the request has returned AND the invalidated ["workspace"]
  // query has refetched. In that gap the row -- gone from the sidebar for the
  // whole six-second undo window, its toast already faded -- came BACK, and
  // left again 85ms later when the fresh listing landed. That flicker, and
  // the reflow of every row beneath it, is the reported glitch.
  //
  // Hiding for the whole flight means the row leaves once, when the reader
  // asked for it, and returns only if the archive actually fails -- which is
  // what the named error notice beside it is there to explain.
  const [archivingThreadIds, setArchivingThreadIds] = useState<ThreadId[]>([]);
  const [archiveFailures, setArchiveFailures] = useState<
    { thread: PendingArchive; error: unknown }[]
  >([]);
  const forgetArchiveFailure = (threadId: ThreadId) => {
    setArchiveFailures((current) =>
      current.filter((failure) => failure.thread.threadId !== threadId),
    );
  };
  const archive = useMutation({
    mutationFn: async ({ projectId, threadId }: PendingArchive) =>
      await archiveThread(projectId, threadId),
    // One choke point for both routes into this mutation -- the toast timing
    // out, and Retry on a failed archive's notice -- so neither can forget to
    // hide the row it is about to remove.
    onMutate: ({ threadId }) => {
      setArchivingThreadIds((current) =>
        current.includes(threadId) ? current : [...current, threadId],
      );
    },
    onSuccess: async (_result, variables) => {
      setThreadMenu(null);
      forgetArchiveFailure(variables.threadId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace"] }),
        // The Archived section is the newly archived thread's destination. If
        // it happens to be open, leaving its list stale means the thread has
        // apparently vanished from both lists at once.
        queryClient.invalidateQueries({ queryKey: ["archived-threads"] }),
      ]);
      // NO NAVIGATION. The focused pane keeps the thread it was showing and
      // swaps its composer for "This thread is archived. Restore it to keep
      // working." -- which is exactly what an unfocused pane has always done.
      //
      // Archiving used to send the app to `/projects/:id`, whose redirect to
      // `lastOpenedThreadId ?? threads[0]` put an ARBITRARY OTHER THREAD
      // under the reader's eyes with nothing said about it. The fix for that
      // was to navigate to `/new` instead, which carries no thread id and so
      // does not re-point the pane. But `/new` is not inert either: it is an
      // INSTRUCTION to open an empty composer, so WorkspaceView answered it
      // by splitting a second pane in and moving keyboard focus into its
      // textarea -- six seconds after a click that asked for neither.
      //
      // That split is what re-tiled the surface, and re-tiling re-parents the
      // existing pane's element, which React cannot preserve across a change
      // of parent. The pane therefore REMOUNTED, losing the latched
      // "this thread was once listed" that is the whole basis of its archived
      // inference, and rendered the thread it had just correctly marked
      // Archived as live again -- its title, a green "Done", a working
      // composer -- until the refetched snapshot 404'd 35ms later.
      //
      // Staying put satisfies the original requirement more directly than
      // either destination: nothing re-points the pane because nothing
      // navigates, the URL goes on naming the thread the reader archived (so
      // a reload returns to it, with Restore in reach), and the pane reaches
      // the notice by simply re-rendering.
    },
    // Recorded per thread rather than read off the mutation, which only ever
    // holds the most recent call's error and is the exact hole NEW-R3-1 fell
    // through.
    onError: (error, variables) => {
      setArchiveFailures((current) => [
        ...current.filter(
          (failure) => failure.thread.threadId !== variables.threadId,
        ),
        { thread: variables, error },
      ]);
    },
    // react-query AWAITS onSuccess before running this, so on the success
    // path the row is only allowed back once the refetched listing has
    // already dropped it -- and it therefore never comes back at all. On the
    // failure path nothing dropped it, so it reappears beside its error.
    // That ordering is the whole fix; a plain onSuccess would un-hide the row
    // before the invalidation it just awaited had reached the cache.
    onSettled: (_result, _error, variables) => {
      setArchivingThreadIds((current) =>
        current.filter((id) => id !== variables.threadId),
      );
    },
  });
  const unarchive = useMutation({
    mutationFn: async ({ projectId, threadId }: PendingArchive) =>
      await unarchiveThread(projectId, threadId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace"] }),
        queryClient.invalidateQueries({ queryKey: ["archived-threads"] }),
      ]);
    },
  });
  const rename = useMutation({
    mutationFn: async ({
      projectId,
      threadId,
      title,
    }: {
      projectId: ProjectId;
      threadId: ThreadId;
      title: string;
    }) => await renameThread(projectId, threadId, title),
    onSuccess: async (_result, variables) => {
      setRenamingThread(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace"] }),
        // The pane header renders the title from its own snapshot query, so
        // without this the renamed thread keeps its old title in the pane
        // until the 15s refetch interval comes round.
        queryClient.invalidateQueries({
          queryKey: ["snapshot", variables.projectId, variables.threadId],
        }),
      ]);
    },
  });
  // One mutation is shared by every sidebar row. The inline editor displays
  // the rejection it catches from mutateAsync, while reset keeps React
  // Query's observer from carrying a settled error into a later thread edit.
  // Every menu and double-click route enters through beginRename, and every
  // Revert route exits through endRename.
  const beginRename = (target: {
    projectId: ProjectId;
    threadId: ThreadId;
    title: string;
  }) => {
    rename.reset();
    setRenamingThread(target);
  };
  const endRename = () => {
    rename.reset();
    setRenamingThread(null);
  };

  // The menu opens off the right edge of the row that asked for it, level with
  // that row's top, so it never covers the thread below. That anchor can fall
  // outside the window near an edge, so it is corrected here — before paint,
  // and against the size the browser actually laid the menu out at rather than
  // against a copy of its CSS. Converges after one pass: the corrected anchor
  // clamps to itself.
  useLayoutEffect(() => {
    const menu = threadMenuRef.current;
    if (threadMenu === null || menu === null) return;
    const { width, height } = menu.getBoundingClientRect();
    const clamped = clampToViewport(threadMenu, { width, height });
    if (clamped.left !== threadMenu.left || clamped.top !== threadMenu.top)
      setThreadMenu({ ...threadMenu, ...clamped });
  }, [threadMenu]);

  useEffect(() => {
    if (threadMenu === null) return;
    const firstItem = threadMenuRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    firstItem?.focus();
    const dismissOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        threadMenuRef.current?.contains(event.target) === true
      )
        return;
      setThreadMenu(null);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setThreadMenu(null);
    };
    const dismiss = () => {
      setThreadMenu(null);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [threadMenu]);

  // Stages an archive. Never touches any other staged archive: a second
  // request runs alongside the first, each on its own timer (NEW-R3-1).
  const requestArchive = (
    projectId: ProjectId,
    threadId: ThreadId,
    title: string,
  ) => {
    setThreadMenu(null);
    forgetArchiveFailure(threadId);
    setPendingArchives((current) =>
      current.some((pending) => pending.threadId === threadId)
        ? current
        : [...current, { projectId, threadId, title }],
    );
  };
  const cancelArchive = (threadId: ThreadId) => {
    setPendingArchives((current) =>
      current.filter((pending) => pending.threadId !== threadId),
    );
  };

  return (
    <nav className="sidebar" aria-label="Projects and threads">
      <header className="brand">
        <span className="brand-mark">π</span>
        <div>
          <strong>Pi Workspace</strong>
          <small>Local agent projects</small>
        </div>
      </header>
      <div className="add-project">
        <span className="add-project-title">Add local project</span>
        <button
          type="button"
          disabled={browse.isPending}
          onClick={() => {
            browse.mutate();
          }}
        >
          {browse.isPending ? "Opening…" : "Browse…"}
        </button>
        {/* The second route in, and the reason it exists: the button above
            hands off to a native OS folder chooser, which is the better way
            when it works and was the ONLY way. That dialog opens as a
            separate window; it can land behind the browser or on another
            desktop, and when it fails outright the app could say so and
            offer nothing else. Adding a project is the first thing anyone
            does and it had no second path.

            Folded into a closed <details> so the common case is unchanged:
            one uppercase label and one primary button, exactly as before.
            The fallback is one word away for the reader who needs it and
            invisible to the reader who does not. */}
        <details className="add-project-path" ref={pathFormRef}>
          <summary>Or enter a path</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const path = pathDraft.trim();
              if (path === "" || addByPath.isPending) return;
              addByPath.mutate(path);
            }}
          >
            <input
              type="text"
              value={pathDraft}
              // Not a `required` field with browser validation: the submit
              // button is disabled until there is something to send, which
              // says the same thing without a popup.
              aria-label="Project directory path"
              placeholder="/absolute/project/path"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(event) => {
                setPathDraft(event.target.value);
                addByPath.reset();
              }}
            />
            <button
              type="submit"
              disabled={pathDraft.trim() === "" || addByPath.isPending}
            >
              {addByPath.isPending ? "Adding…" : "Add"}
            </button>
          </form>
          {/* Said before it is asked, because the new-chat pane already
              handles a non-repository directory and a reader who does not
              know that will assume this field wants a repository. */}
          <p className="add-project-path-note">
            The full path to the directory. It does not have to be a Git
            repository.
          </p>
          {addByPath.error !== null && (
            <ErrorNotice
              error={addByPath.error}
              onDismiss={() => {
                addByPath.reset();
              }}
            />
          )}
        </details>
      </div>
      {/* The folder chooser is a separate OS window, which on macOS can open
          behind the browser or on another Space. All the sidebar used to say
          was a disabled button reading "Opening…" forever, so the app looked
          hung when in fact it was waiting on a dialog the user could not see.
          Saying where the dialog went is the whole fix: there is no cancel to
          offer -- the app cannot close someone else's window, and re-arming
          the button would only open a second dialog behind the first. */}
      {browse.isPending && (
        <p className="add-project-waiting" role="status">
          A folder chooser is open in a separate window. It may be behind this
          one, or on another desktop.
        </p>
      )}
      {browse.error !== null && (
        <ErrorNotice
          error={browse.error}
          onDismiss={() => {
            browse.reset();
          }}
        />
      )}
      {/* One notice per failed archive, naming its thread: with several
          archives in flight an unlabelled message cannot say which one
          failed, and the row silently reappearing explains nothing. */}
      {archiveFailures.map((failure) => (
        <ErrorNotice
          key={failure.thread.threadId}
          error={failure.error}
          context={`Could not archive "${failure.thread.title}"`}
          onRetry={() => {
            archive.mutate(failure.thread);
          }}
        />
      ))}
      {unarchive.error !== null && (
        <ErrorNotice
          error={unarchive.error}
          onDismiss={() => {
            unarchive.reset();
          }}
        />
      )}
      <div className="project-list">
        {workspace.isPending && <p className="muted">Loading projects…</p>}
        {workspace.data?.projects.length === 0 && (
          <p className="empty">
            No projects yet. Add a local directory to begin.
          </p>
        )}
        {workspace.data?.projects.map((project) => {
          const threads = workspace.data.threads.filter(
            (thread) =>
              thread.projectId === project.id &&
              !pendingArchives.some(
                (pending) => pending.threadId === thread.id,
              ) &&
              !archivingThreadIds.includes(thread.id),
          );
          return (
            <section
              className={`project ${selectedProjectId === project.id ? "selected-project" : ""}`}
              key={project.id}
            >
              <div className="project-row">
                <button
                  className="disclosure"
                  aria-label={`${project.sidebarExpanded ? "Collapse" : "Expand"} ${project.displayName}`}
                  onClick={() =>
                    void setExpanded(project.id, !project.sidebarExpanded).then(
                      () =>
                        queryClient.invalidateQueries({
                          queryKey: ["workspace"],
                        }),
                    )
                  }
                >
                  {project.sidebarExpanded ? "▾" : "▸"}
                </button>
                <Link to={`/projects/${project.id}`} className="project-link">
                  <strong>{project.displayName}</strong>
                  <small>
                    {project.available ? project.displayPath : "Unavailable"}
                  </small>
                </Link>
                {project.unreadCount > 0 && (
                  <span
                    className="unread-dot"
                    aria-label={`${String(project.unreadCount)} unread completion${project.unreadCount === 1 ? "" : "s"}`}
                  >
                    ●
                  </span>
                )}
                <button
                  className="icon-button"
                  aria-label={`New thread in ${project.displayName}`}
                  onClick={() => {
                    void navigate(`/projects/${project.id}/new`);
                  }}
                >
                  ＋
                </button>
                <button
                  className="icon-button hover-only"
                  aria-expanded={discoveringProjectId === project.id}
                  aria-label={`Import an existing session into ${project.displayName}`}
                  onClick={() => {
                    setDiscoveringProjectId((current) =>
                      current === project.id ? undefined : project.id,
                    );
                  }}
                >
                  ⇥
                </button>
                <button
                  className="icon-button danger hover-only"
                  aria-label={`Remove ${project.displayName}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${project.displayName} from navigation? Files and Pi history will not be deleted.`,
                      )
                    )
                      void removeProject(project.id).then(() =>
                        queryClient.invalidateQueries({
                          queryKey: ["workspace"],
                        }),
                      );
                  }}
                >
                  ×
                </button>
              </div>
              {project.sidebarExpanded && (
                <>
                  {discoveringProjectId === project.id && (
                    <section
                      className="session-import"
                      aria-label="Import existing session"
                    >
                      <strong>Import existing session</strong>
                      {sessions.isPending && (
                        <p className="muted">Finding sessions…</p>
                      )}
                      {sessions.error !== null && (
                        <ErrorNotice error={sessions.error} />
                      )}
                      {sessions.data?.diagnostics.map((diagnostic) => (
                        <p className="diagnostic warning" key={diagnostic}>
                          {diagnostic}
                        </p>
                      ))}
                      <ul>
                        {sessions.data?.sessions.map((session) => (
                          <li key={`${session.runtime}:${session.id}`}>
                            <span>{session.name ?? session.preview}</span>
                            {session.imported ? (
                              <small>Already imported</small>
                            ) : (
                              <button
                                type="button"
                                disabled={importSession.isPending}
                                onClick={() => {
                                  importSession.mutate({
                                    projectId: project.id,
                                    sessionId: session.id,
                                    runtime: session.runtime,
                                  });
                                }}
                              >
                                Import
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {importSession.error !== null && (
                        <ErrorNotice error={importSession.error} />
                      )}
                    </section>
                  )}
                  <ul className="thread-list">
                    {threads.map((thread) => {
                      const editing =
                        renamingThread?.projectId === project.id &&
                        renamingThread.threadId === thread.id;
                      const running = thread.runState === "running";
                      const openMenu = (left: number, top: number) => {
                        setThreadMenu({
                          projectId: project.id,
                          threadId: thread.id,
                          title: thread.title,
                          running,
                          left,
                          top,
                        });
                      };
                      return (
                        <li
                          key={thread.id}
                          className={`thread-row ${
                            selectedThreadId === thread.id
                              ? "selected-thread"
                              : ""
                          }`}
                          onContextMenu={(event) => {
                            if (editing) return;
                            event.preventDefault();
                            openMenu(event.clientX, event.clientY);
                          }}
                          onKeyDown={(event) => {
                            if (
                              editing ||
                              (event.key !== "ContextMenu" &&
                                !(event.shiftKey && event.key === "F10"))
                            )
                              return;
                            event.preventDefault();
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
                            openMenu(bounds.right + 6, bounds.top);
                          }}
                        >
                          {editing ? (
                            <ThreadRenameForm
                              key={`${thread.id}:${thread.title}`}
                              initialValue={thread.title}
                              label={`Rename ${thread.title}`}
                              onCommit={async (title) => {
                                await rename.mutateAsync({
                                  projectId: project.id,
                                  threadId: thread.id,
                                  title,
                                });
                              }}
                              onRevert={endRename}
                            />
                          ) : (
                            <>
                              <Link
                                className="thread-link"
                                to={`/projects/${project.id}/threads/${thread.id}`}
                                onClick={() => {
                                  setThreadMenu(null);
                                }}
                                onDoubleClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  beginRename({
                                    projectId: project.id,
                                    threadId: thread.id,
                                    title: thread.title,
                                  });
                                }}
                              >
                                {/* A title is the only text on this row the
                                    app did not write, and it may be RTL. In
                                    an LTR paragraph the server's trailing
                                    `…` is a neutral run at the end of the
                                    line, so the bidi algorithm hands it the
                                    paragraph direction and draws it to the
                                    RIGHT of a Hebrew or Arabic title --
                                    detached from the end of the text it
                                    truncates, where it reads as if it came
                                    first. `dir="auto"` gives the title its
                                    own base direction, taken from its first
                                    strong character, so the ellipsis stays
                                    at the logical end. It also stops an RTL
                                    title reordering the status glyph beside
                                    it. A no-op for every LTR title. */}
                                <span
                                  className="thread-title"
                                  dir="auto"
                                  title={`${thread.title} — Double-click to rename`}
                                >
                                  {thread.title}
                                </span>
                                {(() => {
                                  // Same four-way status (and the same
                                  // .sdot.{run|wait|done|fail} classes) as
                                  // the pane header, so the sidebar and the
                                  // panes read identically. A threadless or
                                  // never-run thread (runState null) shows
                                  // no status at all; otherwise fall back to
                                  // the plain unread-completion indicator.
                                  const runStatus = deriveRunStatus({
                                    runState: thread.runState,
                                  });
                                  return runStatus !== null ? (
                                    <span className="status">
                                      <span
                                        className={`sdot ${PANE_STATUS_TOKEN[runStatus]}`}
                                        aria-hidden="true"
                                      />
                                      <span className="sr-only">
                                        {PANE_STATUS_LABEL[runStatus]}
                                      </span>
                                    </span>
                                  ) : (
                                    <Status
                                      state={null}
                                      unread={thread.unread}
                                    />
                                  );
                                })()}
                              </Link>
                              <button
                                className="thread-actions-button"
                                type="button"
                                aria-label={`Actions for ${thread.title}`}
                                aria-haspopup="menu"
                                aria-expanded={
                                  threadMenu?.threadId === thread.id
                                }
                                title={`Actions for ${thread.title}`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const bounds =
                                    event.currentTarget.getBoundingClientRect();
                                  openMenu(bounds.right + 6, bounds.top);
                                }}
                              >
                                <span aria-hidden="true">…</span>
                              </button>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {/* Recovery surface for the one destructive thread action.
                      Collapsed by default and never fetched until opened, so
                      it costs nothing in the normal case. */}
                  <button
                    type="button"
                    className="archived-toggle"
                    aria-expanded={archivedProjectId === project.id}
                    aria-label={`Archived threads in ${project.displayName}`}
                    onClick={() => {
                      setArchivedProjectId((current) =>
                        current === project.id ? undefined : project.id,
                      );
                    }}
                  >
                    <span aria-hidden="true">
                      {archivedProjectId === project.id ? "▾" : "▸"}
                    </span>
                    Archived
                  </button>
                  {archivedProjectId === project.id && (
                    <section
                      className="archived-threads"
                      aria-label={`Archived threads in ${project.displayName}`}
                    >
                      {archivedThreads.isPending && (
                        <p className="muted">Loading archived threads…</p>
                      )}
                      {archivedThreads.error !== null && (
                        <ErrorNotice
                          error={archivedThreads.error}
                          onRetry={() => {
                            void archivedThreads.refetch();
                          }}
                        />
                      )}
                      {archivedThreads.data?.threads.length === 0 && (
                        <p className="empty">No archived threads.</p>
                      )}
                      <ul>
                        {archivedThreads.data?.threads.map((thread) => (
                          <li key={thread.id}>
                            <span
                              className="archived-title"
                              title={thread.title}
                            >
                              {thread.title}
                            </span>
                            <button
                              type="button"
                              aria-label={`Restore ${thread.title}`}
                              disabled={unarchive.isPending}
                              onClick={() => {
                                unarchive.mutate({
                                  projectId: project.id,
                                  threadId: thread.id,
                                  title: thread.title,
                                });
                              }}
                            >
                              Restore
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      {threadMenu !== null && (
        <div
          className="thread-context-menu"
          role="menu"
          aria-label={`Actions for ${threadMenu.title}`}
          ref={threadMenuRef}
          style={{ left: threadMenu.left, top: threadMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              beginRename({
                projectId: threadMenu.projectId,
                threadId: threadMenu.threadId,
                title: threadMenu.title,
              });
              setThreadMenu(null);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label={
              threadMenu.running
                ? "Archive (unavailable while running)"
                : "Archive"
            }
            disabled={threadMenu.running}
            title={
              threadMenu.running
                ? "Wait for this thread to finish before archiving it."
                : undefined
            }
            onClick={() => {
              requestArchive(
                threadMenu.projectId,
                threadMenu.threadId,
                threadMenu.title,
              );
            }}
          >
            Archive
          </button>
        </div>
      )}
      {workspace.data?.diagnostics.map((diagnostic) => (
        <p className="diagnostic warning" key={diagnostic}>
          {diagnostic}
        </p>
      ))}
      {pendingArchives.length > 0 && (
        <div className="undo-toast-stack">
          {pendingArchives.map((pending) => (
            // Keyed by thread: each staged archive owns its own countdown,
            // and each Undo names its thread so two stacked toasts are
            // distinguishable by pointer and by screen reader alike.
            <UndoToast
              key={pending.threadId}
              message={`Archived "${pending.title}"`}
              undoLabel={`Undo archiving "${pending.title}"`}
              onUndo={() => {
                cancelArchive(pending.threadId);
              }}
              onDismiss={() => {
                cancelArchive(pending.threadId);
                archive.mutate(pending);
              }}
            />
          ))}
        </div>
      )}
      <footer className="local-only">
        <span className="local-only-note">
          <span aria-hidden="true">⌂</span> Loopback-only server
        </span>
        <Link to="/settings" className="settings-link">
          Settings
        </Link>
      </footer>
    </nav>
  );
}

/**
 * The project's tiling surface plus the ONE workspace panel docked right of
 * it (WSP-01).
 *
 * The panel's tabs are durable and carry their own context (WSP-02), so
 * unlike the fixed strip it replaces, it does not follow the focused pane.
 * Focus is still an input, but only in two places: it decides which thread
 * the `+` menu opens tabs *for*, and whether a tab shows its worktree chip.
 */
function ProjectWorkspace({
  projectId,
  routeThreadId,
}: {
  projectId: ProjectId;
  routeThreadId?: ThreadId | undefined;
}) {
  const panel = usePanelState();
  // Seeded from the route so the first paint already knows which thread new
  // tabs would belong to; from then on the focused pane drives it.
  const [focusedThreadId, setFocusedThreadId] = useState<ThreadId | null>(
    routeThreadId ?? null,
  );
  // The focused thread's execution scope, which is all the panel needs from
  // the chat surface. ThreadPane owns its own copy of this query (and the
  // live subscription that keeps it fresh); this one exists to name a
  // worktree, which changes only when the focused thread does.
  const snapshot = useQuery({
    queryKey: ["snapshot", projectId, focusedThreadId],
    queryFn: async () => {
      if (focusedThreadId === null)
        throw new Error("No focused thread to open tabs against.");
      return await getSnapshot(projectId, focusedThreadId);
    },
    enabled: focusedThreadId !== null,
    placeholderData: keepPreviousData,
    // Restored after the port to the panel dropped it silently (D6). It is
    // usually redundant — ThreadPane holds the same key with the same
    // interval and the live subscription — but only while the focused
    // thread still has a pane mounted, and this query is what names the
    // worktree on a tab's chip. A chip is a claim about which worktree a tab
    // reads; it should not be able to go stale because a pane closed.
    refetchInterval: 15_000,
  });
  const focusedContext = useMemo(() => {
    const data = snapshot.data;
    if (data === undefined || focusedThreadId === null) return null;
    // keepPreviousData hands back the previously focused thread's snapshot
    // while the next one loads. Building a context from that would label a
    // tab with a worktree it does not read.
    if (data.thread.id !== focusedThreadId) return null;
    return threadTabContext(data.project, data.thread);
  }, [snapshot.data, focusedThreadId]);

  // D-1: a tab restored by the v1 inspector migration has no context of its
  // own. It adopts the focused pane's thread once, and is fixed from then on
  // like every other tab (WSP-02).
  const { bindPendingContexts } = panel.actions;
  useEffect(() => {
    if (focusedContext === null) return;
    bindPendingContexts(focusedContext);
  }, [focusedContext, bindPendingContexts]);

  return (
    <WorkspaceLayout
      selectedProjectId={projectId}
      // The sidebar highlights whatever the user is looking at, which is the
      // focused pane's thread — the route only seeds it.
      selectedThreadId={focusedThreadId ?? routeThreadId}
      panelOpen={panel.state.open}
      panelWidth={panel.state.width}
      onOpenPanel={() => {
        panel.actions.setOpen(true);
      }}
      onClosePanel={() => {
        panel.actions.setOpen(false);
      }}
      panel={
        <WorkspacePanel controller={panel} focusedContext={focusedContext} />
      }
    >
      <WorkspaceView
        projectId={projectId}
        onFocusedThreadChange={setFocusedThreadId}
      />
    </WorkspaceLayout>
  );
}

/**
 * `/projects/:id/new` and `/projects/:id/threads/:threadId` for ONE component,
 * because they are one surface under two entry instructions.
 *
 * They used to be two route components, and React reconciles by ELEMENT TYPE:
 * two types at the same position is an unmount and a mount, not an update. So
 * every crossing between those paths tore the whole workspace down and built
 * it again -- every pane's DOM replaced, every query refetched from cold, and
 * every piece of pane-local state reset. Measured in the running app: one
 * archive re-issued the workspace listing, the focused thread's snapshot and
 * the new-chat preflight, and replaced the pane element twice.
 *
 * The state that reset is the point. `ThreadPane` infers "archived" from the
 * thread's absence from the listing, LATCHED on having seen it there, so that
 * a brand-new thread cannot flash "Archived" before the listing catches up.
 * A remount puts that latch back to false. Archiving the focused thread
 * navigates across exactly this boundary, so the pane that had correctly said
 * "Archived" came back up saying the thread was live -- its title, a green
 * "Done", a working composer -- and stayed wrong for the 126ms until its
 * refetched snapshot returned 404. That is the second half of the reported
 * glitch, and it is the precise defect c9709f8 was written to remove.
 *
 * One component for both paths, so React updates the surface in place. The
 * thread id simply becomes absent on `/new`, which is what it means there.
 * Crossings WITHIN `/threads/:threadId` already behaved: same type, so the
 * surface was already preserved across a change of thread.
 */
function ProjectWorkspaceRoute() {
  const params = useParams();
  const location = useLocation();
  const projectResult = ProjectIdSchema.safeParse(params.projectId);
  if (!projectResult.success) return <NotFound />;
  // `/new` has no thread id at all; on the thread path an unparseable one is
  // not this route.
  if (params.threadId === undefined)
    return <ProjectWorkspace projectId={projectResult.data} />;
  const threadResult = ThreadIdSchema.safeParse(params.threadId);
  if (!threadResult.success) return <NotFound />;
  return (
    <ProjectWorkspace
      projectId={projectResult.data}
      routeThreadId={
        location.pathname.endsWith("/new") ? undefined : threadResult.data
      }
    />
  );
}

function ProjectRoute() {
  const params = useParams();
  const result = ProjectIdSchema.safeParse(params.projectId);
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
  });
  if (!result.success) return <NotFound />;
  if (workspace.isPending)
    return (
      <WorkspaceLayout selectedProjectId={result.data}>
        <Loading />
      </WorkspaceLayout>
    );
  const project = workspace.data?.projects.find(
    (candidate) => candidate.id === result.data,
  );
  if (project === undefined) return <NotFound />;
  const threads =
    workspace.data?.threads.filter(
      (thread) => thread.projectId === project.id,
    ) ?? [];
  const target =
    project.lastOpenedThreadId !== null &&
    threads.some((thread) => thread.id === project.lastOpenedThreadId)
      ? project.lastOpenedThreadId
      : threads[0]?.id;
  if (target !== undefined)
    return (
      <Navigate replace to={`/projects/${project.id}/threads/${target}`} />
    );
  return <ProjectWorkspace projectId={project.id} />;
}

function WorkspaceLayout({
  selectedProjectId,
  selectedThreadId,
  children,
  panel,
  panelOpen = false,
  panelWidth = PANEL_DEFAULT_WIDTH,
  onOpenPanel,
  onClosePanel,
}: {
  selectedProjectId?: ProjectId | undefined;
  selectedThreadId?: ThreadId | undefined;
  children?: ReactNode;
  // The whole docked column, rail included. Absent on the routes that have
  // no project to show one for.
  panel?: ReactNode;
  panelOpen?: boolean;
  panelWidth?: number;
  onOpenPanel?: () => void;
  onClosePanel?: () => void;
}) {
  const [drawer, setDrawer] = useState<"sidebar" | "panel" | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  // A width recorded on a wide monitor is read on a narrow one, so the
  // stored value is clamped against this viewport before it lays anything
  // out — the panel must never squash the chat surface out of the window.
  const effectivePanelWidth = clampPanelWidth(panelWidth, viewportWidth);
  useEffect(() => {
    const resized = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("resize", resized);
    };
  }, []);
  useEffect(() => {
    if (!panelOpen && drawer === "panel") setDrawer(null);
  }, [drawer, panelOpen]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || drawer === null) return;
      if (drawer === "panel") onClosePanel?.();
      setDrawer(null);
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
    };
  }, [drawer, onClosePanel]);
  const panelAvailable = panel !== undefined;
  const panelVisible = panelOpen && panelAvailable;
  return (
    <div
      className={`workspace ${panelAvailable ? "panel-available" : ""} ${panelVisible ? "panel-visible" : ""} ${panelAvailable && !panelVisible ? "panel-railed" : ""} ${drawer === "sidebar" ? "sidebar-open" : ""} ${drawer === "panel" ? "panel-open" : ""}`}
      style={
        {
          "--panel-width": `${String(effectivePanelWidth)}px`,
        } as CSSProperties
      }
    >
      {/* The toolbar sits ABOVE the drawers it opens (NEW-R3-6): it used to be
          covered by the sidebar the moment that sidebar slid in, leaving a
          visible, enabled control that could not be clicked and did not close
          what it had opened. Both buttons are toggles. */}
      <div className="mobile-toolbar">
        <button
          onClick={() => {
            setDrawer((current) => (current === "sidebar" ? null : "sidebar"));
          }}
          aria-expanded={drawer === "sidebar"}
          aria-label={
            drawer === "sidebar"
              ? "Close projects drawer"
              : "Open projects drawer"
          }
        >
          ☰ Projects
        </button>
        {panelAvailable && (
          <button
            onClick={() => {
              if (drawer === "panel") {
                onClosePanel?.();
                setDrawer(null);
                return;
              }
              onOpenPanel?.();
              setDrawer("panel");
            }}
            aria-expanded={drawer === "panel"}
            aria-label={
              drawer === "panel" ? "Close panel drawer" : "Open panel drawer"
            }
          >
            Panel <PanelRightIcon />
          </button>
        )}
      </div>
      <Sidebar
        selectedProjectId={selectedProjectId}
        selectedThreadId={selectedThreadId}
      />
      {children}
      {panel}
      {drawer !== null && (
        <button
          className="drawer-backdrop"
          aria-label="Close drawer"
          onClick={() => {
            if (drawer === "panel") onClosePanel?.();
            setDrawer(null);
          }}
        />
      )}
    </div>
  );
}
function NotFound() {
  return (
    <WorkspaceLayout>
      <main className="center project-empty">
        <h1>Workspace item not found</h1>
        <p>
          The project or thread may have been removed or the link is malformed.
        </p>
        <Link to="/">Return to projects</Link>
      </main>
    </WorkspaceLayout>
  );
}
function SettingsRoute() {
  return (
    <WorkspaceLayout>
      <SettingsPage />
    </WorkspaceLayout>
  );
}
function EmptyRoot() {
  return (
    <WorkspaceLayout>
      <main className="center welcome">
        <span className="hero-mark">π</span>
        <h1>Steer your coding agent</h1>
        <p>
          Add a local project, create a thread, and review Pi's work without
          leaving the workspace.
        </p>
      </main>
    </WorkspaceLayout>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<EmptyRoot />} />
      <Route path="/projects/:projectId" element={<ProjectRoute />} />
      <Route
        path="/projects/:projectId/new"
        element={<ProjectWorkspaceRoute />}
      />
      <Route
        path="/projects/:projectId/threads/:threadId/new"
        element={<ProjectWorkspaceRoute />}
      />
      <Route
        path="/projects/:projectId/threads/:threadId"
        element={<ProjectWorkspaceRoute />}
      />
      <Route path="/settings" element={<SettingsRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
