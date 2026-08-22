import { describe, expect, it } from "vitest";
import type { ProjectId, TerminalId, ThreadId } from "@pi-web/contracts";

import { leafIds } from "../layout/binaryTree.js";
import {
  activateTab,
  bindTabContext,
  closeGroup,
  closeTab,
  createEmptyPanel,
  focusGroup,
  moveTab,
  openTab,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  panelStateProblems,
  setGroupSizes,
  setPanelOpen,
  setPanelWidth,
  splitGroupWithTab,
  updateTab,
} from "./panelModel.js";
import type { GroupId, PanelState, TabPatch } from "./panelModel.js";
import type { NewPanelTab, TabContext, TabId } from "./panelTabs.js";

const PROJECT = "11111111-1111-1111-1111-111111111111" as ProjectId;
const THREAD = "aaaaaaaa-1111-1111-1111-111111111111" as ThreadId;

function context(overrides: Partial<TabContext> = {}): TabContext {
  return {
    projectId: PROJECT,
    threadId: THREAD,
    scopeKey: PROJECT,
    label: "main",
    ...overrides,
  };
}

function ids(): () => string {
  let n = 0;
  return () => `id-${String(++n)}`;
}

// Every invariant the panel must hold after every operation. Called after
// each step of every test below: a per-case assertion catches the case it
// was written for, this catches the ones nobody thought of.
function assertPanelInvariants(state: PanelState): void {
  expect(panelStateProblems(state)).toEqual([]);
}

function changesTab(overrides: Partial<TabContext> = {}): NewPanelTab {
  return { type: "changes", context: context(overrides) };
}

function fileTab(path: string): NewPanelTab {
  return { type: "file", context: context(), path, view: "preview" };
}

function terminalTab(cwd = "/repo"): NewPanelTab {
  return { type: "terminal", context: context(), cwd, terminalId: null };
}

function withoutKey<T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([entryKey]) => entryKey !== key),
  );
}

function onlyGroupId(state: PanelState): GroupId {
  const [id] = Object.keys(state.groups);
  if (id === undefined) throw new Error("expected a group");
  return id;
}

function tabIdsOf(state: PanelState, groupId: GroupId): TabId[] {
  const group = state.groups[groupId];
  if (group === undefined) throw new Error(`no group ${groupId}`);
  return group.tabIds;
}

function activeOf(state: PanelState, groupId: GroupId): TabId | null {
  const group = state.groups[groupId];
  if (group === undefined) throw new Error(`no group ${groupId}`);
  return group.activeTabId;
}

// Builds a two-group panel: group A holds tabs for a.ts and b.ts, group B
// (split to the right of A) holds a tab for c.ts. Returns the ids.
function twoGroups(): {
  state: PanelState;
  make: () => string;
  groupA: GroupId;
  groupB: GroupId;
  tabA: TabId;
  tabB: TabId;
  tabC: TabId;
} {
  const make = ids();
  let state = createEmptyPanel(make);
  const groupA = onlyGroupId(state);
  state = openTab(state, fileTab("a.ts"), make);
  state = openTab(state, fileTab("b.ts"), make);
  const [tabA, tabB] = tabIdsOf(state, groupA);
  state = openTab(state, fileTab("c.ts"), make);
  const tabC = tabIdsOf(state, groupA)[2];
  if (tabA === undefined || tabB === undefined || tabC === undefined)
    throw new Error("expected three tabs");
  state = splitGroupWithTab(state, tabC, groupA, "right", make);
  const groupB = state.focusedGroupId;
  if (groupB === null) throw new Error("expected a focused new group");
  return { state, make, groupA, groupB, tabA, tabB, tabC };
}

describe("createEmptyPanel", () => {
  it("starts closed, with one focused empty group at the default width", () => {
    const state = createEmptyPanel(ids());
    assertPanelInvariants(state);
    expect(state.open).toBe(false);
    expect(state.width).toBe(PANEL_DEFAULT_WIDTH);
    expect(Object.keys(state.groups)).toHaveLength(1);
    expect(state.tabs).toEqual({});
    expect(state.focusedGroupId).toBe(onlyGroupId(state));
    expect(state.root).toEqual({ type: "group", id: onlyGroupId(state) });
  });
});

