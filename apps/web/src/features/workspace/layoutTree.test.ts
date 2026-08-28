import { describe, expect, it } from "vitest";
import type { ThreadId } from "@pi-web/contracts";
import {
  assignThread,
  closePane,
  createInitialLayout,
  focusPane,
  moveFocus,
  paneInDirection,
  paneRects,
  restoreIntoTree,
  setSplitSizes,
  splitPane,
  tiledPaneIds,
} from "./layoutTree.js";
import type { FocusDirection, PaneId } from "./layoutTree.js";

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

  it("restoreIntoTree falls back to the first leaf when focusedPaneId is corrupt (not an actual leaf of root)", () => {
    const make = ids();
    let l = createInitialLayout(make);
    l = splitPane(l, "pane-1", "row", make); // pane-1, pane-2; pane-2 focused
    const splitPanes = tiledPaneIds(l);
    expect(splitPanes).toHaveLength(2);
    const splitId = l.root?.type === "split" ? l.root.id : null;
    expect(splitId).not.toBeNull();

    // Simulate a corrupt v1 payload: focusedPaneId points at a non-leaf id
    // (here, the split node's own id) rather than a tiled pane. A naive
    // `l.focusedPaneId ?? leafIds(l.root)[0]` would trust this bogus id,
    // replaceNode would find no matching leaf and no-op, and the docked
    // pane would be silently dropped instead of folded into the tree.
    l = {
      ...l,
      focusedPaneId: splitId,
      panes: { ...l.panes, "pane-docked": { threadId: null } },
    };

    l = restoreIntoTree(l, "pane-docked");

    for (const id of splitPanes) expect(tiledPaneIds(l)).toContain(id);
    expect(tiledPaneIds(l)).toContain("pane-docked");
    expect(tiledPaneIds(l)).toHaveLength(3);
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

  describe("moveFocus", () => {
    // [ A | [ B | [ C / D ] ] ] — the geometry the iteration-2 tester
    // measured G4 against: two full-height columns and a right-hand column
    // split into a top and a bottom pane.
    //
    //   +--------+--------+--------+
    //   |        |        |   C    |
    //   |   A    |   B    +--------+
    //   |        |        |   D    |
    //   +--------+--------+--------+
    const fourPanes = () => {
      const make = ids();
      let l = createInitialLayout(make); // pane-1 = A
      l = splitPane(l, "pane-1", "row", make); // pane-2 = B, focused
      l = splitPane(l, "pane-2", "row", make); // pane-4 = C, focused
      l = splitPane(l, "pane-4", "column", make); // pane-6 = D, focused
      return l;
    };
    const A = "pane-1";
    const B = "pane-2";
    const C = "pane-4";
    const D = "pane-6";

    it("lays the tree out left-to-right and top-to-bottom", () => {
      const boxes = paneRects(fourPanes());
      expect(boxes.map((box) => box.id)).toEqual([A, B, C, D]);
      const [a, b, c, d] = boxes.map((box) => box.rect);
      if (
        a === undefined ||
        b === undefined ||
        c === undefined ||
        d === undefined
      )
        throw new Error("expected four rects");
      expect(a.x + a.width).toBeCloseTo(b.x);
      expect(b.x + b.width).toBeCloseTo(c.x);
      expect(c.x).toBeCloseTo(d.x);
      expect(c.y + c.height).toBeCloseTo(d.y);
      expect(a.height).toBe(1);
      expect(c.height).toBeLessThan(1);
    });

    // The exact table the tester built by hand. Every "same pane" row used to
    // move somewhere — tree-order traversal has no concept of an edge.
    const table: [PaneId, FocusDirection, PaneId][] = [
      [D, "left", B],
      [D, "up", C],
      [D, "right", D],
      [D, "down", D],
      [C, "up", C],
      [C, "down", D],
      [C, "left", B],
      [C, "right", C],
      [A, "down", A],
      [A, "up", A],
      [A, "left", A],
      [A, "right", B],
      [B, "up", B],
      [B, "down", B],
      [B, "left", A],
      // B spans the full height, so C and D tie on distance, on overlap and
      // on centre offset alike. Tree order breaks it: the topmost wins.
      [B, "right", C],
    ];
    for (const [from, direction, expected] of table) {
      const outcome = expected === from ? "stays put" : `moves to ${expected}`;
      it(`${direction} from ${from} ${outcome}`, () => {
        const l = focusPane(fourPanes(), from);
        expect(moveFocus(l, direction).focusedPaneId).toBe(expected);
      });
    }

    it("never wraps: right from the rightmost pane is a no-op, not a jump home", () => {
      const make = ids();
      let l = createInitialLayout(make);
      l = splitPane(l, "pane-1", "row", make); // panes 1,2 ; focus 2
      expect(moveFocus(l, "right").focusedPaneId).toBe("pane-2");
      expect(moveFocus(l, "left").focusedPaneId).toBe("pane-1");
      l = focusPane(l, "pane-1");
      expect(moveFocus(l, "left").focusedPaneId).toBe("pane-1");
      expect(moveFocus(l, "up").focusedPaneId).toBe("pane-1");
      expect(moveFocus(l, "down").focusedPaneId).toBe("pane-1");
    });

    it("prefers measured geometry over the tree's when every pane has a real box", () => {
      // Same tree, but rendered with the columns in the OPPOSITE screen
      // order — what a right-to-left surface, or any future layout that does
      // not paint the tree left to right, would measure. The direction keys
      // must describe the screen, so "left" from A has to find B.
      const l = focusPane(fourPanes(), A);
      const mirrored = {
        [A]: { x: 600, y: 0, width: 300, height: 400 },
        [B]: { x: 300, y: 0, width: 300, height: 400 },
        [C]: { x: 0, y: 0, width: 300, height: 200 },
        [D]: { x: 0, y: 200, width: 300, height: 200 },
      };
      expect(moveFocus(l, "left", mirrored).focusedPaneId).toBe(B);
      expect(moveFocus(l, "right", mirrored).focusedPaneId).toBe(A);
    });

    it("falls back to the tree when the measurement is incomplete or degenerate", () => {
      const l = focusPane(fourPanes(), D);
      // A pane that has not mounted yet.
      expect(
        moveFocus(l, "left", { [D]: { x: 0, y: 0, width: 10, height: 10 } })
          .focusedPaneId,
      ).toBe(B);
      // Every pane present, but the surface is not laid out (display:none, a
      // detached tree): zero-area boxes would make every pane "in every
      // direction" of every other.
      const collapsed = Object.fromEntries(
        [A, B, C, D].map((id) => [id, { x: 0, y: 0, width: 0, height: 0 }]),
      );
      expect(moveFocus(l, "left", collapsed).focusedPaneId).toBe(B);
    });

    it("is a no-op on a single pane and when focus names nothing in the tree", () => {
      const make = ids();
      const single = createInitialLayout(make);
      expect(moveFocus(single, "right").focusedPaneId).toBe("pane-1");
      const l = { ...fourPanes(), focusedPaneId: "not-a-pane" };
      expect(moveFocus(l, "left").focusedPaneId).toBe("not-a-pane");
    });
  });

  describe("paneInDirection", () => {
    // Fed rects directly: this is a pure spatial question and does not need a
    // tree, a surface or a browser to be asked.
    const box = (id: string, x: number, y: number, w = 100, h = 100) => ({
      id,
      rect: { x, y, width: w, height: h },
    });

    it("picks the neighbour that shares an edge over one further along", () => {
      const boxes = [box("near", 100, 0), box("far", 200, 0), box("me", 0, 0)];
      expect(paneInDirection(boxes, "me", "right")).toBe("near");
    });

    it("ignores a pane that is merely diagonal when one is straight ahead", () => {
      const boxes = [
        box("me", 0, 0),
        box("ahead", 100, 0),
        box("diagonal", 100, 500),
      ];
      expect(paneInDirection(boxes, "me", "right")).toBe("ahead");
    });

    it("prefers the neighbour it shares the most edge with", () => {
      const boxes = [
        box("me", 0, 0, 100, 100),
        box("sliver", 100, 90, 100, 100),
        box("broad", 100, 0, 100, 90),
      ];
      expect(paneInDirection(boxes, "me", "right")).toBe("broad");
    });

    it("returns null when nothing lies that way", () => {
      const boxes = [box("me", 100, 0), box("left", 0, 0)];
      expect(paneInDirection(boxes, "me", "right")).toBeNull();
      expect(paneInDirection(boxes, "me", "up")).toBeNull();
      expect(paneInDirection(boxes, "me", "left")).toBe("left");
    });

    it("tolerates sub-pixel seams between panes that share an edge", () => {
      // Flexbox fractions of an odd pixel width: the boxes overlap by a
      // hundredth of a pixel, which must not read as "not to the left of".
      const boxes = [
        box("me", 100.004, 0, 99.996, 100),
        box("left", 0, 0, 100.01, 100),
      ];
      expect(paneInDirection(boxes, "me", "left")).toBe("left");
    });

    it("returns null for a pane that is not in the set", () => {
      expect(paneInDirection([box("a", 0, 0)], "ghost", "left")).toBeNull();
    });
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
      // By identity, not just by value: a miss walks the whole tree and must
      // hand back the very tree it was given, because every pane is memoised
      // on its own node. Deep equality here would pass equally against an
      // implementation that rebuilt every node it visited.
      expect(result).toBe(l);
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
      // A 1:200 share. It is rescaled first and then held at the 0.05
      // floor, so it lands ON the floor: [0.05, 0.95]. (It used to be
      // clamped before rescaling, which both inflated this share to 0.2 and
      // left the floor itself unenforced for extreme pairs — see F6 in
      // binaryTree.test.ts.)
      expect(a).toBeCloseTo(0.05, 10);
      expect(b).toBeCloseTo(0.95, 10);
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
