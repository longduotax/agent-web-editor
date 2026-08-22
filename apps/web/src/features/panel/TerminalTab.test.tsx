// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

class MockWebSocket extends EventTarget {
  public static readonly OPEN = 1;
  public readyState = MockWebSocket.OPEN;
  public constructor(url: string) {
    super();
    void url;
  }
  public close(): void {
    this.readyState = 3;
  }
  public send(): void {
    return undefined;
  }
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
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
      public observe(): void {
        return undefined;
      }
      public disconnect(): void {
        return undefined;
      }
    },
  );
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