describe("openTab", () => {
  it("inserts into the focused group, activates it, and opens the panel", () => {
    const make = ids();
    const empty = createEmptyPanel(make);
    const groupId = onlyGroupId(empty);

    const state = openTab(empty, changesTab(), make);

    assertPanelInvariants(state);
    expect(state.open).toBe(true);
    expect(tabIdsOf(state, groupId)).toHaveLength(1);
    expect(activeOf(state, groupId)).toBe(tabIdsOf(state, groupId)[0]);
    expect(state.focusedGroupId).toBe(groupId);
  });

  it("does not mutate the state it was given", () => {
    const make = ids();
    const empty = createEmptyPanel(make);
    const before = structuredClone(empty);
    openTab(empty, changesTab(), make);
    expect(empty).toEqual(before);
  });

  it("appends to the end of the strip and keeps earlier tabs put", () => {
    const make = ids();
    let state = createEmptyPanel(make);
    const groupId = onlyGroupId(state);
    state = openTab(state, fileTab("a.ts"), make);
    const first = tabIdsOf(state, groupId)[0];
    state = openTab(state, fileTab("b.ts"), make);
    assertPanelInvariants(state);
    expect(tabIdsOf(state, groupId)).toHaveLength(2);
    expect(tabIdsOf(state, groupId)[0]).toBe(first);
    expect(activeOf(state, groupId)).toBe(tabIdsOf(state, groupId)[1]);
  });

  it("reveals an already-open tab instead of duplicating it", () => {
    const make = ids();
    let state = createEmptyPanel(make);
    const groupId = onlyGroupId(state);
    state = openTab(state, fileTab("a.ts"), make);
    const existing = tabIdsOf(state, groupId)[0];
    state = openTab(state, fileTab("b.ts"), make);

    state = openTab(state, fileTab("a.ts"), make);

    assertPanelInvariants(state);
    expect(tabIdsOf(state, groupId)).toHaveLength(2);
    expect(activeOf(state, groupId)).toBe(existing);
  });

  it("finds the duplicate in another group and focuses that group", () => {
    const { state, make, groupA, groupB, tabC } = twoGroups();
    expect(state.focusedGroupId).toBe(groupB);

    const next = openTab(state, fileTab("a.ts"), make);

    assertPanelInvariants(next);
    expect(Object.keys(next.tabs)).toHaveLength(3);
    expect(next.focusedGroupId).toBe(groupA);
    expect(activeOf(next, groupA)).toBe(tabIdsOf(next, groupA)[0]);
    expect(tabIdsOf(next, groupB)).toEqual([tabC]);
  });

  it("reopens the panel when the revealed tab was hidden", () => {
    const make = ids();
    let state = openTab(createEmptyPanel(make), fileTab("a.ts"), make);
    state = setPanelOpen(state, false);
    state = openTab(state, fileTab("a.ts"), make);
    assertPanelInvariants(state);
    expect(state.open).toBe(true);
  });

  it("opens a second terminal rather than revealing the first", () => {
    const make = ids();
    let state = createEmptyPanel(make);
    state = openTab(state, terminalTab(), make);
    state = openTab(state, terminalTab(), make);
    assertPanelInvariants(state);
    expect(Object.keys(state.tabs)).toHaveLength(2);
  });

  it("honours an explicit target group", () => {
    const { state, make, groupA, groupB } = twoGroups();
    const next = openTab(state, fileTab("d.ts"), make, { groupId: groupA });
    assertPanelInvariants(next);
    expect(tabIdsOf(next, groupA)).toHaveLength(3);
    expect(tabIdsOf(next, groupB)).toHaveLength(1);
    expect(next.focusedGroupId).toBe(groupA);
  });

  it("falls back to a real group when the target group is unknown", () => {
    const make = ids();
    const empty = createEmptyPanel(make);
    const state = openTab(empty, changesTab(), make, { groupId: "nope" });
    assertPanelInvariants(state);
    expect(tabIdsOf(state, onlyGroupId(state))).toHaveLength(1);
  });

  it("creates a group as the root when the panel has none", () => {
    const make = ids();
    let state = createEmptyPanel(make);
    state = openTab(state, changesTab(), make);
    const tabId = tabIdsOf(state, onlyGroupId(state))[0];
    if (tabId === undefined) throw new Error("expected a tab");
    state = closeTab(state, tabId); // last tab of the last group
    expect(state.root).toBeNull();
    expect(state.groups).toEqual({});

    state = openTab(state, changesTab(), make);

    assertPanelInvariants(state);
    expect(state.root).not.toBeNull();
    expect(Object.keys(state.groups)).toHaveLength(1);
    expect(state.open).toBe(true);
    expect(state.focusedGroupId).toBe(onlyGroupId(state));
  });
});

