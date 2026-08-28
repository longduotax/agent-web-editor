// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalIdSchema } from "@pi-web/contracts";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

// The terminal itself is covered by TerminalView.test.tsx; this file is
// about the tab that hosts it, so xterm is a stub.
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

import type { PanelActions } from "./usePanelState.js";
import type { TabContext } from "./panelTabs.js";
import { TerminalTab } from "./TerminalTab.js";

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
const context: TabContext = {
  projectId,
  threadId,
  scopeKey: projectId,
  label: "Example project",
};

// Every socket the render opens, so a test can drive server frames into the
// view and read back what it sent.
const sockets: MockWebSocket[] = [];

class MockWebSocket extends EventTarget {
  public static readonly OPEN = 1;
  public readyState = MockWebSocket.OPEN;
  public readonly sent: string[] = [];
  public constructor(url: string) {
    super();
    void url;
    sockets.push(this);
  }
  public close(): void {
    this.readyState = 3;
  }
  public send(data: string): void {
    this.sent.push(data);
  }
  /** The socket becoming usable: what the view waits for before it asks. */
  public open(): void {
    act(() => {
      this.dispatchEvent(new Event("open"));
    });
  }
  /** What the server would push down the wire. */
  public deliver(frame: unknown): void {
    act(() => {
      this.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(frame) }),
      );
    });
  }
}

const terminalId = TerminalIdSchema.parse(
  "30000000-0000-4000-8000-000000000001",
);

function ready(socket: MockWebSocket): void {
  socket.deliver({ version: 1, type: "ready", projectId, terminalId });
}

function sentTypes(socket: MockWebSocket): string[] {
  return socket.sent.map(
    (frame) => (JSON.parse(frame) as { type: string }).type,
  );
}

function actionsSpy(): PanelActions {
  return {
    openTab: vi.fn(),
    closeTab: vi.fn(),
    activateTab: vi.fn(),
    moveTab: vi.fn(),
    splitWithTab: vi.fn(),
    closeGroup: vi.fn(),
    focusGroup: vi.fn(),
    resizeGroups: vi.fn(),
    setWidth: vi.fn(),
    setOpen: vi.fn(),
    updateTab: vi.fn(),
    bindPendingContexts: vi.fn(),
    announce: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sockets.length = 0;
  resizeObservers.length = 0;
});

// Every live ResizeObserver, so a test can fire the callback the browser
// would fire when the panel is resized.
const resizeObservers: (() => void)[] = [];

function stubEnvironment() {
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      public constructor(callback: () => void) {
        resizeObservers.push(callback);
      }
      public observe(): void {
        return undefined;
      }
      public disconnect(): void {
        return undefined;
      }
    },
  );
}

function fireResize(): void {
  act(() => {
    for (const callback of resizeObservers) callback();
  });
}

const tab = {
  id: "t",
  type: "terminal" as const,
  context,
  cwd: "",
  terminalId: null,
};

