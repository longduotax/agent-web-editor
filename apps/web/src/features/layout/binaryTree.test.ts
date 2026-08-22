import { describe, expect, it } from "vitest";

import {
  containsLeaf,
  leafIds,
  MIN_SIZE_FRACTION,
  normalizeSizes,
  removeLeaf,
  replaceLeaf,
  setSplitSizes,
  splitLeaf,
} from "./binaryTree.js";
import type { TreeLeaf, TreeNode, TreeSplit } from "./binaryTree.js";

// The tree is generic over the leaf's discriminant tag, so both the chat
// surface ("pane") and the workspace panel ("group") can share it. These
// tests exercise both tags to keep that genericity honest.
type PaneTree = TreeNode<"pane", string>;
type GroupTree = TreeNode<"group", string>;

function pane(id: string): TreeLeaf<"pane", string> {
  return { type: "pane", id };
}

function split(
  id: string,
  axis: "row" | "column",
  children: [PaneTree, PaneTree],
  sizes: [number, number] = [0.5, 0.5],
): TreeSplit<"pane", string> {
  return { type: "split", id, axis, children, sizes };
}

describe("binaryTree", () => {
  describe("leafIds", () => {
    it("is empty for an absent tree", () => {
      expect(leafIds<"pane", string>(null)).toEqual([]);
    });

    it("returns the single leaf of a leaf-only tree", () => {
      expect(leafIds(pane("a"))).toEqual(["a"]);
    });

    it("walks in order: left-to-right and top-to-bottom", () => {
      // A 2x2 grid: an outer row split whose halves are each a column split.
      const tree = split("s0", "row", [
        split("s1", "column", [pane("a"), pane("b")]),
        split("s2", "column", [pane("c"), pane("d")]),
      ]);
      expect(leafIds(tree)).toEqual(["a", "b", "c", "d"]);
    });
  });

  describe("containsLeaf", () => {
    it("is false for an absent tree", () => {
      expect(containsLeaf<"pane", string>(null, "a")).toBe(false);
    });

    it("finds a deeply nested leaf and rejects a split's own id", () => {
      const tree = split("s0", "row", [
        pane("a"),
        split("s1", "column", [pane("b"), pane("c")]),
      ]);
      expect(containsLeaf(tree, "c")).toBe(true);
      expect(containsLeaf(tree, "missing")).toBe(false);
      // A split id is not a leaf id, even though both are strings.
      expect(containsLeaf(tree, "s1")).toBe(false);
    });
  });

  describe("replaceLeaf", () => {
    it("replaces the addressed leaf", () => {
      const tree = split("s0", "row", [pane("a"), pane("b")]);
      const next = replaceLeaf(tree, "b", () => pane("z"));
      expect(leafIds(next)).toEqual(["a", "z"]);
    });

    it("passes the matched leaf to the factory", () => {
      const tree = split("s0", "row", [pane("a"), pane("b")]);
      replaceLeaf(tree, "b", (leaf) => {
        expect(leaf).toEqual({ type: "pane", id: "b" });
        return leaf;
      });
      expect.assertions(1);
    });

    it("rebuilds every ancestor on the path but keeps unrelated subtrees identical", () => {
      const untouched = split("s1", "column", [pane("a"), pane("b")]);
      const target = split("s2", "column", [pane("c"), pane("d")]);
      const tree = split("s0", "row", [untouched, target]);

      const next = replaceLeaf(tree, "d", () => pane("z"));

      expect(next).not.toBe(tree); // the root is on the path
      if (next.type !== "split") throw new Error("expected a split");
      // The sibling subtree that contained nothing to replace is reused by
      // reference, so React can bail out of re-rendering it entirely.
      expect(next.children[0]).toBe(untouched);
      expect(next.children[1]).not.toBe(target);
    });

    it("returns the identical tree when the target is absent", () => {
      const tree = split("s0", "row", [
        pane("a"),
        split("s1", "column", [pane("b"), pane("c")]),
      ]);
      expect(replaceLeaf(tree, "missing", () => pane("z"))).toBe(tree);
    });

    it("never treats a split as a replaceable leaf", () => {
      const tree = split("s0", "row", [pane("a"), pane("b")]);
      expect(replaceLeaf(tree, "s0", () => pane("z"))).toBe(tree);
    });
  });

  describe("removeLeaf", () => {
    it("returns null when the only leaf is removed", () => {
      expect(removeLeaf(pane("a"), "a")).toBeNull();
    });

    it("returns the identical tree when the leaf is absent", () => {
      const tree = split("s0", "row", [pane("a"), pane("b")]);
      expect(removeLeaf(tree, "missing")).toBe(tree);
    });

    it("promotes the surviving sibling in place of the split", () => {
      const survivor = pane("a");
      const tree = split("s0", "row", [survivor, pane("b")]);
      expect(removeLeaf(tree, "b")).toBe(survivor);
    });

    it("promotes a surviving sibling subtree, not just a leaf", () => {
      const survivor = split("s1", "column", [pane("b"), pane("c")]);
      const tree = split("s0", "row", [pane("a"), survivor]);
      expect(removeLeaf(tree, "a")).toBe(survivor);
    });

    it("collapses only the split that lost a child", () => {
      const tree = split("s0", "row", [
        split("s1", "column", [pane("a"), pane("b")]),
        split("s2", "column", [pane("c"), pane("d")]),
      ]);
      const next = removeLeaf(tree, "c");
      expect(leafIds(next)).toEqual(["a", "b", "d"]);
      if (next?.type !== "split") throw new Error("expected a split");
      expect(next.children[1]).toEqual(pane("d"));
      expect(next.id).toBe("s0");
    });
  });

  describe("normalizeSizes", () => {
    it("leaves an already-normalized pair alone", () => {
      expect(normalizeSizes([0.3, 0.7])).toEqual([0.3, 0.7]);
    });

    it("clamps to the minimum fraction and rescales to sum to 1", () => {
      // 0.001 is clamped up to 0.05, then [0.05, 0.2] is rescaled: [0.2, 0.8].
      const [a, b] = normalizeSizes([0.001, 0.2]);
      expect(a).toBeCloseTo(0.2, 5);
      expect(b).toBeCloseTo(0.8, 5);
    });

    it("rescales a pair that does not sum to 1", () => {
      const [a, b] = normalizeSizes([2, 2]);
      expect(a).toBeCloseTo(0.5, 5);
      expect(b).toBeCloseTo(0.5, 5);
    });

    it("keeps a collapsed side grabbable, and always sums to 1", () => {
      // Clamping happens before rescaling, so the floor is applied to the
      // raw pair and the rescale can shave it slightly: 0 clamps to 0.05,
      // then [0.05, 1] rescales to 0.05/1.05. What matters is that the
      // collapsed side stays wide enough to grab, never 0.
      const [a, b] = normalizeSizes([0, 1]);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeCloseTo(MIN_SIZE_FRACTION / (1 + MIN_SIZE_FRACTION), 10);
      expect(a + b).toBeCloseTo(1, 10);
    });
  });

  describe("setSplitSizes", () => {
    it("returns the identical tree when the split id is unknown", () => {
      const tree = split("s0", "row", [pane("a"), pane("b")]);
      expect(setSplitSizes(tree, "missing", [0.2, 0.8])).toBe(tree);
    });

    it("returns the identical tree for a leaf-only tree", () => {
      const tree = pane("a");
      expect(setSplitSizes(tree, "s0", [0.2, 0.8])).toBe(tree);
    });

    it("returns the identical tree when the sizes are the ones it has", () => {
      const tree = split("s0", "row", [pane("a"), pane("b")], [0.3, 0.7]);
      // A divider dragged back to where it started must not invalidate the
      // tree: every tile is memoised on its node.
      expect(setSplitSizes(tree, "s0", [0.3, 0.7])).toBe(tree);
      expect(setSplitSizes(tree, "s0", [3, 7])).toBe(tree);
    });

    it("normalizes the sizes it stores", () => {
      const tree = split("s0", "row", [pane("a"), pane("b")]);
      const next = setSplitSizes(tree, "s0", [0.001, 0.2]);
      if (next.type !== "split") throw new Error("expected a split");
      expect(next.sizes[0]).toBeCloseTo(0.2, 5);
      expect(next.sizes[1]).toBeCloseTo(0.8, 5);
    });

    it("addresses a split whose children are both splits", () => {
      const tree = split("s0", "row", [
        split("s1", "column", [pane("a"), pane("b")]),
        split("s2", "column", [pane("c"), pane("d")]),
      ]);
      const next = setSplitSizes(tree, "s2", [0.25, 0.75]);
      if (next.type !== "split") throw new Error("expected a split");
      const inner = next.children[1];
      if (inner.type !== "split") throw new Error("expected a split");
      expect(inner.sizes[0]).toBeCloseTo(0.25, 5);
      // The untouched half keeps its identity.
      expect(next.children[0]).toBe(tree.children[0]);
    });
  });

  describe("splitLeaf", () => {
    it("replaces the target leaf with a split holding it and the new leaf", () => {
      const tree = pane("a");
      const next = splitLeaf(tree, "a", {
        splitId: "s0",
        axis: "row",
        leaf: pane("b"),
        side: "after",
      });
      expect(next).toEqual(split("s0", "row", [pane("a"), pane("b")]));
    });

    it("puts the new leaf before the original when the side says so", () => {
      const next = splitLeaf(pane("a"), "a", {
        splitId: "s0",
        axis: "column",
        leaf: pane("b"),
        side: "before",
      });
      expect(leafIds(next)).toEqual(["b", "a"]);
      if (next.type !== "split") throw new Error("expected a split");
      expect(next.axis).toBe("column");
    });

    it("splits a nested leaf without disturbing its siblings", () => {
      const untouched = split("s1", "column", [pane("a"), pane("b")]);
      const tree = split("s0", "row", [untouched, pane("c")]);

      const next = splitLeaf(tree, "c", {
        splitId: "s2",
        axis: "column",
        leaf: pane("d"),
        side: "after",
      });

      expect(leafIds(next)).toEqual(["a", "b", "c", "d"]);
      if (next.type !== "split") throw new Error("expected a split");
      expect(next.children[0]).toBe(untouched);
    });

    it("returns the identical tree when the target leaf is absent", () => {
      const tree = split("s0", "row", [pane("a"), pane("b")]);
      expect(
        splitLeaf(tree, "missing", {
          splitId: "s1",
          axis: "row",
          leaf: pane("z"),
          side: "after",
        }),
      ).toBe(tree);
    });

    it("works for a differently tagged leaf type", () => {
      const group: GroupTree = { type: "group", id: "g1" };
      const next = splitLeaf(group, "g1", {
        splitId: "s0",
        axis: "row",
        leaf: { type: "group", id: "g2" },
        side: "after",
      });
      expect(leafIds(next)).toEqual(["g1", "g2"]);
      expect(next.type).toBe("split");
    });
  });
});
