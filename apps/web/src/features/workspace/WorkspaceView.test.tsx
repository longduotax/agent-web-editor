// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
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
import { StrictMode } from "react";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId, ThreadId, ThreadSnapshot } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  archiveThread: vi.fn(),
  getSnapshot: vi.fn(),
  getStatus: vi.fn(),
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

// Stands in for the sidebar's thread rows, which live outside WorkspaceView
// but are the only way a user opens a thread that is not already in a pane.
function ThreadLinks({ ids }: { ids: ThreadId[] }) {
  return (
    <nav aria-label="Threads">
      {ids.map((id) => (
        <Link key={id} to={`/projects/${projectId}/threads/${id}`}>
          {`Open ${id}`}
        </Link>
      ))}
    </nav>
  );
}

// Surfaces the current route so a test can assert what the URL says the
// workspace is showing.
function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderWorkspace(
  initialEntry: string,
  options?: {
    seedStore?: (store: Map<string, string>) => void;
    snapshots?: Record<string, ThreadSnapshot>;
    strict?: boolean;
    sidebarLinks?: ThreadId[];
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
  api.getSnapshot.mockImplementation((_projectId: ProjectId, id: ThreadId) =>
    Promise.resolve(snapshotsById[id] ?? snapshot),
  );
  api.getStatus.mockResolvedValue({
    available: true,
    files: [],
    message: null,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const links =
    options?.sidebarLinks === undefined ? null : (
      <ThreadLinks ids={options.sidebarLinks} />
    );
  const tree = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        {links}
        <LocationProbe />
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
    </QueryClientProvider>
  );
  return {
    ...render(
      options?.strict === true ? <StrictMode>{tree}</StrictMode> : tree,
    ),
    store,
  };
}

describe("WorkspaceView", () => {
  it.each([
    ["right", "+", "row"],
    ["down", "_", "column"],
  ])(
    "dispatches the split-%s keychord while the composer is focused and prevents the browser default",
    async (_direction, pressedKey, axis) => {
      stubMacPlatform();
      renderWorkspace(`/projects/${projectId}`);
      const composer = await screen.findByLabelText("First message");
      composer.focus();

      const before = fireEvent.keyDown(composer, {
        key: pressedKey,
        metaKey: true,
        shiftKey: true,
      });
      // fireEvent.keyDown returns false when preventDefault() was called.
      expect(before).toBe(false);

      await screen.findAllByLabelText("New chat");
      expect(screen.getAllByLabelText("New chat")).toHaveLength(2);
      expect(document.querySelector(`.tiling-split-${axis}`)).not.toBeNull();
    },
  );

  it("does nothing on a non-matching keydown", async () => {
    stubMacPlatform();
    renderWorkspace(`/projects/${projectId}`);
    await screen.findByLabelText("New chat");

    const result = fireEvent.keyDown(window, { key: "a" });
    expect(result).toBe(true); // default was not prevented
    expect(screen.getAllByLabelText("New chat")).toHaveLength(1);
  });

  // The composer only ever opens inside a surface that already has a project:
  // a split pane inherits the pane it came from, and the sidebar's New thread
  // button carries the project it was clicked on. A control here could only
  // restate what the pane header already shows, so there is none.
  it("offers no project control in the new-chat composer", async () => {
    renderWorkspace(`/projects/${projectId}/new`);
    const composer = await screen.findByRole("region", { name: "New chat" });

    expect(
      within(composer).queryByRole("combobox", { name: "Project" }),
    ).toBeNull();
    for (const name of ["Execution location", "Starting state", "Base branch"])
      expect(
        within(composer).getByRole("combobox", { name }),
      ).toBeInTheDocument();
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

  // R2-5 / D-9. Closing a pane used to archive the thread as a side effect:
  // the button said "Close", the pane vanished, a 6s toast deferred the real
  // archiveThread call, and that call was fire-and-forget -- no .catch, no
  // error surface -- so the UI reported "Archived" even when the request
  // 403'd and the thread was never archived. There is no unarchive endpoint
  // and no archived-thread list, so a successful one was unrecoverable.
  // Closing a pane is now a pure layout operation; archiving is an explicit,
  // labelled action in the sidebar (see App.test.tsx).
  it("closes a threaded pane as a pure layout operation: no archive call, ever, and no toast", async () => {
    api.archiveThread.mockResolvedValue({ archived: true as const });
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`);
    await screen.findByRole("region", { name: "Example thread" });

    vi.useFakeTimers();
    fireEvent.click(closeButtonFor("Example thread"));

    // The pane is gone right away -- no modal, no waiting on the network.
    expect(screen.getByText("No panes are open.")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Example thread" }),
    ).not.toBeInTheDocument();
    // Nothing is deferred, so no amount of elapsed time can archive it.
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(api.archiveThread).not.toHaveBeenCalled();
  });

  it("closing several threaded panes in a row still never archives anything", async () => {
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

    expect(screen.getByText("No panes are open.")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(api.archiveThread).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
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
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
    expect(api.archiveThread).not.toHaveBeenCalled();
  });

  // R2-10: the draft key is scoped to a pane id that will never exist again,
  // so leaving it behind leaked one localStorage entry per pane ever opened.
  it("drops a closed new-chat pane's draft key instead of leaking it", async () => {
    const user = userEvent.setup();
    const { store } = renderWorkspace(`/projects/${projectId}`);
    const composer = await screen.findByLabelText("First message");
    await user.click(composer);
    await user.paste("a draft nobody will send");

    expect(
      [...store.keys()].filter((key) => key.startsWith("pi-new-draft:")),
    ).toHaveLength(1);

    const closeButton = screen
      .getByLabelText("New chat")
      .closest(".pane")
      ?.querySelector('[aria-label="Close"]');
    if (closeButton === null || closeButton === undefined)
      throw new Error("expected a close button");
    fireEvent.click(closeButton);

    await screen.findByText("No panes are open.");
    expect(
      [...store.keys()].filter((key) => key.startsWith("pi-new-draft:")),
    ).toEqual([]);
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

  // NEW-R3-3. Closing the last pane leaves the URL on the thread it was
  // showing. Clicking that same thread in the sidebar navigates to the route
  // the app is already on, so `params.threadId` never changes and the effect
  // that opens panes from the route never re-runs -- the empty surface became
  // a dead end for the one thread the user is most likely to click.
  it("re-opens a pane when the routed thread's sidebar link is clicked after the last pane was closed", async () => {
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`, {
      sidebarLinks: [threadId],
    });
    await screen.findByRole("region", { name: "Example thread" });

    fireEvent.click(closeButtonFor("Example thread"));
    expect(screen.getByText("No panes are open.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: `Open ${threadId}` }));

    expect(
      await screen.findByRole("region", { name: "Example thread" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No panes are open.")).not.toBeInTheDocument();
  });

  // N2. Closing a pane left the URL describing it. Reloading then re-resolved
  // that URL and brought the pane back, so "close" and "reload" cancelled each
  // other out and the URL was not a truthful description of the workspace.
  describe("the route after a pane is closed", () => {
    it("leaves /new for the remaining pane's thread when the new-chat pane is closed", async () => {
      renderWorkspace(`/projects/${projectId}/new`, {
        seedStore: (store) => {
          store.set(
            `pi-workspace:layout:${projectId}`,
            JSON.stringify({
              version: 2,
              root: {
                type: "split",
                id: "seeded-split",
                axis: "row",
                children: [
                  { type: "pane", id: "seeded-thread" },
                  { type: "pane", id: "seeded-new" },
                ],
                sizes: [0.5, 0.5],
              },
              panes: {
                "seeded-thread": { threadId },
                "seeded-new": { threadId: null },
              },
              focusedPaneId: "seeded-new",
              boundPaneId: null,
            }),
          );
        },
      });
      await screen.findByRole("region", { name: "New chat" });
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/projects/${projectId}/new`,
      );

      fireEvent.click(closeButtonFor("New chat"));

      expect(await screen.findByTestId("location")).toHaveTextContent(
        `/projects/${projectId}/threads/${threadId}`,
      );
      expect(screen.queryByRole("region", { name: "New chat" })).toBeNull();
    });

    // Not a new-chat quirk: the same thing happened to a thread pane the URL
    // named, so the fix is keyed on "did the route address the closed pane",
    // not on the pane's kind.
    it("leaves a thread route for the remaining pane's thread when that thread's pane is closed", async () => {
      renderWorkspace(`/projects/${projectId}/threads/${threadId}`, {
        seedStore: seedTwoPaneLayout,
        snapshots: {
          [threadId]: snapshot,
          [otherThreadId]: otherSnapshot,
        },
      });
      await screen.findByRole("region", { name: "Example thread" });

      fireEvent.click(closeButtonFor("Example thread"));

      expect(await screen.findByTestId("location")).toHaveTextContent(
        `/projects/${projectId}/threads/${otherThreadId}`,
      );
    });

    // Closing a pane the URL was never about must not renavigate underneath
    // the user.
    it("leaves the route alone when the closed pane is not the one the URL names", async () => {
      renderWorkspace(`/projects/${projectId}/threads/${threadId}`, {
        seedStore: seedTwoPaneLayout,
        snapshots: {
          [threadId]: snapshot,
          [otherThreadId]: otherSnapshot,
        },
      });
      await screen.findByRole("region", { name: "Other thread" });

      fireEvent.click(closeButtonFor("Other thread"));

      expect(screen.getByTestId("location")).toHaveTextContent(
        `/projects/${projectId}/threads/${threadId}`,
      );
      expect(
        screen.getByRole("region", { name: "Example thread" }),
      ).toBeInTheDocument();
    });

    // S4. `/new` names nothing -- it is an instruction to open an empty
    // composer. Left in place after the last pane closes, a reload re-issues
    // the instruction the user just countermanded, which is N2 verbatim on
    // the very route N2 was filed against.
    it("leaves /new for the project route when the last pane closed was the new-chat pane", async () => {
      renderWorkspace(`/projects/${projectId}/new`);
      await screen.findByRole("region", { name: "New chat" });

      fireEvent.click(closeButtonFor("New chat"));

      expect(screen.getByText("No panes are open.")).toBeInTheDocument();
      // Exact, not toHaveTextContent: "/projects/<id>/new" CONTAINS
      // "/projects/<id>", so a substring assertion here would pass against
      // the unfixed code.
      await waitFor(() => {
        expect(screen.getByTestId("location").textContent).toBe(
          `/projects/${projectId}`,
        );
      });
    });

    // A thread route DOES name something: it is what a bookmark carries, and
    // NEW-R3-3's sidebar-relink behaviour depends on the route still naming
    // that thread after the surface empties. It is deliberately kept.
    it("keeps the route when the last pane is closed", async () => {
      renderWorkspace(`/projects/${projectId}/threads/${threadId}`);
      await screen.findByRole("region", { name: "Example thread" });

      fireEvent.click(closeButtonFor("Example thread"));

      expect(screen.getByText("No panes are open.")).toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/projects/${projectId}/threads/${threadId}`,
      );
    });
  });

  // Reachable only once a surface can be EMPTY when a thread route mounts,
  // which is what closing the last pane and letting the route re-resolve
  // produces. Without a guard, StrictMode's mount -> cleanup -> mount runs
  // openThread twice, the second invocation still reads the pre-update layout
  // (newPane is a functional setState), and the surface ends up with the
  // thread pane PLUS an orphan "New chat" pane beside it. Measured in the
  // browser: two panes where one was expected.
  it("opens exactly one pane for the routed thread on an empty surface, even under StrictMode", async () => {
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`, {
      strict: true,
      seedStore: (store) => {
        store.set(
          `pi-workspace:layout:${projectId}`,
          JSON.stringify({
            version: 2,
            root: null,
            panes: {},
            focusedPaneId: null,
            boundPaneId: null,
          }),
        );
      },
    });

    expect(
      await screen.findByRole("region", { name: "Example thread" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "New chat" })).toBeNull();
    expect(document.querySelectorAll(".pane")).toHaveLength(1);
  });

  it("focuses/creates a pane for the thread named in the route on mount", async () => {
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`);

    const heading = await screen.findByRole("heading", {
      name: "Example thread",
    });
    const region = heading.closest("[aria-current]");
    expect(region).toHaveAttribute("aria-current", "true");
  });

  it("keeps text-editing chords suppressed while a composer is focused", async () => {
    stubMacPlatform();
    renderWorkspace(`/projects/${projectId}`);
    const composer = await screen.findByLabelText("First message");
    composer.focus();

    // Unlike split, Cmd+Shift+Backspace is a native delete-to-start command
    // in a text field as well as the workspace's close-pane chord. Typing
    // keeps ownership of that chord: no preventDefault and no pane close.
    const result = fireEvent.keyDown(composer, {
      key: "Backspace",
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

  // UX-5: the /new entry effect used to dispatch newPane() once per effect
  // invocation. Under StrictMode React runs mount -> cleanup -> mount, and
  // the second run still saw the pre-split layout, so the sidebar's "+"
  // produced TWO identical new-chat panes (persisted to localStorage, so the
  // user had to close one by hand). The entry must be dispatched at most once
  // per route entry, whatever the effect's invocation count.
  it("adds exactly one new-chat pane when entering /new, even under StrictMode's double-invoked effects", async () => {
    const seededPaneId = "seeded-pane";
    renderWorkspace(`/projects/${projectId}/new`, {
      strict: true,
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

    await screen.findByLabelText("New chat");
    expect(screen.getAllByLabelText("New chat")).toHaveLength(1);
    expect(document.querySelectorAll(".new-chat-pane")).toHaveLength(1);
  });

  it("adds no further new-chat pane when /new is re-entered while one is already focused", async () => {
    const seededPaneId = "seeded-threadless-pane";
    renderWorkspace(`/projects/${projectId}/new`, {
      strict: true,
      seedStore: (store) => {
        store.set(
          `pi-workspace:layout:${projectId}`,
          JSON.stringify({
            version: 2,
            root: { type: "pane", id: seededPaneId },
            panes: { [seededPaneId]: { threadId: null } },
            focusedPaneId: seededPaneId,
            boundPaneId: null,
          }),
        );
      },
    });

    await screen.findByLabelText("New chat");
    expect(screen.getAllByLabelText("New chat")).toHaveLength(1);
  });

  it("renders no environment panel and no environment toggle anywhere on the surface", async () => {
    renderWorkspace(`/projects/${projectId}/threads/${threadId}`);
    await screen.findByRole("region", { name: "Example thread" });

    expect(
      screen.queryByRole("complementary", { name: "Environment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /environment/i }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".environment-panel")).toBeNull();
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
    api.getStatus.mockResolvedValue({
      available: true,
      files: [],
      message: null,
    });

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

    // Both the pane header and the (single, shared) Environment panel now
    // reflect the focused thread's status, so scope the assertion to the
    // pane header rather than asserting a single "Failed" in the whole
    // document.
    const region = await screen.findByRole("region", {
      name: "Example thread",
    });
    await within(region).findByText("Failed");

    const after = JSON.parse(store.get(layoutKey) ?? "null") as {
      focusedPaneId: string | null;
    };
    expect(after.focusedPaneId).toBe(before.focusedPaneId);
  });
});
