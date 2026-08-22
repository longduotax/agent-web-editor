// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// WSP-03's drag, as far as a DOM without layout can be asked about it.
//
// jsdom computes no layout at all: every `getBoundingClientRect` is zero and
// every `offsetLeft` is zero, so a drag rendered here would resolve every
// pointer position to the same target. The geometry is therefore STUBBED to
// a stated layout — two groups side by side, each with a strip — and what
// these cases assert is the wiring: that a press is not a drag, that the
// drop targets appear only during one and highlight one at a time, that each
// kind of drop asks the model for the right thing, that a cancelled drag
// asks for nothing, and that all of it is announced (WSP-10).
//
// The geometry itself is arithmetic, and is tested as arithmetic in
// tabDrag.test.ts; that the real page has the shape stubbed here is measured
// end to end in e2e/workspace-panel.spec.ts, which is the only place a real
// layout exists.

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
const context: TabContext = {
  projectId,
  threadId,
  scopeKey: projectId,
  label: "Example project",
};

/** The stubbed layout, in the coordinates every case below uses. */
const LAYOUT = {
  groupWidth: 200,
  groupHeight: 600,
  stripHeight: 40,
  listWidth: 160,
  tabWidth: 60,
  leftGroupX: 1000,
  rightGroupX: 1200,
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

/**
 * Two groups side by side: `group-1` holds Changes and Files, `group-2`
 * holds one File tab. Seeded as a device-local record rather than built by
 * clicking, so every case starts from the same layout.
 */
function seedTwoGroups(store: Map<string, string>) {
  store.set(
    "pi-workspace:panel",
    JSON.stringify({
      version: 2,
      root: {
        type: "split",
        id: "split-1",
        axis: "row",
        sizes: [0.5, 0.5],
        children: [
          { type: "group", id: "group-1" },
          { type: "group", id: "group-2" },
        ],
      },
      groups: {
        "group-1": {
          id: "group-1",
          tabIds: ["tab-changes", "tab-files"],
          activeTabId: "tab-changes",
        },
        "group-2": {
          id: "group-2",
          tabIds: ["tab-file"],
          activeTabId: "tab-file",
        },
      },
      tabs: {
        "tab-changes": { id: "tab-changes", type: "changes", context },
        "tab-files": { id: "tab-files", type: "files", context, search: "" },
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

function groupLeft(element: Element): number {
  return element.closest(".panel-group")?.id === "panel-group-group-2"
    ? LAYOUT.rightGroupX
    : LAYOUT.leftGroupX;
}

/**
 * The layout jsdom will not compute. Only the elements a drag measures need
 * a rectangle: the group, its strip band, and its scrolling tab list.
 */
function stubbedRect(element: Element): DOMRect {
  const left = groupLeft(element);
  if (element.classList.contains("panel-group"))
    return new DOMRect(left, 0, LAYOUT.groupWidth, LAYOUT.groupHeight);
  if (element.classList.contains("panel-tabstrip"))
    return new DOMRect(left, 0, LAYOUT.groupWidth, LAYOUT.stripHeight);
  if (element.classList.contains("panel-tab-options"))
    return new DOMRect(left, 0, LAYOUT.listWidth, LAYOUT.stripHeight);
  return new DOMRect(0, 0, 0, 0);
}

let offsetLeft: PropertyDescriptor | undefined;
let offsetWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function getRect(this: Element) {
      return stubbedRect(this);
    },
  );
  offsetLeft = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetLeft",
  );
  offsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  // Tabs are measured by their offsets inside the strip's scroller rather
  // than by client rectangles, because offsets do not move when the strip
  // scrolls under the drag.
  Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
    configurable: true,
    get(this: HTMLElement) {
      const list = this.parentElement;
      if (list === null) return 0;
      return (
        [...list.querySelectorAll("[data-panel-tab]")].indexOf(this) *
        LAYOUT.tabWidth
      );
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => LAYOUT.tabWidth,
  });
  api.getStatus.mockResolvedValue({
    available: true,
    message: null,
    files: [],
  });
  api.getFiles.mockResolvedValue({ entries: [], truncated: false });
  api.getFile.mockResolvedValue({
    kind: "text",
    path: "src/main.ts",
    content: "",
    truncated: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (offsetLeft !== undefined)
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", offsetLeft);
  if (offsetWidth !== undefined)
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
});

interface Point {
  x: number;
  y: number;
}

/**
 * A pointer event jsdom will accept. `PointerEvent` is not implemented
 * there, so the event is a `MouseEvent` carrying the two pointer properties
 * the drag actually reads.
 */
function pointerEvent(type: string, at: Point): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event;
}

function press(tab: HTMLElement, at: Point) {
  fireEvent(tab, pointerEvent("pointerdown", at));
}

function movePointer(tab: HTMLElement, to: Point) {
  fireEvent(tab, pointerEvent("pointermove", to));
}

function release(tab: HTMLElement, at: Point) {
  fireEvent(tab, pointerEvent("pointerup", at));
}

/**
 * A press plus enough movement to cross the drag threshold, which is where
 * a real drag starts: the pointer is still over the tab it grabbed, so the
 * pick-up is announced and no target is announced yet — the tab is where it
 * already was.
 */
function beginDrag(tab: HTMLElement, at: Point = ON_TAB) {
  press(tab, at);
  movePointer(tab, { x: at.x + 8, y: at.y });
}

/** The middle of the left group's tab strip, where a drag starts. */
const ON_TAB: Point = { x: LAYOUT.leftGroupX + 20, y: 20 };
/** The centre of the right group. */
const RIGHT_CENTRE: Point = { x: LAYOUT.rightGroupX + 100, y: 300 };
/** The centre of the left group — the group the drag starts in. */
const OWN_CENTRE: Point = { x: LAYOUT.leftGroupX + 100, y: 300 };

function tabsOf(groupIndex: number): string[] {
  const list = screen.getAllByRole("tablist")[groupIndex];
  if (list === undefined) throw new Error("no such tab strip");
  return within(list)
    .getAllByRole("tab")
    .map((tab) => tab.textContent);
}

describe("dragging a panel tab", () => {
  it("does not start a drag on a press that does not move", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    const files = screen.getByRole("tab", { name: "Files" });
    press(files, ON_TAB);
    // Two pixels: a tremor, not a drag.
    movePointer(files, { x: ON_TAB.x + 2, y: ON_TAB.y });
    release(files, { x: ON_TAB.x + 2, y: ON_TAB.y });
    fireEvent.click(files);

    expect(document.querySelector(".panel-drop-zones")).toBeNull();
    expect(document.querySelector(".panel-drag-ghost")).toBeNull();
    // The click still belongs to the tab.
    expect(files).toHaveAttribute("aria-selected", "true");
  });

  it("shows drop targets on every group only while a drag is in progress", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    const changes = screen.getByRole("tab", { name: "Changes" });
    expect(document.querySelectorAll(".panel-drop-zones")).toHaveLength(0);

    beginDrag(changes);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Dragging Changes. Move it over a tab group, or press Escape to cancel.",
    );
    movePointer(changes, RIGHT_CENTRE);

    expect(document.querySelectorAll(".panel-drop-zones")).toHaveLength(2);
    // Four edges and a centre, per group.
    expect(document.querySelectorAll(".panel-drop-edge")).toHaveLength(8);
    expect(document.querySelectorAll(".panel-drop-centre")).toHaveLength(2);
    expect(document.querySelector(".panel-drag-ghost")).toHaveTextContent(
      "Changes",
    );

    release(changes, RIGHT_CENTRE);
    expect(document.querySelectorAll(".panel-drop-zones")).toHaveLength(0);
    expect(document.querySelector(".panel-drag-ghost")).toBeNull();
  });

  it("highlights one target at a time and announces each one", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    const changes = screen.getByRole("tab", { name: "Changes" });
    beginDrag(changes);
    movePointer(changes, RIGHT_CENTRE);

    const highlighted = () =>
      [...document.querySelectorAll(".panel-drop-zones .active")].map(
        (zone) =>
          [...zone.classList].find((name) => name !== "panel-drop-edge") ?? "",
      );
    expect(highlighted()).toEqual(["panel-drop-centre"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Drop into Panel tab group 2 of 2.",
    );

    // The right group's right edge: one target, and a different one.
    movePointer(changes, {
      x: LAYOUT.rightGroupX + LAYOUT.groupWidth - 5,
      y: 300,
    });
    expect(highlighted()).toEqual(["panel-drop-right"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Split Panel tab group 2 of 2 to the right.",
    );

    release(changes, {
      x: LAYOUT.rightGroupX + LAYOUT.groupWidth - 5,
      y: 300,
    });
  });

  it("moves the tab into the group whose centre it is dropped on", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    expect(tabsOf(0)).toEqual(["Changes×", "Files×"]);

    const changes = screen.getByRole("tab", { name: "Changes" });
    beginDrag(changes);
    movePointer(changes, RIGHT_CENTRE);
    release(changes, RIGHT_CENTRE);

    expect(tabsOf(0)).toEqual(["Files×"]);
    expect(tabsOf(1)).toEqual(["main.ts×", "Changes×"]);
    // WSP-03: dropping on a centre activates the tab there.
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moved Changes into Panel tab group 2 of 2.",
    );
  });

  it("splits the group whose edge it is dropped on", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    const changes = screen.getByRole("tab", { name: "Changes" });
    beginDrag(changes);
    // The bottom edge of the right group: a column split.
    const bottom = {
      x: LAYOUT.rightGroupX + 100,
      y: LAYOUT.groupHeight - 5,
    };
    movePointer(changes, bottom);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Split Panel tab group 2 of 2 below.",
    );
    release(changes, bottom);

    expect(screen.getAllByRole("tablist")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Split Panel tab group 2 of 2 below with Changes.",
    );
  });

  it("reorders within its own strip", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    expect(tabsOf(0)).toEqual(["Changes×", "Files×"]);

    const changes = screen.getByRole("tab", { name: "Changes" });
    beginDrag(changes);
    // Past the middle of the second tab: 60px tabs, so 100 is inside the
    // second half of the tab at 60..120.
    const afterFiles = { x: LAYOUT.leftGroupX + 100, y: 20 };
    movePointer(changes, afterFiles);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Drop into Panel tab group 1 of 2 tab strip, position 2 of 2.",
    );
    release(changes, afterFiles);

    expect(tabsOf(0)).toEqual(["Files×", "Changes×"]);
  });

  // WSP-03 names this case explicitly.
  it("does nothing when a tab is dropped on its own group's centre", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    const changes = screen.getByRole("tab", { name: "Changes" });
    beginDrag(changes);
    movePointer(changes, OWN_CENTRE);
    release(changes, OWN_CENTRE);

    expect(tabsOf(0)).toEqual(["Changes×", "Files×"]);
    expect(tabsOf(1)).toEqual(["main.ts×"]);
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing moved.");
  });

  it("leaves the layout alone when Escape cancels the drag", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    // From an INACTIVE tab, so a cancelled drag that nonetheless activated
    // it would show up here.
    const files = screen.getByRole("tab", { name: "Files" });
    beginDrag(files, { x: LAYOUT.leftGroupX + 80, y: 20 });
    movePointer(files, RIGHT_CENTRE);
    expect(document.querySelectorAll(".panel-drop-zones")).toHaveLength(2);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(document.querySelectorAll(".panel-drop-zones")).toHaveLength(0);
    expect(tabsOf(0)).toEqual(["Changes×", "Files×"]);
    expect(tabsOf(1)).toEqual(["main.ts×"]);
    expect(files).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Drag cancelled. Nothing moved.",
    );

    // And the release that follows the cancellation neither moves the tab
    // nor activates it.
    release(files, RIGHT_CENTRE);
    fireEvent.click(files);
    expect(tabsOf(0)).toEqual(["Changes×", "Files×"]);
    expect(files).toHaveAttribute("aria-selected", "false");
  });

  it("leaves the layout alone when the drag is released outside every target", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    const changes = screen.getByRole("tab", { name: "Changes" });
    beginDrag(changes);
    // Over the chat surface, which is left of the panel: WSP-03's splits
    // stay inside the panel, and a tab never lands anywhere else.
    const outside = { x: 200, y: 300 };
    movePointer(changes, outside);
    expect(document.querySelectorAll(".panel-drop-zones .active")).toHaveLength(
      0,
    );
    release(changes, outside);

    expect(tabsOf(0)).toEqual(["Changes×", "Files×"]);
    expect(tabsOf(1)).toEqual(["main.ts×"]);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing moved.");
  });

  it("cancels rather than dropping when the pointer is cancelled", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    const changes = screen.getByRole("tab", { name: "Changes" });
    beginDrag(changes);
    movePointer(changes, RIGHT_CENTRE);
    fireEvent(changes, pointerEvent("pointercancel", RIGHT_CENTRE));

    expect(tabsOf(0)).toEqual(["Changes×", "Files×"]);
    expect(tabsOf(1)).toEqual(["main.ts×"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Drag cancelled. Nothing moved.",
    );
  });

  it("does not start a drag from the close affordance", () => {
    const store = stubStorage();
    seedTwoGroups(store);
    renderPanel();

    const changes = screen.getByRole("tab", { name: "Changes" });
    const close = changes.querySelector("[data-tab-close]");
    if (close === null) throw new Error("no close affordance");

    // Dispatched from the affordance, which bubbles to the tab with the
    // affordance as its target — exactly what a press on the × produces.
    fireEvent(close, pointerEvent("pointerdown", ON_TAB));
    movePointer(changes, RIGHT_CENTRE);

    expect(document.querySelector(".panel-drag-ghost")).toBeNull();
    expect(tabsOf(1)).toEqual(["main.ts×"]);
  });

  it("has no axe violations mid-drag", async () => {
    const store = stubStorage();
    seedTwoGroups(store);
    const { container } = renderPanel();

    const changes = screen.getByRole("tab", { name: "Changes" });
    beginDrag(changes);
    movePointer(changes, RIGHT_CENTRE);

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
