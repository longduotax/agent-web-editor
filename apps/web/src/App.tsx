import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
  type Project,
  type ProjectId,
  type ThreadId,
} from "@pi-web/contracts";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  archiveThread,
  browseProject,
  discoverSessions,
  getArchivedThreads,
  getDiff,
  getFile,
  getFiles,
  getSnapshot,
  getStatus,
  getWorkspace,
  importThread,
  removeProject,
  renameThread,
  setExpanded,
  unarchiveThread,
} from "./api/client.js";
import { summarizeChanges } from "./components/changesSummary.js";
import { classifyDiff } from "./components/diffLines.js";
import { useDebouncedValue } from "./components/useDebouncedValue.js";
import { ErrorNotice } from "./components/ErrorNotice.js";
import { Loading } from "./components/Loading.js";
import { Status } from "./components/Status.js";
import { TerminalView } from "./features/TerminalView.js";
import { SettingsPage } from "./features/settings/SettingsPage.js";
import { UndoToast } from "./features/workspace/UndoToast.js";
import { WorkspaceView } from "./features/workspace/WorkspaceView.js";
import {
  deriveRunStatus,
  PANE_STATUS_LABEL,
  PANE_STATUS_TOKEN,
} from "./features/workspace/runStatus.js";
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_TABS,
  readInspectorPreferences,
  writeInspectorPreferences,
  type InspectorPreferences,
  type InspectorTab,
} from "./inspectorPreferences.js";

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
    }: {
      projectId: ProjectId;
      sessionId: string;
    }) => await importThread(projectId, sessionId),
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
      if (selectedThreadId === variables.threadId)
        void navigate(`/projects/${variables.projectId}`);
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
      </div>
      {browse.error !== null && <ErrorNotice error={browse.error} />}
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
      {unarchive.error !== null && <ErrorNotice error={unarchive.error} />}
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
              ),
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
                    aria-label={`${String(project.unreadCount)} unread completions`}
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
                          <li key={session.id}>
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
                            openMenu(bounds.right, bounds.bottom);
                          }}
                        >
                          {editing ? (
                            <form
                              className="thread-rename"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const title = renamingThread.title.trim();
                                if (title !== "")
                                  rename.mutate({
                                    projectId: project.id,
                                    threadId: thread.id,
                                    title,
                                  });
                              }}
                            >
                              <input
                                aria-label={`Rename ${thread.title}`}
                                autoFocus
                                maxLength={200}
                                value={renamingThread.title}
                                onFocus={(event) => {
                                  event.currentTarget.select();
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== "Escape") return;
                                  event.stopPropagation();
                                  setRenamingThread(null);
                                }}
                                onChange={(event) => {
                                  setRenamingThread({
                                    ...renamingThread,
                                    title: event.target.value,
                                  });
                                }}
                              />
                              <button type="submit" disabled={rename.isPending}>
                                Save
                              </button>
                              <button
                                type="button"
                                disabled={rename.isPending}
                                onClick={() => {
                                  setRenamingThread(null);
                                }}
                              >
                                Cancel
                              </button>
                              {rename.error !== null && (
                                <ErrorNotice error={rename.error} />
                              )}
                            </form>
                          ) : (
                            <>
                              <Link
                                className="thread-link"
                                to={`/projects/${project.id}/threads/${thread.id}`}
                                onClick={() => {
                                  setThreadMenu(null);
                                }}
                              >
                                <span className="thread-title">
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
                                  openMenu(bounds.left, bounds.bottom);
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
              setRenamingThread({
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

// How many file rows the Files tab paints at once. The unsearched listing on
// a real repository is ~20,000 entries; rendering them all is what made the
// inspector slow to open and to scroll (NEW-R3-4).
const FILE_LIST_RENDER_LIMIT = 200;

const DESKTOP_SIDEBAR_WIDTH = 272;
const MIN_THREAD_WIDTH = 360;
const INSPECTOR_RESIZE_STEP = 24;

function PanelRightIcon() {
  return (
    <svg className="panel-right-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
      <path d="M9.25 2.75v10.5" />
    </svg>
  );
}

function inspectorMaxWidth(viewportWidth: number): number {
  return Math.min(
    INSPECTOR_MAX_WIDTH,
    Math.max(
      INSPECTOR_MIN_WIDTH,
      viewportWidth - DESKTOP_SIDEBAR_WIDTH - MIN_THREAD_WIDTH,
    ),
  );
}

// Added / removed / hunk-header lines are coloured from theme tokens. The
// `+`/`-` prefix characters stay in the text, so the distinction is never
// carried by colour alone.
function DiffText({ text }: { text: string }) {
  return (
    <pre className="diff-text">
      {classifyDiff(text).map((line, index) => (
        <span
          className={`diff-line diff-${line.kind}`}
          key={`${String(index)}:${line.text}`}
        >
          {line.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function Inspector({
  project,
  threadId,
  tab,
  width,
  onTabChange,
  onWidthChange,
  onClose,
  open,
}: {
  project: Project;
  threadId: ThreadId;
  tab: InspectorTab;
  width: number;
  onTabChange: (tab: InspectorTab) => void;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  open: boolean;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [resizing, setResizing] = useState(false);
  const resizingPointer = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const maxWidth = inspectorMaxWidth(viewportWidth);
  const effectiveWidth = Math.min(
    maxWidth,
    Math.max(INSPECTOR_MIN_WIDTH, width),
  );
  useEffect(() => {
    setSelectedPath(null);
    setSearch("");
  }, [threadId]);
  useEffect(() => {
    const resized = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("resize", resized);
    };
  }, []);
  const resizeFromClientX = (clientX: number) => {
    onWidthChange(
      Math.min(
        maxWidth,
        Math.max(INSPECTOR_MIN_WIDTH, Math.round(window.innerWidth - clientX)),
      ),
    );
  };
  const finishResize = (element: HTMLDivElement, pointerId: number) => {
    resizingPointer.current = null;
    if (
      typeof element.hasPointerCapture === "function" &&
      typeof element.releasePointerCapture === "function" &&
      element.hasPointerCapture(pointerId)
    )
      element.releasePointerCapture(pointerId);
    setResizing(false);
  };
  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | undefined;
    if (event.key === "ArrowLeft")
      nextWidth = effectiveWidth + INSPECTOR_RESIZE_STEP;
    if (event.key === "ArrowRight")
      nextWidth = effectiveWidth - INSPECTOR_RESIZE_STEP;
    if (event.key === "Home") nextWidth = INSPECTOR_MIN_WIDTH;
    if (event.key === "End") nextWidth = maxWidth;
    if (nextWidth === undefined) return;
    event.preventDefault();
    onWidthChange(Math.min(maxWidth, Math.max(INSPECTOR_MIN_WIDTH, nextWidth)));
  };
  const status = useQuery({
    queryKey: ["git", project.id, threadId],
    queryFn: () => getStatus(project.id, threadId),
    enabled: tab === "changes",
  });
  // Debounced + keepPreviousData: a full recursive listing takes hundreds of
  // milliseconds to seconds on a real repository, so a query per keystroke
  // both hammered the server and blanked the panel to "Listing files…"
  // between every character.
  const debouncedSearch = useDebouncedValue(search);
  const files = useQuery({
    queryKey: ["files", project.id, threadId, debouncedSearch],
    queryFn: () => getFiles(project.id, threadId, debouncedSearch),
    enabled: tab === "files",
    placeholderData: keepPreviousData,
  });
  const preview = useQuery({
    queryKey: ["file", project.id, threadId, selectedPath],
    queryFn: () => getFile(project.id, threadId, selectedPath ?? ""),
    enabled: tab === "files" && selectedPath !== null,
  });
  const diff = useQuery({
    queryKey: ["diff", project.id, threadId, selectedPath],
    queryFn: () => getDiff(project.id, threadId, selectedPath ?? ""),
    enabled: tab === "changes" && selectedPath !== null,
  });
  return (
    <aside
      className="inspector"
      aria-label="Project inspector"
      aria-hidden={!open}
      inert={!open}
    >
      <div
        className={`inspector-resizer ${resizing ? "resizing" : ""}`}
        role="separator"
        aria-label="Resize inspector panel"
        aria-orientation="vertical"
        aria-valuemin={INSPECTOR_MIN_WIDTH}
        aria-valuemax={maxWidth}
        aria-valuenow={effectiveWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          resizingPointer.current = event.pointerId;
          if (typeof event.currentTarget.setPointerCapture === "function")
            event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (resizingPointer.current === event.pointerId)
            resizeFromClientX(event.clientX);
        }}
        onPointerUp={(event) => {
          finishResize(event.currentTarget, event.pointerId);
        }}
        onPointerCancel={(event) => {
          finishResize(event.currentTarget, event.pointerId);
        }}
        onKeyDown={resizeWithKeyboard}
      />
      <div className="inspector-tabs">
        <div className="inspector-tab-options" role="tablist">
          {INSPECTOR_TABS.map((name) => (
            <button
              id={`inspector-tab-${name}`}
              role="tab"
              aria-controls="inspector-content"
              aria-selected={tab === name}
              key={name}
              onClick={() => {
                onTabChange(name);
                setSelectedPath(null);
              }}
            >
              {name[0]?.toUpperCase()}
              {name.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="inspector-close"
          aria-label="Close inspector panel"
          title="Close inspector"
          onClick={onClose}
        >
          <PanelRightIcon />
        </button>
      </div>
      <div
        id="inspector-content"
        className="inspector-content"
        role="tabpanel"
        aria-labelledby={`inspector-tab-${tab}`}
      >
        {tab === "changes" && (
          <>
            <p className="scope-note">
              Current thread workspace
              {status.data?.available === true &&
                status.data.files.length > 0 &&
                ` · ${summarizeChanges(status.data.files)}`}
            </p>
            {status.isPending && (
              <p className="panel-state" aria-live="polite">
                Reading the worktree…
              </p>
            )}
            {status.data?.available === false && (
              <div className="empty">{status.data.message}</div>
            )}
            {status.data?.available === true &&
              status.data.files.length === 0 && (
                <div className="empty">No changes in this worktree.</div>
              )}
            <ul className="file-list">
              {status.data?.files.map((file) => (
                <li key={file.path}>
                  <button
                    onClick={() => {
                      setSelectedPath(file.path);
                    }}
                    className={selectedPath === file.path ? "active" : ""}
                  >
                    <span className={`change-kind ${file.kind}`}>
                      {file.kind[0]?.toUpperCase()}
                    </span>
                    <span>{file.path}</span>
                  </button>
                </li>
              ))}
            </ul>
            {(status.data?.files.length ?? 0) > 0 && selectedPath === null && (
              <p className="panel-state">Select a file to view its diff.</p>
            )}
            {diff.isPending && selectedPath !== null && (
              <p className="panel-state" aria-live="polite">
                Loading diff…
              </p>
            )}
            {diff.data !== undefined && (
              <div className="diff-view">
                <header>
                  {diff.data.path}
                  {diff.data.truncated && " · truncated"}
                </header>
                {diff.data.staged !== "" && (
                  <>
                    <h4>Staged</h4>
                    <DiffText text={diff.data.staged} />
                  </>
                )}
                {diff.data.unstaged !== "" && (
                  <>
                    <h4>Unstaged</h4>
                    <DiffText text={diff.data.unstaged} />
                  </>
                )}
              </div>
            )}
            {status.error !== null && (
              <ErrorNotice
                error={status.error}
                onRetry={() => {
                  void status.refetch();
                }}
              />
            )}
            {diff.error !== null && (
              <ErrorNotice
                error={diff.error}
                onRetry={() => {
                  void diff.refetch();
                }}
              />
            )}
          </>
        )}
        {tab === "files" && (
          <>
            <input
              className="file-search"
              aria-label="Search project files"
              placeholder="Search files…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
            {files.isPending && (
              <p className="panel-state" aria-live="polite">
                Listing files…
              </p>
            )}
            {files.data?.entries.length === 0 && (
              <div className="empty">
                {/* Named for the query the RESULT belongs to, not the
                    keystroke in flight. */}
                {debouncedSearch === ""
                  ? "No files in this workspace."
                  : `No files match "${debouncedSearch}".`}
              </div>
            )}
            {/* Rendered rows are capped (NEW-R3-4). The server returns the
                whole recursive listing -- 20,000 entries on this repo, node_
                modules included -- and painting all of them as real DOM made
                the first paint and every subsequent scroll of the inspector
                visibly slow. The cap is a render budget, not a filter: the
                count below always names the true total and points at search,
                which narrows the result on the server. */}
            <ul className="file-list">
              {files.data?.entries
                .slice(0, FILE_LIST_RENDER_LIMIT)
                .map((file) => (
                  <li key={file.path}>
                    <button
                      disabled={file.kind !== "file" && file.kind !== "symlink"}
                      onClick={() => {
                        setSelectedPath(file.path);
                      }}
                    >
                      <span aria-hidden="true">
                        {file.kind === "directory" ? "▸" : "·"}
                      </span>
                      <span>{file.path}</span>
                    </button>
                  </li>
                ))}
            </ul>
            {(files.data?.entries.length ?? 0) > FILE_LIST_RENDER_LIMIT && (
              <p className="panel-state" aria-live="polite">
                {`Showing the first ${String(FILE_LIST_RENDER_LIMIT)} of ${String(files.data?.entries.length ?? 0)} files. Search to narrow the list.`}
              </p>
            )}
            {(files.data?.entries.length ?? 0) > 0 && selectedPath === null && (
              <p className="panel-state">Select a file to preview it.</p>
            )}
            {preview.data !== undefined && (
              <div className="file-preview">
                <header>
                  <span>{preview.data.path}</span>
                  <button
                    onClick={() =>
                      void navigator.clipboard.writeText(preview.data.path)
                    }
                  >
                    Copy path
                  </button>
                  <button
                    disabled={preview.data.binary}
                    onClick={() =>
                      void navigator.clipboard.writeText(preview.data.content)
                    }
                  >
                    Copy
                  </button>
                </header>
                {preview.data.binary ? (
                  <p>Binary file preview is unavailable.</p>
                ) : (
                  <pre>{preview.data.content}</pre>
                )}
              </div>
            )}
            {files.error !== null && (
              <ErrorNotice
                error={files.error}
                onRetry={() => {
                  void files.refetch();
                }}
              />
            )}
            {preview.error !== null && (
              <ErrorNotice
                error={preview.error}
                onRetry={() => {
                  void preview.refetch();
                }}
              />
            )}
          </>
        )}
        {tab === "terminal" && (
          <TerminalView projectId={project.id} threadId={threadId} />
        )}
      </div>
    </aside>
  );
}

/**
 * The project's tiling surface plus the ONE workspace inspector docked right
 * of it (CWS-06).
 *
 * The inspector follows the **focused pane**, never the URL. A route can
 * address at most one thread, but the surface can hold several panes at once
 * (and, on `/new`, none that own a thread yet); deriving the inspector from
 * `useParams().threadId` meant it showed a thread the user was not looking
 * at, or disappeared entirely while a perfectly inspectable pane was
 * focused. `WorkspaceView` reports whichever thread its focused pane owns —
 * `null` for a threadless pane or an empty surface — and that is the single
 * source of truth for what the inspector shows.
 */
function ProjectWorkspace({
  projectId,
  routeThreadId,
}: {
  projectId: ProjectId;
  routeThreadId?: ThreadId | undefined;
}) {
  const [inspectorPreferences, setInspectorPreferences] =
    useState<InspectorPreferences>(readInspectorPreferences);
  useEffect(() => {
    writeInspectorPreferences(inspectorPreferences);
  }, [inspectorPreferences]);
  // Seeded from the route so the first paint already has the right workspace
  // when the surface opens on the addressed thread; from then on the focused
  // pane drives it.
  const [focusedThreadId, setFocusedThreadId] = useState<ThreadId | null>(
    routeThreadId ?? null,
  );
  const updateInspectorPreferences = (
    update: Partial<Omit<InspectorPreferences, "version">>,
  ) => {
    setInspectorPreferences((current) => ({ ...current, ...update }));
  };
  // Kept only for the Inspector, which needs the project record and to know
  // whether a snapshot is available; ThreadPane owns its own copy of this
  // query (and the live-update subscription that keeps it fresh) so it stays
  // self-contained. keepPreviousData means moving focus between two thread
  // panes swaps the inspector's contents instead of tearing the whole column
  // down and rebuilding it.
  const snapshot = useQuery({
    queryKey: ["snapshot", projectId, focusedThreadId],
    queryFn: async () => {
      if (focusedThreadId === null)
        throw new Error("No focused thread to inspect.");
      return await getSnapshot(projectId, focusedThreadId);
    },
    enabled: focusedThreadId !== null,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const inspectable = focusedThreadId !== null && snapshot.data !== undefined;
  return (
    <WorkspaceLayout
      selectedProjectId={projectId}
      // The sidebar highlights whatever the user is looking at, which is the
      // focused pane's thread — the route only seeds it.
      selectedThreadId={focusedThreadId ?? routeThreadId}
      inspectorAvailable={inspectable}
      inspectorOpen={inspectorPreferences.open}
      inspectorWidth={inspectorPreferences.width}
      onOpenInspector={() => {
        updateInspectorPreferences({ open: true });
      }}
      onCloseInspector={() => {
        updateInspectorPreferences({ open: false });
      }}
      inspector={
        inspectable ? (
          <Inspector
            // Remount on a thread change so the tab's selected file, search
            // box and in-flight queries never leak across panes.
            key={focusedThreadId}
            project={snapshot.data.project}
            threadId={focusedThreadId}
            tab={inspectorPreferences.activeTab}
            width={inspectorPreferences.width}
            onTabChange={(activeTab) => {
              updateInspectorPreferences({ activeTab });
            }}
            onWidthChange={(width) => {
              updateInspectorPreferences({ width });
            }}
            onClose={() => {
              updateInspectorPreferences({ open: false });
            }}
            open={inspectorPreferences.open}
          />
        ) : undefined
      }
    >
      <WorkspaceView
        projectId={projectId}
        onFocusedThreadChange={setFocusedThreadId}
      />
    </WorkspaceLayout>
  );
}

function NewChatRoute() {
  const params = useParams();
  const projectResult = ProjectIdSchema.safeParse(params.projectId);
  if (!projectResult.success) return <NotFound />;
  return <ProjectWorkspace projectId={projectResult.data} />;
}

function ThreadRoute() {
  const params = useParams();
  const projectResult = ProjectIdSchema.safeParse(params.projectId);
  const threadResult = ThreadIdSchema.safeParse(params.threadId);
  if (!projectResult.success || !threadResult.success) return <NotFound />;
  return (
    <ProjectWorkspace
      projectId={projectResult.data}
      routeThreadId={threadResult.data}
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
  inspector,
  inspectorAvailable = false,
  inspectorOpen = false,
  inspectorWidth = 400,
  onOpenInspector,
  onCloseInspector,
}: {
  selectedProjectId?: ProjectId | undefined;
  selectedThreadId?: ThreadId | undefined;
  children?: ReactNode;
  inspector?: ReactNode;
  inspectorAvailable?: boolean;
  inspectorOpen?: boolean;
  inspectorWidth?: number;
  onOpenInspector?: () => void;
  onCloseInspector?: () => void;
}) {
  const [drawer, setDrawer] = useState<"sidebar" | "inspector" | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const effectiveInspectorWidth = Math.min(
    inspectorMaxWidth(viewportWidth),
    Math.max(INSPECTOR_MIN_WIDTH, inspectorWidth),
  );
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
    if (!inspectorOpen && drawer === "inspector") setDrawer(null);
  }, [drawer, inspectorOpen]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || drawer === null) return;
      if (drawer === "inspector") onCloseInspector?.();
      setDrawer(null);
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
    };
  }, [drawer, onCloseInspector]);
  const inspectorVisible = inspectorOpen && inspector !== undefined;
  return (
    <div
      className={`workspace ${inspector !== undefined ? "inspector-available" : ""} ${inspectorVisible ? "inspector-visible" : ""} ${inspectorAvailable && !inspectorVisible ? "inspector-railed" : ""} ${drawer === "sidebar" ? "sidebar-open" : ""} ${drawer === "inspector" ? "inspector-open" : ""}`}
      style={
        {
          "--inspector-width": `${String(effectiveInspectorWidth)}px`,
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
        {inspectorAvailable && (
          <button
            onClick={() => {
              if (drawer === "inspector") {
                onCloseInspector?.();
                setDrawer(null);
                return;
              }
              onOpenInspector?.();
              setDrawer("inspector");
            }}
            aria-expanded={drawer === "inspector"}
            aria-label={
              drawer === "inspector"
                ? "Close inspector drawer"
                : "Open inspector drawer"
            }
          >
            Inspector <PanelRightIcon />
          </button>
        )}
      </div>
      <Sidebar
        selectedProjectId={selectedProjectId}
        selectedThreadId={selectedThreadId}
      />
      {children}
      {inspector}
      {inspectorAvailable && !inspectorVisible && (
        <div className="inspector-rail">
          <div className="inspector-rail-head">
            <button
              type="button"
              className="inspector-reopen"
              aria-label="Open inspector panel"
              title="Open inspector"
              onClick={onOpenInspector}
            >
              <PanelRightIcon />
            </button>
          </div>
        </div>
      )}
      {drawer !== null && (
        <button
          className="drawer-backdrop"
          aria-label="Close drawer"
          onClick={() => {
            if (drawer === "inspector") onCloseInspector?.();
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
      <Route path="/projects/:projectId/new" element={<NewChatRoute />} />
      <Route
        path="/projects/:projectId/threads/:threadId"
        element={<ThreadRoute />}
      />
      <Route path="/settings" element={<SettingsRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
