import {
  useEffect,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LiveEventSchema,
  LiveSnapshotRequiredSchema,
  ProjectIdSchema,
  ThreadIdSchema,
  type Project,
  type ProjectId,
  type ThreadId,
  type ThreadSnapshot,
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
  browseProject,
  createThread,
  discoverSessions,
  getDiff,
  getFile,
  getFiles,
  getSnapshot,
  getStatus,
  getWorkspace,
  importThread,
  markViewed,
  prompt,
  removeProject,
  renameThread,
  setExpanded,
  steer,
  stop,
  webSocketUrl,
} from "./api/client.js";
import { Activity, displayTranscript } from "./components/Activity.js";
import { Markdown } from "./components/Markdown.js";
import { Status } from "./components/Status.js";
import { TerminalView } from "./features/TerminalView.js";

function ErrorNotice({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div className="error-notice" role="alert">
      {message}
    </div>
  );
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
  const create = useMutation({
    mutationFn: createThread,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void navigate(
        `/projects/${result.thread.projectId}/threads/${result.thread.id}`,
      );
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
                    create.mutate(project.id);
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
                      return (
                        <li
                          key={thread.id}
                          className={
                            selectedThreadId === thread.id
                              ? "selected-thread"
                              : ""
                          }
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
                                to={`/projects/${project.id}/threads/${thread.id}`}
                              >
                                <span>{thread.title}</span>
                                <Status
                                  state={thread.runState}
                                  unread={thread.unread}
                                />
                              </Link>
                              <button
                                className="icon-button"
                                aria-label={`Rename ${thread.title}`}
                                onClick={() => {
                                  setRenamingThread({
                                    projectId: project.id,
                                    threadId: thread.id,
                                    title: thread.title,
                                  });
                                }}
                              >
                                ✎
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
      <footer className="local-only">
        <span aria-hidden="true">⌂</span> Loopback-only server
      </footer>
    </nav>
  );
}

function useLive(
  projectId: ProjectId,
  threadId: ThreadId,
  snapshot: ThreadSnapshot | undefined,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (snapshot === undefined) return;
    let closed = false;
    let retry: number | undefined;
    let socket: WebSocket | undefined;
    const connect = () => {
      socket = new WebSocket(webSocketUrl("/api/live"));
      socket.addEventListener("open", () =>
        socket?.send(
          JSON.stringify({
            version: 1,
            type: "subscribe",
            threadId,
            epoch: snapshot.epoch,
            cursor: snapshot.highWaterSequence,
          }),
        ),
      );
      socket.addEventListener("message", (event) => {
        let value: unknown;
        try {
          value = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (
          LiveEventSchema.safeParse(value).success ||
          LiveSnapshotRequiredSchema.safeParse(value).success
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["snapshot", projectId, threadId],
          });
          void queryClient.invalidateQueries({ queryKey: ["workspace"] });
        }
      });
      socket.addEventListener("close", () => {
        if (!closed) retry = window.setTimeout(connect, 1_000);
      });
    };
    connect();
    return () => {
      closed = true;
      if (retry !== undefined) clearTimeout(retry);
      socket?.close();
    };
  }, [
    projectId,
    queryClient,
    snapshot?.epoch,
    snapshot?.highWaterSequence,
    threadId,
  ]);
}

function Transcript({ snapshot }: { snapshot: ThreadSnapshot }) {
  return (
    <div className="transcript" aria-label="Conversation">
      {snapshot.transcript.length === 0 && (
        <div className="empty conversation-empty">
          <strong>No messages yet</strong>
          <span>
            Ask Pi to inspect, implement, or review something in this project.
          </span>
        </div>
      )}
      {displayTranscript(snapshot.transcript).map((item) =>
        item.kind === "message" ? (
          <article className={`message message-${item.role}`} key={item.id}>
            <header>
              {item.role === "assistant"
                ? "Pi"
                : item.role === "user"
                  ? "You"
                  : "System"}
            </header>
            <div className="markdown">
              <Markdown>{item.text}</Markdown>
            </div>
          </article>
        ) : item.kind === "tool" ? (
          <Activity
            item={item}
            key={item.id}
            projectPath={snapshot.project.displayPath}
          />
        ) : (
          <p className={`diagnostic ${item.level}`} key={item.id}>
            {item.text}
          </p>
        ),
      )}
      {snapshot.diagnostics.map((diagnostic) => (
        <p className="diagnostic warning" key={diagnostic}>
          {diagnostic}
        </p>
      ))}
    </div>
  );
}

export function Composer({
  projectId,
  threadId,
  snapshot,
}: {
  projectId: ProjectId;
  threadId: ThreadId;
  snapshot: ThreadSnapshot;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(
    () => localStorage.getItem(`pi-draft:${threadId}`) ?? "",
  );
  const active = snapshot.currentRun?.state === "running";
  const mutation = useMutation({
    mutationFn: async () =>
      active
        ? await steer(projectId, threadId, text)
        : await prompt(projectId, threadId, text),
    onSuccess: async () => {
      setText("");
      localStorage.removeItem(`pi-draft:${threadId}`);
      await queryClient.invalidateQueries({
        queryKey: ["snapshot", projectId, threadId],
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });
  useEffect(() => {
    localStorage.setItem(`pi-draft:${threadId}`, text);
  }, [text, threadId]);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === "") return;
    mutation.mutate();
  };
  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-input">
        <textarea
          aria-label="Message Pi"
          placeholder="Ask Pi to work in this project…"
          rows={3}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.nativeEvent.isComposing
            )
              return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="composer-actions">
          <span>Enter to send · Shift + Enter for a new line</span>
          {active && (
            <button
              type="button"
              className="stop"
              onClick={() =>
                void stop(projectId, threadId).then(() =>
                  queryClient.invalidateQueries({
                    queryKey: ["snapshot", projectId, threadId],
                  }),
                )
              }
            >
              ■ Stop
            </button>
          )}
          <button
            type="submit"
            className="send"
            aria-label={active ? "Steer current run" : "Send message"}
            title={active ? "Steer current run" : "Send message"}
            disabled={mutation.isPending || text.trim() === ""}
          >
            <span aria-hidden="true">↑</span>
          </button>
        </div>
      </div>
      {mutation.error !== null && <ErrorNotice error={mutation.error} />}
    </form>
  );
}