describe("closeTab", () => {
  it("removes the tab and forgets its state", () => {
    const make = ids();
    let state = createEmptyPanel(make);
    const groupId = onlyGroupId(state);
    state = openTab(state, fileTab("a.ts"), make);
    state = openTab(state, fileTab("b.ts"), make);
    const [tabA] = tabIdsOf(state, groupId);
    if (tabA === undefined) throw new Error("expected a tab");

    state = closeTab(state, tabA);

    assertPanelInvariants(state);
    expect(state.tabs[tabA]).toBeUndefined();
    expect(tabIdsOf(state, groupId)).toHaveLength(1);
  });

  it("activates the tab to the right of the one that closed", () => {
    const make = ids();
    let state = createEmptyPanel(make);
    const groupId = onlyGroupId(state);
    state = openTab(state, fileTab("a.ts"), make);
    state = openTab(state, fileTab("b.ts"), make);
    state = openTab(state, fileTab("c.ts"), make);
    const [, tabB, tabC] = tabIdsOf(state, groupId);
    if (tabB === undefined || tabC === undefined)
      throw new Error("expected three tabs");
    state = activateTab(state, tabB);

    state = closeTab(state, tabB);

    assertPanelInvariants(state);
    expect(activeOf(state, groupId)).toBe(tabC);
  });

  it("falls back to the left neighbour when the last tab closes", () => {
    const make = ids();
    let state = createEmptyPanel(make);
    const groupId = onlyGroupId(state);
    state = openTab(state, fileTab("a.ts"), make);
    state = openTab(state, fileTab("b.ts"), make);
    const [tabA, tabB] = tabIdsOf(state, groupId);
    if (tabA === undefined || tabB === undefined)
      throw new Error("expected two tabs");

    state = closeTab(state, tabB); // the rightmost, and the active one

    assertPanelInvariants(state);
    expect(activeOf(state, groupId)).toBe(tabA);
  });

  it("leaves the active tab alone when a different tab closes", () => {
    const make = ids();
    let state = createEmptyPanel(make);
    const groupId = onlyGroupId(state);
    state = openTab(state, fileTab("a.ts"), make);
    state = openTab(state, fileTab("b.ts"), make);
    const [tabA, tabB] = tabIdsOf(state, groupId);
    if (tabA === undefined || tabB === undefined)
      throw new Error("expected two tabs");

    state = closeTab(state, tabA); // tabB is active

    assertPanelInvariants(state);
    expect(activeOf(state, groupId)).toBe(tabB);
  });

  it("removes an emptied group and promotes its sibling", () => {
    const { state, groupA, groupB, tabC } = twoGroups();

    const next = closeTab(state, tabC); // groupB's only tab

    assertPanelInvariants(next);
    expect(next.groups[groupB]).toBeUndefined();
    expect(next.root).toEqual({ type: "group", id: groupA });
    expect(next.focusedGroupId).toBe(groupA);
    expect(next.open).toBe(true);
  });

  it("closes the panel when the last tab of the last group closes", () => {
    const make = ids();
    let state = openTab(createEmptyPanel(make), changesTab(), make);
    const tabId = tabIdsOf(state, onlyGroupId(state))[0];
    if (tabId === undefined) throw new Error("expected a tab");

    state = closeTab(state, tabId);

    assertPanelInvariants(state);
    expect(state.root).toBeNull();
    expect(state.groups).toEqual({});
    expect(state.tabs).toEqual({});
    expect(state.focusedGroupId).toBeNull();
    expect(state.open).toBe(false);
  });

  it("ignores an unknown tab id", () => {
    const { state } = twoGroups();
    expect(closeTab(state, "nope")).toEqual(state);
  });
});

