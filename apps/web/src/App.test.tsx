// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";
import type {
  ProjectId,
  RunId,
  ThreadId,
  ThreadSnapshot,
} from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  archiveThread: vi.fn(),
  unarchiveThread: vi.fn(),
  getArchivedThreads: vi.fn(),
  discoverSessions: vi.fn(),
  getFiles: vi.fn(),
  getSnapshot: vi.fn(),
  getStatus: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspacePreflight: vi.fn(),
  importThread: vi.fn(),
  markViewed: vi.fn(),
  prompt: vi.fn(),
  renameThread: vi.fn(),
  startThread: vi.fn(),
  steer: vi.fn(),
}));

vi.mock("./api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("./api/client.js")>();
  return { ...client, ...api };
});

import { Markdown } from "./components/Markdown.js";
import { Status } from "./components/Status.js";
import { App, Composer } from "./App.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("safe and accessible workspace rendering", () => {
  it("renders the workspace immediately without an authentication screen", () => {
    api.getWorkspace.mockResolvedValue({
      projects: [],
      threads: [],
      diagnostics: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Steer your coding agent")).toBeInTheDocument();
    expect(
      screen.queryByText("Opening local workspace…"),
    ).not.toBeInTheDocument();
  });

  it("discards malformed persisted composer drafts", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => 42,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
    const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
    const snapshot: ThreadSnapshot = {
      version: 2,
      project: {
        id: projectId,
        displayName: "Example project",
        displayPath: "/example",
        createdAt: "2026-01-01T00:00:00.000Z",
        available: true,
        gitAvailable: true,
        sidebarExpanded: true,
        unreadCount: 0,
        lastOpenedThreadId: threadId,
      },
      thread: {
        id: threadId,
        projectId,
        title: "Example thread",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        runState: null,
        unread: false,
        runtimeAvailable: true,
        runtime: "pi" as const,
        workspace: { mode: "shared", branchName: null, available: true },
      },
      transcriptPage: { items: [], olderCursor: null, atLatest: true },
      currentRun: null,
      lastRun: null,
      epoch: "40000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    };
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Composer
          projectId={projectId}
          threadId={threadId}
          snapshot={snapshot}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Message Pi" })).toHaveValue("");
  });

  it("uses bound storage methods for draft reads and writes", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(
        this: { values: Map<string, string> },
        key: string,
      ): string | null {
        return this.values.get(key) ?? null;
      },
      setItem(
        this: { values: Map<string, string> },
        key: string,
        value: string,
      ): void {
        this.values.set(key, value);
      },
      removeItem(this: { values: Map<string, string> }, key: string): void {
        this.values.delete(key);
      },
      values,
    };
    vi.stubGlobal("localStorage", storage);
    const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
    const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
    const snapshot = {
      version: 2,
      project: {
        id: projectId,
        displayName: "Example project",
        displayPath: "/example",
        createdAt: "2026-01-01T00:00:00.000Z",
        available: true,
        gitAvailable: true,
        sidebarExpanded: true,
        unreadCount: 0,
        lastOpenedThreadId: threadId,
      },
      thread: {
        id: threadId,
        projectId,
        title: "Example thread",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        runState: null,
        unread: false,
        runtimeAvailable: true,
        runtime: "pi" as const,
        workspace: { mode: "shared", branchName: null, available: true },
      },
      transcriptPage: { items: [], olderCursor: null, atLatest: true },
      currentRun: null,
      lastRun: null,
      epoch: "40000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    } satisfies ThreadSnapshot;
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <Composer
          projectId={projectId}
          threadId={threadId}
          snapshot={snapshot}
        />
      </QueryClientProvider>,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Message Pi" }),
      "Bound",
    );
    await waitFor(() => {
      expect(values.get(`pi-draft:${threadId}`)).toBe("Bound");
    });
  });

  it("shows Codex-style worktree choices with a clean default and no environment control", async () => {
    const user = userEvent.setup();
    const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
    api.getWorkspace.mockResolvedValue({
      projects: [
        {
          id: projectId,
          displayName: "Example project",
          displayPath: "example",
          createdAt: "2026-01-01T00:00:00.000Z",
          available: true,
          gitAvailable: true,
          sidebarExpanded: true,
          unreadCount: 0,
          lastOpenedThreadId: null,
        },
      ],
      threads: [],
      diagnostics: [],
    });
    api.getWorkspacePreflight.mockResolvedValue({
      worktreeAvailable: true,
      unavailableReason: null,
      currentBranch: "main",
      branches: ["main", "release"],
      headCommit: "1234567",
      changes: {
        staged: 1,
        modified: 1,
        deleted: 0,
        renamed: 0,
        untracked: 1,
        files: ["one.ts", "two.ts", "three.ts"],
        token: "1234567890abcdef",
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${projectId}/new`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText("Execution location")).toHaveValue(
      "worktree",
    );
    expect(screen.getByLabelText("Starting state")).toHaveValue("none");
    // Scoped to the new-chat form itself: the workspace surface's separate,
    // focus-following Environment panel (docked alongside the tiling
    // surface) legitimately has "Environment"-labelled elements of its own,
    // but the composer form must not grow an environment control.
    const form = document.querySelector(".new-chat-card");
    if (form === null) throw new Error("expected the new-chat form");
    expect(
      within(form as HTMLElement).queryByLabelText(/environment/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Local changes are not copied/),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Base branch")).toHaveValue("main");
    });
    await user.selectOptions(
      screen.getByLabelText("Starting state"),
      "tracked_and_untracked",
    );
    expect(screen.getByText(/Including 3 local changes/)).toBeInTheDocument();
  });

  it("sends with Enter, uses Shift+Enter for a new line, and steers active runs", async () => {
    const user = userEvent.setup();
    const drafts = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => drafts.get(key) ?? null,
      setItem: (key: string, value: string) => {
        drafts.set(key, value);
      },
      removeItem: (key: string) => {
        drafts.delete(key);
      },
    });
    api.prompt.mockResolvedValue(undefined);
    api.steer.mockResolvedValue(undefined);
    const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
    const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
    const snapshot: ThreadSnapshot = {
      version: 2,
      project: {
        id: projectId,
        displayName: "Example project",
        displayPath: "/example",
        createdAt: "2026-01-01T00:00:00.000Z",
        available: true,
        gitAvailable: true,
        sidebarExpanded: true,
        unreadCount: 0,
        lastOpenedThreadId: threadId,
      },
      thread: {
        id: threadId,
        projectId,
        title: "Example thread",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        runState: null,
        unread: false,
        runtimeAvailable: true,
        runtime: "pi" as const,
        workspace: { mode: "shared", branchName: null, available: true },
      },
      transcriptPage: { items: [], olderCursor: null, atLatest: true },
      currentRun: null,
      lastRun: null,
      epoch: "40000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    };
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Composer
          projectId={projectId}
          threadId={threadId}
          snapshot={snapshot}
        />
      </QueryClientProvider>,
    );

    const message = screen.getByRole("textbox", { name: "Message Pi" });
    await user.type(message, "First line");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(message, "Second line");
    expect(message).toHaveValue("First line\nSecond line");

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(api.prompt).toHaveBeenCalledWith(
        projectId,
        threadId,
        "First line\nSecond line",
      );
      expect(message).toHaveValue("");
    });

    const activeSnapshot: ThreadSnapshot = {
      ...snapshot,
      thread: { ...snapshot.thread, runState: "running" },
      currentRun: {
        id: "50000000-0000-4000-8000-000000000001" as RunId,
        projectId,
        threadId,
        state: "running",
        startedAt: "2026-01-01T00:01:00.000Z",
        endedAt: null,
        failureCode: null,
        failureMessage: null,
      },
    };
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Composer
          projectId={projectId}
          threadId={threadId}
          snapshot={activeSnapshot}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByText("Wait until finished")).not.toBeInTheDocument();
    await user.type(message, "Focus on the tests");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(api.steer).toHaveBeenCalledWith(
        projectId,
        threadId,
        "Focus on the tests",
      );
      expect(message).toHaveValue("");
    });
  });

  it("renders compact inline run signals without visible status words", () => {
    const { rerender } = render(<Status state="running" unread={false} />);
    const running = screen.getByLabelText("Running");
    expect(running).toBeInTheDocument();
    expect(running.textContent).toBe("");
    expect(screen.queryByText("Running")).not.toBeInTheDocument();

    rerender(<Status state="completed" unread />);
    const unread = screen.getByLabelText("Unread completion");
    expect(unread).toHaveTextContent("●");
    expect(screen.queryByText("Unread")).not.toBeInTheDocument();
  });

  it("does not enable raw Markdown HTML", () => {
    const { container } = render(
      <Markdown>{`<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert(1))`}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(screen.getByText("unsafe").closest("a")).not.toHaveAttribute(
      "href",
      expect.stringContaining("javascript:"),
    );
  });

  it("persists inspector visibility, selected tab, and resized width", async () => {
    const user = userEvent.setup();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal(
      "WebSocket",
      class {
        public addEventListener() {
          return undefined;
        }
        public send() {
          return undefined;
        }
        public close() {
          return undefined;
        }
      },
    );
    const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
    const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
    const project = {
      id: projectId,
      displayName: "Example project",
      displayPath: "/example",
      createdAt: "2026-01-01T00:00:00.000Z",
      available: true,
      gitAvailable: true,
      sidebarExpanded: true,
      unreadCount: 0,
      lastOpenedThreadId: threadId,
    };
    api.getWorkspace.mockResolvedValue({
      projects: [project],
      threads: [
        {
          id: threadId,
          projectId,
          title: "Resizable thread",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActivityAt: "2026-01-01T00:00:00.000Z",
          runState: null,
          unread: false,
          runtimeAvailable: true,
          runtime: "pi" as const,
          workspace: { mode: "shared", branchName: null, available: true },
        },
      ],
      diagnostics: [],
    });
    api.getSnapshot.mockResolvedValue({
      version: 2,
      project,
      thread: {
        id: threadId,
        projectId,
        title: "Resizable thread",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        runState: null,
        unread: false,
        runtimeAvailable: true,
        runtime: "pi" as const,
        workspace: { mode: "shared", branchName: null, available: true },
      },
      transcriptPage: { items: [], olderCursor: null, atLatest: true },
      currentRun: null,
      lastRun: null,
      epoch: "40000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    } satisfies ThreadSnapshot);
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/projects/${projectId}/threads/${threadId}`]}
        >
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Resizable thread" });
    expect(
      screen.queryByRole("complementary", { name: "Project inspector" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Open inspector panel" }),
    );
    expect(
      await screen.findByRole("complementary", {
        name: "Project inspector",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Files" }));
    await waitFor(() => {
      expect(
        JSON.parse(values.get("pi-workspace:inspector") ?? ""),
      ).toMatchObject({ activeTab: "files", open: true });
    });

    const closeInspector = screen.getByRole("button", {
      name: "Close inspector panel",
    });
    expect(closeInspector.querySelector(".panel-right-icon")).not.toBeNull();
    await user.click(closeInspector);
    expect(
      screen.queryByRole("complementary", { name: "Project inspector" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".inspector")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(document.querySelector(".inspector")).toHaveAttribute("inert");
    await waitFor(() => {
      expect(
        JSON.parse(values.get("pi-workspace:inspector") ?? ""),
      ).toMatchObject({ activeTab: "files", open: false });
    });

    await user.click(
      screen.getByRole("button", { name: "Open inspector panel" }),
    );
    expect(
      await screen.findByRole("tab", { name: "Files", selected: true }),
    ).toBeInTheDocument();

    const separator = screen.getByRole("separator", {
      name: "Resize inspector panel",
    });
    fireEvent.pointerDown(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 720, pointerId: 1 });
    fireEvent.pointerUp(separator, { pointerId: 1 });
    await waitFor(() => {
      expect(
        JSON.parse(values.get("pi-workspace:inspector") ?? ""),
      ).toMatchObject({ width: 720 });
    });
    expect(separator).toHaveAttribute("aria-valuenow", "720");
    separator.focus();
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => {
      expect(
        JSON.parse(values.get("pi-workspace:inspector") ?? ""),
      ).toMatchObject({ width: 744 });
    });
  });

  it("imports a discovered session and renames a thread", async () => {
    const user = userEvent.setup();
    const drafts = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => drafts.get(key) ?? null,
      setItem: (key: string, value: string) => {
        drafts.set(key, value);
      },
      removeItem: (key: string) => {
        drafts.delete(key);
      },
    });
    const projectId = "10000000-0000-4000-8000-000000000001";
    const threadId = "20000000-0000-4000-8000-000000000001";
    const importedThreadId = "30000000-0000-4000-8000-000000000001";
    let workspace = {
      projects: [
        {
          id: projectId,
          displayName: "Example project",
          displayPath: "/example",
          available: true,
          sidebarExpanded: true,
          unreadCount: 0,
          lastOpenedThreadId: threadId,
        },
      ],
      threads: [
        {
          id: threadId,
          projectId,
          title: "Original thread",
          runtimeSessionId: "40000000-0000-4000-8000-000000000001",
          runState: null as "running" | null,
          unread: false,
        },
      ],
      diagnostics: [],
    };
    api.getWorkspace.mockImplementation(() => Promise.resolve(workspace));
    api.discoverSessions.mockResolvedValue({
      sessions: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          name: "Existing session",
          createdAt: "2026-01-01T00:00:00.000Z",
          modifiedAt: "2026-01-01T00:00:00.000Z",
          messageCount: 1,
          preview: "Existing work",
          imported: false,
        },
      ],
      diagnostics: ["One session could not be read."],
    });
    api.importThread.mockResolvedValue({
      thread: {
        id: importedThreadId,
        projectId,
        title: "Existing session",
        runtimeSessionId: "50000000-0000-4000-8000-000000000001",
        runState: null,
        unread: false,
      },
    });
    // The tiling workspace can render more than one thread pane at once
    // (e.g. the original thread's pane stays tiled alongside a
    // newly-opened one), so the snapshot returned must vary by the
    // requested thread id rather than being a single fixed value.
    api.getSnapshot.mockImplementation((_projectId: string, tid: string) =>
      Promise.resolve({
        version: 2,
        project: workspace.projects[0],
        thread:
          tid === importedThreadId
            ? {
                id: importedThreadId,
                projectId,
                title: "Existing session",
                runtimeSessionId: "50000000-0000-4000-8000-000000000001",
                runState: null,
                unread: false,
              }
            : {
                id: threadId,
                projectId,
                title: "Original thread",
                runtimeSessionId: "40000000-0000-4000-8000-000000000001",
                runState: null,
                unread: false,
              },
        transcriptPage: { items: [], olderCursor: null, atLatest: true },
        currentRun: null,
        lastRun: null,
        epoch: "60000000-0000-4000-8000-000000000001",
        highWaterSequence: 0,
        capabilities: { prompt: true, steer: true, stop: true },
        diagnostics: [],
      }),
    );
    api.archiveThread.mockImplementation(
      (_projectId: ProjectId, archivedThreadId: ThreadId) => {
        workspace = {
          ...workspace,
          threads: workspace.threads.filter(
            (thread) => thread.id !== archivedThreadId,
          ),
        };
        return Promise.resolve({ archived: true as const });
      },
    );
    api.renameThread.mockImplementation(
      (_projectId: ProjectId, renamedThreadId: ThreadId, title: string) => {
        workspace = {
          ...workspace,
          threads: workspace.threads.map((thread) =>
            thread.id === renamedThreadId ? { ...thread, title } : thread,
          ),
        };
        const thread = workspace.threads.find(
          (candidate) => candidate.id === renamedThreadId,
        );
        if (thread === undefined) throw new Error("Expected test thread");
        return Promise.resolve({ thread });
      },
    );

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Import an existing session into Example project",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Import" }),
    ).toBeInTheDocument();
    expect(api.discoverSessions).toHaveBeenCalledWith(projectId);
    expect(
      screen.getByText("One session could not be read."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(api.importThread).toHaveBeenCalledWith(
        projectId,
        "50000000-0000-4000-8000-000000000001",
      );
      expect(api.getSnapshot).toHaveBeenCalledWith(projectId, importedThreadId);
    });
    expect(
      await screen.findByRole("heading", { name: "Existing session" }),
    ).toBeInTheDocument();

    const originalThread = screen.getByRole("link", {
      name: "Original thread",
    });
    fireEvent.contextMenu(originalThread);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Archive" }),
    ).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.contextMenu(originalThread);
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const title = screen.getByRole("textbox", {
      name: "Rename Original thread",
    });
    await user.clear(title);
    await user.type(title, "Renamed thread");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(api.renameThread).toHaveBeenCalledWith(
        projectId,
        threadId,
        "Renamed thread",
      );
    });
    expect(await screen.findByText("Renamed thread")).toBeInTheDocument();

    const renamedLink = screen.getByRole("link", { name: "Renamed thread" });
    renamedLink.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    workspace = {
      ...workspace,
      threads: workspace.threads.map((thread) =>
        thread.id === threadId ? { ...thread, runState: "running" } : thread,
      ),
    };
    await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    await screen.findByRole("link", { name: /Renamed thread.*Working/ });
    // R2-6: the per-row overflow control is persistently visible and is the
    // one route to Rename/Archive; Archive stays disabled while running.
    await user.click(
      screen.getByRole("button", { name: "Actions for Renamed thread" }),
    );
    expect(
      screen.getByRole("menuitem", {
        name: "Archive (unavailable while running)",
      }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");

    workspace = {
      ...workspace,
      threads: workspace.threads.map((thread) =>
        thread.id === threadId ? { ...thread, runState: null } : thread,
      ),
    };
    await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    await user.click(
      await screen.findByRole("button", { name: "Actions for Renamed thread" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    // The row leaves the list at once, but the request itself is deferred
    // behind the undo toast (R2-5); the timing is covered by the dedicated
    // "sidebar archive" suite below.
    expect(screen.queryByText("Renamed thread")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'Undo archiving "Renamed thread"' }),
    ).toBeInTheDocument();
    expect(api.archiveThread).not.toHaveBeenCalled();
  });
});

