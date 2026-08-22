// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";
import { useEffect, type JSX } from "react";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  getFiles: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import type { TabContext } from "./panelTabs.js";
import { usePanelState } from "./usePanelState.js";
import { WorkspacePanel } from "./WorkspacePanel.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
const context: TabContext = {
  projectId,
  threadId,
  scopeKey: projectId,
  label: "Example project",
};

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
  vi.stubGlobal("innerWidth", 1440);
  return store;
}

// Stands in for ProjectWorkspace: it owns the controller and binds the
// context-less tab the first-run record carries (D-1), which is exactly the
// wiring the route performs.
function Harness({
  focusedContext = context,
}: {
  focusedContext?: TabContext | null;
}): JSX.Element {
  const controller = usePanelState();
  const { bindPendingContexts } = controller.actions;
  useEffect(() => {
    if (focusedContext !== null) bindPendingContexts(focusedContext);
  }, [focusedContext, bindPendingContexts]);
  return (
    <WorkspacePanel controller={controller} focusedContext={focusedContext} />
  );
}

function renderPanel(focusedContext: TabContext | null = context) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness focusedContext={focusedContext} />
    </QueryClientProvider>,
  );
}

const panel = () =>
  screen.queryByRole("complementary", { name: "Workspace panel" });

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Open workspace panel" }),
  );
}

describe("WorkspacePanel", () => {
  it("is inert rather than merely invisible while it is closed, and the rail brings it back", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    renderPanel();

    // Out of the accessibility tree, and unreachable by focus.
    expect(panel()).not.toBeInTheDocument();
    expect(document.querySelector(".panel")).toHaveAttribute("inert");

    await openPanel(user);

    expect(panel()).toBeInTheDocument();
    expect(document.querySelector(".panel")).not.toHaveAttribute("inert");
    expect(
      screen.queryByRole("button", { name: "Open workspace panel" }),
    ).not.toBeInTheDocument();
  });

  it("closes back to the rail from its own control", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    renderPanel();
    await openPanel(user);

    await user.click(
      screen.getByRole("button", { name: "Close workspace panel" }),
    );

    expect(panel()).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open workspace panel" }),
    ).toBeInTheDocument();
  });

  it("resizes by pointer and by keyboard, within what the viewport can carry", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    renderPanel();
    await openPanel(user);

    const separator = screen.getByRole("separator", {
      name: "Resize workspace panel",
    });
    fireEvent.pointerDown(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 720, pointerId: 1 });
    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(separator).toHaveAttribute("aria-valuenow", "720");

    separator.focus();
    await user.keyboard("{ArrowLeft}");
    expect(separator).toHaveAttribute("aria-valuenow", "744");

    // 1440 - 272 (sidebar) - 360 (smallest chat pane): the panel can never
    // squash the chat surface out of the window.
    await user.keyboard("{End}");
    expect(separator).toHaveAttribute("aria-valuenow", "808");
  });

  it("splits into two groups with a divider that resizes them", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    renderPanel();
    await openPanel(user);

    await user.click(screen.getByRole("button", { name: "New panel tab" }));
    await user.click(screen.getByRole("menuitem", { name: "Files" }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    // The panel's own split chord: Shift + primary + Alt + ArrowRight.
    fireEvent.keyDown(window, {
      key: "ArrowRight",
      shiftKey: true,
      ctrlKey: true,
      altKey: true,
    });

    const divider = await screen.findByRole("separator", {
      name: "Resize panel groups",
    });
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    divider.focus();
    await user.keyboard("{ArrowRight}");
    expect(divider).toHaveAttribute("aria-valuenow", "55");
  });

  it("leaves the reopen rail when its last tab is closed", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    renderPanel();
    await openPanel(user);

    await user.click(screen.getByRole("button", { name: "Close Changes tab" }));

    expect(panel()).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open workspace panel" }),
    ).toBeInTheDocument();
  });
});

// WSP-09 is a contract, not an aspiration, so it is verified rather than
// asserted: these are the two claims the panel makes about doing no work it
// does not have to.
describe("WorkspacePanel does only the visible tab's work", () => {
  async function openBothTabs(user: ReturnType<typeof userEvent.setup>) {
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "New panel tab" }));
    await user.click(screen.getByRole("menuitem", { name: "Files" }));
  }

  it("never queries for a tab that has not been activated", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    renderPanel();
    await openPanel(user);
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalledTimes(1);
    });

    // Opening a tab activates it, so open one and switch away from it: the
    // Changes tab is now mounted but hidden.
    await user.click(screen.getByRole("button", { name: "New panel tab" }));
    await user.click(screen.getByRole("menuitem", { name: "Files" }));
    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(1);
    });

    // A hidden body issues nothing further, however much the panel around it
    // re-renders.
    fireEvent.keyDown(window, {
      key: " ",
      shiftKey: true,
      ctrlKey: true,
      altKey: true,
    });
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(api.getFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps a hidden tab mounted and inert, and refetches nothing on the way back", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    renderPanel();
    await openBothTabs(user);
    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(1);
    });

    const changesBody = document.querySelector(
      '[role="tabpanel"][aria-labelledby^="panel-tab-"]',
    );
    expect(changesBody).toHaveAttribute("hidden");
    expect(changesBody).toHaveAttribute("inert");
    // Still mounted: its content is retained, not rebuilt.
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(2);

    await user.click(screen.getByRole("tab", { name: "Changes" }));
    await user.click(screen.getByRole("tab", { name: "Files" }));
    await user.click(screen.getByRole("tab", { name: "Changes" }));

    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(api.getFiles).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations with two tabs open", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    const { container } = renderPanel();
    await openBothTabs(user);
    await within(container).findByRole("textbox", {
      name: "Search project files",
    });

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