function Inspector({ project }: { project: Project }) {
  const [tab, setTab] = useState<"changes" | "files" | "terminal">("changes");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const status = useQuery({
    queryKey: ["git", project.id],
    queryFn: () => getStatus(project.id),
    enabled: tab === "changes",
  });
  const files = useQuery({
    queryKey: ["files", project.id, search],
    queryFn: () => getFiles(project.id, search),
    enabled: tab === "files",
  });
  const preview = useQuery({
    queryKey: ["file", project.id, selectedPath],
    queryFn: () => getFile(project.id, selectedPath ?? ""),
    enabled: tab === "files" && selectedPath !== null,
  });
  const diff = useQuery({
    queryKey: ["diff", project.id, selectedPath],
    queryFn: () => getDiff(project.id, selectedPath ?? ""),
    enabled: tab === "changes" && selectedPath !== null,
  });
  return (
    <aside className="inspector" aria-label="Project inspector">
      <div className="inspector-tabs" role="tablist">
        {(["changes", "files", "terminal"] as const).map((name) => (
          <button
            role="tab"
            aria-selected={tab === name}
            key={name}
            onClick={() => {
              setTab(name);
              setSelectedPath(null);
            }}
          >
            {name[0]?.toUpperCase()}
            {name.slice(1)}
          </button>
        ))}
      </div>
      <div className="inspector-content">
        {tab === "changes" && (
          <>
            <p className="scope-note">Current project-wide working tree</p>
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
        {tab === "terminal" && <TerminalView projectId={project.id} />}
      </div>
    </aside>
  );
}

function ThreadRoute() {
  const params = useParams();
  const projectResult = ProjectIdSchema.safeParse(params.projectId);
  const threadResult = ThreadIdSchema.safeParse(params.threadId);
  if (!projectResult.success || !threadResult.success) return <NotFound />;
  const projectId = projectResult.data;
  const threadId = threadResult.data;
  const snapshot = useQuery({
    queryKey: ["snapshot", projectId, threadId],
    queryFn: () => getSnapshot(projectId, threadId),
    refetchInterval: 15_000,
  });
  useLive(projectId, threadId, snapshot.data);
  useEffect(() => {
    const lastRun = snapshot.data?.lastRun;
    if (snapshot.data?.thread.unread === true && lastRun?.state === "completed")
      void markViewed(projectId, threadId, lastRun.id);
  }, [
    projectId,
    snapshot.data?.lastRun,
    snapshot.data?.thread.unread,
    threadId,
  ]);
  return (
    <WorkspaceLayout selectedProjectId={projectId} selectedThreadId={threadId}>
      {snapshot.isPending ? (
        <Loading />
      ) : snapshot.error !== null ? (
        <main className="center">
          <ErrorNotice error={snapshot.error} />
        </main>
      ) : (
        <>
          <main className="center">
            <header className="thread-header">
              <div>
                <small>{snapshot.data.project.displayName}</small>
                <h1>{snapshot.data.thread.title}</h1>
              </div>
              <Status
                state={
                  snapshot.data.currentRun?.state ??
                  snapshot.data.lastRun?.state ??
                  null
                }
                unread={snapshot.data.thread.unread}
              />
            </header>
            <div className="trust-warning">
              <strong>Direct execution:</strong> Pi tools run with your user
              permissions, without application approval or an OS sandbox.
            </div>
            <Transcript snapshot={snapshot.data} />
            <Composer
              projectId={projectId}
              threadId={threadId}
              snapshot={snapshot.data}
            />
          </main>
          <Inspector project={snapshot.data.project} />
        </>
      )}
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
      <main className="center project-empty">
        <h1>{project.displayName}</h1>
        <p>Create a thread using the + button beside the project.</p>
      </main>
      <Inspector project={project} />
    </WorkspaceLayout>
  );
}

function WorkspaceLayout({
  selectedProjectId,
  selectedThreadId,
  children,
}: {
  selectedProjectId?: ProjectId | undefined;
  selectedThreadId?: ThreadId | undefined;
  children?: ReactNode;
}) {
  const [drawer, setDrawer] = useState<"sidebar" | "inspector" | null>(null);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <div
      className={`workspace ${drawer === "sidebar" ? "sidebar-open" : ""} ${drawer === "inspector" ? "inspector-open" : ""}`}
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
        <button
          onClick={() => {
            setDrawer("inspector");
          }}
          aria-label="Open inspector drawer"
        >
          Inspector ⓘ
        </button>
      </div>
      <Sidebar
        selectedProjectId={selectedProjectId}
        selectedThreadId={selectedThreadId}
      />
      {children}
      {drawer !== null && (
        <button
          className="drawer-backdrop"
          aria-label="Close drawer"
          onClick={() => {
            setDrawer(null);
          }}
        />
      )}
    </div>
  );
}
function Loading() {
  return (
    <main className="center loading" aria-live="polite">
      Loading workspace…
    </main>
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
        path="/projects/:projectId/threads/:threadId"
        element={<ThreadRoute />}
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
