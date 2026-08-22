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

const STORED_CONTEXT = {
  projectId: PROJECT,
  threadId: THREAD,
  scopeKey: "worktree-1",
  label: "feature",
};

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

  // WSP-08 accepts `http` and `https` addresses and nothing else, and the
  // plan's boundary table says a rejected address is *cleared from tab
  // state*. That is this module's job: the record is an arbitrary string
  // under a key any script on the origin can write, and the component that
  // renders the frame is not the last line of defence for what is stored.
  function browserPanel(tab: Record<string, unknown>): string {
    return JSON.stringify({
      version: PANEL_STATE_VERSION,
      root: { type: "group", id: "g1" },
      groups: { g1: { id: "g1", tabIds: ["t1"], activeTabId: "t1" } },
      tabs: {
        t1: {
          id: "t1",
          type: "browser",
          context: null,
          url: "",
          history: [],
          historyIndex: -1,
          ...tab,
        },
      },
      focusedGroupId: "g1",
      width: 400,
      open: true,
    });
  }

  function restoredBrowserTab(stored: Record<string, unknown>): {
    url: string;
    history: string[];
    historyIndex: number;
  } {
    stubStorage({ [PANEL_STORAGE_KEY]: browserPanel(stored) });
    const tab = onlyTab(readPanelState(ids()));
    if (tab.type !== "browser") throw new Error("expected a browser tab");
    return {
      url: tab.url,
      history: tab.history,
      historyIndex: tab.historyIndex,
    };
  }

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "about:blank",
    "vbscript:msgbox(1)",
    "not a url",
  ])("clears a persisted %s address from the tab", (url) => {
    expect(restoredBrowserTab({ url }).url).toBe("");
  });

  it.each(["http://localhost:5173/", "https://example.com/docs"])(
    "keeps a persisted %s address",
    (url) => {
      expect(restoredBrowserTab({ url }).url).toBe(url);
    },
  );

  it("clears a rejected address out of the history as well", () => {
    const restored = restoredBrowserTab({
      url: "http://localhost:5173/",
      history: ["javascript:alert(1)", "http://localhost:5173/"],
      historyIndex: 1,
    });
    expect(restored.history).toEqual(["http://localhost:5173/"]);
    expect(restored.historyIndex).toBe(0);
  });

  it.each([
    [{ history: [], historyIndex: 99 }, -1],
    [{ history: [], historyIndex: 0 }, -1],
    [{ history: ["http://a.test/", "http://b.test/"], historyIndex: 99 }, 1],
    [{ history: ["http://a.test/", "http://b.test/"], historyIndex: -3 }, 0],
    [{ history: ["http://a.test/"], historyIndex: 0.5 }, 0],
  ])(
    "makes a persisted history position consistent with its history",
    (stored, expected) => {
      expect(restoredBrowserTab(stored).historyIndex).toBe(expected);
    },
  );

  it("discards unreadable JSON and clears it", () => {
    const { removed } = stubStorage({ [PANEL_STORAGE_KEY]: "{not json" });
    expectDefaultPanel(readPanelState(ids()));
    expect(removed).toContain(PANEL_STORAGE_KEY);
  });

  it("discards a record of an unknown version and clears it", () => {
    // Perfect in every other respect, so the version is the only reason it
    // is refused: a record that also fails six other fields would pass this
    // test with the version check deleted.
    const { removed } = stubStorage({
      [PANEL_STORAGE_KEY]: storedPanel({ version: 4 }),
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
        t2: {
          id: "t2",
          type: "files",
          context: null,
          search: "",
          expanded: [],
          showIgnored: false,
        },
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

  // A tree deep enough to overflow the stack is not a parse failure: the
  // RangeError escapes zod (whose schema is recursive) and every recursive
  // walk after it, and it used to be caught by the outer handler -- the one
  // path that skipped `removeItem`. The panel then reset on every reload,
  // forever, with no way for the user to recover. `data-boundaries.md`
  // requires a corrupt record to be quarantined, not re-parsed on each read.
  // Assembled as text rather than as objects, because a depth that overflows
  // the reader's stack would overflow JSON.stringify's on the way in.
  function deepPanelJson(depth: number): string {
    const group = (id: string): string =>
      `"${id}":{"id":"${id}","tabIds":["t-${id}"],"activeTabId":"t-${id}"}`;
    const tab = (id: string): string =>
      `"t-${id}":{"id":"t-${id}","type":"changes","context":null}`;
    let node = '{"type":"group","id":"g0"}';
    const groups = [group("g0")];
    const tabs = [tab("g0")];
    for (let level = 0; level < depth; level += 1) {
      const id = `g${String(level + 1)}`;
      node = `{"type":"split","id":"s${String(level)}","axis":"row","sizes":[0.5,0.5],"children":[${node},{"type":"group","id":"${id}"}]}`;
      groups.push(group(id));
      tabs.push(tab(id));
    }
    return `{"version":${String(PANEL_STATE_VERSION)},"root":${node},"groups":{${groups.join(",")}},"tabs":{${tabs.join(",")}},"focusedGroupId":"g0","width":400,"open":true}`;
  }

  it.each([50, 500, 2000, 10_000])(
    "quarantines a %p-deep tree instead of re-parsing it on every read",
    (depth) => {
      const { store, removed } = stubStorage({
        [PANEL_STORAGE_KEY]: deepPanelJson(depth),
      });

      expectDefaultPanel(readPanelState(ids()));

      expect(removed).toContain(PANEL_STORAGE_KEY);
      expect(store.has(PANEL_STORAGE_KEY)).toBe(false);
    },
  );

  it("still accepts a tree deep enough for any real panel", () => {
    stubStorage({ [PANEL_STORAGE_KEY]: deepPanelJson(8) });
    const state = readPanelState(ids());
    expect(panelStateProblems(state)).toEqual([]);
    expect(Object.keys(state.groups)).toHaveLength(9);
  });

  // Each of these parses cleanly against the v2 schema and is refused by the
  // integrity pass instead. `panelStateProblems` is tested directly for all
  // of them, but that proves the rule exists, not that the reader runs it:
  // deleting the `panelStateProblems` call in `readPanelState` left every
  // one of those tests green.
  it.each([
    [
      "a tab listed in two groups",
      {
        root: {
          type: "split",
          id: "s1",
          axis: "row",
          children: [
            { type: "group", id: "g1" },
            { type: "group", id: "g2" },
          ],
          sizes: [0.5, 0.5],
        },
        groups: {
          g1: { id: "g1", tabIds: ["t1"], activeTabId: "t1" },
          g2: { id: "g2", tabIds: ["t1"], activeTabId: "t1" },
        },
      },
    ],
    [
      "a group that is not in the tree",
      {
        groups: {
          g1: { id: "g1", tabIds: ["t1"], activeTabId: "t1" },
          ghost: { id: "ghost", tabIds: [], activeTabId: null },
        },
      },
    ],
    [
      "a group referencing a tab that does not exist",
      {
        groups: { g1: { id: "g1", tabIds: ["t1", "gone"], activeTabId: "t1" } },
      },
    ],
    [
      "a tab keyed under an id that is not its own",
      { tabs: { t1: { id: "t2", type: "changes", context: null } } },
    ],
    [
      "a tab that belongs to no group",
      {
        tabs: {
          t1: { id: "t1", type: "changes", context: null },
          t2: {
            id: "t2",
            type: "files",
            context: null,
            search: "",
            expanded: [],
            showIgnored: false,
          },
        },
      },
    ],
    [
      "two tabs addressing the same thing",
      {
        groups: { g1: { id: "g1", tabIds: ["t1", "t2"], activeTabId: "t1" } },
        tabs: {
          t1: {
            id: "t1",
            type: "file",
            context: STORED_CONTEXT,
            path: "a.ts",
            view: "preview",
          },
          t2: {
            id: "t2",
            type: "file",
            context: STORED_CONTEXT,
            path: "a.ts",
            view: "source",
          },
        },
      },
    ],
  ])("discards a record with %s, and clears it", (_case, overrides) => {
    const { removed } = stubStorage({
      [PANEL_STORAGE_KEY]: storedPanel(overrides),
    });
    expectDefaultPanel(readPanelState(ids()));
    expect(removed).toContain(PANEL_STORAGE_KEY);
  });

  it("discards a record that is open with no groups at all", () => {
    const { removed } = stubStorage({
      [PANEL_STORAGE_KEY]: JSON.stringify({
        version: PANEL_STATE_VERSION,
        root: null,
        groups: {},
        tabs: {},
        focusedGroupId: null,
        width: 400,
        open: true,
      }),
    });
    expectDefaultPanel(readPanelState(ids()));
    expect(removed).toContain(PANEL_STORAGE_KEY);
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

// Version 3 added the file tree's `expanded` and `showIgnored` to the `files`
// tab (WSP-05 as revised by specification version 2). A version 2 record is
// still a record of a panel the user arranged, so it is migrated, not reset.
describe("migration from a version 2 record", () => {
  function storedV2(): string {
    return JSON.stringify({
      version: 2,
      root: { type: "group", id: "g1" },
      groups: { g1: { id: "g1", tabIds: ["t1"], activeTabId: "t1" } },
      tabs: {
        t1: { id: "t1", type: "files", context: STORED_CONTEXT, search: "src" },
      },
      focusedGroupId: "g1",
      width: 520,
      open: true,
    });
  }

  it("fills an empty expansion set and hides ignored files", () => {
    stubStorage({ [PANEL_STORAGE_KEY]: storedV2() });

    const state = readPanelState(ids());

    expect(panelStateProblems(state)).toEqual([]);
    const tab = onlyTab(state);
    if (tab.type !== "files") throw new Error("expected a files tab");
    expect(tab.expanded).toEqual([]);
    expect(tab.showIgnored).toBe(false);
    // Everything the version 2 record did say is carried, so a migration
    // that quietly reset would fail here rather than pass.
    expect(tab.search).toBe("src");
    expect(state.width).toBe(520);
    expect(state.open).toBe(true);
  });

  it("stamps the next write with version 3", () => {
    const { store } = stubStorage({ [PANEL_STORAGE_KEY]: storedV2() });

    writePanelState(readPanelState(ids()));

    const written: unknown = JSON.parse(store.get(PANEL_STORAGE_KEY) ?? "");
    expect(written).toMatchObject({ version: PANEL_STATE_VERSION });
    expect(PANEL_STATE_VERSION).toBe(3);
  });

  it("round-trips an expansion set and the ignored opt-in", () => {
    const { store } = stubStorage();
    const make = ids();
    let state = createEmptyPanel(make);
    state = openTab(
      state,
      {
        type: "files",
        context: STORED_CONTEXT,
        search: "",
        expanded: ["src", "src/features"],
        showIgnored: true,
      },
      make,
    );
    writePanelState(state);
    expect(store.has(PANEL_STORAGE_KEY)).toBe(true);

    const restored = onlyTab(readPanelState(ids()));
    if (restored.type !== "files") throw new Error("expected a files tab");
    expect(restored.expanded).toEqual(["src", "src/features"]);
    expect(restored.showIgnored).toBe(true);
  });

  // An expansion entry becomes a listing request, so it is held to the
  // server's own path rules. A bad entry costs its own expansion, never the
  // tab and never the panel.
  it.each([
    ["/etc/passwd"],
    ["../outside"],
    ["src/../../escape"],
    ["C:\\Windows"],
    ["src\\features"],
    ["src/\u0000null"],
    [42],
    [null],
  ])("drops the unusable expansion entry %p without losing the tab", (bad) => {
    stubStorage({
      [PANEL_STORAGE_KEY]: JSON.stringify({
        version: PANEL_STATE_VERSION,
        root: { type: "group", id: "g1" },
        groups: { g1: { id: "g1", tabIds: ["t1"], activeTabId: "t1" } },
        tabs: {
          t1: {
            id: "t1",
            type: "files",
            context: STORED_CONTEXT,
            search: "",
            expanded: ["src", bad],
            showIgnored: false,
          },
        },
        focusedGroupId: "g1",
        width: 400,
        open: true,
      }),
    });

    const tab = onlyTab(readPanelState(ids()));
    if (tab.type !== "files") throw new Error("expected a files tab");
    expect(tab.expanded).toEqual(["src"]);
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
    // The v1 -> v3 chain in one read: a device that has not opened the panel
    // since the inspector shipped arrives with a tree-shaped files tab.
    if (tab.type !== "files") throw new Error("expected a files tab");
    expect(tab.expanded).toEqual([]);
    expect(tab.showIgnored).toBe(false);
    // The shipped inspector followed the focused pane, so it never recorded
    // which thread its content belonged to. The tab is restored honestly
    // context-less and the UI binds it on first render.
    expect(tab.context).toBeNull();
  });

  // Deliberately not the default panel's own width and open state: a
  // migration asserted against `{changes, 400, closed}` is indistinguishable
  // from the reset fallback, and would pass unchanged if this function
  // returned null for every record.
  it("migrates a changes tab", () => {
    stubStorage({
      [INSPECTOR_MIGRATION_KEY]: JSON.stringify({
        version: 1,
        open: true,
        activeTab: "changes",
        width: 512,
      }),
    });

    const state = readPanelState(ids());

    expect(panelStateProblems(state)).toEqual([]);
    expect(onlyGroup(state).tabIds).toHaveLength(1);
    expect(onlyTab(state).type).toBe("changes");
    expect(onlyTab(state).context).toBeNull();
    expect(state.width).toBe(512);
    expect(state.open).toBe(true);
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
