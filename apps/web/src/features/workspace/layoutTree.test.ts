import { describe, expect, it } from "vitest";
import type { ThreadId } from "@pi-web/contracts";
import {
  assignThread,
  closePane,
  createInitialLayout,
  moveFocus,
  restoreIntoTree,
  setSplitSizes,
  splitPane,
  tiledPaneIds,
} from "./layoutTree.js";

const ids = () => {
  let n = 0;
  return () => `pane-${String(++n)}`;
};

describe("layoutTree", () => {
  it("starts with one focused, threadless pane", () => {
    const l = createInitialLayout(ids());
    expect(tiledPaneIds(l)).toEqual(["pane-1"]);
    expect(l.focusedPaneId).toBe("pane-1");
    expect(l.panes["pane-1"]?.threadId).toBeNull();
  });

  it("splits right into a focused new pane", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make);
    expect(l.root?.type).toBe("split");
    expect(tiledPaneIds(l)).toEqual(["pane-1", "pane-2"]);
    expect(l.focusedPaneId).toBe("pane-2");
  });

  it("gives every new split a stable id, distinct from pane ids", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make);
    if (l.root?.type !== "split") throw new Error("expected split root");
    expect(typeof l.root.id).toBe("string");
    expect(l.root.id.length).toBeGreaterThan(0);
    expect(l.root.id).not.toBe("pane-1");
    expect(l.root.id).not.toBe("pane-2");
  });

  it("splitting a nonexistent target leaves the layout unchanged", () => {
    const make = ids();
    const l = createInitialLayout(make);
    const result = splitPane(l, "pane-does-not-exist", "row", make);
    expect(result).toEqual(l);
    expect(tiledPaneIds(result)).toEqual(tiledPaneIds(l));
    expect(result.focusedPaneId).toBe(l.focusedPaneId);
    expect(Object.keys(result.panes)).toEqual(Object.keys(l.panes));
  });

  it("restoreIntoTree folds a docked-style id back into the tree, preserving existing splits and focusing it", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make); // pane-1, pane-2; pane-2 focused
    l = splitPane(l, "pane-1", "column", make); // pane-1 further split
    const splitPanes = tiledPaneIds(l);
    expect(splitPanes).toHaveLength(3);
    // Simulate a v1-style docked pane that was removed from the tree but
    // kept in `panes`.
    const beforeRoot = l.root;
    l = { ...l, panes: { ...l.panes, "pane-docked": { threadId: null } } };

    l = restoreIntoTree(l, "pane-docked");

    // All previously-tiled panes are still present; nothing was lost.
    for (const id of splitPanes) expect(tiledPaneIds(l)).toContain(id);
    expect(tiledPaneIds(l)).toContain("pane-docked");
    expect(tiledPaneIds(l)).toHaveLength(4);
    // The existing split structure is preserved (nested, not discarded).
    expect(l.root).not.toEqual(beforeRoot);
    expect(l.focusedPaneId).toBe("pane-docked");
  });

  it("restoreIntoTree becomes the root when there is no tiled pane", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = closePane(l, "pane-1");
    expect(l.root).toBeNull();

    l = { ...l, panes: { ...l.panes, "pane-docked": { threadId: null } } };
    l = restoreIntoTree(l, "pane-docked");

    expect(l.root).toEqual({ type: "pane", id: "pane-docked" });
    expect(l.focusedPaneId).toBe("pane-docked");
  });

  it("closing a pane collapses its parent split and forgets it", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "column", make);
    l = closePane(l, "pane-2");
    expect(l.root).toEqual({ type: "pane", id: "pane-1" });
    expect(l.panes["pane-2"]).toBeUndefined();
    expect(l.focusedPaneId).toBe("pane-1");
  });

  it("assigns a thread id to a pane", () => {
    const l = assignThread(
      createInitialLayout(ids()),
      "pane-1",
      "t1" as ThreadId,
    );
    expect(l.panes["pane-1"]?.threadId).toBe("t1");
  });

  it("moves focus cyclically across tiled panes", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make); // panes 1,2 ; focus 2
    l = moveFocus(l, "right");
    expect(l.focusedPaneId).toBe("pane-1"); // cyclic wrap
    l = moveFocus(l, "left");
    expect(l.focusedPaneId).toBe("pane-2");
  });

  describe("setSplitSizes", () => {
    it("updates the sizes of the split addressed by its own id", () => {
      const make = ids();
      let l = createInitialLayout(make);
      l = splitPane(l, "pane-1", "row", make); // pane-1, pane-2
      if (l.root?.type !== "split") throw new Error("expected split root");
      const splitId = l.root.id;
      l = setSplitSizes(l, splitId, [0.3, 0.7]);
      expect(l.root).toEqual({
        type: "split",
        id: splitId,
        axis: "row",
        children: [
          { type: "pane", id: "pane-1" },
          { type: "pane", id: "pane-2" },
        ],
        sizes: [0.3, 0.7],
      });
    });

    it("is a no-op when there is no root", () => {
      const l = createInitialLayout(ids());
      const result = setSplitSizes(l, "split-does-not-exist", [0.2, 0.8]);
      expect(result).toEqual(l);
    });

    it("is a no-op when the split id is unknown", () => {
      const make = ids();
      let l = createInitialLayout(make);
      l = splitPane(l, "pane-1", "row", make);
      const result = setSplitSizes(l, "split-does-not-exist", [0.2, 0.8]);
      expect(result).toEqual(l);
    });

    it("normalizes sizes to sum to 1, clamping to a sane minimum", () => {
      const make = ids();
      let l = createInitialLayout(make);
      l = splitPane(l, "pane-1", "row", make);
      if (l.root?.type !== "split") throw new Error("expected split root");
      l = setSplitSizes(l, l.root.id, [0.001, 0.2]);
      const root = l.root;
      if (root?.type !== "split") throw new Error("expected split root");
      const [a, b] = root.sizes;
      // 0.001 is clamped up to the 0.05 minimum, then [0.05, 0.2] is
      // rescaled to sum to 1: [0.05, 0.2] / 0.25 = [0.2, 0.8].
      expect(a).toBeCloseTo(0.2, 5);
      expect(b).toBeCloseTo(0.8, 5);
      expect(a + b).toBeCloseTo(1, 10);
    });

    it("finds and updates a split even when both of its children are themselves splits (2x2 grid)", () => {
      const make = ids();
      let l = createInitialLayout(make); // pane-1
      l = splitPane(l, "pane-1", "row", make); // outer split; pane-1, pane-2
      if (l.root?.type !== "split") throw new Error("expected split root");
      const outerSplitId = l.root.id;
      l = splitPane(l, "pane-1", "column", make); // pane-1's side split down
      l = splitPane(l, "pane-2", "column", make); // pane-2's side split down
      // Neither of the outer split's immediate children is a pane anymore,
      // but the outer split can still be addressed and resized by its own
      // id (this is the case a pane-id-based resize handle can't reach).
      const grid = l.root;
      if (grid?.type !== "split") throw new Error("expected split root");
      expect(grid.children[0].type).toBe("split");
      expect(grid.children[1].type).toBe("split");

      l = setSplitSizes(l, outerSplitId, [0.3, 0.7]);

      const root = l.root;
      if (root?.type !== "split") throw new Error("expected split root");
      expect(root.id).toBe(outerSplitId);
      expect(root.sizes[0]).toBeCloseTo(0.3, 5);
      expect(root.sizes[1]).toBeCloseTo(0.7, 5);
    });
  });
});