describe("TerminalTab", () => {
  it("hosts one shell for its own execution scope, warning once", () => {
    stubEnvironment();
    render(<TerminalTab tab={tab} visible actions={actionsSpy()} />);

    expect(screen.getByLabelText("Project terminal")).toBeInTheDocument();
    // WSP-07: the unsandboxed-shell warning belongs to the terminal, so it
    // appears once per terminal tab rather than once per panel.
    expect(
      screen.getAllByText(/Direct local shell — not sandboxed/),
    ).toHaveLength(1);
  });

  // WSP-07: the warning belongs to the terminal, so two terminal tabs carry
  // two warnings — it is not a per-panel banner that a second shell inherits.
  it("carries its own shell warning per tab", () => {
    stubEnvironment();
    render(
      <>
        <TerminalTab tab={tab} visible actions={actionsSpy()} />
        <TerminalTab
          tab={{ ...tab, id: "t2" }}
          visible
          actions={actionsSpy()}
        />
      </>,
    );

    expect(screen.getAllByLabelText("Project terminal")).toHaveLength(2);
    expect(
      screen.getAllByText(/Direct local shell — not sandboxed/),
    ).toHaveLength(2);
  });

  // WSP-07: a process that is genuinely gone is reported as gone, with a
  // restart action — not left looking like a live but silent shell.
  it("reports a process that has exited, and offers a way to start another", async () => {
    const user = userEvent.setup();
    stubEnvironment();
    render(<TerminalTab tab={tab} visible actions={actionsSpy()} />);
    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;

    ready(socket);
    expect(screen.getByText("Terminal running")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start terminal" }),
    ).not.toBeInTheDocument();

    socket.deliver({
      version: 1,
      type: "exit",
      projectId,
      exitCode: 0,
      signal: null,
    });

    expect(screen.getByText("Terminal exited")).toBeInTheDocument();
    const restart = screen.getByRole("button", { name: "Start terminal" });
    await user.click(restart);
    // A new shell, not another claim on the one that has gone (WSP-07).
    expect(sentTypes(socket)).toContain("create");
  });

  // D4. `visible` used to be accepted and silently dropped. A hidden
  // terminal is a zero-size box, so measuring it proposes nonsense and would
  // push a bogus size to the PTY; the process and its buffer are untouched
  // either way (WSP-09).
  it("does no measuring while it is hidden, and refits when it comes back", () => {
    stubEnvironment();
    const { rerender } = render(
      <TerminalTab tab={tab} visible actions={actionsSpy()} />,
    );
    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;
    ready(socket);

    fireResize();
    expect(sentTypes(socket).filter((type) => type === "resize")).toHaveLength(
      1,
    );

    rerender(<TerminalTab tab={tab} visible={false} actions={actionsSpy()} />);
    fireResize();
    fireResize();
    // Still exactly one socket: hiding a terminal does not restart it.
    expect(sockets).toHaveLength(1);
    expect(sentTypes(socket).filter((type) => type === "resize")).toHaveLength(
      1,
    );

    rerender(<TerminalTab tab={tab} visible actions={actionsSpy()} />);
    // Refitted once on the way back, because the panel may have been resized
    // while this tab was away.
    expect(sentTypes(socket).filter((type) => type === "resize")).toHaveLength(
      2,
    );
  });

  // WSP-04 and WSP-07: the tab's durable state is which shell it is attached
  // to and where that shell is. Both are recorded through `updateTab`, which
  // is what puts them in the panel record before the next reload.
  it("records the terminal it attached to and the directory it is in", () => {
    stubEnvironment();
    const actions = actionsSpy();
    render(<TerminalTab tab={tab} visible actions={actions} />);
    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;

    ready(socket);
    expect(actions.updateTab).toHaveBeenCalledWith("t", { terminalId });

    socket.deliver({
      version: 1,
      type: "cwd",
      projectId,
      terminalId,
      cwd: "apps/web",
    });
    expect(actions.updateTab).toHaveBeenCalledWith("t", { cwd: "apps/web" });
  });

  // The reload path: a tab that recorded a terminal claims that one back,
  // with its scrollback, rather than starting a second shell (WSP-07).
  it("claims the recorded terminal on mount, and creates one otherwise", () => {
    stubEnvironment();
    render(
      <TerminalTab
        tab={{ ...tab, terminalId, cwd: "apps/web" }}
        visible
        actions={actionsSpy()}
      />,
    );
    const socket = sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;
    socket.open();
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "attach",
      terminalId,
    });

    cleanup();
    render(<TerminalTab tab={tab} visible actions={actionsSpy()} />);
    const second = sockets[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    second.open();
    expect(JSON.parse(second.sent[0] ?? "{}")).toMatchObject({
      type: "create",
    });
  });

  it("says so, and starts no shell, when it has no worktree to run in", () => {
    stubEnvironment();
    render(
      <TerminalTab
        tab={{ ...tab, context: null }}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(screen.getByText(/not bound to a worktree/)).toBeVisible();
    expect(screen.queryByLabelText("Project terminal")).not.toBeInTheDocument();
  });
});
