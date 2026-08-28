// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";
import type {
  ProjectId,
  RunId,
  ThreadId,
  ThreadSnapshot,
} from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  addProjectByPath: vi.fn(),
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

import { ApiClientError } from "./api/client.js";
import { Markdown } from "./components/Markdown.js";
import { Status } from "./components/Status.js";
import { App, Composer } from "./App.js";
import type { PanelTab } from "./features/panel/panelTabs.js";
import { PANEL_STATE_VERSION } from "./features/panel/panelStorage.js";

/** Just enough of the device-local panel record for these assertions. */
interface PersistedPanel {
  version: number;
  open: boolean;
  tabs: Record<string, PanelTab>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// The docked workspace panel, as assistive technology sees it: a closed
// panel is aria-hidden and inert, so it is absent from this query even
// though its element is still in the DOM.
const panel = () =>
  screen.queryByRole("complementary", { name: "Workspace panel" });

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
      version: 1,
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
        workspace: { mode: "shared", branchName: null, available: true },
      },
      transcript: [],
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
      version: 1,
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
        workspace: { mode: "shared", branchName: null, available: true },
      },
      transcript: [],
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
      version: 1,
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
        workspace: { mode: "shared", branchName: null, available: true },
      },
      transcript: [],
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

  it("persists the panel's visibility, its open tabs, and its resized width", async () => {
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
          workspace: { mode: "shared", branchName: null, available: true },
        },
      ],
      diagnostics: [],
    });
    api.getSnapshot.mockResolvedValue({
      version: 1,
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
        workspace: { mode: "shared", branchName: null, available: true },
      },
      transcript: [],
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
    expect(panel()).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Open workspace panel" }),
    );
    expect(
      await screen.findByRole("complementary", {
        name: "Workspace panel",
      }),
    ).toBeInTheDocument();

    // A second tab, opened for the focused pane's thread (WSP-02).
    await user.click(screen.getByRole("button", { name: "New panel tab" }));
    await user.click(screen.getByRole("menuitem", { name: "Files" }));
    await waitFor(() => {
      expect(JSON.parse(values.get("pi-workspace:panel") ?? "")).toMatchObject({
        version: PANEL_STATE_VERSION,
        open: true,
      });
    });
    // Both tabs are in the device-local record, not just the visible one.
    // Parsed rather than string-matched: `toContain` on raw JSON passes on a
    // record that says anything at all about a type, in any position.
    const record = JSON.parse(
      values.get("pi-workspace:panel") ?? "",
    ) as PersistedPanel;
    expect(
      Object.values(record.tabs)
        .map((tab) => tab.type)
        .sort(),
    ).toEqual(["changes", "files"]);

    const closePanel = screen.getByRole("button", {
      name: "Close workspace panel",
    });
    expect(closePanel.querySelector(".panel-right-icon")).not.toBeNull();
    await user.click(closePanel);
    expect(panel()).not.toBeInTheDocument();
    // Closed means inert, not merely invisible (WSP-10).
    expect(document.querySelector(".panel")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(document.querySelector(".panel")).toHaveAttribute("inert");
    await waitFor(() => {
      expect(JSON.parse(values.get("pi-workspace:panel") ?? "")).toMatchObject({
        open: false,
      });
    });

    await user.click(
      screen.getByRole("button", { name: "Open workspace panel" }),
    );
    expect(
      await screen.findByRole("tab", { name: "Files", selected: true }),
    ).toBeInTheDocument();

    const separator = screen.getByRole("separator", {
      name: "Resize workspace panel",
    });
    fireEvent.pointerDown(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 720, pointerId: 1 });
    fireEvent.pointerUp(separator, { pointerId: 1 });
    await waitFor(() => {
      expect(JSON.parse(values.get("pi-workspace:panel") ?? "")).toMatchObject({
        width: 720,
      });
    });
    expect(separator).toHaveAttribute("aria-valuenow", "720");
    separator.focus();
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => {
      expect(JSON.parse(values.get("pi-workspace:panel") ?? "")).toMatchObject({
        width: 744,
      });
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
        version: 1,
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
                // The panel names the worktree a tab reads from this, so
                // the fixture carries what the contract always carries.
                workspace: {
                  mode: "shared",
                  branchName: null,
                  available: true,
                },
              }
            : {
                id: threadId,
                projectId,
                title: "Original thread",
                runtimeSessionId: "40000000-0000-4000-8000-000000000001",
                runState: null,
                unread: false,
                workspace: {
                  mode: "shared",
                  branchName: null,
                  available: true,
                },
              },
        transcript: [],
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
    await user.dblClick(
      screen.getByText("Original thread", { selector: ".thread-title" }),
    );
    const title = screen.getByRole("textbox", {
      name: "Rename Original thread",
    });
    expect(
      screen.queryByRole("button", { name: /save|confirm|cancel/i }),
    ).not.toBeInTheDocument();
    await user.clear(title);
    await user.type(title, "Renamed thread");
    fireEvent.blur(title, { relatedTarget: document.body });
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
  }, 10_000);
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

