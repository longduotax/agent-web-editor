// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

import { TabStrip } from "./TabStrip.js";
import type { PanelActions } from "./usePanelState.js";
import type { PanelTab, TabContext, TabId } from "./panelTabs.js";
import type { TabGroup } from "./panelModel.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;

const here: TabContext = {
  projectId,
  threadId,
  scopeKey: projectId,
  label: "Example project",
};
const elsewhere: TabContext = {
  projectId,
  threadId,
  scopeKey: "20000000-0000-4000-8000-000000000002",
  label: "pi/feature",
};

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

const tabs: Record<TabId, PanelTab> = {
  "tab-1": { id: "tab-1", type: "changes", context: here },
  "tab-2": { id: "tab-2", type: "files", context: here, search: "" },
  "tab-3": {
    id: "tab-3",
    type: "file",
    context: elsewhere,
    path: "src/main.ts",
    view: "preview",
  },
};

const group: TabGroup = {
  id: "group-1",
  tabIds: ["tab-1", "tab-2", "tab-3"],
  activeTabId: "tab-1",
};

function renderStrip(
  overrides: {
    group?: TabGroup;
    focusedContext?: TabContext | null;
    actions?: PanelActions;
    onClosePanel?: () => void;
  } = {},
) {
  const actions = overrides.actions ?? actionsSpy();
  render(
    <TabStrip
      group={overrides.group ?? group}
      tabs={tabs}
      actions={actions}
      focused
      focusRequest={0}
      focusedContext={
        overrides.focusedContext === undefined ? here : overrides.focusedContext
      }
      index={1}
      groupCount={1}
      onClosePanel={overrides.onClosePanel}
    />,
  );
  return actions;
}

// The shipped stylesheet, resolved from this file rather than from the
// working directory, so the assertion below reads what the app loads.
function stylesheetPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../styles.css");
}

