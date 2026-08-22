// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId, TerminalId, ThreadId } from "@pi-web/contracts";

import { createEmptyPanel, openTab, panelStateProblems } from "./panelModel.js";
import type { PanelState } from "./panelModel.js";
import type { PanelTab } from "./panelTabs.js";
import {
  INSPECTOR_MIGRATION_KEY,
  PANEL_STATE_VERSION,
  PANEL_STORAGE_KEY,
  readPanelState,
  writePanelState,
} from "./panelStorage.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROJECT = "11111111-1111-4111-8111-111111111111" as ProjectId;
const THREAD = "aaaaaaaa-1111-4111-8111-111111111111" as ThreadId;
const TERMINAL = "cccccccc-3333-4333-8333-333333333333" as TerminalId;

function ids(): () => string {
  let n = 0;
  return () => `id-${String(++n)}`;
}

interface Stub {
  store: Map<string, string>;
  removed: string[];
}

// A localStorage stand-in that records what was removed, so a test can
// assert that a record we refused to trust was cleared rather than left to
// fail again on the next read.
function stubStorage(initial: Record<string, string> = {}): Stub {
  const store = new Map(Object.entries(initial));
  const removed: string[] = [];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      removed.push(key);
      store.delete(key);
    },
  });
  return { store, removed };
}

function onlyGroup(state: PanelState): { tabIds: string[] } {
  const groups = Object.values(state.groups);
  const [group] = groups;
  if (groups.length !== 1 || group === undefined)
    throw new Error(`expected exactly one group, got ${String(groups.length)}`);
  return group;
}

function onlyTab(state: PanelState): PanelTab {
  const tabs = Object.values(state.tabs);
  const [tab] = tabs;
  if (tabs.length !== 1 || tab === undefined)
    throw new Error(`expected exactly one tab, got ${String(tabs.length)}`);
  return tab;
}

function expectDefaultPanel(state: PanelState): void {
  expect(panelStateProblems(state)).toEqual([]);
  expect(onlyGroup(state).tabIds).toHaveLength(1);
  const tab = onlyTab(state);
  expect(tab.type).toBe("changes");
  expect(tab.context).toBeNull();
  expect(state.width).toBe(400);
  expect(state.open).toBe(false);
}