// WSP-02, inverted from R2-1. The shipped inspector followed the FOCUSED
// PANE: it re-targeted itself, and remounted, whenever chat focus moved, so
// a selected file, a search box and every in-flight query were discarded by
// a click on another pane. The panel's tabs are durable and carry their own
// context instead, so a focus change must leave every one of them exactly as
// it was — and a tab whose worktree is no longer the focused one says so.
describe("the panel does not follow the focused pane", () => {
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
      version: 1,
      project,
      thread,
      transcript: [],
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

  it("keeps every tab, its selection and its worktree when focus moves to a threadless pane", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("heading", { name: "Focused thread" });
    await user.click(
      screen.getByRole("button", { name: "Open workspace panel" }),
    );
    await user.click(screen.getByRole("button", { name: "New panel tab" }));
    await user.click(screen.getByRole("menuitem", { name: "Files" }));
    expect(
      await screen.findByRole("tab", { name: "Files", selected: true }),
    ).toBeInTheDocument();
    // Nothing is chipped while the tabs read the focused pane's own
    // worktree. Scoped to the strip: the project's name is also the sidebar
    // row and the pane header's repository label.
    expect(
      within(screen.getByRole("tablist")).queryByText("Example project"),
    ).not.toBeInTheDocument();

    // Split: the fresh pane owns no thread and takes focus.
    await user.click(
      screen.getByRole("button", { name: "Split right into a new chat" }),
    );
    expect(
      await screen.findByRole("region", { name: "New chat" }),
    ).toBeInTheDocument();

    // The panel stays, with both tabs and the same one selected.
    expect(panel()).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(
      screen.getByRole("tab", { name: /Files/, selected: true }),
    ).toBeInTheDocument();
    // ...and each tab now names the worktree it reads, because nothing on
    // screen implies it any more (WSP-02).
    await waitFor(() => {
      expect(
        within(screen.getByRole("tablist")).getAllByText("Example project"),
      ).toHaveLength(2);
    });

    // Refocusing the thread pane takes the chips away again. The route never
    // changed at any point in this test.
    await user.click(screen.getByRole("region", { name: "Focused thread" }));
    await waitFor(() => {
      expect(
        within(screen.getByRole("tablist")).queryByText("Example project"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("keeps the panel and its tabs when every pane is closed", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole("heading", { name: "Focused thread" });
    await user.click(
      screen.getByRole("button", { name: "Open workspace panel" }),
    );
    expect(panel()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("No panes are open.")).toBeInTheDocument();

    // A tab reads a worktree, not a pane: closing every pane takes nothing
    // away from it.
    expect(panel()).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Changes/ })).toBeInTheDocument();
  });
});

// R2-5 / D-9, second half. Archiving is now reachable ONLY through the
// sidebar's explicitly labelled Archive action. Because there is no unarchive
// endpoint, undo must PREVENT the archive rather than reverse it: the row
// leaves the list immediately, the call is deferred behind the toast, and a
// failure puts the row back with an error the user can see.
// NEW-5, the single worst thing left in the product: the only way to add a
// project was a native OS folder dialog. If it failed to open, opened behind
// the window, or landed on another desktop, there was no way in at all -- and
// adding a project is the first thing every reader must do.
describe("adding a project without the native folder chooser", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;

  function renderEmptySidebar() {
    api.getWorkspace.mockResolvedValue({
      projects: [],
      threads: [],
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
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const pathField = () =>
    screen.getByRole("textbox", { name: "Project directory path" });
  const disclosure = () =>
    screen.getByText("Or enter a path").closest<HTMLDetailsElement>("details");

  it("keeps Browse primary and folds the path field into a closed disclosure", async () => {
    renderEmptySidebar();
    await screen.findByRole("button", { name: "Browse…" });
    // The common case is unchanged: the disclosure is closed, so the sidebar
    // still reads as one label and one primary button.
    expect(disclosure()?.open).toBe(false);
    // Browse keeps the accent fill; the path route's submit does not, so two
    // routes to the same place do not both look like the main one.
    expect(
      screen.getByRole("button", { name: "Browse…" }).className,
    ).not.toContain("add-project-path");
  });

  it("registers a typed path and clears the field", async () => {
    api.addProjectByPath.mockResolvedValue({
      project: {
        id: projectId,
        displayName: "sandbox",
        displayPath: "/Users/someone/sandbox",
        available: true,
        gitAvailable: true,
        sidebarExpanded: true,
        unreadCount: 0,
        lastOpenedThreadId: null,
      },
    });
    renderEmptySidebar();
    await screen.findByRole("button", { name: "Browse…" });
    fireEvent.click(screen.getByText("Or enter a path"));

    // Nothing to submit until there is a path.
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.change(pathField(), {
      target: { value: "/Users/someone/sandbox" },
    });
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      // First argument only: react-query hands the mutation context as a
      // second argument, which is not part of this contract.
      expect(api.addProjectByPath.mock.calls[0]?.[0]).toBe(
        "/Users/someone/sandbox",
      );
    });
    // The field empties rather than holding a path whose only remaining
    // outcome is "already registered".
    await waitFor(() => {
      expect(disclosure()?.open).toBe(false);
    });
    expect(pathField()).toHaveValue("");
  });

  it("reports the server's reason for a bad path and offers a dismiss", async () => {
    api.addProjectByPath.mockRejectedValue(
      new ApiClientError(
        404,
        "project_path_not_found",
        "There is nothing at that path.",
      ),
    );
    renderEmptySidebar();
    await screen.findByRole("button", { name: "Browse…" });
    fireEvent.click(screen.getByText("Or enter a path"));
    fireEvent.change(pathField(), { target: { value: "/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("There is nothing at that path.");
    fireEvent.click(
      within(alert).getByRole("button", { name: "Dismiss this message" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  // NEW-4. The dot's only accessible name read "1 unread completions".
  it("counts unread completions in the singular when there is one", async () => {
    for (const [count, label] of [
      [1, "1 unread completion"],
      [2, "2 unread completions"],
    ] as const) {
      api.getWorkspace.mockResolvedValue({
        projects: [
          {
            id: projectId,
            displayName: "Example project",
            displayPath: "/example",
            available: true,
            sidebarExpanded: true,
            unreadCount: count,
            lastOpenedThreadId: null,
          },
        ],
        threads: [],
        diagnostics: [],
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/"]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
      cleanup();
    }
  });

  it("has no axe violations with the path field open", async () => {
    renderEmptySidebar();
    await screen.findByRole("button", { name: "Browse…" });
    fireEvent.click(screen.getByText("Or enter a path"));
    const results = await axe.run(document.body, {
      runOnly: ["wcag2a", "wcag2aa"],
    });
    expect(results.violations).toEqual([]);
  });
});

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

  // NEW-6. Archiving the FOCUSED pane's thread used to send the app to
  // `/projects/:id`, which redirects to `lastOpenedThreadId ?? threads[0]` --
  // so an unrelated conversation appeared under the reader's eyes and nothing
  // said why. The undo toast names what was archived and never mentions the
  // substitution. An unfocused pane already did the right thing: it keeps the
  // thread and swaps its composer for the archived notice.
  //
  // It reaches that notice by not navigating at all. `/new` was tried first
  // and does keep the pane pointed at its own thread, but it is an
  // instruction to open an empty composer: WorkspaceView answered it by
  // splitting a second pane in, which re-tiled the surface, re-parented the
  // archived pane's element and so REMOUNTED it -- resetting the latched
  // "this thread was once listed" that its archived inference rests on, and
  // flashing the thread back to live until the next snapshot 404. Staying put
  // keeps the pane, its state, and the URL that names what was archived.
  it("does not swap the focused pane onto an unrelated thread when its own is archived", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    const seen: string[] = [];
    function LocationProbe() {
      seen.push(useLocation().pathname);
      return null;
    }
    api.getWorkspace.mockResolvedValue({
      projects: [
        {
          id: projectId,
          displayName: "Example project",
          displayPath: "/example",
          available: true,
          sidebarExpanded: true,
          unreadCount: 0,
          lastOpenedThreadId: secondThreadId,
        },
      ],
      threads: [
        {
          id: threadId,
          projectId,
          title: "Archive me",
          runState: null,
          unread: false,
        },
        {
          id: secondThreadId,
          projectId,
          title: "Somebody else's conversation",
          runState: null,
          unread: false,
        },
      ],
      diagnostics: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/projects/${projectId}/threads/${threadId}`]}
        >
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("link", { name: "Archive me" });

    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Archive me" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(api.archiveThread).toHaveBeenCalledTimes(1);
    });
    // The route never moves: it goes on naming the thread that was archived,
    // so the pane keeps it and shows the archived notice in place.
    expect(seen.at(-1)).toBe(`/projects/${projectId}/threads/${threadId}`);
    expect(new Set(seen)).toEqual(
      new Set([`/projects/${projectId}/threads/${threadId}`]),
    );
    // The bare project route is what redirects onto another thread. It is
    // never visited, so that redirect never runs.
    expect(seen).not.toContain(`/projects/${projectId}`);
    expect(seen).not.toContain(
      `/projects/${projectId}/threads/${secondThreadId}`,
    );
    // And the `/new` instruction, which would have split a second pane in and
    // remounted this one, is never issued either.
    expect(seen).not.toContain(`/projects/${projectId}/new`);
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

  // The reported glitch, first half: "after archiving a chat, a couple of
  // seconds later there is a slight glitch."
  //
  // The row leaves the sidebar the moment Archive is clicked, and the reader
  // is entitled to never see it again. It came back: `pendingArchives` was
  // the only thing hiding it, and the toast's dismissal both un-staged the
  // archive and fired the request in ONE handler -- so from the instant the
  // request was sent until the ["workspace"] refetch that its response
  // invalidates finally landed, nothing was hiding the row and the cached
  // listing still carried the thread. Measured at 85ms in the running app:
  // the row flashed back in, pushed every row below it down, and left again.
  //
  // The window is a network round trip plus a refetch, so it is held open
  // here by a deferred archive rather than reproduced by timing.
  it("never lets the archived row flash back while its request is in flight", async () => {
    let commitArchive!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      commitArchive = resolve;
    });
    const listing = (titles: { id: ThreadId; title: string }[]) => ({
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
      threads: titles.map((thread) => ({
        id: thread.id,
        projectId,
        title: thread.title,
        runState: null,
        unread: false,
      })),
      diagnostics: [],
    });
    api.archiveThread.mockImplementation(async () => {
      await inFlight;
      // Only now does the server consider the thread archived, so only now
      // does the listing stop carrying it.
      api.getWorkspace.mockResolvedValue(listing([]));
      return { archived: true as const };
    });
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
    // Mid-flight: the undo window has closed and its toast is gone, the
    // request has not come back, and the listing in the cache still lists the
    // thread. This is the frame the reader saw the row reappear in.
    expect(
      screen.queryByRole("button", {
        name: 'Undo archiving "Disposable thread"',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Disposable thread" }),
    ).not.toBeInTheDocument();

    commitArchive();
    // The invalidated listing has landed and no longer carries the thread, so
    // nothing is hiding the row any more -- and it must still be gone.
    await waitFor(() => {
      expect(api.getWorkspace.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(
      screen.queryByRole("link", { name: "Disposable thread" }),
    ).not.toBeInTheDocument();
  });
});

// The reported glitch, second half. Archiving the focused pane's thread
// navigates to `/projects/:id/new`, and that path used to be served by a
// DIFFERENT route component from `/projects/:id/threads/:threadId`. React
// reconciles by element type, so the crossing was an unmount and a mount of
// the entire workspace rather than an update -- which reset every piece of
// pane-local state, ThreadPane's latched "this thread was once listed" among
// them, and made the pane render a thread it had already correctly marked
// Archived as live again until its refetched snapshot 404'd.
describe("workspace surface identity across the /new boundary", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
  const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;

  it("updates the surface in place instead of remounting it", async () => {
    api.getWorkspace.mockResolvedValue({
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
          title: "Example thread",
          runState: null,
          unread: false,
        },
      ],
      diagnostics: [],
    });
    api.getSnapshot.mockResolvedValue({
      version: 1,
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
        workspace: { mode: "shared", branchName: null, available: true },
      },
      transcript: [],
      currentRun: null,
      lastRun: null,
      epoch: "40000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    } satisfies ThreadSnapshot);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/projects/${projectId}/threads/${threadId}`]}
        >
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("link", { name: "Example thread" });
    const surface = container.querySelector(".tiling-surface");
    expect(surface).not.toBeNull();

    // The sidebar's own route into `/new`, which is the same crossing the
    // archive makes.
    fireEvent.click(
      screen.getByRole("button", { name: "New thread in Example project" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "New thread in Example project" }),
      ).toBeInTheDocument();
    });
    // The SAME element, not merely another one matching the selector: a
    // remount would have replaced it, taking every pane's state with it.
    expect(container.querySelector(".tiling-surface")).toBe(surface);
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
//
// Seeded from a v1 inspector record, so this also covers WSP-04's migration
// end to end: the record becomes one Files tab, which binds to the focused
// pane's thread on first render and then reads that worktree.
describe("panel Files tab search", () => {
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
      version: 1,
      project,
      thread,
      transcript: [],
      currentRun: null,
      lastRun: null,
      epoch: "40000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    } satisfies ThreadSnapshot);
    // The tree lists one level at a time; the search asks for the whole
    // subtree. Both answer from this stub.
    api.getFiles.mockResolvedValue({
      entries: [
        {
          path: "src/main.ts",
          name: "main.ts",
          kind: "file" as const,
          size: 1,
        },
      ],
      truncated: false,
      ignoredHidden: false,
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
    // The tab opens on the tree: one row, showing its own name.
    await screen.findByRole("treeitem", { name: "main.ts" });
    expect(api.getFiles).toHaveBeenCalledTimes(1);
    expect(api.getFiles).toHaveBeenLastCalledWith(projectId, threadId, {
      path: "",
      depth: "1",
      showIgnored: false,
    });

    await user.type(search, "mai");
    // Three keystrokes, still one request in flight-or-done: nothing fires
    // until typing settles.
    expect(api.getFiles).toHaveBeenCalledTimes(1);
    // ...and the panel never blanks to its loading state mid-typing.
    expect(screen.queryByText("Listing files…")).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "main.ts" })).toBeVisible();

    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(2);
    });
    // A settled search is flat, full paths, and asks for the whole subtree.
    expect(api.getFiles).toHaveBeenLastCalledWith(projectId, threadId, {
      search: "mai",
      depth: "full",
      showIgnored: false,
    });
    expect(await screen.findByText("src/main.ts")).toBeVisible();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();

    // Typing on: the settled result stays on screen while the next one runs.
    await user.type(search, "n");
    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByText("src/main.ts")).toBeVisible();
    expect(screen.queryByText("Listing files…")).not.toBeInTheDocument();
  });
});

// R2-12. The UX-7 Changes-tab states shipped in round 1 with no test at all,
// and the changes summary rescued from the deleted EnvironmentPanel lost its
// 308 lines of coverage with it. The pure summary logic is unit-tested in
// components/changesSummary.test.ts; this covers the rendering — through a
// migrated v1 inspector record, as above.
describe("panel Changes tab states", () => {
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
      version: 1,
      project,
      thread,
      transcript: [],
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
      await screen.findByText(
        /Working tree: Example project.*1 added, 1 modified/,
      ),
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

// Shell chrome that has no component of its own: it lives entirely in
// styles.css, so it is asserted against the stylesheet source. jsdom does not
// cascade, and a palette that only LOOKS right in a snapshot is what let 53
// elements fail contrast, so the colour assertions compute real ratios.
describe("shell layout and light-mode palette", () => {
  const readStyles = async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    return await readFile(resolve(here, "styles.css"), "utf8");
  };

  /** The body of the first top-level rule for `selector`. */
  const ruleBody = (css: string, selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`\\n${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    if (match === null)
      throw new Error(`no top-level rule found for selector "${selector}"`);
    return match[1] ?? "";
  };

  /** A custom property's value from the first (light) :root block. */
  const token = (css: string, name: string): string => {
    const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
    if (match === null) throw new Error(`no --${name} token in styles.css`);
    return (match[1] ?? "").trim();
  };

  const relativeLuminance = (color: string): number => {
    const hex = color.replace("#", "");
    const linear = [0, 2, 4].map((i) => {
      const s = parseInt(hex.slice(i, i + 2), 16) / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return (
      0.2126 * (linear[0] ?? 0) +
      0.7152 * (linear[1] ?? 0) +
      0.0722 * (linear[2] ?? 0)
    );
  };

  const contrast = (foreground: string, background: string): number => {
    const a = relativeLuminance(foreground);
    const b = relativeLuminance(background);
    const [lighter, darker] = a > b ? [a, b] : [b, a];
    return (lighter + 0.05) / (darker + 0.05);
  };

  // F1/F6. `hidden` clips but still makes the shell a scroll container, so
  // the collapsed panel's 400px of off-canvas overflow gave the browser
  // somewhere to scroll to, and the first click inside a pane dragged the
  // project sidebar off screen with no scrollbar to bring it back.
  it("clips the shell instead of making it scrollable, so the off-canvas panel cannot push the sidebar away", async () => {
    const css = await readStyles();
    const workspace = ruleBody(css, ".workspace");

    expect(workspace).toMatch(/overflow:\s*clip;/);
    expect(workspace).not.toMatch(/overflow:\s*hidden;/);
    expect(workspace).not.toMatch(/overflow-x:/);
  });

  // F4. Every muted string is checked against the DARKEST surface it can
  // land on, not against the page: a hovered or selected row paints --active
  // behind text that had only ever been contrast-checked on white.
  it("keeps secondary text and status colours above WCAG AA on every background they land on", async () => {
    const css = await readStyles();
    const backgrounds = {
      page: token(css, "page"),
      hover: token(css, "hover"),
      active: token(css, "active"),
      "user-pill": token(css, "user-pill"),
    };

    for (const name of ["muted", "glyph", "green", "done", "text", "text-2"]) {
      const foreground = token(css, name);
      for (const [surface, background] of Object.entries(backgrounds)) {
        const ratio = contrast(foreground, background);
        expect(
          ratio,
          `--${name} (${foreground}) on --${surface} (${background}) is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    // Small glyph affordances (the + and the ...) are single characters, not
    // words, so they carry more contrast than body-sized muted text does.
    expect(contrast(token(css, "glyph"), backgrounds.active)).toBeGreaterThan(
      contrast(token(css, "muted"), backgrounds.active),
    );

    // And the affordances the tester measured at 2.91:1 draw on it.
    for (const selector of [".thread-actions-button", ".archived-toggle"])
      expect(ruleBody(css, selector)).toMatch(/color:\s*var\(--glyph\)/);
  });

  // THE STATES NOBODY EVER AUDITED. Three rounds of contrast walks were all
  // run on an idle thread with a healthy server, and every one of them
  // reported "one failure left". Auditing the same page DURING A RUN took the
  // count from 2 to 6: "Working", the steer hint, the Stop button and the
  // spinner had never been measured by anyone, because they do not exist
  // while nothing is happening -- which is to say, they only exist in the
  // state this app is for.
  //
  // The shape of both bugs was the same and is worth naming: a colour tuned
  // as a SIGNAL (a 6px dot, a red fill) was reused as INK. A signal only has
  // to clear 3:1; ink has to clear 4.5:1. So the tokens are split, and this
  // test measures each ink against the background its own selectors actually
  // paint -- including the tint mixed from the signal colour, which is where
  // both failures were hiding.
  it("keeps transient-state text above WCAG AA on the tints it actually paints on", async () => {
    const css = await readStyles();
    const card = token(css, "card");

    /** `percent`% of `color` composited over `over`, as `color-mix` does. */
    const tint = (color: string, percent: number, over: string): string => {
      const parse = (value: string) =>
        [0, 2, 4].map((i) =>
          parseInt(value.replace("#", "").slice(i, i + 2), 16),
        );
      const [a, b] = [parse(color), parse(over)];
      return `#${[0, 1, 2]
        .map((i) =>
          Math.round(
            ((a[i] ?? 0) * percent) / 100 +
              ((b[i] ?? 0) * (100 - percent)) / 100,
          )
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
    };

    // NEW-1. "Working" in the pane header and the steering hint are WORDS,
    // and they took --run, a 3.39:1 dot colour.
    const runInk = token(css, "run-ink");
    for (const surface of ["card", "hover", "active"]) {
      const ratio = contrast(runInk, token(css, surface));
      expect(
        ratio,
        `--run-ink (${runInk}) on --${surface} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const selector of [
      ".pane-head .status.run",
      ".composer.steering .composer-actions > span:first-child",
    ])
      expect(ruleBody(css, selector)).toMatch(/color:\s*var\(--run-ink\)/);
    // The dot and the spinner rim keep the signal colour: they are non-text
    // indicators at 3:1, and darkening them would flatten the one moving mark
    // in the app to satisfy a rule about words.
    expect(ruleBody(css, ".pane-head .status .sdot.run")).toMatch(
      /background:\s*var\(--run\)/,
    );

    // NEW-2. Every failure surface paints a tint of --fail behind --fail.
    // The Stop button -- the one control anybody reaches for under time
    // pressure -- was the worst of them at 3.54:1.
    const fail = token(css, "fail");
    const failInk = token(css, "fail-ink");
    const failSurfaces: [string, number][] = [
      [".error-notice", 8],
      [".error-notice-dismiss:hover", 14],
      [".composer-actions .stop", 18],
    ];
    for (const [selector, percent] of failSurfaces) {
      const background = tint(fail, percent, card);
      const ratio = contrast(failInk, background);
      expect(
        ratio,
        `--fail-ink (${failInk}) on ${selector}'s ${String(percent)}% tint (${background}) is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
      // And the old token would still fail there, so this is a real change
      // rather than a rename.
      expect(contrast(fail, background)).toBeLessThan(4.5);
    }
    for (const selector of [
      ".error-notice-retry",
      ".error-notice-dismiss",
      ".composer-actions .stop",
      ".run-failure-body",
      ".diagnostic.error",
    ])
      expect(ruleBody(css, selector)).toMatch(/color:\s*var\(--fail-ink\)/);
    // `.error-notice` has two top-level rules and the cascading one is the
    // second, so it is matched by the pair it sets rather than by name.
    expect(css).toMatch(
      /color:\s*var\(--fail-ink\);\s*background:\s*color-mix\(in srgb, var\(--fail\) 8%, var\(--card\)\);/,
    );

    // NEW-8. WCAG 2.2 2.5.8: a pointer target is at least 24x24 CSS px, and
    // the ✕ laid out at 22.4.
    const dismiss = ruleBody(css, ".error-notice-dismiss");
    const size = /width:\s*([\d.]+)rem/.exec(dismiss)?.[1];
    expect(Number(size) * 16).toBeGreaterThanOrEqual(24);
    expect(dismiss).toMatch(new RegExp(`height:\\s*${String(size)}rem`));
  });

  // F5/S6. Two measures, and the split is the point: narrowing the shared
  // surface axis to buy prose a tighter measure also narrowed the new-chat
  // card, whose three selects then wrapped to a second row.
  it("narrows only the transcript, leaving the surface axis the cards sit on alone", async () => {
    const css = await readStyles();

    expect(css).toMatch(/--surface-measure:\s*48rem;/);
    expect(css).toMatch(/--transcript-measure:\s*[\d.]+rem;/);

    // The transcript is capped by BOTH: its own measure narrows it, and the
    // surface axis still bounds it, so a reply can never be laid out wider
    // than the composer that asked for it.
    expect(ruleBody(css, ".transcript-column")).toMatch(
      /max-width:\s*min\(\s*var\(--transcript-measure\),\s*var\(--surface-measure\)\s*\)/,
    );

    // Only the transcript gets the tighter measure; every other surface stays
    // on the shared axis.
    for (const selector of [".composer-input", ".new-chat-card"])
      expect(ruleBody(css, selector)).toMatch(/var\(--surface-measure\)/);
  });

  // F5. A measure means nothing without the type set in it, so both halves
  // are asserted together: 40rem at 1rem lands the median full line at 83
  // characters, measured in Chrome across 48 real transcript paragraphs.
  it("sets a reading measure and body copy that produce a comfortable line", async () => {
    const css = await readStyles();

    expect(ruleBody(css, ".a-block")).toMatch(/font-size:\s*1rem;/);
    expect(ruleBody(css, ".u-bubble")).toMatch(/font-size:\s*1rem;/);

    // Paragraph breaks have to read as breaks: the gap between two
    // paragraphs must beat the leading inside one, which the UA default of
    // 1em against a 1.6 line-height did not.
    const paragraphs = ruleBody(css, ".markdown > :is(p, ul, ol, blockquote)");
    const gap = /margin-block:\s*0\s+([\d.]+)em;/.exec(paragraphs);
    expect(gap, "paragraphs need an explicit bottom margin").not.toBeNull();
    const leading = /line-height:\s*([\d.]+);/.exec(ruleBody(css, ".markdown"));
    expect(Number(gap?.[1])).toBeGreaterThan(0.75 * Number(leading?.[1]));
  });

  // S6. The floor under --transcript-measure, and the reason it is not tuned
  // purely for prose: this is a coding tool, and an 80-column block is the
  // width code is written to. Prose would prefer 38rem; code needs 39.3rem;
  // the token resolves that in code's favour, and this pins the floor so a
  // future "let's tighten the measure" cannot quietly reintroduce the scroll.
  it("keeps the transcript wide enough that an 80-column code block does not scroll", async () => {
    const css = await readStyles();

    // ui-monospace advances 0.6014em per character in Chrome, measured on the
    // app's own `.markdown pre` at its computed 12.48px.
    const monoAdvanceRatio = 0.6014;
    const rootFontPx = 16;

    const measure = /--transcript-measure:\s*([\d.]+)rem;/.exec(css);
    expect(measure, "the transcript needs its own measure").not.toBeNull();

    // This rule heads a selector list, so it is read directly rather than
    // through ruleBody (which only matches a lone selector before its brace).
    const pre = /\n\.markdown pre,[\s\S]*?\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    const fontRem = /font:\s*([\d.]+)rem\//.exec(pre);
    const paddingRem = /padding:\s*([\d.]+)rem;/.exec(pre);
    const borderPx = /border:\s*([\d.]+)px/.exec(pre);
    for (const [name, match] of Object.entries({
      fontRem,
      paddingRem,
      borderPx,
    }))
      expect(match, `.markdown pre should declare ${name}`).not.toBeNull();

    const columnPx = Number(measure?.[1]) * rootFontPx;
    const requiredPx =
      80 * Number(fontRem?.[1]) * rootFontPx * monoAdvanceRatio +
      2 * Number(paddingRem?.[1]) * rootFontPx +
      2 * Number(borderPx?.[1]);

    expect(
      columnPx,
      `an 80-column block needs ${requiredPx.toFixed(1)}px but the column is ${columnPx.toFixed(1)}px`,
    ).toBeGreaterThanOrEqual(requiredPx);
  });

  // F11/F12. Red is the app's only irreversible-action signal, and archiving
  // is undoable twice over -- an undo toast, then the Archived section.
  it("keeps the thread menu neutral and quiet", async () => {
    const css = await readStyles();

    // Nothing is destructive by POSITION any more; an item has to say so.
    expect(css).not.toMatch(/\.thread-context-menu button:last-child/);
    expect(css).toMatch(/\.thread-context-menu button\.destructive/);

    // 53% black under a popover reads as a bruise on a near-white sidebar.
    const menu = ruleBody(css, ".thread-context-menu");
    expect(menu).toMatch(/box-shadow:\s*var\(--pop-shadow\)/);

    // Both themes are asserted, because they deliberately DIFFER and an
    // earlier version of this test only ever read the first (light) block --
    // it would have passed whatever dark held. Light must be quiet; dark must
    // stay heavy, because a shadow tuned for a white page is invisible on a
    // #131417 one. Neither value is allowed to drift into the other's range.
    const declarations = [...css.matchAll(/--pop-shadow:([\s\S]*?);/g)].map(
      (match) =>
        [...(match[1] ?? "").matchAll(/rgba\([^)]*?,\s*([\d.]+)\)/g)].map(
          (alpha) => Number(alpha[1]),
        ),
    );
    // One light :root, plus the prefers-color-scheme and [data-theme] blocks.
    expect(declarations).toHaveLength(3);

    const [light, ...dark] = declarations;
    expect(light?.length).toBeGreaterThan(0);
    for (const alpha of light ?? []) expect(alpha).toBeLessThanOrEqual(0.15);
    for (const theme of dark)
      for (const alpha of theme) expect(alpha).toBeGreaterThanOrEqual(0.3);
  });

  // F13. Neither of these had a ring at all: `outline: none` plus a hover
  // fill, which is indistinguishable from a pointer passing over.
  it("gives every focusable control a 2px ring rather than a background swap", async () => {
    const css = await readStyles();

    for (const selector of [
      ".thread-context-menu button:focus-visible",
      ".new-chat-toolbar select:focus-visible",
    ]) {
      const body = ruleBody(css, selector);
      expect(body, `${selector} has no ring`).toMatch(
        /outline:\s*2px solid var\(--focus-ring\)/,
      );
      expect(body).toMatch(/outline-offset:\s*-?[12]px/);
    }

    // A half-transparent ring composites to about 2.3:1 on white, under the
    // 3:1 a focus indicator needs. It is opaque in both themes now.
    expect(css).not.toMatch(/--focus-ring:\s*rgba\(/);
  });

  // F12, the other half: the menu opened from the trigger's BOTTOM edge,
  // directly over the next thread, so the user lost sight of the list they
  // were acting on. It now opens off the row's right edge, level with it.
  it("anchors the thread actions menu beside its row, not over the row below", async () => {
    const menuProjectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
    api.getWorkspace.mockResolvedValue({
      projects: [
        {
          id: menuProjectId,
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
          id: "20000000-0000-4000-8000-000000000001" as ThreadId,
          projectId: menuProjectId,
          title: "First thread",
          runState: null,
          unread: false,
        },
        {
          id: "20000000-0000-4000-8000-000000000002" as ThreadId,
          projectId: menuProjectId,
          title: "Second thread",
          runState: null,
          unread: false,
        },
      ],
      diagnostics: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/projects/${menuProjectId}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const trigger = await screen.findByRole("button", {
      name: "Actions for First thread",
    });
    // jsdom lays nothing out, so the trigger is handed the geometry a real
    // 272px sidebar reports for the first row's "..." button.
    const bounds = {
      x: 231,
      y: 210,
      width: 28,
      height: 28,
      top: 210,
      right: 259,
      bottom: 238,
      left: 231,
    };
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      ...bounds,
      toJSON: () => bounds,
    });
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: "Actions for First thread" });
    // Right of the trigger, so it clears the sidebar's rows entirely...
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThan(bounds.right);
    // ...and level with the row that opened it, never below it.
    expect(Number.parseFloat(menu.style.top)).toBe(bounds.top);
  });
});

// A failed inline rename belongs to the editor and draft that produced it.
// Editing clears it for retry; Revert exits it; and opening another thread's
// editor starts clean rather than inheriting the previous mutation state.
describe("a rename that fails", () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
  const first = "20000000-0000-4000-8000-000000000001" as ThreadId;
  const second = "20000000-0000-4000-8000-000000000002" as ThreadId;

  function renderTwoThreads() {
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
          id: first,
          projectId,
          title: "First thread",
          runState: null,
          unread: false,
        },
        {
          id: second,
          projectId,
          title: "Second thread",
          runState: null,
          unread: false,
        },
      ],
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

  // Scoped to the form: the sidebar can carry other alerts (a project
  // diagnostic, a failed snapshot), and the finding is about THIS one.
  function renameForm(): HTMLElement {
    const form = document.querySelector(".thread-rename");
    if (!(form instanceof HTMLElement)) throw new Error("no rename form open");
    return form;
  }

  async function openRenameOf(
    user: ReturnType<typeof userEvent.setup>,
    title: string,
  ) {
    fireEvent.contextMenu(screen.getByRole("link", { name: title }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  }

  async function failRenameOf(
    user: ReturnType<typeof userEvent.setup>,
    title: string,
  ) {
    await openRenameOf(user, title);
    const field = within(renameForm()).getByRole("textbox", {
      name: `Rename ${title}`,
    });
    await user.clear(field);
    await user.type(field, `${title} draft{Enter}`);
    return await within(renameForm()).findByRole("alert");
  }

  it("clears while editing for retry, and comes back for the next failure", async () => {
    api.renameThread.mockRejectedValue(new Error("Renaming is not allowed."));
    const user = userEvent.setup();
    renderTwoThreads();
    await screen.findByRole("link", { name: "First thread" });

    const alert = await failRenameOf(user, "First thread");
    expect(alert).toHaveTextContent(
      "Could not rename this thread: Renaming is not allowed.",
    );

    const field = within(renameForm()).getByRole("textbox", {
      name: "Rename First thread",
    });
    await user.clear(field);
    await user.type(field, "Retry title");
    expect(within(renameForm()).queryByRole("alert")).not.toBeInTheDocument();

    api.renameThread.mockRejectedValue(new Error("The thread is gone."));
    await user.keyboard("{Enter}");
    expect(await within(renameForm()).findByRole("alert")).toHaveTextContent(
      "Could not rename this thread: The thread is gone.",
    );
  });

  it("does not follow the reader onto another thread", async () => {
    api.renameThread.mockRejectedValue(new Error("Renaming is not allowed."));
    const user = userEvent.setup();
    renderTwoThreads();
    await screen.findByRole("link", { name: "First thread" });

    await failRenameOf(user, "First thread");
    await user.click(
      within(renameForm()).getByRole("button", { name: "Revert title" }),
    );
    expect(document.querySelector(".thread-rename")).toBeNull();

    await openRenameOf(user, "Second thread");

    expect(
      within(renameForm()).getByRole("textbox", {
        name: "Rename Second thread",
      }),
    ).toBeInTheDocument();
    // The first thread's failure has nothing to say about this one.
    expect(within(renameForm()).queryByRole("alert")).not.toBeInTheDocument();
  });
});