describe("TabStrip", () => {
  it("is a tablist whose active tab points at its own panel", () => {
    renderStrip();
    const list = screen.getByRole("tablist");
    const strip = within(list).getAllByRole("tab");

    expect(strip).toHaveLength(3);
    const changes = screen.getByRole("tab", { name: "Changes" });
    const files = screen.getByRole("tab", { name: "Files" });
    expect(screen.getByRole("tab", { name: /main\.ts/ })).toBeVisible();
    expect(changes).toHaveAttribute("aria-selected", "true");
    expect(files).toHaveAttribute("aria-selected", "false");
    expect(changes).toHaveAttribute("aria-controls", "panel-tabpanel-tab-1");
    // A tab that has never been activated has no body mounted, so it must
    // not claim one.
    expect(files).not.toHaveAttribute("aria-controls");
  });

  // One stop in the page's tab order per group: arrows move within the
  // strip, Tab moves out of it.
  it("keeps a roving tabindex on the active tab", () => {
    renderStrip();
    const strip = screen.getAllByRole("tab");
    expect(strip[0]).toHaveAttribute("tabindex", "0");
    expect(strip[1]).toHaveAttribute("tabindex", "-1");
    expect(strip[2]).toHaveAttribute("tabindex", "-1");
  });

  it("moves through the strip with the arrow keys, wrapping at both ends", async () => {
    const user = userEvent.setup();
    const actions = renderStrip();
    const strip = screen.getAllByRole("tab");
    strip[0]?.focus();

    await user.keyboard("{ArrowRight}");
    expect(actions.activateTab).toHaveBeenCalledWith("tab-2");

    await user.keyboard("{ArrowLeft}");
    expect(actions.activateTab).toHaveBeenLastCalledWith("tab-3");

    await user.keyboard("{End}");
    expect(actions.activateTab).toHaveBeenLastCalledWith("tab-3");
    await user.keyboard("{Home}");
    expect(actions.activateTab).toHaveBeenLastCalledWith("tab-1");
  });

  it("activates a tab on click", async () => {
    const user = userEvent.setup();
    const actions = renderStrip();

    await user.click(screen.getByRole("tab", { name: /Files/ }));

    expect(actions.activateTab).toHaveBeenCalledWith("tab-2");
  });

  // A tablist may own nothing but tabs, and a button nested inside a tab is
  // a nested interactive, so the per-tab "×" is a pointer affordance and the
  // announced control closes the active tab (the chord covers the rest).
  it("closes a tab from its own pointer affordance without activating it", async () => {
    const user = userEvent.setup();
    const actions = renderStrip();

    await user.click(screen.getByTitle("Close Files"));

    expect(actions.closeTab).toHaveBeenCalledWith("tab-2");
    expect(actions.activateTab).not.toHaveBeenCalled();
  });

  it("offers an announced control that closes the active tab", async () => {
    const user = userEvent.setup();
    const actions = renderStrip();

    await user.click(screen.getByRole("button", { name: "Close Changes tab" }));

    expect(actions.closeTab).toHaveBeenCalledWith("tab-1");
  });

  // WSP-02: two tabs of one type from different worktrees must never be
  // ambiguous, and the chip names the execution scope, not the thread.
  it("chips only the tabs that read a different worktree", () => {
    renderStrip();
    expect(
      within(screen.getByRole("tab", { name: /main\.ts/ })).getByText(
        "pi/feature",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("tab", { name: "Changes" })).queryByText(
        "Example project",
      ),
    ).not.toBeInTheDocument();
  });

  it("chips every context-bearing tab when no chat pane owns a thread", () => {
    renderStrip({ focusedContext: null });
    expect(
      within(screen.getByRole("tab", { name: /Changes/ })).getByText(
        "Example project",
      ),
    ).toBeInTheDocument();
  });

  it("opens a new tab for the focused pane's thread", async () => {
    const user = userEvent.setup();
    const actions = renderStrip();

    await user.click(screen.getByRole("button", { name: "New panel tab" }));
    await user.click(screen.getByRole("menuitem", { name: "Terminal" }));

    expect(actions.openTab).toHaveBeenCalledWith(
      { type: "terminal", context: here, cwd: "", terminalId: null },
      { groupId: "group-1" },
    );
  });

  it("says why the thread-bound tab types are unavailable without a thread", async () => {
    const user = userEvent.setup();
    renderStrip({ focusedContext: null });

    await user.click(screen.getByRole("button", { name: "New panel tab" }));

    expect(screen.getByRole("menuitem", { name: /Changes/ })).toBeDisabled();
    expect(
      screen.getByText(/Focus a chat pane with a thread/),
    ).toBeInTheDocument();
  });

  it("dismisses the menu with Escape", async () => {
    const user = userEvent.setup();
    renderStrip();

    await user.click(screen.getByRole("button", { name: "New panel tab" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers the panel's close control only where it is given one", async () => {
    const user = userEvent.setup();
    const onClosePanel = vi.fn();
    renderStrip({ onClosePanel });

    await user.click(
      screen.getByRole("button", { name: "Close workspace panel" }),
    );
    expect(onClosePanel).toHaveBeenCalled();

    cleanup();
    renderStrip();
    expect(
      screen.queryByRole("button", { name: "Close workspace panel" }),
    ).not.toBeInTheDocument();
  });

  // D3. The affordance used to rest at `opacity: 0`, which hides an element
  // from view but leaves it fully hit-testable — so on a device with no
  // hover, the right edge of every inactive tab was an invisible close
  // button. This reads the shipped stylesheet rather than a copy of it,
  // because the defect lived entirely in the CSS.
  it("puts the per-tab close affordance out of reach until its tab is hovered or active", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(stylesheetPath(), "utf8");
    document.head.appendChild(style);
    renderStrip();

    // Files is inactive and nothing is hovering it: a tap landing here must
    // reach the tab, not the affordance.
    const inactive = screen.getByTitle("Close Files");
    expect(getComputedStyle(inactive).visibility).toBe("hidden");
    expect(getComputedStyle(inactive).pointerEvents).toBe("none");

    const active = within(
      screen.getByRole("tab", { name: "Changes" }),
    ).getByTitle("Close Changes");
    expect(getComputedStyle(active).visibility).toBe("visible");
    expect(getComputedStyle(active).pointerEvents).toBe("auto");

    style.remove();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <>
        <TabStrip
          group={group}
          tabs={tabs}
          actions={actionsSpy()}
          focused
          focusRequest={0}
          focusedContext={here}
          index={1}
          groupCount={1}
          onClosePanel={vi.fn()}
        />
        {/* The body the active tab controls, which the group renders in the
            real panel. */}
        <div id="panel-tabpanel-tab-1" role="tabpanel" aria-label="Changes" />
      </>,
    );

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
