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
import { ProjectIdSchema, ThreadIdSchema } from "@pi-web/contracts";

interface TerminalOptions {
  theme?: { background?: string; foreground?: string; cursor?: string };
}

const terminals = vi.hoisted(() => ({
  instances: [] as { lines: string[]; options: TerminalOptions }[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public options: TerminalOptions;
    public lines: string[] = [];
    public constructor(options: TerminalOptions) {
      this.options = options;
      terminals.instances.push(this);
    }
    public clear(): void {
      return undefined;
    }
    public dispose(): void {
      return undefined;
    }
    public loadAddon(): void {
      return undefined;
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
    public readonly cols = 100;
    public readonly rows = 30;
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    public fit(): void {
      return undefined;
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

afterEach(() => {
  MockWebSocket.instances.splice(0);
  terminals.instances.splice(0);
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
      public disconnect(): void {
        return undefined;
      }
      public observe(): void {
        return undefined;
      }
    },
  );
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
