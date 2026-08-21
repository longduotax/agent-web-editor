// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { ThreadPane } from "./ThreadPane.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

function renderPane(
  overrides: {
    onFocus?: () => void;
    onClose?: () => void;
    onBind?: () => void;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onFocus = overrides.onFocus ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const onBind = overrides.onBind ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThreadPane
          projectId={projectId}
          threadId={threadId}
          focused
          onFocus={onFocus}
          onClose={onClose}
          onBind={onBind}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onFocus, onClose, onBind };
}

describe("ThreadPane", () => {
  it("renders the transcript and composer for a stubbed thread snapshot", async () => {
    api.getSnapshot.mockResolvedValue(snapshot);
    renderPane();

    expect(
      await screen.findByRole("heading", { name: "Example thread" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Conversation")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Message Pi" }),
    ).toBeInTheDocument();
  });

  it("invokes onClose from the title bar, without changing behavior otherwise", async () => {
    api.getSnapshot.mockResolvedValue(snapshot);
    const user = userEvent.setup();
    const { onClose } = renderPane();

    await screen.findByRole("heading", { name: "Example thread" });

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onFocus when the pane body is clicked", async () => {
    api.getSnapshot.mockResolvedValue(snapshot);
    const user = userEvent.setup();
    const { onFocus } = renderPane();

    const heading = await screen.findByRole("heading", {
      name: "Example thread",
    });
    await user.click(heading);
    await waitFor(() => {
      expect(onFocus).toHaveBeenCalled();
    });
  });
});
