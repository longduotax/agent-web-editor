// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  options?: { seedStore?: (store: Map<string, string>) => void },
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
  api.getSnapshot.mockResolvedValue(snapshot);

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

  it("archives a threaded pane exactly once even on a double-invoke close, then removes the pane", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`);

    const region = await screen.findByRole("region", {
      name: "Example thread",
    });
    const closeButton = region
      .closest(".pane")
      ?.querySelector('[aria-label="Close"]');
    if (closeButton === null || closeButton === undefined)
      throw new Error("expected a close button");

    fireEvent.click(closeButton);
    fireEvent.click(closeButton);

    await screen.findByText("No panes are open.");
    expect(api.archiveThread).toHaveBeenCalledTimes(1);
    expect(api.archiveThread).toHaveBeenCalledWith(projectId, threadId);
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

    // Cmd+Shift+ArrowDown is the "collapse" chord; on a mac it also
    // means select-to-end-of-field inside a text input. With a
    // text-editing target focused, the workspace shortcut must be
    // suppressed entirely (no preventDefault, no collapse).
    const result = fireEvent.keyDown(composer, {
      key: "ArrowDown",
      metaKey: true,
      shiftKey: true,
    });
    expect(result).toBe(true); // default was not prevented

    // Collapsing the sole pane would swap the tiling surface to its empty
    // state and add a dock chip; neither happened.
    expect(screen.queryByText("No panes are open.")).not.toBeInTheDocument();
    expect(document.querySelector(".dock-chip")).toBeNull();
    expect(screen.getByLabelText("New chat")).toBeInTheDocument();
  });

  it("mounts the tiling surface and dock on the /new route, creating a focused threadless pane even when the persisted layout's focused pane already has a thread", async () => {
    const seededPaneId = "seeded-pane";
    renderWorkspace(`/projects/${projectId}/new`, {
      seedStore: (store) => {
        store.set(
          `pi-workspace:layout:${projectId}`,
          JSON.stringify({
            version: 1,
            root: { type: "pane", id: seededPaneId },
            panes: { [seededPaneId]: { threadId } },
            docked: [],
            focusedPaneId: seededPaneId,
            boundPaneId: null,
          }),
        );
      },
    });

    // The persisted pane still has "Example thread" tiled...
    await screen.findByRole("heading", { name: "Example thread" });
    expect(document.querySelector(".tiling-surface")).not.toBeNull();
    expect(document.querySelector(".dock-row")).not.toBeNull();

    // ...and landing on /new adds and focuses a fresh threadless pane
    // alongside it, rather than reusing the already-threaded one.
    const composer = await screen.findByLabelText("First message");
    expect(composer.closest(".pane")).toHaveClass("pane-focused");
  });
});