describe("activateTab", () => {
  it("activates the tab and focuses its group", () => {
    const { state, groupA, groupB, tabA } = twoGroups();
    expect(state.focusedGroupId).toBe(groupB);

    const next = activateTab(state, tabA);

    assertPanelInvariants(next);
    expect(activeOf(next, groupA)).toBe(tabA);
    expect(next.focusedGroupId).toBe(groupA);
  });

  it("ignores an unknown tab id", () => {
    const { state } = twoGroups();
    expect(activateTab(state, "nope")).toEqual(state);
  });
});

describe("moveTab", () => {
  it("reorders within a group", () => {
    const { state, groupA, tabA, tabB } = twoGroups();

    const next = moveTab(state, tabA, groupA, 1);

    assertPanelInvariants(next);
    expect(tabIdsOf(next, groupA)).toEqual([tabB, tabA]);
    expect(activeOf(next, groupA)).toBe(tabA);
    expect(next.focusedGroupId).toBe(groupA);
  });

  it("is a no-op when the tab already occupies that position", () => {
    const { state, groupA, tabA } = twoGroups();
    const next = moveTab(state, tabA, groupA, 0);
    assertPanelInvariants(next);
    expect(next).toEqual(state);
  });

  it("clamps an out-of-range index instead of dropping the tab", () => {
    const { state, groupA, tabA, tabB } = twoGroups();
    const next = moveTab(state, tabA, groupA, 99);
    assertPanelInvariants(next);
    expect(tabIdsOf(next, groupA)).toEqual([tabB, tabA]);
  });

  it("moves a tab into another group, activating and focusing it there", () => {
    const { state, groupA, groupB, tabA, tabC } = twoGroups();

    const next = moveTab(state, tabA, groupB, 0);

    assertPanelInvariants(next);
    expect(tabIdsOf(next, groupB)).toEqual([tabA, tabC]);
    expect(tabIdsOf(next, groupA)).toHaveLength(1);
    expect(activeOf(next, groupB)).toBe(tabA);
    expect(next.focusedGroupId).toBe(groupB);
  });

  it("keeps the moved tab's own state intact", () => {
    const { state, groupB, tabA } = twoGroups();
    const next = moveTab(state, tabA, groupB, 0);
    expect(next.tabs[tabA]).toEqual(state.tabs[tabA]);
  });

  it("removes the source group when the move empties it", () => {
    const { state, groupA, groupB, tabC } = twoGroups();

    const next = moveTab(state, tabC, groupA, 0);

    assertPanelInvariants(next);
    expect(next.groups[groupB]).toBeUndefined();
    expect(next.root).toEqual({ type: "group", id: groupA });
    expect(tabIdsOf(next, groupA)[0]).toBe(tabC);
    expect(next.focusedGroupId).toBe(groupA);
  });

  it("re-activates a neighbour in the source group when the active tab leaves", () => {
    const { state, groupA, groupB, tabA, tabB } = twoGroups();
    const withActive = activateTab(state, tabA);

    const next = moveTab(withActive, tabA, groupB, 0);

    assertPanelInvariants(next);
    expect(activeOf(next, groupA)).toBe(tabB);
  });

  it("ignores an unknown tab or group", () => {
    const { state, groupA, tabA } = twoGroups();
    expect(moveTab(state, "nope", groupA, 0)).toEqual(state);
    expect(moveTab(state, tabA, "nope", 0)).toEqual(state);
  });
});

