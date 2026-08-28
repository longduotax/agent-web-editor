// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, type JSX } from "react";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

// WSP-09's hardest claim: "a tab moved between groups keeps its process,
// scroll position, and state". Both are measured here rather than asserted,
// because the panel shipped a comment promising exactly this while doing the
// opposite (D1): tab bodies were children of their group, and the panel's
// tree renders a different element type per node, so every change of tree
// shape unmounted the bodies at that position — closing a live terminal's
// socket and starting a second shell.

const api = vi.hoisted(() => ({
  getFiles: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

// The terminal itself is covered by TerminalView.test.tsx; here it only has
// to be something that owns a socket.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public clear(): void {
      return undefined;
    }
    public dispose(): void {
      return undefined;
    }
    public loadAddon(): void {
      return undefined;
    }
    public onData(): { dispose: () => void } {
      return { dispose: () => undefined };
    }
    public open(): void {
      return undefined;
    }
    public write(): void {
      return undefined;
    }
    public writeln(): void {
      return undefined;
    }
    public options = {};
    public readonly cols = 80;
    public readonly rows = 24;
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    public fit(): void {
      return undefined;
    }
  },
}));

import type { TabContext } from "./panelTabs.js";
import { usePanelState } from "./usePanelState.js";
import { WorkspacePanel } from "./WorkspacePanel.js";

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
const context: TabContext = {
  projectId,
  threadId,
  scopeKey: projectId,
  label: "Example project",
};

const sockets = { opened: 0, closed: 0 };

class CountingWebSocket extends EventTarget {
  public static readonly OPEN = 1;
  public readyState = CountingWebSocket.OPEN;
  public constructor(url: string) {
    super();
    void url;
    sockets.opened += 1;
  }
  public close(): void {
    this.readyState = 3;
    sockets.closed += 1;
  }
  public send(): void {
    return undefined;
  }
}

function stubEnvironment(): Map<string, string> {
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
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("WebSocket", CountingWebSocket);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      public observe(): void {
        return undefined;
      }
      public disconnect(): void {
        return undefined;
      }
    },
  );
  return store;
}

function Harness(): JSX.Element {
  const controller = usePanelState();
  const { bindPendingContexts } = controller.actions;
  useEffect(() => {
    bindPendingContexts(context);
  }, [bindPendingContexts]);
  return <WorkspacePanel controller={controller} focusedContext={context} />;
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Open workspace panel" }),
  );
}

async function openTab(
  user: ReturnType<typeof userEvent.setup>,
  name: "Files" | "Terminal",
) {
  await user.click(screen.getByRole("button", { name: "New panel tab" }));
  await user.click(screen.getByRole("menuitem", { name }));
}

