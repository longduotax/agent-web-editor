// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectIdSchema,
  TerminalClientFrameSchema,
  ThreadIdSchema,
} from "@pi-web/contracts";

interface TerminalOptions {
  theme?: { background?: string; foreground?: string; cursor?: string };
}

const terminals = vi.hoisted(() => ({
  instances: [] as {
    lines: string[];
    options: TerminalOptions;
    cols: number;
    rows: number;
    cleared: number;
  }[],
  // What the fit addon will propose the next time it is asked. The real one
  // reads the container; the point of this seam is that it can propose a
  // size the contract refuses, which is the whole of F1.
  proposed: { columns: 100, rows: 30 },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public options: TerminalOptions;
    public lines: string[] = [];
    public cols = 100;
    public rows = 30;
    public cleared = 0;
    public constructor(options: TerminalOptions) {
      this.options = options;
      terminals.instances.push(this);
    }
    public clear(): void {
      this.cleared += 1;
    }
    public dispose(): void {
      return undefined;
    }
    public loadAddon(addon: { activate(terminal: unknown): void }): void {
      addon.activate(this);
    }
    public onData(): { dispose(): void } {
      return { dispose: () => undefined };
    }
    public open(): void {
      return undefined;
    }
    public write(): void {
      return undefined;
    }
    public writeln(value: string): void {
      this.lines.push(value);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    public activate(terminal: { cols: number; rows: number }): void {
      this.terminal = terminal;
    }
    private terminal: { cols: number; rows: number } | null = null;
    public fit(): void {
      if (this.terminal === null) return;
      this.terminal.cols = terminals.proposed.columns;
      this.terminal.rows = terminals.proposed.rows;
    }
  },
}));

import { TerminalView } from "./TerminalView.js";

const projectId = ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001");
const threadId = ThreadIdSchema.parse("30000000-0000-4000-8000-000000000001");
const terminalId = "20000000-0000-4000-8000-000000000001" as const;

class MockWebSocket extends EventTarget {
  public static readonly OPEN = 1;
  public static readonly instances: MockWebSocket[] = [];
  public readonly sent: string[] = [];
  public readyState = MockWebSocket.OPEN;

  public constructor(url: string) {
    super();
    void url;
    MockWebSocket.instances.push(this);
  }

  public close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public open(): void {
    this.dispatchEvent(new Event("open"));
  }

  public message(frame: unknown): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(frame) }),
    );
  }
}

/** Every live ResizeObserver callback, so a test can drive a container resize. */
const resizeCallbacks: (() => void)[] = [];

afterEach(() => {
  MockWebSocket.instances.splice(0);
  terminals.instances.splice(0);
  terminals.proposed = { columns: 100, rows: 30 };
  resizeCallbacks.splice(0);
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--term-bg");
  document.documentElement.style.removeProperty("--term-fg");
  document.documentElement.style.removeProperty("--term-cursor");
  cleanup();
  vi.unstubAllGlobals();
});

function stubEnvironment() {
  vi.stubGlobal("WebSocket", MockWebSocket);
  // jsdom ships no matchMedia; the terminal watches it so a "System" theme
  // choice re-colours live when the OS flips.
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      public constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      public disconnect(): void {
        return undefined;
      }
      public observe(): void {
        return undefined;
      }
    },
  );
}

/** The container changed size: what the fit addon reacts to. */
function containerResized() {
  for (const callback of resizeCallbacks) callback();
}

/** The last frame of a type the view sent, or undefined. */
function lastSent(
  socket: MockWebSocket,
  type: string,
): Record<string, unknown> | undefined {
  const frames = socket.sent
    .map((frame) => JSON.parse(frame) as Record<string, unknown>)
    .filter((frame) => frame.type === type);
  return frames[frames.length - 1];
}

function setThemeTokens(background: string, foreground: string) {
  document.documentElement.style.setProperty("--term-bg", background);
  document.documentElement.style.setProperty("--term-fg", foreground);
  document.documentElement.style.setProperty("--term-cursor", foreground);
}

