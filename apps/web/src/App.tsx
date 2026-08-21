import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "./api/client.js";
import { ErrorNotice } from "./components/ErrorNotice.js";
import { Loading } from "./components/Loading.js";
import { Status } from "./components/Status.js";
import { TerminalView } from "./features/TerminalView.js";
import { SettingsPage } from "./features/settings/SettingsPage.js";
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
  const archive = useMutation({
    mutationFn: async ({
      projectId,
      threadId,
    }: {
      projectId: ProjectId;
      threadId: ThreadId;
    }) => await archiveThread(projectId, threadId),
    onSuccess: async (_result, variables) => {
      setThreadMenu(null);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      if (selectedThreadId === variables.threadId)
        void navigate(`/projects/${variables.projectId}`);
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
    onSuccess: async () => {
      setRenamingThread(null);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
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

  const requestArchive = (projectId: ProjectId, threadId: ThreadId) => {
    setThreadMenu(null);
    archive.mutate({ projectId, threadId });
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
      {archive.error !== null && <ErrorNotice error={archive.error} />}
      <div className="project-list">
        {workspace.isPending && <p className="muted">Loading projects…</p>}
        {workspace.data?.projects.length === 0 && (
          <p className="empty">
            No projects yet. Add a local directory to begin.
          </p>
        )}
        {workspace.data?.projects.map((project) => {
          const threads = workspace.data.threads.filter(
            (thread) => thread.projectId === project.id,
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
                  className="icon-button"
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
                  className="icon-button danger"
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
                                className="thread-archive-button"
                                type="button"
                                aria-label={
                                  running
                                    ? `Archive ${thread.title} (unavailable while running)`
                                    : `Archive ${thread.title}`
                                }
                                disabled={running || archive.isPending}
                                title={
                                  running
                                    ? "Wait for this thread to finish before archiving it."
                                    : `Archive ${thread.title}`
                                }
                                onClick={() => {
                                  requestArchive(project.id, thread.id);
                                }}
                              >
                                <svg
                                  aria-hidden="true"
                                  viewBox="0 0 16 16"
                                  width="14"
                                  height="14"
                                >
                                  <path d="M2.25 3.25h11.5v2.5H2.25zM3.5 6.75h9v6h-9zM6 8.25h4" />
                                </svg>
                              </button>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
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
            disabled={threadMenu.running || archive.isPending}
            title={
              threadMenu.running
                ? "Wait for this thread to finish before archiving it."
                : undefined
            }
            onClick={() => {
              requestArchive(threadMenu.projectId, threadMenu.threadId);
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
  const files = useQuery({
    queryKey: ["files", project.id, threadId, search],
    queryFn: () => getFiles(project.id, threadId, search),
    enabled: tab === "files",
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
            <p className="scope-note">Current thread workspace</p>
            {status.data?.available === false && (
              <div className="empty">{status.data.message}</div>
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
            {diff.data !== undefined && (
              <div className="diff-view">
                <header>
                  {diff.data.path}
                  {diff.data.truncated && " · truncated"}
                </header>
                {diff.data.staged !== "" && (
                  <>
                    <h4>Staged</h4>
                    <pre>{diff.data.staged}</pre>
                  </>
                )}
                {diff.data.unstaged !== "" && (
                  <>
                    <h4>Unstaged</h4>
                    <pre>{diff.data.unstaged}</pre>
                  </>
                )}
              </div>
            )}
            {(status.error ?? diff.error) !== null && (
              <ErrorNotice error={status.error ?? diff.error} />
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
            <ul className="file-list">
              {files.data?.entries.map((file) => (
                <li key={file.path}>
                  <button
                    disabled={file.kind !== "file" && file.kind !== "symlink"}
                    onClick={() => {
                      setSelectedPath(file.path);
                    }}
                  >
                    <span>{file.kind === "directory" ? "▸" : "·"}</span>
                    <span>{file.path}</span>
                  </button>
                </li>
              ))}
            </ul>
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
            {(files.error ?? preview.error) !== null && (
              <ErrorNotice error={files.error ?? preview.error} />
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

function NewChatRoute() {
  const params = useParams();
  const projectResult = ProjectIdSchema.safeParse(params.projectId);
  if (!projectResult.success) return <NotFound />;
  const projectId = projectResult.data;
  return (
    <WorkspaceLayout selectedProjectId={projectId}>
      <WorkspaceView projectId={projectId} />
    </WorkspaceLayout>
  );
}

function ThreadRoute() {
  const params = useParams();
  const projectResult = ProjectIdSchema.safeParse(params.projectId);
  const threadResult = ThreadIdSchema.safeParse(params.threadId);
  const [inspectorPreferences, setInspectorPreferences] =
    useState<InspectorPreferences>(readInspectorPreferences);
  useEffect(() => {
    writeInspectorPreferences(inspectorPreferences);
  }, [inspectorPreferences]);
  if (!projectResult.success || !threadResult.success) return <NotFound />;
  const projectId = projectResult.data;
  const threadId = threadResult.data;
  const updateInspectorPreferences = (
    update: Partial<Omit<InspectorPreferences, "version">>,
  ) => {
    setInspectorPreferences((current) => ({ ...current, ...update }));
  };
  // Kept only for the Inspector, which needs the project record and to know
  // whether a snapshot is available; ThreadPane owns its own copy of this
  // query (and the live-update subscription that keeps it fresh) so it stays
  // self-contained.
  const snapshot = useQuery({
    queryKey: ["snapshot", projectId, threadId],
    queryFn: () => getSnapshot(projectId, threadId),
    refetchInterval: 15_000,
  });
  return (
    <WorkspaceLayout
      selectedProjectId={projectId}
      selectedThreadId={threadId}
      inspectorAvailable={snapshot.data !== undefined}
      inspectorOpen={inspectorPreferences.open}
      inspectorWidth={inspectorPreferences.width}
      onOpenInspector={() => {
        updateInspectorPreferences({ open: true });
      }}
      onCloseInspector={() => {
        updateInspectorPreferences({ open: false });
      }}
      inspector={
        snapshot.data !== undefined ? (
          <Inspector
            project={snapshot.data.project}
            threadId={threadId}
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
      <WorkspaceView projectId={projectId} />
    </WorkspaceLayout>
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
  return (
    <WorkspaceLayout selectedProjectId={project.id}>
      <WorkspaceView projectId={project.id} />
    </WorkspaceLayout>
  );
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
      className={`workspace ${inspector !== undefined ? "inspector-available" : ""} ${inspectorVisible ? "inspector-visible" : ""} ${drawer === "sidebar" ? "sidebar-open" : ""} ${drawer === "inspector" ? "inspector-open" : ""}`}
      style={
        {
          "--inspector-width": `${String(effectiveInspectorWidth)}px`,
        } as CSSProperties
      }
    >
      <div className="mobile-toolbar">
        <button
          onClick={() => {
            setDrawer("sidebar");
          }}
          aria-label="Open projects drawer"
        >
          ☰ Projects
        </button>
        {inspectorAvailable && (
          <button
            onClick={() => {
              onOpenInspector?.();
              setDrawer("inspector");
            }}
            aria-label="Open inspector drawer"
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
        <button
          type="button"
          className="inspector-reopen"
          aria-label="Open inspector panel"
          title="Open inspector"
          onClick={onOpenInspector}
        >
          <PanelRightIcon />
        </button>
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
