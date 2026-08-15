// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectIdSchema } from "@pi-web/contracts";

const terminals = vi.hoisted(() => ({
  instances: [] as { lines: string[] }[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public constructor() {
      terminals.instances.push({ lines: [] });
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
      const terminal = terminals.instances.at(-1);
      if (terminal !== undefined) terminal.lines.push(value);
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
  vi.unstubAllGlobals();
});

describe("TerminalView", () => {
  it("recovers from termination by attaching a fresh terminal", () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
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
    render(<TerminalView projectId={projectId} />);
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
    });
  });
});
