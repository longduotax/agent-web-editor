// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  restoreScrollGeometry();
});

// jsdom has no layout, so scrollHeight/clientHeight are always 0 and any
// scroll-to-bottom effect is unobservable. These helpers install writable
// geometry on the element prototype for the duration of one test (scrollTop
// itself is a real, settable property in jsdom).
let scrollGeometryStubbed = false;
function stubScrollGeometry(initial: {
  scrollHeight: number;
  clientHeight: number;
}) {
  let current = initial;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => current.scrollHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => current.clientHeight,
  });
  scrollGeometryStubbed = true;
  return {
    set(next: { scrollHeight: number; clientHeight: number }) {
      current = next;
    },
  };
}
function restoreScrollGeometry() {
  if (!scrollGeometryStubbed) return;
  scrollGeometryStubbed = false;
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
}

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
    onSplit?: () => void;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onFocus = overrides.onFocus ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const onSplit = overrides.onSplit ?? vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThreadPane
          projectId={projectId}
          threadId={threadId}
          focused
          onFocus={onFocus}
          onClose={onClose}
          onSplit={onSplit}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onFocus, onClose, onSplit, queryClient, container: view.container };
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

  it("invokes onClose from the pane header, without changing behavior otherwise", async () => {
    api.getSnapshot.mockResolvedValue(snapshot);
    const user = userEvent.setup();
    const { onClose } = renderPane();

    await screen.findByRole("heading", { name: "Example thread" });

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onSplit from the pane header and exposes no Collapse/Bind button", async () => {
    api.getSnapshot.mockResolvedValue(snapshot);
    const user = userEvent.setup();
    const { onSplit } = renderPane();

    await screen.findByRole("heading", { name: "Example thread" });

    await user.click(screen.getByRole("button", { name: "Split" }));
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Collapse" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bind" }),
    ).not.toBeInTheDocument();
  });

  it("renders the user turn as a quiet pill and the assistant turn as flowing text without a card", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      transcript: [
        {
          id: "u1",
          kind: "message",
          role: "user",
          text: "Ping",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "Pong",
          timestamp: "2026-01-01T00:00:01.000Z",
        },
      ],
    });
    renderPane();
    await screen.findByRole("heading", { name: "Example thread" });

    const userBubble = screen.getByText("Ping").closest(".u-bubble");
    expect(userBubble).not.toBeNull();
    expect(userBubble?.closest(".message-user")).toBeNull();

    const assistantBlock = screen.getByText("Pong").closest(".a-block");
    expect(assistantBlock).not.toBeNull();
    expect(assistantBlock).not.toHaveClass("message");
  });

  // Rewritten for UX-4: the pane no longer stacks a second `.thread-header`
  // band under `.pane-head`. The trust note is now the quiet inline line of
  // the single merged pane header, so this asserts the same CWS-01 intent
  // ("one quiet inline status line in the pane header region") against the
  // merged header instead of the removed one.
  it("demotes the trust notice to a single quiet line in the one pane header, not a full-width banner", async () => {
    api.getSnapshot.mockResolvedValue(snapshot);
    renderPane();

    const heading = await screen.findByRole("heading", {
      name: "Example thread",
    });
    const note = screen.getByText("Direct execution:");
    expect(note.closest(".trust-warning")).toBeNull();
    expect(note.closest(".pane-head")).not.toBeNull();
    expect(heading.closest(".pane-head")).toBe(note.closest(".pane-head"));
  });

  it("renders exactly one header, one title and one run status for the thread", async () => {
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      thread: { ...snapshot.thread, runState: "completed" },
    });
    const { container } = renderPane();
    await screen.findByRole("heading", { name: "Example thread" });

    expect(container.querySelectorAll(".thread-header")).toHaveLength(0);
    expect(container.querySelectorAll("header")).toHaveLength(1);
    expect(screen.getAllByText("Example thread")).toHaveLength(1);
    expect(screen.getAllByText("Done")).toHaveLength(1);
  });

  const ping = {
    id: "u1",
    kind: "message",
    role: "user",
    text: "Ping",
    timestamp: "2026-01-01T00:00:00.000Z",
  } as const;
  const pong = {
    id: "a1",
    kind: "message",
    role: "assistant",
    text: "Pong",
    timestamp: "2026-01-01T00:00:01.000Z",
  } as const;

  it("opens the transcript scrolled to the newest message and follows new items while pinned to the bottom", async () => {
    const geometry = stubScrollGeometry({
      scrollHeight: 2000,
      clientHeight: 400,
    });
    api.getSnapshot.mockResolvedValue({ ...snapshot, transcript: [ping] });
    const { queryClient } = renderPane();
    await screen.findByRole("heading", { name: "Example thread" });

    const transcript = screen.getByLabelText("Conversation");
    await waitFor(() => {
      expect(transcript.scrollTop).toBe(2000);
    });

    geometry.set({ scrollHeight: 3000, clientHeight: 400 });
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      transcript: [ping, pong],
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
    });
    await screen.findByText("Pong");
    await waitFor(() => {
      expect(transcript.scrollTop).toBe(3000);
    });
  });

  it("does not yank the user back to the bottom once they have scrolled up", async () => {
    const geometry = stubScrollGeometry({
      scrollHeight: 2000,
      clientHeight: 400,
    });
    api.getSnapshot.mockResolvedValue({ ...snapshot, transcript: [ping] });
    const { queryClient } = renderPane();
    await screen.findByRole("heading", { name: "Example thread" });

    const transcript = screen.getByLabelText("Conversation");
    await waitFor(() => {
      expect(transcript.scrollTop).toBe(2000);
    });

    // The user scrolls up: the transcript must stop following new content.
    transcript.scrollTop = 0;
    fireEvent.scroll(transcript);

    geometry.set({ scrollHeight: 3000, clientHeight: 400 });
    api.getSnapshot.mockResolvedValue({
      ...snapshot,
      transcript: [ping, pong],
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
    });
    await screen.findByText("Pong");
    expect(transcript.scrollTop).toBe(0);
  });

  it("keeps the pane header usable and offers a Retry when the snapshot fails to load", async () => {
    api.getSnapshot.mockRejectedValueOnce(new Error("connection refused"));
    const user = userEvent.setup();
    renderPane();

    await screen.findByText("connection refused");
    // The pane chrome survives the failure: Close is still reachable.
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    api.getSnapshot.mockResolvedValue(snapshot);
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("heading", { name: "Example thread" }),
    ).toBeInTheDocument();
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

// R2-8. Run.failureCode / Run.failureMessage have always been in the
// contracts and sent by the server, but the web app used them nowhere: a
// dead run showed a red dot labelled "Failed" and nothing else — no reason,
// no retry, nothing to paste into a bug report.
describe("failed run reporting", () => {
  const failedSnapshot: ThreadSnapshot = {
    ...snapshot,
    thread: { ...snapshot.thread, runState: "failed" },
    currentRun: null,
    lastRun: {
      id: "50000000-0000-4000-8000-000000000001" as RunId,
      threadId,
      projectId,
      state: "failed",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:05.000Z",
      failureCode: "runtime_unavailable",
      failureMessage: "The Pi runtime exited before the run completed.",
    },
  };

  it("renders the run's failure message, not just a red dot", async () => {
    api.getSnapshot.mockResolvedValue(failedSnapshot);
    renderPane();

    await screen.findByRole("heading", { name: "Example thread" });
    expect(
      await screen.findByText(
        "The Pi runtime exited before the run completed.",
      ),
    ).toBeVisible();
    // The status label is still there; the message is additional, not a
    // replacement.
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("falls back to the failure code when no message is supplied", async () => {
    api.getSnapshot.mockResolvedValue({
      ...failedSnapshot,
      lastRun: { ...failedSnapshot.lastRun, failureMessage: null },
    });
    renderPane();

    await screen.findByRole("heading", { name: "Example thread" });
    expect(await screen.findByText(/runtime_unavailable/)).toBeVisible();
  });

  it("says nothing about failure when the run did not fail", async () => {
    api.getSnapshot.mockResolvedValue(snapshot);
    renderPane();

    await screen.findByRole("heading", { name: "Example thread" });
    expect(document.querySelector(".run-failure")).toBeNull();
  });
});