// Shift + primary + Alt is the panel's chord group; ctrlKey stands in for
// the primary modifier on the non-mac platform jsdom reports.
function panelChord(key: string) {
  fireEvent.keyDown(window, {
    key,
    shiftKey: true,
    ctrlKey: true,
    altKey: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  sockets.opened = 0;
  sockets.closed = 0;
});

describe("a tab body outlives every change of tree shape", () => {
  it("keeps a running terminal's socket across a split and across the promotion that follows", async () => {
    const user = userEvent.setup();
    stubEnvironment();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    renderPanel();
    await openPanel(user);
    await openTab(user, "Terminal");

    const surface = screen.getByLabelText("Project terminal");
    await waitFor(() => {
      expect(sockets.opened).toBe(1);
    });
    expect(sockets.closed).toBe(0);

    // Sequence one: split the group the terminal is in. The group's React
    // subtree is replaced by a split node, which used to take the terminal
    // down with it.
    panelChord("ArrowRight");
    await screen.findByRole("separator", { name: "Resize panel groups" });

    expect(sockets.opened).toBe(1);
    expect(sockets.closed).toBe(0);
    // Not merely "a terminal is on screen": the same DOM node, which is what
    // makes it the same xterm and the same process.
    expect(screen.getByLabelText("Project terminal")).toBe(surface);

    // Sequence two: close the other group's last tab. The model removes the
    // emptied group and promotes its sibling, so the root goes split -> leaf
    // and the SURVIVING group is re-created at that position.
    await user.click(screen.getByRole("tab", { name: "Changes" }));
    await user.click(screen.getByRole("button", { name: "Close Changes tab" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("separator", { name: "Resize panel groups" }),
      ).not.toBeInTheDocument();
    });
    expect(sockets.opened).toBe(1);
    expect(sockets.closed).toBe(0);
    expect(screen.getByLabelText("Project terminal")).toBe(surface);
  });

  it("keeps a body's scroll position across a split", async () => {
    const user = userEvent.setup();
    stubEnvironment();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    renderPanel();
    await openPanel(user);
    await openTab(user, "Files");

    const filesTabId = activeTabId();
    const body = document.getElementById(`panel-tabpanel-${filesTabId}`);
    expect(body).not.toBeNull();
    if (body === null) return;
    body.scrollTop = 320;
    // The browser reports the offset through a scroll event; that is where
    // the panel records it, so it can put it back after the move.
    fireEvent.scroll(body);

    panelChord("ArrowRight");
    await screen.findByRole("separator", { name: "Resize panel groups" });

    const afterSplit = document.getElementById(`panel-tabpanel-${filesTabId}`);
    expect(afterSplit).toBe(body);
    expect(afterSplit?.scrollTop).toBe(320);
  });

  it("keeps a body's scroll position across a tab switch", async () => {
    const user = userEvent.setup();
    stubEnvironment();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    renderPanel();
    await openPanel(user);
    await openTab(user, "Files");

    const filesTabId = activeTabId();
    const files = document.getElementById(`panel-tabpanel-${filesTabId}`);
    expect(files).not.toBeNull();
    if (files === null) return;
    files.scrollTop = 128;

    await user.click(screen.getByRole("tab", { name: "Changes" }));
    await user.click(screen.getByRole("tab", { name: "Files" }));

    expect(document.getElementById(`panel-tabpanel-${filesTabId}`)).toBe(files);
    expect(files.scrollTop).toBe(128);
  });

  // G1. Neither case above is evidence about a real browser: jsdom lays
  // nothing out, so it never takes a hidden body out of layout and never
  // resets a scroller. What this one pins is the half of the mechanism that
  // IS testable here — that the offset recorded is the one belonging to
  // whatever DESCENDANT actually scrolled, and that returning to the tab
  // puts it back — with the browser's reset stood in for by hand, because
  // that reset is the thing jsdom will not do. The real measurement is in
  // e2e/workspace-panel.spec.ts, which is where a layout exists.
  it("records and restores the offset of a descendant scroller, not the body's own", async () => {
    const user = userEvent.setup();
    stubEnvironment();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    renderPanel();
    await openPanel(user);
    await openTab(user, "Files");

    const filesTabId = activeTabId();
    const body = document.getElementById(`panel-tabpanel-${filesTabId}`);
    expect(body).not.toBeNull();
    if (body === null) return;
    // The element that scrolls since the F2 fix is inside the body, not the
    // body — `.file-preview pre` in a File tab, and whatever each other tab
    // type bounds. Any descendant stands for it here.
    const inner = body.firstElementChild;
    expect(inner).not.toBeNull();
    if (inner === null) return;
    inner.scrollTop = 640;
    inner.scrollLeft = 96;
    // A descendant's scroll event does not bubble, and React does not
    // simulate bubbling for it, so this is delivered to the capture-phase
    // listener or to nothing at all.
    fireEvent.scroll(inner);

    await user.click(screen.getByRole("tab", { name: "Changes" }));
    // What a browser does to a scroller that leaves layout, by hand.
    inner.scrollTop = 0;
    inner.scrollLeft = 0;
    await user.click(screen.getByRole("tab", { name: "Files" }));

    expect(document.getElementById(`panel-tabpanel-${filesTabId}`)).toBe(body);
    expect(body.firstElementChild).toBe(inner);
    expect(inner.scrollTop).toBe(640);
    expect(inner.scrollLeft).toBe(96);
  });
});

// The active tab of the focused group, read off the DOM rather than the
// model, because these tests only ever know tabs by what the strip shows.
function activeTabId(): string {
  const selected = screen
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true");
  return (selected?.id ?? "").replace("panel-tab-", "");
}
