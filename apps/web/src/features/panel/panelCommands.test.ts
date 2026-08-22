import { describe, expect, it } from "vitest";

import { applyPanelCommand } from "./panelCommands.js";
import {
  createEmptyPanel,
  openTab,
  panelStateProblems,
  type PanelState,
} from "./panelModel.js";
import { leafIds } from "../layout/binaryTree.js";

function ids(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id-${String(next)}`;
  };
}

// A panel holding `count` Changes-like tabs in one group. Files tabs are
// used for the extras because openTab dedupes two Changes tabs of the same
// (null) scope onto one another.
function panelWith(count: number, makeId: () => string): PanelState {
  let state = openTab(createEmptyPanel(makeId), CHANGES, makeId);
  for (let index = 1; index < count; index += 1)
    state = openTab(
      state,
      {
        type: "terminal",
        context: null,
        cwd: `dir-${String(index)}`,
        terminalId: null,
      },
      makeId,
    );
  return state;
}

const CHANGES = { type: "changes", context: null } as const;

describe("applyPanelCommand", () => {
  it("moves the active tab forward and wraps at the end of the strip", () => {
    const makeId = ids();
    const state = panelWith(3, makeId);
    const group = leafIds(state.root)[0] ?? "";
    const strip = state.groups[group]?.tabIds ?? [];
    expect(state.groups[group]?.activeTabId).toBe(strip[2]);

    const wrapped = applyPanelCommand(
      state,
      { type: "panel-tab", direction: "next" },
      makeId,
    );
    expect(wrapped.groups[group]?.activeTabId).toBe(strip[0]);

    const back = applyPanelCommand(
      wrapped,
      { type: "panel-tab", direction: "previous" },
      makeId,
    );
    expect(back.groups[group]?.activeTabId).toBe(strip[2]);
  });

  it("closes the focused group's active tab", () => {
    const makeId = ids();
    const state = panelWith(2, makeId);
    const active =
      state.groups[leafIds(state.root)[0] ?? ""]?.activeTabId ?? "";

    const closed = applyPanelCommand(
      state,
      { type: "panel-close-tab" },
      makeId,
    );
    expect(Object.keys(closed.tabs)).toHaveLength(1);
    expect(closed.tabs[active]).toBeUndefined();
    expect(panelStateProblems(closed)).toEqual([]);
  });

  it("splits the focused group along the commanded edge", () => {
    const makeId = ids();
    const state = panelWith(2, makeId);

    const split = applyPanelCommand(
      state,
      { type: "panel-split", edge: "bottom" },
      makeId,
    );
    expect(split.root?.type).toBe("split");
    expect(leafIds(split.root)).toHaveLength(2);
    expect(panelStateProblems(split)).toEqual([]);
  });

  // The model cannot split a group holding a single tab: the tab would leave
  // its group empty and the "new" half would hold what the old one showed.
  it("leaves a single-tab group untouched, by reference", () => {
    const makeId = ids();
    const state = panelWith(1, makeId);
    expect(
      applyPanelCommand(state, { type: "panel-split", edge: "right" }, makeId),
    ).toBe(state);
  });

  it("moves the active tab into the next group and wraps", () => {
    const makeId = ids();
    const split = applyPanelCommand(
      panelWith(3, makeId),
      { type: "panel-split", edge: "right" },
      makeId,
    );
    const [first, second] = leafIds(split.root);
    const moved = applyPanelCommand(
      split,
      { type: "panel-move-tab", direction: "next" },
      makeId,
    );
    // The focused group is the new (second) one; "next" wraps back to the
    // first.
    expect(split.focusedGroupId).toBe(second);
    expect(moved.groups[first ?? ""]?.tabIds).toHaveLength(3);
    expect(panelStateProblems(moved)).toEqual([]);
  });

  it("does not move a tab when there is only one group", () => {
    const makeId = ids();
    const state = panelWith(2, makeId);
    expect(
      applyPanelCommand(
        state,
        { type: "panel-move-tab", direction: "next" },
        makeId,
      ),
    ).toBe(state);
  });

  it("toggles the panel open and shut", () => {
    const makeId = ids();
    const state = { ...panelWith(1, makeId), open: false };
    const opened = applyPanelCommand(state, { type: "panel-toggle" }, makeId);
    expect(opened.open).toBe(true);
    expect(
      applyPanelCommand(opened, { type: "panel-toggle" }, makeId).open,
    ).toBe(false);
  });

  it("opens the panel when focus is asked for, so the focus lands somewhere", () => {
    const makeId = ids();
    const state = { ...panelWith(1, makeId), open: false };
    expect(applyPanelCommand(state, { type: "panel-focus" }, makeId).open).toBe(
      true,
    );
  });

  it("is a no-op, by reference, on an empty panel", () => {
    const makeId = ids();
    const empty: PanelState = {
      ...createEmptyPanel(makeId),
      root: null,
      groups: {},
      focusedGroupId: null,
    };
    for (const command of [
      { type: "panel-tab", direction: "next" },
      { type: "panel-close-tab" },
      { type: "panel-move-tab", direction: "next" },
      { type: "panel-split", edge: "right" },
    ] as const)
      expect(applyPanelCommand(empty, command, makeId)).toBe(empty);
  });
});