describe("readPanelState", () => {
  it("returns the default panel when there is nothing stored", () => {
    stubStorage();
    expectDefaultPanel(readPanelState(ids()));
  });

  it("works when the browser has no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expectDefaultPanel(readPanelState(ids()));
  });

  it("survives a storage that throws on every access", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expectDefaultPanel(readPanelState(ids()));
  });

  it("round-trips a panel written by writePanelState", () => {
    stubStorage();
    const make = ids();
    let state = createEmptyPanel(make);
    state = openTab(
      state,
      {
        type: "file",
        context: {
          projectId: PROJECT,
          threadId: THREAD,
          scopeKey: "worktree-1",
          label: "feature",
        },
        path: "apps/web/src/App.tsx",
        view: "source",
      },
      make,
    );
    state = openTab(
      state,
      {
        type: "browser",
        context: null,
        url: "http://localhost:5173/",
        history: ["http://localhost:5173/"],
        historyIndex: 0,
      },
      make,
    );

    writePanelState(state);

    expect(readPanelState(ids())).toEqual(state);
  });

  it("stores the version alongside the state under the panel key", () => {
    const { store } = stubStorage();
    writePanelState(createEmptyPanel(ids()));
    const raw = store.get(PANEL_STORAGE_KEY);
    if (raw === undefined) throw new Error("nothing was written");
    expect(JSON.parse(raw)).toMatchObject({ version: PANEL_STATE_VERSION });
  });

  it("brings a terminal tab back detached from its old process", () => {
    stubStorage();
    const make = ids();
    let state = createEmptyPanel(make);
    state = openTab(
      state,
      {
        type: "terminal",
        context: null,
        cwd: "/repo/apps",
        terminalId: TERMINAL,
      },
      make,
    );
    writePanelState(state);

    const restored = readPanelState(ids());

    const tab = onlyTab(restored);
    if (tab.type !== "terminal") throw new Error("expected a terminal tab");
    // The process is the server's, not the record's: a restored tab must
    // re-attach or restart rather than claim a process it does not have.
    expect(tab.terminalId).toBeNull();
    expect(tab.cwd).toBe("/repo/apps");
  });

  it("discards unreadable JSON and clears it", () => {
    const { removed } = stubStorage({ [PANEL_STORAGE_KEY]: "{not json" });
    expectDefaultPanel(readPanelState(ids()));
    expect(removed).toContain(PANEL_STORAGE_KEY);
  });

  it("discards a record of an unknown version and clears it", () => {
    const { removed } = stubStorage({
      [PANEL_STORAGE_KEY]: JSON.stringify({ version: 99, root: null }),
    });
    expectDefaultPanel(readPanelState(ids()));
    expect(removed).toContain(PANEL_STORAGE_KEY);
  });

  it("discards a non-string stored value and clears it", () => {
    const removed: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: () => 42,
      setItem: () => undefined,
      removeItem: (key: string) => removed.push(key),
    });
    expectDefaultPanel(readPanelState(ids()));
    expect(removed).toContain(PANEL_STORAGE_KEY);
  });

  it("discards a structurally valid record whose tree references a missing group", () => {
    // This parses cleanly against the schema and would render half a panel
    // pointing at nothing, so shape validation alone is not enough.
    const { removed } = stubStorage({
      [PANEL_STORAGE_KEY]: JSON.stringify({
        version: PANEL_STATE_VERSION,
        root: {
          type: "split",
          id: "s1",
          axis: "row",
          children: [
            { type: "group", id: "g1" },
            { type: "group", id: "ghost" },
          ],
          sizes: [0.5, 0.5],
        },
        groups: { g1: { id: "g1", tabIds: ["t1"], activeTabId: "t1" } },
        tabs: { t1: { id: "t1", type: "changes", context: null } },
        focusedGroupId: "g1",
        width: 400,
        open: true,
      }),
    });

    expectDefaultPanel(readPanelState(ids()));
    expect(removed).toContain(PANEL_STORAGE_KEY);
  });

  // WSP-04 ("enforces a minimum outer width") and WSP-01 ("clamped size
  // fractions") are promises about what the panel renders, so they have to
  // hold for a width and a pair of fractions that arrive from storage, not
  // only for ones a drag produced. A stored width of 0 is the worst case:
  // the resize edge of a 0px panel cannot be grabbed, so there is no
  // in-product way back.
  function storedPanel(overrides: Record<string, unknown>): string {
    return JSON.stringify({
      version: PANEL_STATE_VERSION,
      root: { type: "group", id: "g1" },
      groups: { g1: { id: "g1", tabIds: ["t1"], activeTabId: "t1" } },
      tabs: { t1: { id: "t1", type: "changes", context: null } },
      focusedGroupId: "g1",
      width: 400,
      open: true,
      ...overrides,
    });
  }

  function splitPanel(sizes: [number, number]): string {
    return storedPanel({
      root: {
        type: "split",
        id: "s1",
        axis: "row",
        children: [
          { type: "group", id: "g1" },
          { type: "group", id: "g2" },
        ],
        sizes,
      },
      groups: {
        g1: { id: "g1", tabIds: ["t1"], activeTabId: "t1" },
        g2: { id: "g2", tabIds: ["t2"], activeTabId: "t2" },
      },
      tabs: {
        t1: { id: "t1", type: "changes", context: null },
        t2: { id: "t2", type: "files", context: null, search: "" },
      },
    });
  }

  it.each([
    [3, 280],
    [0, 280],
    [-1000, 280],
    [1e12, 4096],
    [512.4, 512],
  ])("clamps a stored width of %p to %p", (stored, expected) => {
    stubStorage({ [PANEL_STORAGE_KEY]: storedPanel({ width: stored }) });
    expect(readPanelState(ids()).width).toBe(expected);
  });

  it.each([
    [[0, 1] as [number, number]],
    [[-5, 900] as [number, number]],
    [[0.5, 0.5] as [number, number]],
  ])("normalizes stored split fractions %p", (sizes) => {
    stubStorage({ [PANEL_STORAGE_KEY]: splitPanel(sizes) });

    const root = readPanelState(ids()).root;

    if (root?.type !== "split") throw new Error("expected a split root");
    const [a, b] = root.sizes;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(1);
    expect(a + b).toBeCloseTo(1, 10);
  });

  it("discards a record whose group activates a tab it does not hold", () => {
    const { removed } = stubStorage({
      [PANEL_STORAGE_KEY]: JSON.stringify({
        version: PANEL_STATE_VERSION,
        root: { type: "group", id: "g1" },
        groups: { g1: { id: "g1", tabIds: ["t1"], activeTabId: "t2" } },
        tabs: { t1: { id: "t1", type: "changes", context: null } },
        focusedGroupId: "g1",
        width: 400,
        open: true,
      }),
    });
    expectDefaultPanel(readPanelState(ids()));
    expect(removed).toContain(PANEL_STORAGE_KEY);
  });
});

