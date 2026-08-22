import { describe, expect, it } from "vitest";

import type { TreeNode } from "../layout/binaryTree.js";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./panelModel.js";
import type { GroupId } from "./panelModel.js";
import {
  PANEL_MIN_GROUP_HEIGHT,
  PANEL_MIN_GROUP_WIDTH,
  clampPanelWidth,
  panelMaxWidth,
  treeMinHeight,
  treeMinWidth,
} from "./panelGeometry.js";

describe("panelMaxWidth", () => {
  it("leaves the sidebar and a readable chat pane their room", () => {
    // 1440 - 272 (sidebar) - 360 (smallest usable chat pane) = 808.
    expect(panelMaxWidth(1440)).toBe(808);
  });

  it("never falls below the panel's own minimum, however narrow the viewport", () => {
    expect(panelMaxWidth(400)).toBe(PANEL_MIN_WIDTH);
    expect(panelMaxWidth(0)).toBe(PANEL_MIN_WIDTH);
  });

  it("stops at the model's absolute ceiling", () => {
    expect(panelMaxWidth(100_000)).toBe(PANEL_MAX_WIDTH);
  });
});

describe("clampPanelWidth", () => {
  it("keeps a width the viewport can carry", () => {
    expect(clampPanelWidth(500, 1440)).toBe(500);
  });

  // Without this the panel can be dragged — or restored — wider than the
  // viewport, squashing the chat surface to nothing.
  it("clamps a width the viewport cannot carry", () => {
    expect(clampPanelWidth(4000, 1440)).toBe(808);
  });

  it("clamps a width below the minimum", () => {
    expect(clampPanelWidth(10, 1440)).toBe(PANEL_MIN_WIDTH);
  });

  it("rounds to whole pixels", () => {
    expect(clampPanelWidth(500.6, 1440)).toBe(501);
  });

  it("falls back to the minimum for a width that is not a number", () => {
    expect(clampPanelWidth(Number.NaN, 1440)).toBe(PANEL_MIN_WIDTH);
  });
});

// F6. WSP-04 says the panel "never shrinks a group into an unreadable
// state", and the panel enforced a minimum OUTER WIDTH but bounded its
// groups only by MIN_FRACTION — a proportion, which is no floor in pixels
// at all. At PANEL_MIN_WIDTH split in two, each group was 139px and the
// terminal in one of them negotiated 16 columns.
describe("the minimum size of a tree of groups", () => {
  const group = (id: string): TreeNode<"group", GroupId> => ({
    type: "group",
    id,
  });
  const split = (
    axis: "row" | "column",
    children: [TreeNode<"group", GroupId>, TreeNode<"group", GroupId>],
  ): TreeNode<"group", GroupId> => ({
    type: "split",
    id: `${axis}-split`,
    axis,
    children,
    sizes: [0.5, 0.5],
  });

  it("is one group's floor for a single group", () => {
    expect(treeMinWidth(group("a"))).toBe(PANEL_MIN_GROUP_WIDTH);
    expect(treeMinHeight(group("a"))).toBe(PANEL_MIN_GROUP_HEIGHT);
  });

  it("adds along the split axis and takes the larger across it", () => {
    const sideBySide = split("row", [group("a"), group("b")]);
    expect(treeMinWidth(sideBySide)).toBe(PANEL_MIN_GROUP_WIDTH * 2);
    expect(treeMinHeight(sideBySide)).toBe(PANEL_MIN_GROUP_HEIGHT);

    const stacked = split("column", [group("a"), group("b")]);
    expect(treeMinWidth(stacked)).toBe(PANEL_MIN_GROUP_WIDTH);
    expect(treeMinHeight(stacked)).toBe(PANEL_MIN_GROUP_HEIGHT * 2);
  });

  it("recurses, so a nested split carries its own share", () => {
    const nested = split("row", [
      group("a"),
      split("column", [group("b"), group("c")]),
    ]);
    expect(treeMinWidth(nested)).toBe(PANEL_MIN_GROUP_WIDTH * 2);
    expect(treeMinHeight(nested)).toBe(PANEL_MIN_GROUP_HEIGHT * 2);
  });

  it("is zero for a panel with no groups at all", () => {
    expect(treeMinWidth(null)).toBe(0);
    expect(treeMinHeight(null)).toBe(0);
  });
});