describe("sidebar run status", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
  const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;

  function renderSidebarWithRunState(runState: "failed" | "running" | null) {
    api.getWorkspace.mockResolvedValue({
      projects: [
        {
          id: projectId,
          displayName: "Example project",
          displayPath: "/example",
          available: true,
          sidebarExpanded: true,
          unreadCount: 0,
          lastOpenedThreadId: null,
        },
      ],
      threads: [
        {
          id: threadId,
          projectId,
          title: "Example thread",
          runtimeSessionId: "40000000-0000-4000-8000-000000000001",
          runState,
          unread: false,
        },
      ],
      diagnostics: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("shows the derived run status as a dot plus an accessible label, matching the pane header's tokens", async () => {
    renderSidebarWithRunState("failed");

    const row = await screen.findByRole("link", {
      name: /Example thread.*Failed/,
    });
    const dot = row.querySelector(".sdot.fail");
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-hidden", "true");
    // Status is never colour-only: an accessible label backs the dot.
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows no status indicator for a threadless/never-run thread", async () => {
    renderSidebarWithRunState(null);

    const row = await screen.findByRole("link", { name: "Example thread" });
    expect(row.querySelector(".sdot")).toBeNull();
  });

  it("has no axe violations with a run status shown in the sidebar", async () => {
    renderSidebarWithRunState("running");
    await screen.findByRole("link", { name: /Example thread.*Working/ });

    // Scoped to the sidebar landmark itself: the full page has a
    // pre-existing (unrelated) nested-landmark structure elsewhere that
    // isn't part of this change.
    const sidebar = screen.getByRole("navigation", {
      name: "Projects and threads",
    });
    const results = await axe.run(sidebar);
    expect(results.violations).toEqual([]);
  });
});

// R2-1. The single workspace inspector (Changes | Files | Terminal) is the
// only panel left after UX-1, and the spec describes it as following the
// FOCUSED PANE. It used to derive from useParams().threadId instead, so
// focusing a threadless pane while the route pointed at a thread left the
// inspector showing a pane the user was not looking at, and focusing a
// thread pane while the route was /new made the whole column vanish.
describe("inspector follows the focused pane", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
  const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;

  const project = {
    id: projectId,
    displayName: "Example project",
    displayPath: "/example",
    createdAt: "2026-01-01T00:00:00.000Z",
    available: true,
    gitAvailable: true,
    sidebarExpanded: true,
    unreadCount: 0,
    lastOpenedThreadId: threadId,
  };
  const thread = {
    id: threadId,
    projectId,
    title: "Focused thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    runState: null,
    unread: false,
    runtimeAvailable: true,
    runtime: "pi" as const,
    workspace: { mode: "shared" as const, branchName: null, available: true },
  };

  function renderWorkspace() {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal(
      "WebSocket",
      class {
        public addEventListener() {
          return undefined;
        }
        public send() {
          return undefined;
        }
        public close() {
          return undefined;
        }
      },
    );
    api.getWorkspace.mockResolvedValue({
      projects: [project],
      threads: [thread],
      diagnostics: [],
    });
    api.getSnapshot.mockResolvedValue({
      version: 2,
      project,
      thread,
      transcriptPage: { items: [], olderCursor: null, atLatest: true },
      currentRun: null,
      lastRun: null,
      epoch: "40000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    } satisfies ThreadSnapshot);
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    api.getWorkspacePreflight.mockResolvedValue({
      worktreeAvailable: true,
      unavailableReason: null,
      currentBranch: "main",
      branches: ["main"],
      changes: null,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/projects/${projectId}/threads/${threadId}`]}
        >
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const inspector = () =>
    screen.queryByRole("complementary", { name: "Project inspector" });

  it("hides the inspector while a threadless pane is focused and restores it on refocus, without the URL changing", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("heading", { name: "Focused thread" });
    await user.click(
      screen.getByRole("button", { name: "Open inspector panel" }),
    );
    expect(inspector()).toBeInTheDocument();

    // Split: the fresh pane owns no thread and takes focus.
    await user.click(screen.getByRole("button", { name: "Split" }));
    const newChatPane = await screen.findByRole("region", { name: "New chat" });
    expect(newChatPane).toBeInTheDocument();

    // A threadless pane has no workspace to inspect, so the column goes away
    // entirely -- rail included.
    await waitFor(() => {
      expect(inspector()).not.toBeInTheDocument();
    });
    expect(document.querySelector(".inspector-rail")).toBeNull();

    // Refocusing the thread pane brings its workspace back. The route never
    // changed at any point in this test.
    await user.click(screen.getByRole("region", { name: "Focused thread" }));
    await waitFor(() => {
      expect(inspector()).toBeInTheDocument();
    });
    expect(
      screen.getByRole("tab", { name: "Changes", selected: true }),
    ).toBeInTheDocument();
  });

  it("hides the inspector once every pane is closed", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("heading", { name: "Focused thread" });
    await user.click(
      screen.getByRole("button", { name: "Open inspector panel" }),
    );
    expect(inspector()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("No panes are open.")).toBeInTheDocument();
    await waitFor(() => {
      expect(inspector()).not.toBeInTheDocument();
    });
    expect(document.querySelector(".inspector-rail")).toBeNull();
  });
});

// R2-5 / D-9, second half. Archiving is now reachable ONLY through the
// sidebar's explicitly labelled Archive action. Because there is no unarchive
// endpoint, undo must PREVENT the archive rather than reverse it: the row
// leaves the list immediately, the call is deferred behind the toast, and a
// failure puts the row back with an error the user can see.
describe("sidebar archive", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
  const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
  const secondThreadId = "20000000-0000-4000-8000-000000000002" as ThreadId;

  function renderSidebar(
    threads: { id: ThreadId; title: string }[] = [
      { id: threadId, title: "Disposable thread" },
    ],
  ) {
    api.getWorkspace.mockResolvedValue({
      projects: [
        {
          id: projectId,
          displayName: "Example project",
          displayPath: "/example",
          available: true,
          sidebarExpanded: true,
          unreadCount: 0,
          lastOpenedThreadId: null,
        },
      ],
      threads: threads.map((thread) => ({
        id: thread.id,
        projectId,
        title: thread.title,
        runState: null,
        unread: false,
      })),
      diagnostics: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("defers the archive behind an undo toast and never sends it when undone", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderSidebar();
    const row = await screen.findByRole("link", { name: "Disposable thread" });
    expect(row).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Disposable thread" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    // The row leaves immediately and nothing has been sent yet.
    expect(
      screen.queryByRole("link", { name: "Disposable thread" }),
    ).not.toBeInTheDocument();
    expect(api.archiveThread).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Undo archiving "Disposable thread"',
      }),
    );
    expect(
      screen.getByRole("link", { name: "Disposable thread" }),
    ).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(api.archiveThread).not.toHaveBeenCalled();
  });

  it("sends the archive once the toast times out", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderSidebar();
    await screen.findByRole("link", { name: "Disposable thread" });

    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Disposable thread" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(api.archiveThread).toHaveBeenCalledTimes(1);
    });
    expect(api.archiveThread).toHaveBeenCalledWith(projectId, threadId);
  });

  it("restores the row and surfaces an error when the archive fails, instead of reporting success", async () => {
    api.archiveThread.mockRejectedValue(new Error("worktree is locked"));
    renderSidebar();
    await screen.findByRole("link", { name: "Disposable thread" });

    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Disposable thread" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(
      screen.queryByRole("link", { name: "Disposable thread" }),
    ).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    vi.useRealTimers();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "worktree is locked",
    );
    expect(
      screen.getByRole("link", { name: "Disposable thread" }),
    ).toBeInTheDocument();
  });

  // NEW-R3-1. Archiving a second thread inside the first's undo window used
  // to flush the first archive immediately (destroying an undo the user was
  // still entitled to) and then call mutation.reset(), which detached the
  // observer before the rejection landed -- so a failed flush produced no
  // alert at all. Each pending archive now owns its own toast and timer, and
  // every failure is named and surfaced.
  it("keeps each pending archive on its own undo window instead of flushing the first", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderSidebar([
      { id: threadId, title: "First thread" },
      { id: secondThreadId, title: "Second thread" },
    ]);
    await screen.findByRole("link", { name: "First thread" });

    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for First thread" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Second thread" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    // Starting the second archive must not commit the first.
    expect(api.archiveThread).not.toHaveBeenCalled();
    // Both rows are staged, and both undo affordances are on screen.
    expect(
      screen.getByRole("button", { name: 'Undo archiving "First thread"' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'Undo archiving "Second thread"' }),
    ).toBeInTheDocument();

    // The first thread's own window is still running: undo still works.
    fireEvent.click(
      screen.getByRole("button", { name: 'Undo archiving "First thread"' }),
    );
    expect(
      screen.getByRole("link", { name: "First thread" }),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(api.archiveThread).toHaveBeenCalledTimes(1);
    });
    expect(api.archiveThread).toHaveBeenCalledWith(projectId, secondThreadId);
  });

  it("names the failing thread and surfaces its error even when a second archive was requested inside its undo window", async () => {
    api.archiveThread.mockImplementation((_project: ProjectId, id: ThreadId) =>
      id === threadId
        ? Promise.reject(new Error("worktree is locked"))
        : Promise.resolve({ archived: true as const }),
    );
    renderSidebar([
      { id: threadId, title: "First thread" },
      { id: secondThreadId, title: "Second thread" },
    ]);
    await screen.findByRole("link", { name: "First thread" });

    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for First thread" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Second thread" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    vi.useRealTimers();

    // Exactly one notice, naming the thread that actually failed. The second
    // archive succeeded and must not produce one.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(
      'Could not archive "First thread": worktree is locked',
    );
    expect(
      screen.getByRole("link", { name: "First thread" }),
    ).toBeInTheDocument();
    expect(api.archiveThread).toHaveBeenCalledTimes(2);
  });
});

// NEW-R3-1, second half. Archive used to be a one-way door: a committed
// archive hid the thread from every listing the app had, and the only way
// back was editing the database by hand. It is now reversible.
describe("restoring an archived thread", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
  const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;

  function renderSidebar(threads: { id: ThreadId; title: string }[] = []) {
    api.getWorkspace.mockResolvedValue({
      projects: [
        {
          id: projectId,
          displayName: "Example project",
          displayPath: "/example",
          available: true,
          sidebarExpanded: true,
          unreadCount: 0,
          lastOpenedThreadId: null,
        },
      ],
      threads: threads.map((thread) => ({
        id: thread.id,
        projectId,
        title: thread.title,
        runState: null,
        unread: false,
      })),
      diagnostics: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("lists archived threads only when asked, and restores one", async () => {
    api.getArchivedThreads.mockResolvedValue({
      threads: [
        {
          id: threadId,
          projectId,
          title: "Archived thread",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActivityAt: "2026-01-01T00:00:00.000Z",
          runState: null,
          unread: false,
          runtimeAvailable: true,
          runtime: "pi" as const,
          workspace: { mode: "shared", branchName: null, available: true },
        },
      ],
    });
    api.unarchiveThread.mockResolvedValue({ archived: false as const });
    const user = userEvent.setup();
    renderSidebar();

    const toggle = await screen.findByRole("button", {
      name: "Archived threads in Example project",
    });
    // Nothing is fetched until the section is opened.
    expect(api.getArchivedThreads).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    await user.click(
      await screen.findByRole("button", { name: "Restore Archived thread" }),
    );

    await waitFor(() => {
      expect(api.unarchiveThread).toHaveBeenCalledWith(projectId, threadId);
    });
  });

  it("refreshes an open Archived section when an archive commits, so the thread never vanishes from both lists at once", async () => {
    api.getArchivedThreads.mockResolvedValue({ threads: [] });
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderSidebar([{ id: threadId, title: "Disposable thread" }]);

    await screen.findByRole("link", { name: "Disposable thread" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Archived threads in Example project",
      }),
    );
    await waitFor(() => {
      expect(api.getArchivedThreads).toHaveBeenCalledTimes(1);
    });

    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Disposable thread" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(api.archiveThread).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(api.getArchivedThreads).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces a failed restore instead of silently doing nothing", async () => {
    api.getArchivedThreads.mockResolvedValue({
      threads: [
        {
          id: threadId,
          projectId,
          title: "Archived thread",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActivityAt: "2026-01-01T00:00:00.000Z",
          runState: null,
          unread: false,
          runtimeAvailable: true,
          runtime: "pi" as const,
          workspace: { mode: "shared", branchName: null, available: true },
        },
      ],
    });
    api.unarchiveThread.mockRejectedValue(new Error("thread was not found"));
    const user = userEvent.setup();
    renderSidebar();

    await user.click(
      await screen.findByRole("button", {
        name: "Archived threads in Example project",
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Restore Archived thread" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "thread was not found",
    );
  });
});

// R2-6. With no pointer over the sidebar, the only visible call to action
// used to be "Browse…" — a once-ever action — while starting a chat (the
// app's primary verb) and renaming a thread had no visible control at all.
describe("sidebar affordances are visible without hovering", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
  const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;

  it("keeps New thread and the per-thread actions menu visible, and hover-gates only the destructive controls", async () => {
    api.getWorkspace.mockResolvedValue({
      projects: [
        {
          id: projectId,
          displayName: "Example project",
          displayPath: "/example",
          available: true,
          sidebarExpanded: true,
          unreadCount: 0,
          lastOpenedThreadId: null,
        },
      ],
      threads: [
        {
          id: threadId,
          projectId,
          title: "Example thread",
          runState: null,
          unread: false,
        },
      ],
      diagnostics: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const newThread = await screen.findByRole("button", {
      name: "New thread in Example project",
    });
    expect(newThread.className).not.toMatch(/hover-only/);
    const actions = screen.getByRole("button", {
      name: "Actions for Example thread",
    });
    expect(actions.className).not.toMatch(/hover-only/);

    // Destructive / rare controls may still be hover-revealed.
    expect(
      screen.getByRole("button", { name: "Remove Example project" }).className,
    ).toMatch(/hover-only/);

    // The actions menu is the discoverable route to Rename, which previously
    // existed only on right-click / Shift+F10.
    fireEvent.click(actions);
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  });
});

// R2-13. `queryKey: ["files", …, search]` had no debounce and no
// placeholderData, so every character started a fresh full-tree listing
// (~750ms–5s on a real repo) and `files.isPending` replaced the whole list
// with "Listing files…" between each one.
describe("inspector Files tab search", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
  const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
  const project = {
    id: projectId,
    displayName: "Example project",
    displayPath: "/example",
    createdAt: "2026-01-01T00:00:00.000Z",
    available: true,
    gitAvailable: true,
    sidebarExpanded: true,
    unreadCount: 0,
    lastOpenedThreadId: threadId,
  };
  const thread = {
    id: threadId,
    projectId,
    title: "Example thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    runState: null,
    unread: false,
    runtimeAvailable: true,
    runtime: "pi" as const,
    workspace: { mode: "shared" as const, branchName: null, available: true },
  };

  it("debounces the query and keeps the previous list visible while the next one loads", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal(
      "WebSocket",
      class {
        public addEventListener() {
          return undefined;
        }
        public send() {
          return undefined;
        }
        public close() {
          return undefined;
        }
      },
    );
    const values = new Map<string, string>([
      [
        "pi-workspace:inspector",
        JSON.stringify({
          version: 1,
          open: true,
          activeTab: "files",
          width: 400,
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    api.getWorkspace.mockResolvedValue({
      projects: [project],
      threads: [thread],
      diagnostics: [],
    });
    api.getSnapshot.mockResolvedValue({
      version: 2,
      project,
      thread,
      transcriptPage: { items: [], olderCursor: null, atLatest: true },
      currentRun: null,
      lastRun: null,
      epoch: "40000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    } satisfies ThreadSnapshot);
    api.getFiles.mockResolvedValue({
      entries: [{ path: "src/main.ts", kind: "file" as const }],
      truncated: false,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/projects/${projectId}/threads/${threadId}`]}
        >
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const search = await screen.findByRole("textbox", {
      name: "Search project files",
    });
    await screen.findByText("src/main.ts");
    expect(api.getFiles).toHaveBeenCalledTimes(1);

    await user.type(search, "mai");
    // Three keystrokes, still one request in flight-or-done: nothing fires
    // until typing settles.
    expect(api.getFiles).toHaveBeenCalledTimes(1);
    // ...and the panel never blanks to its loading state mid-typing.
    expect(screen.queryByText("Listing files…")).not.toBeInTheDocument();
    expect(screen.getByText("src/main.ts")).toBeInTheDocument();

    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(2);
    });
    expect(api.getFiles).toHaveBeenLastCalledWith(projectId, threadId, "mai");
    expect(screen.queryByText("Listing files…")).not.toBeInTheDocument();
  });
});

