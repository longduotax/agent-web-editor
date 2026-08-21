// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";
import type {
  GitBranch,
  ProjectId,
  RunId,
  ThreadId,
  ThreadSnapshot,
} from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { EnvironmentPanel } from "./EnvironmentPanel.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
const otherThreadId = "20000000-0000-4000-8000-000000000002" as ThreadId;
const paneA = "pane-a";
const paneB = "pane-b";

function makeSnapshot(
  id: ThreadId,
  title: string,
  overrides: Partial<ThreadSnapshot["thread"]> = {},
): ThreadSnapshot {
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
      runState: "running",
      unread: false,
      runtimeAvailable: true,
      workspace: {
        mode: "worktree",
        branchName: "feature/env-panel" as GitBranch,
        baseBranch: "main" as GitBranch,
        baseCommit: "abc1234",
        available: true,
      },
      ...overrides,
    },
    transcript: [],
    currentRun: {
      id: "30000000-0000-4000-8000-000000000001" as RunId,
      threadId: id,
      projectId,
      state: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      failureCode: null,
      failureMessage: null,
    },
    lastRun: null,
    epoch: "40000000-0000-4000-8000-000000000001",
    highWaterSequence: 0,
    capabilities: { prompt: true, steer: true, stop: true },
    diagnostics: [],
  };
}

function makeController(
  layout: WorkspaceLayoutController["layout"],
): WorkspaceLayoutController {
  return {
    layout,
    dispatch: vi.fn(),
    assignThreadToPane: vi.fn(),
    newPane: vi.fn(),
    focus: vi.fn(),
    bind: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    replaceLayout: vi.fn(),
  };
}

function renderPanel(controller: WorkspaceLayoutController) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EnvironmentPanel
        projectId={projectId}
        controller={controller}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("EnvironmentPanel", () => {
  it("shows the focused thread's title, status label, branch, and a changes summary", async () => {
    api.getSnapshot.mockImplementation((_p: ProjectId, id: ThreadId) =>
      Promise.resolve(
        id === threadId
          ? makeSnapshot(threadId, "Example thread")
          : makeSnapshot(otherThreadId, "Other thread"),
      ),
    );
    api.getStatus.mockResolvedValue({
      available: true,
      files: [
        {
          path: "a.ts",
          originalPath: null,
          indexStatus: "M",
          worktreeStatus: " ",
          kind: "modified",
        },
        {
          path: "b.ts",
          originalPath: null,
          indexStatus: "M",
          worktreeStatus: " ",
          kind: "modified",
        },
      ],
      message: null,
    });

    const layout: WorkspaceLayoutController["layout"] = {
      root: null,
      panes: {
        [paneA]: { threadId },
        [paneB]: { threadId: otherThreadId },
      },
      focusedPaneId: paneA,
      boundPaneId: null,
    };

    renderPanel(makeController(layout));

    expect(
      await screen.findByRole("complementary", { name: "Environment" }),
    ).toBeInTheDocument();
    await screen.findByText("Example thread");
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("feature/env-panel")).toBeInTheDocument();
    expect(await screen.findByText("2 modified")).toBeInTheDocument();
  });

  it("updates the shown branch when focus moves to a different threaded pane", async () => {
    api.getSnapshot.mockImplementation((_p: ProjectId, id: ThreadId) =>
      Promise.resolve(
        id === threadId
          ? makeSnapshot(threadId, "Example thread", {
              workspace: {
                mode: "worktree",
                branchName: "feature/first" as GitBranch,
                baseBranch: "main" as GitBranch,
                baseCommit: "abc1234",
                available: true,
              },
            })
          : makeSnapshot(otherThreadId, "Other thread", {
              workspace: {
                mode: "worktree",
                branchName: "feature/second" as GitBranch,
                baseBranch: "main" as GitBranch,
                baseCommit: "def5678",
                available: true,
              },
            }),
      ),
    );
    api.getStatus.mockResolvedValue({
      available: true,
      files: [],
      message: null,
    });

    const layout: WorkspaceLayoutController["layout"] = {
      root: null,
      panes: {
        [paneA]: { threadId },
        [paneB]: { threadId: otherThreadId },
      },
      focusedPaneId: paneA,
      boundPaneId: null,
    };

    const { rerender } = renderPanel(makeController(layout));
    await screen.findByText("feature/first");

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <EnvironmentPanel
          projectId={projectId}
          controller={makeController({ ...layout, focusedPaneId: paneB })}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await screen.findByText("feature/second");
    expect(screen.queryByText("feature/first")).not.toBeInTheDocument();
  });

  it("shows an empty state when no pane is focused", () => {
    const layout: WorkspaceLayoutController["layout"] = {
      root: null,
      panes: {},
      focusedPaneId: null,
      boundPaneId: null,
    };
    renderPanel(makeController(layout));

    expect(screen.getByText("No focused run")).toBeInTheDocument();
    expect(api.getSnapshot).not.toHaveBeenCalled();
  });

  it("shows an empty state when the focused pane is threadless", () => {
    const layout: WorkspaceLayoutController["layout"] = {
      root: null,
      panes: { [paneA]: { threadId: null } },
      focusedPaneId: paneA,
      boundPaneId: null,
    };
    renderPanel(makeController(layout));

    expect(screen.getByText("No focused run")).toBeInTheDocument();
    expect(api.getSnapshot).not.toHaveBeenCalled();
  });

  it("renders exactly one Environment region", () => {
    const layout: WorkspaceLayoutController["layout"] = {
      root: null,
      panes: {},
      focusedPaneId: null,
      boundPaneId: null,
    };
    renderPanel(makeController(layout));

    expect(
      screen.getAllByRole("complementary", { name: "Environment" }),
    ).toHaveLength(1);
  });

  it("has no axe violations", async () => {
    api.getSnapshot.mockResolvedValue(makeSnapshot(threadId, "Example thread"));
    api.getStatus.mockResolvedValue({
      available: true,
      files: [
        {
          path: "a.ts",
          originalPath: null,
          indexStatus: "M",
          worktreeStatus: " ",
          kind: "modified",
        },
      ],
      message: null,
    });
    const layout: WorkspaceLayoutController["layout"] = {
      root: null,
      panes: { [paneA]: { threadId } },
      focusedPaneId: paneA,
      boundPaneId: null,
    };

    const { container } = renderPanel(makeController(layout));
    await screen.findByText("Example thread");

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