describe("TerminalView", () => {
  it("takes its palette from the app's theme tokens, never a hardcoded one, and re-themes live when the theme changes", async () => {
    stubEnvironment();
    setThemeTokens("#ffffff", "#1d1d1f");
    render(<TerminalView projectId={projectId} threadId={threadId} />);

    const terminal = terminals.instances[0];
    if (terminal === undefined) throw new Error("Terminal was not created");
    expect(terminal.options.theme).toMatchObject({
      background: "#ffffff",
      foreground: "#1d1d1f",
    });

    // Switching System -> Dark in Settings stamps data-theme on <html> and
    // remaps the tokens; the live terminal must follow without a reload.
    await act(async () => {
      setThemeTokens("#131417", "#ececee");
      document.documentElement.setAttribute("data-theme", "dark");
      // MutationObserver callbacks land on a microtask.
      await Promise.resolve();
    });

    expect(terminal.options.theme).toMatchObject({
      background: "#131417",
      foreground: "#ececee",
    });
    expect(terminals.instances).toHaveLength(1); // re-themed, not recreated
  });

  // F1. Shrinking a group to its floor made the fit addon propose `rows: 1`;
  // the contract bounds rows at 2, so the server refused the frame and wrote
  // "Terminal command was rejected." into the user's shell. The contract is
  // the authority and the client obeys it BEFORE sending.
  it("clamps a proposed size into the contract's bounds rather than sending a frame the server must reject", () => {
    stubEnvironment();
    render(<TerminalView projectId={projectId} threadId={threadId} />);
    const socket = MockWebSocket.instances[0];
    if (socket === undefined) throw new Error("WebSocket was not created");
    act(() => {
      socket.open();
      socket.message({ version: 1, type: "ready", projectId, terminalId });
    });

    // What the fit addon proposes for a group shrunk to MIN_FRACTION.
    terminals.proposed = { columns: 191, rows: 1 };
    act(() => {
      containerResized();
    });

    const resize = lastSent(socket, "resize");
    expect(resize).toMatchObject({ columns: 191, rows: 2 });
    // And the frame that is sent is one the contract accepts.
    expect(() => TerminalClientFrameSchema.parse(resize)).not.toThrow();

    // The ceiling, from the other side.
    terminals.proposed = { columns: 4000, rows: 4000 };
    act(() => {
      containerResized();
    });
    expect(lastSent(socket, "resize")).toMatchObject({
      columns: 500,
      rows: 200,
    });
  });

  // F1. A rejected command used to be written into the scrollback — where it
  // is indistinguishable from program output and survives there — and to
  // latch the toolbar at "Terminal error" for the rest of the session.
  it("surfaces a rejected command in the toolbar, never in the buffer, and clears it on the next successful exchange", () => {
    stubEnvironment();
    render(<TerminalView projectId={projectId} threadId={threadId} />);
    const socket = MockWebSocket.instances[0];
    const terminal = terminals.instances[0];
    if (socket === undefined) throw new Error("WebSocket was not created");
    if (terminal === undefined) throw new Error("Terminal was not created");
    act(() => {
      socket.open();
      socket.message({ version: 1, type: "ready", projectId, terminalId });
    });
    expect(screen.getByText("Terminal running")).toBeInTheDocument();

    act(() => {
      socket.message({
        version: 1,
        type: "error",
        projectId,
        message: "Terminal command was rejected.",
      });
    });

    // Said where a message belongs, in the words the server used.
    expect(
      screen.getByText("Terminal command was rejected."),
    ).toBeInTheDocument();
    // Not in the scrollback, where it would outlive the problem.
    expect(terminal.lines).toEqual([]);
    // And the shell is still running, so the toolbar still says so.
    expect(screen.getByText("Terminal running")).toBeInTheDocument();

    act(() => {
      socket.message({ version: 1, type: "output", projectId, data: "$ " });
    });

    expect(
      screen.queryByText("Terminal command was rejected."),
    ).not.toBeInTheDocument();
  });

  // A fatal error is a different thing from a refused command: the socket is
  // gone and nothing will clear it.
  it("latches a disconnect, which no later frame can clear", () => {
    stubEnvironment();
    render(<TerminalView projectId={projectId} threadId={threadId} />);
    const socket = MockWebSocket.instances[0];
    if (socket === undefined) throw new Error("WebSocket was not created");
    act(() => {
      socket.open();
      socket.message({ version: 1, type: "ready", projectId, terminalId });
      socket.close();
    });
    expect(screen.getByText("Terminal disconnected")).toBeInTheDocument();
  });

  it("recovers from termination by attaching a fresh terminal", () => {
    stubEnvironment();
    render(<TerminalView projectId={projectId} threadId={threadId} />);
    const socket = MockWebSocket.instances[0];
    if (socket === undefined) throw new Error("WebSocket was not created");
    act(() => {
      socket.open();
      socket.message({ version: 1, type: "ready", projectId, terminalId });
    });

    fireEvent.click(screen.getByRole("button", { name: "Terminate" }));
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toEqual({
      version: 1,
      type: "terminate",
      projectId,
      threadId,
      terminalId,
    });

    act(() => {
      socket.message({
        version: 1,
        type: "exit",
        projectId,
        exitCode: 143,
        signal: 15,
      });
    });
    expect(screen.getByText("Terminal exited")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start terminal" }));
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toEqual({
      version: 1,
      type: "attach",
      projectId,
      threadId,
    });
  });
});
