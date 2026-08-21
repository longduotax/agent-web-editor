// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { useWorkspaceLayout } from "./useWorkspaceLayout.js";
import { tiledPaneIds } from "./layoutTree.js";
import { DockRow } from "./Dock.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId1 = "20000000-0000-4000-8000-000000000001" as ThreadId;
const threadId2 = "20000000-0000-4000-8000-000000000002" as ThreadId;

function snapshotFor(
  threadId: ThreadId,
  thread: { title: string; runState: string | null; unread: boolean },
) {
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
      lastOpenedThreadId: threadId,
    },
    thread: {
      id: threadId,
      projectId,
      title: thread.title,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      runState: thread.runState,
      unread: thread.unread,
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

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(() => useWorkspaceLayout(projectId), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { result, queryClient };
}

describe("DockRow", () => {
  it("shows an accessible attention indicator only for the settled-unread pane, and none for a threadless pane", async () => {
    const { result, queryClient } = setup();

    // Two tiled panes to start (default layout), plus one more split so we
    // have three panes total: two get threads assigned, one stays threadless.
    act(() => {
      result.current.dispatch({ type: "split", axis: "row" });
    });
    const initialTiled = tiledPaneIds(result.current.layout);
    expect(initialTiled.length).toBeGreaterThanOrEqual(2);
    const [paneA, paneB] = initialTiled;
    if (paneA === undefined || paneB === undefined)
      throw new Error("expected two tiled panes");

    act(() => {
      result.current.assignThreadToPane(paneA, threadId1);
    });
    act(() => {
      result.current.assignThreadToPane(paneB, threadId2);
    });

    // Collapse both into the dock.
    act(() => {
      result.current.collapse(paneA);
    });
    act(() => {
      result.current.collapse(paneB);
    });

    expect(result.current.layout.docked).toContain(paneA);
    expect(result.current.layout.docked).toContain(paneB);

    api.getSnapshot.mockImplementation(
      (_projectId: ProjectId, tid: ThreadId) => {
        if (tid === threadId1)
          return snapshotFor(threadId1, {
            title: "Alpha",
            runState: "completed",
            unread: true,
          });
        if (tid === threadId2)
          return snapshotFor(threadId2, {
            title: "Beta",
            runState: "running",
            unread: true,
          });
        throw new Error(`unexpected threadId ${tid}`);
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <DockRow projectId={projectId} controller={result.current} />
      </QueryClientProvider>,
    );

    const alphaChip = await screen.findByRole("button", { name: /Alpha/ });
    const betaChip = await screen.findByRole("button", { name: /Beta/ });

    expect(
      within(alphaChip).queryByText("needs attention"),
    ).toBeInTheDocument();
    expect(
      within(betaChip).queryByText("needs attention"),
    ).not.toBeInTheDocument();
  });

  it("restores a docked pane when its chip is clicked", async () => {
    const { result, queryClient } = setup();

    act(() => {
      result.current.dispatch({ type: "split", axis: "row" });
    });
    const [paneA] = tiledPaneIds(result.current.layout);
    if (paneA === undefined) throw new Error("expected a tiled pane");

    act(() => {
      result.current.assignThreadToPane(paneA, threadId1);
    });
    act(() => {
      result.current.collapse(paneA);
    });
    expect(result.current.layout.docked).toContain(paneA);
    const dockedCountBefore = result.current.layout.docked.length;
    const tiledCountBefore = tiledPaneIds(result.current.layout).length;

    api.getSnapshot.mockResolvedValue(
      snapshotFor(threadId1, {
        title: "Alpha",
        runState: "completed",
        unread: true,
      }),
    );

    function DockHost() {
      return <DockRow projectId={projectId} controller={result.current} />;
    }

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <DockHost />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    const alphaChip = await screen.findByRole("button", { name: /Alpha/ });
    await act(async () => {
      await user.click(alphaChip);
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <DockHost />
      </QueryClientProvider>,
    );

    expect(result.current.layout.docked.length).toBeLessThan(dockedCountBefore);
    expect(tiledPaneIds(result.current.layout).length).toBeGreaterThan(
      tiledCountBefore,
    );
  });

  it("renders 'New chat' with no attention indicator for a threadless docked pane", async () => {
    const { result, queryClient } = setup();

    act(() => {
      result.current.dispatch({ type: "split", axis: "row" });
    });
    const [paneA] = tiledPaneIds(result.current.layout);
    if (paneA === undefined) throw new Error("expected a tiled pane");
    // paneA has no threadId assigned.
    act(() => {
      result.current.collapse(paneA);
    });
    expect(result.current.layout.docked).toContain(paneA);

    render(
      <QueryClientProvider client={queryClient}>
        <DockRow projectId={projectId} controller={result.current} />
      </QueryClientProvider>,
    );

    const chip = await screen.findByRole("button", { name: /New chat/ });
    expect(within(chip).queryByText("needs attention")).not.toBeInTheDocument();
    expect(api.getSnapshot).not.toHaveBeenCalled();
  });
});
