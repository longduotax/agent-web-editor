// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId, ThreadId, ThreadSnapshot } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  markViewed: vi.fn(),
  prompt: vi.fn(),
  steer: vi.fn(),
  stop: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspacePreflight: vi.fn(),
  startThread: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { tiledPaneIds } from "./layoutTree.js";
import { useWorkspaceLayout } from "./useWorkspaceLayout.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";
import { TilingSurface } from "./TilingSurface.js";

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

function snapshotFor(id: ThreadId, title: string): ThreadSnapshot {
  return {
    ...snapshot,
    thread: { ...snapshot.thread, id, title },
  };
}

function Harness({
  onReady,
}: {
  onReady: (controller: WorkspaceLayoutController) => void;
}) {
  const controller = useWorkspaceLayout(projectId);
  onReady(controller);
  return (
    <TilingSurface
      projectId={projectId}
      controller={controller}
      onClosePane={vi.fn()}
      onThreadStarted={(paneId, startedThreadId) => {
        controller.assignThreadToPane(paneId, startedThreadId);
      }}
    />
  );
}

function renderSurface() {
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
  api.getSnapshot.mockResolvedValue(snapshot);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let latest: WorkspaceLayoutController | undefined;
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Harness
          onReady={(controller) => {
            latest = controller;
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    getController: () => {
      if (latest === undefined) throw new Error("controller not ready");
      return latest;
    },
    store,
    container,
  };
}

async function seedTwoPanes(getController: () => WorkspaceLayoutController) {
  act(() => {
    getController().dispatch({ type: "split", axis: "row" });
  });
  const [firstPaneId] = tiledPaneIds(getController().layout);
  if (firstPaneId === undefined) throw new Error("missing first pane");
  act(() => {
    getController().assignThreadToPane(firstPaneId, threadId);
  });
  await screen.findByRole("heading", { name: "Example thread" });
  return firstPaneId;
}

describe("TilingSurface", () => {
  it("renders both tiled panes with a resizable divider between them", async () => {
    const { getController } = renderSurface();
    await seedTwoPanes(getController);

    expect(
      screen.getByRole("heading", { name: "Example thread" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New chat")).toBeInTheDocument();

    const divider = screen.getByRole("separator");
    expect(divider).toHaveAttribute("aria-orientation");
    expect(divider).toHaveAttribute("aria-valuemin");
    expect(divider).toHaveAttribute("aria-valuemax");
    expect(divider).toHaveAttribute("aria-valuenow");
  });

  it("adjusts split sizes on the controller when the divider is resized with the keyboard", async () => {
    const { getController } = renderSurface();
    await seedTwoPanes(getController);

    const before = getController().layout.root;
    expect(before?.type).toBe("split");
    const beforeFirst = before?.type === "split" ? before.sizes[0] : undefined;
    expect(beforeFirst).toBeCloseTo(0.5);

    const divider = screen.getByRole("separator");
    divider.focus();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");

    const after = getController().layout.root;
    expect(after?.type).toBe("split");
    if (after?.type === "split") {
      expect(after.sizes[0]).toBeGreaterThan(beforeFirst ?? 0);
      expect(after.sizes[0] + after.sizes[1]).toBeCloseTo(1);
    }
  });

  it("focuses a pane on click and marks it with aria-current", async () => {
    const { getController } = renderSurface();
    const firstPaneId = await seedTwoPanes(getController);
    // The split leaves focus on the newly created (new-chat) pane.
    expect(getController().layout.focusedPaneId).not.toBe(firstPaneId);

    const user = userEvent.setup();
    const heading = screen.getByRole("heading", { name: "Example thread" });
    await user.click(heading);

    expect(getController().layout.focusedPaneId).toBe(firstPaneId);
    const threadHeading = screen.getByRole("heading", {
      name: "Example thread",
    });
    const threadRegion = threadHeading.closest("[aria-current]");
    expect(threadRegion).toHaveAttribute("aria-current", "true");
  });

  it("resizes the outer split of a 2x2 grid by keyboard, even though neither of its immediate children is a pane", async () => {
    const { getController, container } = renderSurface();

    // Build a 2x2 grid: split right, then split each side down. The outer
    // split's two children end up being splits themselves (not panes) —
    // this is the case a pane-id-based resize handle could never reach.
    act(() => {
      getController().dispatch({ type: "split", axis: "row" });
    });
    const outerSplit = getController().layout.root;
    if (outerSplit?.type !== "split") throw new Error("expected split root");
    const outerSplitId = outerSplit.id;
    const [leftPaneId, rightPaneId] = outerSplit.children.map((child) =>
      child.type === "pane" ? child.id : undefined,
    );
    if (leftPaneId === undefined || rightPaneId === undefined)
      throw new Error("expected two pane children");

    act(() => {
      getController().focus(leftPaneId);
    });
    act(() => {
      getController().dispatch({ type: "split", axis: "column" });
    });
    act(() => {
      getController().focus(rightPaneId);
    });
    act(() => {
      getController().dispatch({ type: "split", axis: "column" });
    });

    const grid = getController().layout.root;
    if (grid?.type !== "split") throw new Error("expected split root");
    expect(grid.id).toBe(outerSplitId);
    expect(grid.children[0].type).toBe("split");
    expect(grid.children[1].type).toBe("split");
    const before = grid.sizes[0];

    // The outer divider is the one directly under the top-level split
    // container; the two inner dividers sit one level deeper, inside each
    // side's own split container.
    const outerDivider = container.querySelector(
      ":scope > .tiling-surface > .tiling-split > .tiling-divider",
    );
    if (outerDivider === null) throw new Error("outer divider not found");
    expect(outerDivider).toHaveAttribute("role", "separator");

    (outerDivider as HTMLElement).focus();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");

    const after = getController().layout.root;
    if (after?.type !== "split") throw new Error("expected split root");
    expect(after.id).toBe(outerSplitId);
    expect(after.sizes[0]).toBeGreaterThan(before);
    expect(after.sizes[0] + after.sizes[1]).toBeCloseTo(1);
  });

  it("does not leak a draft from a closed pane into the pane promoted into its position (regression: split ids as React keys)", async () => {
    const threadA = "20000000-0000-4000-8000-00000000000a" as ThreadId;
    const threadB = "20000000-0000-4000-8000-00000000000b" as ThreadId;
    const threadC = "20000000-0000-4000-8000-00000000000c" as ThreadId;
    const threadD = "20000000-0000-4000-8000-00000000000d" as ThreadId;
    const snapshots = new Map<ThreadId, ThreadSnapshot>([
      [threadA, snapshotFor(threadA, "Thread A")],
      [threadB, snapshotFor(threadB, "Thread B")],
      [threadC, snapshotFor(threadC, "Thread C")],
      [threadD, snapshotFor(threadD, "Thread D")],
    ]);

    const { getController, store } = renderSurface();
    // Override the single-thread default stub with per-thread routing; the
    // queries this test triggers all happen after this point.
    api.getSnapshot.mockImplementation((_projectId: ProjectId, tid: ThreadId) =>
      Promise.resolve(snapshots.get(tid)),
    );

    // A is the initial pane. Split A right -> B (focused). Split B right ->
    // C (focused). Split C right -> D (focused). Assign each thread as its
    // pane appears.
    const paneA = getController().layout.focusedPaneId;
    if (paneA === null) throw new Error("missing pane A");
    act(() => {
      getController().assignThreadToPane(paneA, threadA);
    });

    act(() => {
      getController().dispatch({ type: "split", axis: "row" });
    });
    const paneB = getController().layout.focusedPaneId;
    if (paneB === null) throw new Error("missing pane B");
    act(() => {
      getController().assignThreadToPane(paneB, threadB);
    });

    act(() => {
      getController().dispatch({ type: "split", axis: "row" });
    });
    const paneC = getController().layout.focusedPaneId;
    if (paneC === null) throw new Error("missing pane C");
    act(() => {
      getController().assignThreadToPane(paneC, threadC);
    });

    act(() => {
      getController().dispatch({ type: "split", axis: "row" });
    });
    const paneD = getController().layout.focusedPaneId;
    if (paneD === null) throw new Error("missing pane D");
    act(() => {
      getController().assignThreadToPane(paneD, threadD);
    });

    await screen.findByRole("heading", { name: "Thread D" });

    // Type a draft into B's composer specifically (there are four
    // identically-labeled composers, one per pane — scope by B's region).
    const regionB = screen.getByRole("region", { name: "Thread B" });
    const composerB = within(regionB).getByRole("textbox", {
      name: "Message Pi",
    });
    const user = userEvent.setup();
    await user.type(composerB, "draft typed in B");
    await waitFor(() => {
      expect(store.get(`pi-draft:${threadB}`)).toBe("draft typed in B");
    });

    // Close B. Its parent split is replaced by the surviving sibling
    // subtree (the split containing C and D), which gets promoted into B's
    // former position in the tree.
    act(() => {
      getController().close(paneB);
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Thread B" }),
      ).not.toBeInTheDocument();
    });

    // C's composer must be freshly mounted (empty), not reusing B's
    // composer instance and its leftover draft text — and C's own
    // persisted draft must be untouched by B's draft.
    const regionC = screen.getByRole("region", { name: "Thread C" });
    const composerC = within(regionC).getByRole("textbox", {
      name: "Message Pi",
    });
    expect(composerC).toHaveValue("");
    expect(store.get(`pi-draft:${threadC}`) ?? "").not.toBe("draft typed in B");
  });
});
