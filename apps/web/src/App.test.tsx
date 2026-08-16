// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectId,
  RunId,
  ThreadId,
  ThreadSnapshot,
} from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  archiveThread: vi.fn(),
  discoverSessions: vi.fn(),
  getSnapshot: vi.fn(),
  getWorkspace: vi.fn(),
  importThread: vi.fn(),
  prompt: vi.fn(),
  renameThread: vi.fn(),
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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
    api.getSnapshot.mockResolvedValue({
      version: 1,
      project: workspace.projects[0],
      thread: {
        id: importedThreadId,
        projectId,
        title: "Existing session",
        runtimeSessionId: "50000000-0000-4000-8000-000000000001",
        runState: null,
        unread: false,
      },
      transcript: [],
      currentRun: null,
      lastRun: null,
      epoch: "60000000-0000-4000-8000-000000000001",
      highWaterSequence: 0,
      capabilities: { prompt: true, steer: true, stop: true },
      diagnostics: [],
    });
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
    expect(
      await screen.findByRole("button", {
        name: "Archive Renamed thread (unavailable while running)",
      }),
    ).toBeDisabled();
    fireEvent.contextMenu(
      screen.getByRole("link", { name: /Renamed thread.*Running/ }),
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
      await screen.findByRole("button", { name: "Archive Renamed thread" }),
    );
    await waitFor(() => {
      expect(api.archiveThread).toHaveBeenCalledWith(projectId, threadId);
    });
    expect(screen.queryByText("Renamed thread")).not.toBeInTheDocument();
  });
});
