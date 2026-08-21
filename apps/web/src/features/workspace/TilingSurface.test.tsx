// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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

function stubStorage(): void {
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
    />
  );
}

function renderSurface() {
  stubStorage();
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
  render(
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
});