describe("splitGroupWithTab", () => {
  it("splits along a row for a left or right edge and a column otherwise", () => {
    const { state, make, groupA, tabA } = twoGroups();

    const row = splitGroupWithTab(state, tabA, groupA, "right", make);
    assertPanelInvariants(row);
    const column = splitGroupWithTab(state, tabA, groupA, "bottom", make);
    assertPanelInvariants(column);

    if (row.root?.type !== "split") throw new Error("expected a split root");
    if (column.root?.type !== "split") throw new Error("expected a split root");
    // The panel's own outer split (groupA | groupB) is a row; the new split
    // is the one wrapping groupA.
    const rowInner = row.root.children[0];
    const columnInner = column.root.children[0];
    if (rowInner.type !== "split" || columnInner.type !== "split")
      throw new Error("expected an inner split");
    expect(rowInner.axis).toBe("row");
    expect(columnInner.axis).toBe("column");
  });

  it("places the tab on the side it was dropped on", () => {
    const { state, make, groupA, tabA } = twoGroups();

    const after = splitGroupWithTab(state, tabA, groupA, "right", make);
    const before = splitGroupWithTab(state, tabA, groupA, "left", make);

    assertPanelInvariants(after);
    assertPanelInvariants(before);
    // In-order leaf ids are left-to-right, so the new group's position in
    // that order is where it landed on screen.
    const afterGroups = leafIds(after.root);
    const beforeGroups = leafIds(before.root);
    expect(afterGroups[1]).toBe(after.focusedGroupId);
    expect(beforeGroups[0]).toBe(before.focusedGroupId);
  });

  it("puts the dragged tab alone in the new group and focuses it", () => {
    const { state, make, groupA, tabA } = twoGroups();

    const next = splitGroupWithTab(state, tabA, groupA, "bottom", make);

    assertPanelInvariants(next);
    const newGroupId = next.focusedGroupId;
    if (newGroupId === null) throw new Error("expected a focused group");
    expect(tabIdsOf(next, newGroupId)).toEqual([tabA]);
    expect(activeOf(next, newGroupId)).toBe(tabA);
    expect(tabIdsOf(next, groupA)).not.toContain(tabA);
  });

  it("removes the source group when the split empties it", () => {
    const { state, make, groupA, groupB, tabC } = twoGroups();

    // Drag groupB's only tab onto groupA's edge: groupB must not survive as
    // an empty group.
    const next = splitGroupWithTab(state, tabC, groupA, "top", make);

    assertPanelInvariants(next);
    expect(next.groups[groupB]).toBeUndefined();
    expect(Object.keys(next.groups)).toHaveLength(2);
    expect(leafIds(next.root)).toHaveLength(2);
  });

  it("is a no-op when a single-tab group is split by its own only tab", () => {
    const { state, make, groupB, tabC } = twoGroups();
    const next = splitGroupWithTab(state, tabC, groupB, "right", make);
    expect(next).toEqual(state);
  });

  it("splits a group with its own tab when the group has others", () => {
    const { state, make, groupA, tabA } = twoGroups();
    const next = splitGroupWithTab(state, tabA, groupA, "right", make);
    assertPanelInvariants(next);
    expect(Object.keys(next.groups)).toHaveLength(3);
  });

  it("ignores an unknown tab or group", () => {
    const { state, make, groupA, tabA } = twoGroups();
    expect(splitGroupWithTab(state, "nope", groupA, "right", make)).toEqual(
      state,
    );
    expect(splitGroupWithTab(state, tabA, "nope", "right", make)).toEqual(
      state,
    );
  });
});

describe("closeGroup", () => {
  it("closes the group, its tabs, and promotes the sibling", () => {
    const { state, groupA, groupB, tabA, tabB, tabC } = twoGroups();

    const next = closeGroup(state, groupA);

    assertPanelInvariants(next);
    expect(next.groups[groupA]).toBeUndefined();
    expect(next.tabs[tabA]).toBeUndefined();
    expect(next.tabs[tabB]).toBeUndefined();
    expect(next.tabs[tabC]).toBeDefined();
    expect(next.root).toEqual({ type: "group", id: groupB });
    expect(next.focusedGroupId).toBe(groupB);
  });

  it("closes the panel when the last group closes", () => {
    const make = ids();
    let state = openTab(createEmptyPanel(make), changesTab(), make);
    state = closeGroup(state, onlyGroupId(state));
    assertPanelInvariants(state);
    expect(state.root).toBeNull();
    expect(state.tabs).toEqual({});
    expect(state.open).toBe(false);
    expect(state.focusedGroupId).toBeNull();
  });

  it("ignores an unknown group", () => {
    const { state } = twoGroups();
    expect(closeGroup(state, "nope")).toEqual(state);
  });
});

