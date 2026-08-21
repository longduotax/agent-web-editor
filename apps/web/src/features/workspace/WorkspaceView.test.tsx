// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId, ThreadId, ThreadSnapshot } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  archiveThread: vi.fn(),
  getSnapshot: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspacePreflight: vi.fn(),
  markViewed: vi.fn(),
  prompt: vi.fn(),
  startThread: vi.fn(),
  steer: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { WorkspaceView } from "./WorkspaceView.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
const otherThreadId = "20000000-0000-4000-8000-000000000002" as ThreadId;

function makeSnapshot(id: ThreadId, title: string): ThreadSnapshot {
  return {
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
      lastOpenedThreadId: id,
    },
    thread: {
      id,
      projectId,
      title,
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
}

const snapshot: ThreadSnapshot = makeSnapshot(threadId, "Example thread");
const otherSnapshot: ThreadSnapshot = makeSnapshot(
  otherThreadId,
  "Other thread",
);

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

function stubMacPlatform() {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
}

function renderWorkspace(
  initialEntry: string,
  options?: {
    seedStore?: (store: Map<string, string>) => void;
    snapshots?: Record<string, ThreadSnapshot>;
  },
) {
  const store = stubStorage();
  options?.seedStore?.(store);
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
    branches: ["main"],
    headCommit: "1234567",
    changes: null,
  });
  const snapshotsById = options?.snapshots ?? { [threadId]: snapshot };
  api.getSnapshot.mockImplementation(
    (_projectId: ProjectId, id: ThreadId) =>
      Promise.resolve(snapshotsById[id] ?? snapshot),
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/projects/:projectId"
            element={<WorkspaceView projectId={projectId} />}
          />
          <Route
            path="/projects/:projectId/threads/:threadId"
            element={<WorkspaceView projectId={projectId} />}
          />
          <Route
            path="/projects/:projectId/new"
            element={<WorkspaceView projectId={projectId} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkspaceView", () => {
  it("dispatches a split command on the split-right keychord and prevents the browser default", async () => {
    stubMacPlatform();
    renderWorkspace(`/projects/${projectId}`);
    await screen.findByLabelText("New chat");

    const before = fireEvent.keyDown(window, {
      key: "+",
      metaKey: true,
      shiftKey: true,
    });
    // fireEvent.keyDown returns false when preventDefault() was called.
    expect(before).toBe(false);

    await screen.findAllByLabelText("New chat");
    expect(screen.getAllByLabelText("New chat")).toHaveLength(2);
  });

  it("does nothing on a non-matching keydown", async () => {
    stubMacPlatform();
    renderWorkspace(`/projects/${projectId}`);
    await screen.findByLabelText("New chat");

    const result = fireEvent.keyDown(window, { key: "a" });
    expect(result).toBe(true); // default was not prevented
    expect(screen.getAllByLabelText("New chat")).toHaveLength(1);
  });

  function closeButtonFor(name: string): HTMLElement {
    const region = screen.getByRole("region", { name });
    const closeButton = region
      .closest(".pane")
      ?.querySelector('[aria-label="Close"]');
    if (closeButton === null || closeButton === undefined)
      throw new Error("expected a close button");
    return closeButton as HTMLElement;
  }

  it("closes a threaded pane immediately (no archive call yet) and shows an undo toast", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`);
    await screen.findByRole("region", { name: "Example thread" });

    fireEvent.click(closeButtonFor("Example thread"));

    // The pane is gone right away — no modal, no waiting on the network.
    await screen.findByText("No panes are open.");
    expect(
      screen.queryByRole("region", { name: "Example thread" }),
    ).not.toBeInTheDocument();
    expect(api.archiveThread).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("archives the thread once the undo toast times out", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`);
    await screen.findByRole("region", { name: "Example thread" });

    vi.useFakeTimers();
    fireEvent.click(closeButtonFor("Example thread"));
    expect(api.archiveThread).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(api.archiveThread).toHaveBeenCalledTimes(1);
    expect(api.archiveThread).toHaveBeenCalledWith(projectId, threadId);
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
  });

  it("clicking Undo restores the pane with no archive call, ever", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`);
    await screen.findByRole("region", { name: "Example thread" });

    vi.useFakeTimers();
    fireEvent.click(closeButtonFor("Example thread"));
    expect(screen.getByText("No panes are open.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(
      screen.getByRole("region", { name: "Example thread" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();

    // Undo cancelled the deferred archive outright — even letting the
    // original timeout elapse must never call archiveThread.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(api.archiveThread).not.toHaveBeenCalled();
  });

  it("closing a threadless (new-chat) pane shows no toast and never archives", async () => {
    stubMacPlatform();
    renderWorkspace(`/projects/${projectId}`);
    await screen.findByLabelText("New chat");

    const composer = screen.getByLabelText("New chat").closest(".pane");
    const closeButton = composer?.querySelector('[aria-label="Close"]');
    if (closeButton === null || closeButton === undefined)
      throw new Error("expected a close button");
    fireEvent.click(closeButton);

    await screen.findByText("No panes are open.");
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(api.archiveThread).not.toHaveBeenCalled();
  });

  function seedTwoPaneLayout(store: Map<string, string>) {
    const seededPaneA = "seeded-pane-a";
    const seededPaneB = "seeded-pane-b";
    store.set(
      `pi-workspace:layout:${projectId}`,
      JSON.stringify({
        version: 2,
        root: {
          type: "split",
          id: "seeded-split",
          axis: "row",
          children: [
            { type: "pane", id: seededPaneA },
            { type: "pane", id: seededPaneB },
          ],
          sizes: [0.5, 0.5],
        },
        panes: {
          [seededPaneA]: { threadId },
          [seededPaneB]: { threadId: otherThreadId },
        },
        focusedPaneId: seededPaneA,
        boundPaneId: null,
      }),
    );
  }

  it("flushes (archives now) a pending close's thread when a second pane is closed before its toast times out, and gives the second pane a fresh full timeoutMs window (not the first's leftover time)", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderWorkspace(`/projects/${projectId}`, {
      snapshots: { [threadId]: snapshot, [otherThreadId]: otherSnapshot },
      seedStore: seedTwoPaneLayout,
    });

    await screen.findByRole("region", { name: "Example thread" });
    await screen.findByRole("region", { name: "Other thread" });

    vi.useFakeTimers();
    fireEvent.click(closeButtonFor("Example thread"));
    expect(api.archiveThread).not.toHaveBeenCalled();

    // Let most (but not all) of the first toast's window elapse before
    // flushing it, so a stale/reused timer for the second pane would fire
    // almost immediately — distinguishing that bug from a correctly fresh
    // 6s window starting at B's own close.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(api.archiveThread).not.toHaveBeenCalled();

    fireEvent.click(closeButtonFor("Other thread"));

    // Closing the second pane while the first's toast was still pending
    // flushes (archives) the first thread immediately...
    expect(api.archiveThread).toHaveBeenCalledTimes(1);
    expect(api.archiveThread).toHaveBeenCalledWith(projectId, threadId);

    // ...and starts a fresh deferred archive for the second: just past
    // where the first pane's stale timer would have fired (1000ms further,
    // i.e. 6000ms since A's close but only 1000ms since B's), it must NOT
    // have archived yet.
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.archiveThread).toHaveBeenCalledTimes(1);

    // Only once a full 6000ms has elapsed since B's own close does it
    // archive.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(api.archiveThread).toHaveBeenCalledTimes(2);
    expect(api.archiveThread).toHaveBeenCalledWith(projectId, otherThreadId);
  });

  it("clicking Undo on the second (flushed) pane's toast still results in zero archive calls for it", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderWorkspace(`/projects/${projectId}`, {
      snapshots: { [threadId]: snapshot, [otherThreadId]: otherSnapshot },
      seedStore: seedTwoPaneLayout,
    });

    await screen.findByRole("region", { name: "Example thread" });
    await screen.findByRole("region", { name: "Other thread" });

    vi.useFakeTimers();
    fireEvent.click(closeButtonFor("Example thread"));
    fireEvent.click(closeButtonFor("Other thread"));
    expect(api.archiveThread).toHaveBeenCalledTimes(1);
    expect(api.archiveThread).toHaveBeenCalledWith(projectId, threadId);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(
      screen.getByRole("region", { name: "Other thread" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // Still just the one archive call, for the flushed first pane — never
    // one for the second (undone) pane.
    expect(api.archiveThread).toHaveBeenCalledTimes(1);
  });

  it("focuses/creates a pane for the thread named in the route on mount", async () => {
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`);

    const heading = await screen.findByRole("heading", {
      name: "Example thread",
    });
    const region = heading.closest("[aria-current]");
    expect(region).toHaveAttribute("aria-current", "true");
  });

  it("suppresses workspace shortcuts while a text-editing target is focused, so native text-editing shortcuts (e.g. select-to-start/end, delete-to-start) reach the input untouched", async () => {
    stubMacPlatform();
    renderWorkspace(`/projects/${projectId}`);
    const composer = await screen.findByLabelText("First message");
    composer.focus();

    // Cmd+Shift+ArrowDown used to be the "collapse" chord; on a mac it also
    // means select-to-end-of-field inside a text input. With a
    // text-editing target focused, the workspace shortcut must be
    // suppressed entirely (no preventDefault, no dispatch).
    const result = fireEvent.keyDown(composer, {
      key: "ArrowDown",
      metaKey: true,
      shiftKey: true,
    });
    expect(result).toBe(true); // default was not prevented

    expect(screen.queryByText("No panes are open.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New chat")).toBeInTheDocument();
  });

  it("mounts the tiling surface on the /new route, creating a focused threadless pane even when the persisted layout's focused pane already has a thread", async () => {
    const seededPaneId = "seeded-pane";
    renderWorkspace(`/projects/${projectId}/new`, {
      seedStore: (store) => {
        store.set(
          `pi-workspace:layout:${projectId}`,
          JSON.stringify({
            version: 2,
            root: { type: "pane", id: seededPaneId },
            panes: { [seededPaneId]: { threadId } },
            focusedPaneId: seededPaneId,
            boundPaneId: null,
          }),
        );
      },
    });

    // The persisted pane still has "Example thread" tiled...
    await screen.findByRole("heading", { name: "Example thread" });
    expect(document.querySelector(".tiling-surface")).not.toBeNull();

    // ...and landing on /new adds and focuses a fresh threadless pane
    // alongside it, rather than reusing the already-threaded one.
    const composer = await screen.findByLabelText("First message");
    expect(composer.closest(".pane")).toHaveClass("focused");
  });

  it("renders no dock chrome: no 'Docked panes' group anywhere in the view", async () => {
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`);
    await screen.findByRole("region", { name: "Example thread" });

    expect(
      screen.queryByRole("group", { name: "Docked panes" }),
    ).not.toBeInTheDocument();
  });

  it("never moves focus when a pane's run state changes to failed (header/sidebar indicators update, focus does not)", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const store = stubStorage();
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
      branches: ["main"],
      headCommit: "1234567",
      changes: null,
    });
    let currentSnapshot = snapshot;
    api.getSnapshot.mockImplementation(() => Promise.resolve(currentSnapshot));

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/projects/${projectId}/threads/${threadId}`]}
        >
          <Routes>
            <Route
              path="/projects/:projectId/threads/:threadId"
              element={<WorkspaceView projectId={projectId} />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("region", { name: "Example thread" });

    const layoutKey = `pi-workspace:layout:${projectId}`;
    const before = JSON.parse(store.get(layoutKey) ?? "null") as {
      focusedPaneId: string | null;
    };
    expect(before.focusedPaneId).not.toBeNull();

    // Simulate the run transitioning to failed: the header status must
    // update, but nothing may call the focus setter as a side effect.
    currentSnapshot = {
      ...snapshot,
      thread: { ...snapshot.thread, runState: "failed" },
    };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
    });

    await screen.findByText("Failed");

    const after = JSON.parse(store.get(layoutKey) ?? "null") as {
      focusedPaneId: string | null;
    };
    expect(after.focusedPaneId).toBe(before.focusedPaneId);
  });
});
