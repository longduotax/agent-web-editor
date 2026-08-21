import { describe, expect, it } from "vitest";
import type { ThreadId } from "@pi-web/contracts";
import {
  assignThread,
  closePane,
  collapsePane,
  createInitialLayout,
  moveFocus,
  restorePane,
  setPaneParentSizes,
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
    expect(l.docked).toEqual([]);
  });

  it("splits right into a focused new pane", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make);
    expect(l.root?.type).toBe("split");
    expect(tiledPaneIds(l)).toEqual(["pane-1", "pane-2"]);
    expect(l.focusedPaneId).toBe("pane-2");
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

  it("collapses to the dock and restores back into the tree", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make); // pane-2 focused
    l = collapsePane(l, "pane-2");
    expect(l.docked).toEqual(["pane-2"]);
    expect(tiledPaneIds(l)).toEqual(["pane-1"]);
    expect(l.panes["pane-2"]).toBeDefined();
    l = restorePane(l, "pane-2");
    expect(l.docked).toEqual([]);
    expect(tiledPaneIds(l)).toContain("pane-2");
    expect(l.focusedPaneId).toBe("pane-2");
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

  describe("setPaneParentSizes", () => {
    it("updates the sizes of the parent split of a pane", () => {
      const make = ids();
      let l = createInitialLayout(make);
      l = splitPane(l, "pane-1", "row", make); // pane-1, pane-2
      l = setPaneParentSizes(l, "pane-2", [0.3, 0.7]);
      expect(l.root).toEqual({
        type: "split",
        axis: "row",
        children: [
          { type: "pane", id: "pane-1" },
          { type: "pane", id: "pane-2" },
        ],
        sizes: [0.3, 0.7],
      });
    });

    it("is a no-op when the pane is the root pane", () => {
      const l = createInitialLayout(ids());
      const result = setPaneParentSizes(l, "pane-1", [0.2, 0.8]);
      expect(result).toEqual(l);
    });

    it("is a no-op when the pane id is unknown", () => {
      const make = ids();
      let l = createInitialLayout(make);
      l = splitPane(l, "pane-1", "row", make);
      const result = setPaneParentSizes(l, "pane-does-not-exist", [0.2, 0.8]);
      expect(result).toEqual(l);
    });

    it("normalizes sizes to sum to 1, clamping to a sane minimum", () => {
      const make = ids();
      let l = createInitialLayout(make);
      l = splitPane(l, "pane-1", "row", make);
      l = setPaneParentSizes(l, "pane-2", [0.001, 0.2]);
      const root = l.root;
      if (root?.type !== "split") throw new Error("expected split root");
      const [a, b] = root.sizes;
      // 0.001 is clamped up to the 0.05 minimum, then [0.05, 0.2] is
      // rescaled to sum to 1: [0.05, 0.2] / 0.25 = [0.2, 0.8].
      expect(a).toBeCloseTo(0.2, 5);
      expect(b).toBeCloseTo(0.8, 5);
      expect(a + b).toBeCloseTo(1, 10);
    });
  });
});