describe("focusGroup", () => {
  it("focuses an existing group and ignores an unknown one", () => {
    const { state, groupA } = twoGroups();
    const next = focusGroup(state, groupA);
    assertPanelInvariants(next);
    expect(next.focusedGroupId).toBe(groupA);
    expect(focusGroup(state, "nope")).toEqual(state);
  });
});

describe("setGroupSizes", () => {
  it("resizes the addressed split and normalizes the fractions", () => {
    const { state } = twoGroups();
    if (state.root?.type !== "split") throw new Error("expected a split root");
    const splitId = state.root.id;

    const next = setGroupSizes(state, splitId, [0.001, 0.2]);

    assertPanelInvariants(next);
    if (next.root?.type !== "split") throw new Error("expected a split root");
    expect(next.root.sizes[0]).toBeCloseTo(0.2, 5);
    expect(next.root.sizes[1]).toBeCloseTo(0.8, 5);
  });

  it("ignores an unknown split and a panel with no tree", () => {
    const { state } = twoGroups();
    expect(setGroupSizes(state, "nope", [0.3, 0.7])).toEqual(state);
    const empty = createEmptyPanel(ids());
    expect(setGroupSizes(empty, "nope", [0.3, 0.7])).toEqual(empty);
  });
});

describe("setPanelWidth and setPanelOpen", () => {
  it("clamps the width to the readable range", () => {
    const state = createEmptyPanel(ids());
    expect(setPanelWidth(state, 640).width).toBe(640);
    expect(setPanelWidth(state, 10).width).toBe(PANEL_MIN_WIDTH);
    expect(setPanelWidth(state, 999_999).width).toBe(PANEL_MAX_WIDTH);
  });

  it("rounds a fractional width and ignores a nonsense one", () => {
    const state = createEmptyPanel(ids());
    expect(setPanelWidth(state, 420.6).width).toBe(421);
    expect(setPanelWidth(state, Number.NaN)).toEqual(state);
  });

  it("toggles open without disturbing anything else", () => {
    const make = ids();
    const state = openTab(createEmptyPanel(make), changesTab(), make);
    const closed = setPanelOpen(state, false);
    assertPanelInvariants(closed);
    expect(closed.open).toBe(false);
    expect(closed.tabs).toEqual(state.tabs);
    expect(setPanelOpen(closed, true).open).toBe(true);
  });
});

describe("updateTab", () => {
  it("updates a file tab's view mode", () => {
    const make = ids();
    let state = openTab(createEmptyPanel(make), fileTab("a.md"), make);
    const tabId = tabIdsOf(state, onlyGroupId(state))[0];
    if (tabId === undefined) throw new Error("expected a tab");

    state = updateTab(state, tabId, { view: "source" });

    assertPanelInvariants(state);
    const tab = state.tabs[tabId];
    if (tab?.type !== "file") throw new Error("expected a file tab");
    expect(tab.view).toBe("source");
    expect(tab.path).toBe("a.md");
  });

  it("updates a terminal's cwd and attaches a live process", () => {
    const make = ids();
    let state = openTab(createEmptyPanel(make), terminalTab(), make);
    const tabId = tabIdsOf(state, onlyGroupId(state))[0];
    if (tabId === undefined) throw new Error("expected a tab");
    const terminalId = "cccccccc-3333-3333-3333-333333333333" as TerminalId;

    state = updateTab(state, tabId, { cwd: "/repo/apps", terminalId });

    const tab = state.tabs[tabId];
    if (tab?.type !== "terminal") throw new Error("expected a terminal tab");
    expect(tab.cwd).toBe("/repo/apps");
    expect(tab.terminalId).toBe(terminalId);
  });

  // A File or Diff tab's path is its identity — WSP-05 opens a *different*
  // tab for a different file — and a tab's context is fixed when it is
  // opened (WSP-02). Patching either would let a tab become a duplicate of
  // one already open, which openTab's dedupe only ever prevented at open
  // time. Neither key exists on TabPatch; `bindTabContext` is the one route
  // that may set a context, and it resolves the collision it can create.
  it("cannot re-target a tab's identity", () => {
    // @ts-expect-error `path` is not patchable: it is the tab's identity.
    const repointed: TabPatch = { path: "b.ts" };
    // @ts-expect-error `context` is bindTabContext's to set, once.
    const rebound: TabPatch = { context: null };
    const make = ids();
    const state = openTab(createEmptyPanel(make), fileTab("a.md"), make);
    const tabId = tabIdsOf(state, onlyGroupId(state))[0];
    if (tabId === undefined) throw new Error("expected a tab");

    const next = updateTab(updateTab(state, tabId, repointed), tabId, rebound);

    const tab = next.tabs[tabId];
    if (tab?.type !== "file") throw new Error("expected a file tab");
    expect(tab.path).toBe("a.md");
    expect(tab.context).toEqual(context());
    assertPanelInvariants(next);
  });

  it("ignores keys that do not belong to the tab's type", () => {
    const make = ids();
    let state = openTab(createEmptyPanel(make), fileTab("a.md"), make);
    const tabId = tabIdsOf(state, onlyGroupId(state))[0];
    if (tabId === undefined) throw new Error("expected a tab");

    state = updateTab(state, tabId, { url: "http://example.com" });

    const tab = state.tabs[tabId];
    if (tab?.type !== "file") throw new Error("expected a file tab");
    expect(tab).not.toHaveProperty("url");
  });

  it("ignores an unknown tab id and an empty patch", () => {
    const make = ids();
    const state = openTab(createEmptyPanel(make), fileTab("a.md"), make);
    expect(updateTab(state, "nope", { view: "source" })).toEqual(state);
    const tabId = tabIdsOf(state, onlyGroupId(state))[0];
    if (tabId === undefined) throw new Error("expected a tab");
    expect(updateTab(state, tabId, {})).toEqual(state);
  });
});