// R2-12. The UX-7 Changes-tab states shipped in round 1 with no test at all,
// and the changes summary rescued from the deleted EnvironmentPanel lost its
// 308 lines of coverage with it. The pure summary logic is unit-tested in
// components/changesSummary.test.ts; this covers the rendering.
describe("inspector Changes tab states", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
  const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
  const project = {
    id: projectId,
    displayName: "Example project",
    displayPath: "/example",
    createdAt: "2026-01-01T00:00:00.000Z",
    available: true,
    gitAvailable: true,
    sidebarExpanded: true,
    unreadCount: 0,
    lastOpenedThreadId: threadId,
  };
  const thread = {
    id: threadId,
    projectId,
    title: "Example thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    runState: null,
    unread: false,
    runtimeAvailable: true,
    runtime: "pi" as const,
    workspace: { mode: "shared" as const, branchName: null, available: true },
  };

  function renderChangesTab() {
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal(
      "WebSocket",
      class {
        public addEventListener() {
          return undefined;
        }
        public send() {
          return undefined;
        }
        public close() {
          return undefined;
        }
      },
    );
    const values = new Map<string, string>([
      [
        "pi-workspace:inspector",
        JSON.stringify({
          version: 1,
          open: true,
          activeTab: "changes",
          width: 400,
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    api.getWorkspace.mockResolvedValue({
      projects: [project],
      threads: [thread],
      diagnostics: [],
    });
    api.getSnapshot.mockResolvedValue({
      version: 2,
      project,
      thread,
      transcriptPage: { items: [], olderCursor: null, atLatest: true },
      currentRun: null,
      lastRun: null,
      epoch: "40000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    } satisfies ThreadSnapshot);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/projects/${projectId}/threads/${threadId}`]}
        >
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("shows a pending state, then the empty state for a clean worktree", async () => {
    let resolveStatus: (value: {
      available: boolean;
      message: string | null;
      files: never[];
    }) => void = () => undefined;
    api.getStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    renderChangesTab();

    expect(await screen.findByText("Reading the worktree…")).toBeVisible();
    resolveStatus({ available: true, message: null, files: [] });
    expect(
      await screen.findByText("No changes in this worktree."),
    ).toBeVisible();
    expect(screen.queryByText("Reading the worktree…")).not.toBeInTheDocument();
  });

  it("carries the changes summary on the scope note and asks for a selection", async () => {
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [
        {
          path: "src/added.ts",
          originalPath: null,
          indexStatus: "A",
          worktreeStatus: " ",
          kind: "added",
        },
        {
          path: "src/changed.ts",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          kind: "modified",
        },
      ],
    });
    renderChangesTab();

    expect(
      await screen.findByText(/Current thread workspace.*1 added, 1 modified/),
    ).toBeVisible();
    expect(screen.getByText("Select a file to view its diff.")).toBeVisible();
    expect(
      screen.queryByText("No changes in this worktree."),
    ).not.toBeInTheDocument();
  });

  it("shows the server's reason when the worktree is unavailable", async () => {
    api.getStatus.mockResolvedValue({
      available: false,
      message: "git is not installed on this machine.",
      files: [],
    });
    renderChangesTab();

    expect(
      await screen.findByText("git is not installed on this machine."),
    ).toBeVisible();
    expect(
      screen.queryByText("No changes in this worktree."),
    ).not.toBeInTheDocument();
  });
});
