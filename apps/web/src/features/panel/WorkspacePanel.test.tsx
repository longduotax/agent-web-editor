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
  getFile: vi.fn(),
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
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <Harness focusedContext={focusedContext} />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

// A device-local record as `panelStorage` writes it (WSP-04), so a test can
// start from a panel the user already had rather than building one by
// clicking. Three tabs, one of them active.
function seedPanelRecord(store: Map<string, string>) {
  store.set(
    "pi-workspace:panel",
    JSON.stringify({
      version: 2,
      root: { type: "group", id: "group-1" },
      groups: {
        "group-1": {
          id: "group-1",
          tabIds: ["tab-changes", "tab-files", "tab-file"],
          activeTabId: "tab-files",
        },
      },
      tabs: {
        "tab-changes": { id: "tab-changes", type: "changes", context },
        "tab-files": {
          id: "tab-files",
          type: "files",
          context,
          search: "",
        },
        "tab-file": {
          id: "tab-file",
          type: "file",
          context,
          path: "src/main.ts",
          view: "preview",
        },
      },
      focusedGroupId: "group-1",
      width: 400,
      open: true,
    }),
  );
}

const panel = () =>
  screen.queryByRole("complementary", { name: "Workspace panel" });

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Open workspace panel" }),
  );
}

// Shift + primary + Alt is the panel's chord group; ctrlKey stands in for the
// primary modifier on the non-mac platform jsdom reports.
function panelChord(key: string) {
  fireEvent.keyDown(window, {
    key,
    shiftKey: true,
    ctrlKey: true,
    altKey: true,
  });
}

function tabIdOf(name: string): string {
  return screen.getByRole("tab", { name }).id.replace("panel-tab-", "");
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

  // The claim WSP-09 actually makes about ten open tabs costing one body.
  // This is measured from a RESTORED panel, because that is the only way to
  // hold a tab that has never been activated: opening one activates it, so a
  // test that clicks its way to two tabs has activated both and can only
  // measure something else.
  it("mounts and queries only the tab a restored panel shows", async () => {
    const store = stubStorage();
    seedPanelRecord(store);
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    api.getFile.mockResolvedValue({
      available: true,
      kind: "text",
      content: "",
      truncated: false,
      message: null,
    });
    renderPanel();

    expect(await screen.findAllByRole("tab")).toHaveLength(3);
    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(1);
    });
    // One body for three tabs, and it is the active one's.
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    expect(document.querySelector('[role="tabpanel"]')).toHaveAttribute(
      "id",
      "panel-tabpanel-tab-files",
    );
    expect(api.getStatus).not.toHaveBeenCalled();
    expect(api.getFile).not.toHaveBeenCalled();
  });

  it("issues nothing further when the panel is toggled shut and open", async () => {
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

    await user.click(screen.getByRole("button", { name: "New panel tab" }));
    await user.click(screen.getByRole("menuitem", { name: "Files" }));
    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(1);
    });

    // The panel-toggle chord, twice: shut, then open again.
    panelChord(" ");
    panelChord(" ");
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(api.getFiles).toHaveBeenCalledTimes(1);
  });

  // `enabled: visible && …` is what this measures, and it measures it: an
  // invalidated query with a mounted observer refetches immediately unless it
  // is disabled, so this fails the moment the visibility gate is deleted.
  // (The previous version of this test passed on `staleTime` alone — its
  // whole 30-second window fitted inside the test.)
  it("keeps a hidden tab mounted and inert, and issues nothing for it even when its data is invalidated", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [{ path: "src/main.ts", kind: "modified" }],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    const { queryClient } = renderPanel();
    await openBothTabs(user);
    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(1);
    });

    const changesBody = document.getElementById(
      `panel-tabpanel-${tabIdOf("Changes")}`,
    );
    expect(changesBody).toHaveAttribute("hidden");
    expect(changesBody).toHaveAttribute("inert");
    // Still mounted: its content is retained, not rebuilt.
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(2);
    expect(api.getStatus).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries({ queryKey: ["git"] });
    await Promise.resolve();
    expect(api.getStatus).toHaveBeenCalledTimes(1);

    // Coming back does refetch — the data was invalidated — but the content
    // it already had never leaves the screen while that happens (WSP-09).
    await user.click(screen.getByRole("tab", { name: "Changes" }));
    expect(screen.getByText("src/main.ts")).toBeVisible();
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("src/main.ts")).toBeVisible();
  });

  // D5. WSP-06 calls the Changes list the CURRENT state of a named worktree,
  // and nothing invalidates it — the live channel carries no worktree signal,
  // and a shell run in a Terminal tab emits nothing at all. So this body
  // re-reads on every activation, while the bodies that are not making that
  // claim keep the panel's stale window.
  it("re-reads the worktree whenever the Changes tab is shown, without blanking it", async () => {
    const user = userEvent.setup();
    stubStorage();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [{ path: "src/main.ts", kind: "modified" }],
    });
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    renderPanel();
    await openBothTabs(user);
    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(1);
    });
    expect(api.getStatus).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: "Changes" }));

    // Its previous answer is still on screen while the new one is in flight:
    // no "Reading the worktree…", no lost scroll position.
    expect(screen.getByText("src/main.ts")).toBeVisible();
    expect(screen.queryByText("Reading the worktree…")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalledTimes(2);
    });

    // Files is not making that claim, so it still costs nothing to return to.
    await user.click(screen.getByRole("tab", { name: "Files" }));
    expect(api.getFiles).toHaveBeenCalledTimes(1);
  });

  // D2. Every panel chord acts on `focusedGroupId`, and the only thing that
  // wrote it was a pointer press on a tab strip — so a keyboard user who
  // moved focus into another group had their chords act on the group they
  // had left.
  it("acts on the group the keyboard is in, not the one the pointer last touched", async () => {
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

    // Split: the Files tab moves to a new group, and focus follows it there.
    panelChord("ArrowRight");
    await screen.findByRole("separator", { name: "Resize panel groups" });
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();

    // Focus the OTHER group's tab with the keyboard alone, then close.
    screen.getByRole("tab", { name: "Changes" }).focus();
    panelChord("Backspace");

    await waitFor(() => {
      expect(
        screen.queryByRole("tab", { name: "Changes" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
  });

  // D9. Two landmarks called "Panel tab group" and two tablists called
  // "Panel tabs" are indistinguishable to a screen reader (WSP-10).
  it("names each group and each tab strip distinctly once the panel is split", async () => {
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

    // One group: nothing to tell apart, so it keeps the plain name.
    expect(
      screen.getByRole("region", { name: "Panel tab group" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "Panel tabs" }),
    ).toBeInTheDocument();

    panelChord("ArrowRight");
    await screen.findByRole("separator", { name: "Resize panel groups" });

    const names = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-label"));
    expect(names).toEqual(["Panel tab group 1 of 2", "Panel tab group 2 of 2"]);
    expect(
      screen.getByRole("tablist", { name: "Panel tabs, group 1 of 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "Panel tabs, group 2 of 2" }),
    ).toBeInTheDocument();
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