describe("panelStateProblems", () => {
  it("accepts the states the model itself produces", () => {
    const { state } = twoGroups();
    expect(panelStateProblems(state)).toEqual([]);
    expect(panelStateProblems(createEmptyPanel(ids()))).toEqual([]);
  });

  it("rejects a tree leaf with no group behind it", () => {
    const { state, groupB } = twoGroups();
    const groups = withoutKey(state.groups, groupB);
    expect(panelStateProblems({ ...state, groups })).not.toEqual([]);
  });

  it("rejects a group that is not in the tree", () => {
    const { state } = twoGroups();
    const orphan = {
      ...state,
      groups: {
        ...state.groups,
        ghost: { id: "ghost", tabIds: [], activeTabId: null },
      },
    };
    expect(panelStateProblems(orphan)).not.toEqual([]);
  });

  it("rejects a group referencing a tab that does not exist", () => {
    const { state, tabC } = twoGroups();
    const tabs = withoutKey(state.tabs, tabC);
    expect(panelStateProblems({ ...state, tabs })).not.toEqual([]);
  });

  it("rejects an active tab that is not in its own group", () => {
    const { state, groupB, tabA } = twoGroups();
    const group = state.groups[groupB];
    if (group === undefined) throw new Error("expected a group");
    const broken = {
      ...state,
      groups: { ...state.groups, [groupB]: { ...group, activeTabId: tabA } },
    };
    expect(panelStateProblems(broken)).not.toEqual([]);
  });

  it("rejects an empty group alongside others, and a focus on nothing", () => {
    const { state, groupB, tabC } = twoGroups();
    const group = state.groups[groupB];
    if (group === undefined) throw new Error("expected a group");
    const tabs = withoutKey(state.tabs, tabC);
    const emptied = {
      ...state,
      tabs,
      groups: {
        ...state.groups,
        [groupB]: { ...group, tabIds: [], activeTabId: null },
      },
    };
    expect(panelStateProblems(emptied)).not.toEqual([]);
    expect(
      panelStateProblems({ ...state, focusedGroupId: "nope" }),
    ).not.toEqual([]);
  });

  it("rejects the same tab living in two groups", () => {
    const { state, groupB, tabA } = twoGroups();
    const group = state.groups[groupB];
    if (group === undefined) throw new Error("expected a group");
    const broken = {
      ...state,
      groups: {
        ...state.groups,
        [groupB]: { ...group, tabIds: [...group.tabIds, tabA] },
      },
    };
    expect(panelStateProblems(broken)).not.toEqual([]);
  });

  // openTab's dedupe is a contract, not an optimisation (WSP-09), but it was
  // enforced only at open time: a patch could re-point a File tab at a path
  // another tab already held, and the result was two tabs rendering the same
  // content, each re-fetching it. Nothing may produce that state, so the
  // invariant belongs here rather than in one operation.
  it("rejects two tabs addressing the same thing", () => {
    const { state, groupA, tabA } = twoGroups();
    const tab = state.tabs[tabA];
    const group = state.groups[groupA];
    if (tab === undefined || group === undefined)
      throw new Error("expected a tab and its group");
    const broken = {
      ...state,
      tabs: { ...state.tabs, twin: { ...tab, id: "twin" } },
      groups: {
        ...state.groups,
        [groupA]: { ...group, tabIds: [...group.tabIds, "twin"] },
      },
    };
    expect(panelStateProblems(broken)).not.toEqual([]);
  });

  it("accepts two terminals of one scope, which are never the same target", () => {
    const make = ids();
    let state = openTab(createEmptyPanel(make), terminalTab(), make);
    state = openTab(state, terminalTab(), make);
    expect(Object.keys(state.tabs)).toHaveLength(2);
    expect(panelStateProblems(state)).toEqual([]);
  });

  it("rejects a tab that belongs to no group at all", () => {
    const { state, tabA } = twoGroups();
    const tab = state.tabs[tabA];
    if (tab === undefined) throw new Error("expected a tab");
    const broken = {
      ...state,
      tabs: { ...state.tabs, ghost: { ...tab, id: "ghost" } },
    };
    expect(panelStateProblems(broken)).not.toEqual([]);
  });
});