describe("migration from the v1 inspector preference", () => {
  it("migrates the recorded tab, width, and open state into one group", () => {
    stubStorage({
      [INSPECTOR_MIGRATION_KEY]: JSON.stringify({
        version: 1,
        open: true,
        activeTab: "files",
        width: 520,
      }),
    });

    const state = readPanelState(ids());

    expect(panelStateProblems(state)).toEqual([]);
    expect(state.width).toBe(520);
    expect(state.open).toBe(true);
    expect(onlyGroup(state).tabIds).toHaveLength(1);
    const tab = onlyTab(state);
    expect(tab.type).toBe("files");
    // The shipped inspector followed the focused pane, so it never recorded
    // which thread its content belonged to. The tab is restored honestly
    // context-less and the UI binds it on first render.
    expect(tab.context).toBeNull();
  });

  it("migrates a changes tab", () => {
    stubStorage({
      [INSPECTOR_MIGRATION_KEY]: JSON.stringify({
        version: 1,
        open: false,
        activeTab: "changes",
        width: 400,
      }),
    });
    expectDefaultPanel(readPanelState(ids()));
  });

  it("migrates a terminal tab without claiming a process", () => {
    stubStorage({
      [INSPECTOR_MIGRATION_KEY]: JSON.stringify({
        version: 1,
        open: true,
        activeTab: "terminal",
        width: 600,
      }),
    });

    const state = readPanelState(ids());

    const tab = onlyTab(state);
    if (tab.type !== "terminal") throw new Error("expected a terminal tab");
    expect(tab.terminalId).toBeNull();
    expect(state.width).toBe(600);
  });

  // The shipped inspector bounded its own width to [280, 4096]; the panel
  // that replaces it must not accept a record the record's own writer would
  // have refused.
  it.each([0, 3, -1000, 1e12, 400.5])(
    "refuses a v1 width of %p rather than restoring an unusable panel",
    (width) => {
      stubStorage({
        [INSPECTOR_MIGRATION_KEY]: JSON.stringify({
          version: 1,
          open: true,
          activeTab: "files",
          width,
        }),
      });
      expectDefaultPanel(readPanelState(ids()));
    },
  );

  it("ignores a malformed v1 record and falls back to the default panel", () => {
    stubStorage({
      [INSPECTOR_MIGRATION_KEY]: JSON.stringify({
        version: 1,
        open: true,
        activeTab: "nonsense",
        width: 520,
      }),
    });
    expectDefaultPanel(readPanelState(ids()));
  });

  it("leaves the v1 record in place, so a v2 record always wins", () => {
    const { store } = stubStorage({
      [INSPECTOR_MIGRATION_KEY]: JSON.stringify({
        version: 1,
        open: true,
        activeTab: "terminal",
        width: 600,
      }),
    });

    // The first read migrates; persisting the result is what ends the
    // migration, because a v2 record is preferred from then on.
    writePanelState(readPanelState(ids()));
    const state = readPanelState(ids());

    expect(store.has(INSPECTOR_MIGRATION_KEY)).toBe(true);
    expect(onlyTab(state).type).toBe("terminal");
    expect(state.width).toBe(600);
  });
});

describe("writePanelState", () => {
  it("never throws when storage refuses to write", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => undefined,
    });
    expect(() => {
      writePanelState(createEmptyPanel(ids()));
    }).not.toThrow();
  });

  it("never throws when there is no storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => {
      writePanelState(createEmptyPanel(ids()));
    }).not.toThrow();
  });
});