// D-1. A tab restored by the v1 inspector migration carries no context, and
// binding one can turn it into a duplicate of a tab the user opened in the
// meantime: openTab's dedupe runs at open time only, so nothing else would
// ever collapse the two, and panelStateProblems is right not to call it
// broken. Binding therefore has to resolve the collision itself.
describe("bindTabContext", () => {
  it("binds a context-less tab", () => {
    const makeId = ids();
    const state = openTab(
      createEmptyPanel(makeId),
      { type: "changes", context: null },
      makeId,
    );
    const tabId = Object.keys(state.tabs)[0] ?? "";

    const bound = bindTabContext(state, tabId, context());

    expect(bound.tabs[tabId]?.context).toEqual(context());
    assertPanelInvariants(bound);
  });

  it("collapses a bind that duplicates an open tab, keeping the older one", () => {
    const makeId = ids();
    const migrated = openTab(
      createEmptyPanel(makeId),
      { type: "changes", context: null },
      makeId,
    );
    const migratedId = Object.keys(migrated.tabs)[0] ?? "";
    const state = openTab(migrated, changesTab(), makeId);
    const openedId =
      Object.keys(state.tabs).find((id) => id !== migratedId) ?? "";
    expect(Object.keys(state.tabs)).toHaveLength(2);

    const bound = bindTabContext(state, migratedId, context());

    expect(Object.keys(bound.tabs)).toEqual([migratedId]);
    expect(bound.tabs[openedId]).toBeUndefined();
    expect(bound.groups[bound.focusedGroupId ?? ""]?.activeTabId).toBe(
      migratedId,
    );
    assertPanelInvariants(bound);
  });

  it("leaves a tab that already has a context alone, by reference", () => {
    const makeId = ids();
    const state = openTab(createEmptyPanel(makeId), changesTab(), makeId);
    const tabId = Object.keys(state.tabs)[0] ?? "";

    expect(bindTabContext(state, tabId, context({ scopeKey: "other" }))).toBe(
      state,
    );
  });

  it("leaves a browser tab's null context alone: it reads no worktree", () => {
    const makeId = ids();
    const state = openTab(
      createEmptyPanel(makeId),
      {
        type: "browser",
        context: null,
        url: "http://localhost:3000",
        history: [],
        historyIndex: 0,
      },
      makeId,
    );
    const tabId = Object.keys(state.tabs)[0] ?? "";

    expect(bindTabContext(state, tabId, context())).toBe(state);
  });

  it("ignores an unknown tab", () => {
    const makeId = ids();
    const state = openTab(createEmptyPanel(makeId), changesTab(), makeId);
    expect(bindTabContext(state, "nope", context())).toBe(state);
  });
});
