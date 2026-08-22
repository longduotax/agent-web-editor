import type { ThreadId } from "@pi-web/contracts";

import {
  containsLeaf,
  leafIds,
  removeLeaf,
  setSplitSizes as setNodeSizes,
  splitLeaf,
} from "../layout/binaryTree.js";
import type {
  SplitAxis,
  TreeLeaf,
  TreeNode,
  TreeSplit,
} from "../layout/binaryTree.js";

export type PaneId = string;
export type SplitId = string;
export type { SplitAxis };
export type FocusDirection = "left" | "right" | "up" | "down";

// The chat surface's leaves are panes. The tree itself lives in
// `features/layout/binaryTree.ts`, shared with the workspace panel; the
// "pane" tag is what keeps this surface's persisted format its own.
export type PaneNode = TreeLeaf<"pane", PaneId>;
export type SplitNode = TreeSplit<"pane", PaneId>;
export type LayoutNode = TreeNode<"pane", PaneId>;

export interface WorkspaceLayout {
  root: LayoutNode | null; // null = no tiled panes
  panes: Record<PaneId, { threadId: ThreadId | null }>; // all panes, all tiled
  focusedPaneId: PaneId | null;
  boundPaneId: PaneId | null; // right-panel binding (carried; used in a later phase)
}

// Picks the next focus target after a pane leaves the tree: keep the
// previously-focused pane if it's still tiled, else the first tiled pane,
// else null.
function nextFocus(
  root: LayoutNode | null,
  previouslyFocused: PaneId | null,
): PaneId | null {
  if (previouslyFocused !== null && containsLeaf(root, previouslyFocused))
    return previouslyFocused;
  return leafIds(root)[0] ?? null;
}

export function createInitialLayout(makeId: () => PaneId): WorkspaceLayout {
  const id = makeId();
  return {
    root: { type: "pane", id },
    panes: { [id]: { threadId: null } },
    focusedPaneId: id,
    boundPaneId: null,
  };
}

export function splitPane(
  l: WorkspaceLayout,
  target: PaneId,
  axis: SplitAxis,
  makeId: () => PaneId,
): WorkspaceLayout {
  if (l.root === null || !containsLeaf(l.root, target)) return l;
  const newId = makeId();
  // Same generator as pane ids; only the field it's stored in (and thus its
  // uniqueness within the tree) matters, not which pool it came from.
  const splitId: SplitId = makeId();
  const root = splitLeaf(l.root, target, {
    splitId,
    axis,
    leaf: { type: "pane", id: newId },
    side: "after", // a split always opens the new pane right of / below the old
  });
  return {
    ...l,
    root,
    panes: { ...l.panes, [newId]: { threadId: null } },
    focusedPaneId: newId,
  };
}

export function closePane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout {
  if (l.root === null) return l;
  const root = removeLeaf(l.root, id);
  const focusedPaneId = nextFocus(
    root,
    l.focusedPaneId === id ? null : l.focusedPaneId,
  );
  const panes = Object.fromEntries(
    Object.entries(l.panes).filter(([paneId]) => paneId !== id),
  );
  const boundPaneId = l.boundPaneId === id ? null : l.boundPaneId;
  return { ...l, root, panes, focusedPaneId, boundPaneId };
}

// Internal helper used only to migrate v1 persisted layouts (which had a
// `docked` tier) forward into v2's pure tiled tree: folds a pane id that
// used to live in `docked` back into the tiled tree, splitting the focused
// pane along "row" (or becoming the root when there is none), and focuses
// it. Not part of the public pane-management API — application code drives
// the tree via splitPane/closePane/moveFocus/etc.
export function restoreIntoTree(
  l: WorkspaceLayout,
  id: PaneId,
): WorkspaceLayout {
  if (l.root === null) {
    return { ...l, root: { type: "pane", id }, focusedPaneId: id };
  }
  // `focusedPaneId` from a corrupt/stale persisted payload can point at an
  // id that isn't actually a leaf of `root` (e.g. a split id, or a pane that
  // no longer exists). splitLeaf no-ops when its target isn't found, which
  // would silently drop the docked pane being folded in here — so only trust
  // focusedPaneId when it really is a leaf; otherwise fall back to the first
  // leaf, same as when focusedPaneId is absent.
  const target =
    l.focusedPaneId !== null && containsLeaf(l.root, l.focusedPaneId)
      ? l.focusedPaneId
      : leafIds(l.root)[0];
  if (target === undefined) return l;
  const splitId: SplitId = `split-${crypto.randomUUID()}`;
  const root = splitLeaf(l.root, target, {
    splitId,
    axis: "row",
    leaf: { type: "pane", id },
    side: "after",
  });
  return { ...l, root, focusedPaneId: id };
}

export function assignThread(
  l: WorkspaceLayout,
  id: PaneId,
  threadId: ThreadId,
): WorkspaceLayout {
  if (!(id in l.panes)) return l;
  return { ...l, panes: { ...l.panes, [id]: { threadId } } };
}

export function focusPane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout {
  if (!(id in l.panes)) return l;
  return { ...l, focusedPaneId: id };
}

/** An axis-aligned box, in whatever units the caller measured in. */
export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A pane and where it sits, in tree order. */
export interface PaneBox {
  id: PaneId;
  rect: PaneRect;
}

/**
 * Where each pane sits, derived from the tree alone, in a unit square.
 *
 * This is the fallback geometry for `moveFocus` when nothing has measured the
 * real thing (unit tests, the first dispatch before any pane has mounted).
 * It is faithful about ORDER and about the vertical axis — a row split always
 * puts its first child entirely left of its second, a column split always
 * puts its first child entirely above its second, and column fractions are
 * exactly the heights flexbox will produce.
 *
 * It is NOT faithful about horizontal SIZE once the surface has more panes
 * than fit: `MIN_PANE_WIDTH_PX` clamps each region and the surface scrolls
 * (CWS-07), so on screen a 0.2-fraction pane and a 0.4-fraction pane can both
 * be 360px wide. That distortion is monotonic — it never reorders panes and
 * never moves one across another — so the half-plane each pane falls into is
 * the same either way, which is what direction is decided by. Measured rects
 * are still preferred where they exist; this keeps the function total.
 */
export function paneRects(l: WorkspaceLayout): PaneBox[] {
  const boxes: PaneBox[] = [];
  const walk = (node: LayoutNode, rect: PaneRect): void => {
    if (node.type !== "split") {
      boxes.push({ id: node.id, rect });
      return;
    }
    const [first, second] = node.children;
    const [firstSize] = node.sizes;
    if (node.axis === "row") {
      const width = rect.width * firstSize;
      walk(first, { ...rect, width });
      walk(second, {
        x: rect.x + width,
        y: rect.y,
        width: rect.width - width,
        height: rect.height,
      });
      return;
    }
    const height = rect.height * firstSize;
    walk(first, { ...rect, height });
    walk(second, {
      x: rect.x,
      y: rect.y + height,
      width: rect.width,
      height: rect.height - height,
    });
  };
  if (l.root !== null) walk(l.root, { x: 0, y: 0, width: 1, height: 1 });
  return boxes;
}

/**
 * The pane a directional key should land on, or null when there is none.
 *
 * The rule the Settings labels promise, and nothing more: among the panes
 * that lie wholly in the named half-plane, take the nearest; break ties by
 * how much of the perpendicular edge they share. There is deliberately NO
 * wrap — "left" from the leftmost pane is a question with no answer, and
 * teleporting focus to the far side of the screen is not that answer.
 *
 * Ranking, in order:
 *  1. panes that overlap the source on the perpendicular axis, before those
 *     that only touch its corner. (In a fully tiled surface something always
 *     overlaps, so this only decides degenerate cases.)
 *  2. the smallest gap along the axis of travel — the adjacent column/row,
 *     not one behind it.
 *  3. the largest shared perpendicular edge — the pane you are most "in
 *     front of".
 *  4. the closest perpendicular centre.
 *  5. tree order, so a geometric dead heat still resolves the same way every
 *     time. A pane spanning the full height of the surface faces a column
 *     split into two equal halves at exactly equal distance, equal overlap
 *     and equal centre offset; this is what makes that land on the top one
 *     rather than on whichever the array happened to hold first.
 */
export function paneInDirection(
  boxes: readonly PaneBox[],
  from: PaneId,
  dir: FocusDirection,
): PaneId | null {
  const source = boxes.find((box) => box.id === from)?.rect;
  if (source === undefined) return null;
  const horizontal = dir === "left" || dir === "right";
  const forward = dir === "right" || dir === "down";
  const start = (r: PaneRect) => (horizontal ? r.x : r.y);
  const extent = (r: PaneRect) => (horizontal ? r.width : r.height);
  const perpStart = (r: PaneRect) => (horizontal ? r.y : r.x);
  const perpExtent = (r: PaneRect) => (horizontal ? r.height : r.width);

  // A tolerance in the caller's own units, so this works on CSS pixels and on
  // the unit square alike: shared edges are equal in exact arithmetic but not
  // after a flexbox layout, and "wholly to the left of" must not be decided
  // by a rounding error.
  const scale = boxes.reduce((max, box) => Math.max(max, extent(box.rect)), 0);
  const epsilon = Math.max(scale, Number.EPSILON) * 1e-3;

  let best: { id: PaneId; rank: number[] } | undefined;
  for (const [index, box] of boxes.entries()) {
    if (box.id === from) continue;
    const rect = box.rect;
    const gap = forward
      ? start(rect) - (start(source) + extent(source))
      : start(source) - (start(rect) + extent(rect));
    if (gap < -epsilon) continue; // overlaps, or sits behind the source
    const overlap =
      Math.min(
        perpStart(rect) + perpExtent(rect),
        perpStart(source) + perpExtent(source),
      ) - Math.max(perpStart(rect), perpStart(source));
    const centreOffset = Math.abs(
      perpStart(rect) +
        perpExtent(rect) / 2 -
        (perpStart(source) + perpExtent(source) / 2),
    );
    const rank = [
      overlap > epsilon ? 0 : 1,
      gap,
      -overlap,
      centreOffset,
      index,
    ];
    if (best === undefined || compareRanks(rank, best.rank) < 0)
      best = { id: box.id, rank };
  }
  return best?.id ?? null;
}

function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * Moves focus geometrically, in the direction the Settings row names.
 *
 * `measured` is the rendered geometry, keyed by pane id, when the surface has
 * mounted and could measure it; it is used only if EVERY tiled pane has a
 * real, positive-area rect in it. A partial or zero-area measurement (a pane
 * mid-mount, a surface rendered into a detached tree) would silently answer a
 * spatial question with nonsense, so it falls back to the tree's own
 * geometry, which is always available and always ordered correctly.
 *
 * Returns the layout unchanged when nothing lies in that direction. That
 * no-op is the feature: it is what makes the four keys describe the layout
 * instead of cycling through it.
 */
export function moveFocus(
  l: WorkspaceLayout,
  dir: FocusDirection,
  measured?: Readonly<Record<PaneId, PaneRect>>,
): WorkspaceLayout {
  const leaves = tiledPaneIds(l);
  if (leaves.length < 2 || l.focusedPaneId === null) return l;
  if (!leaves.includes(l.focusedPaneId)) return l;
  const boxes = measuredBoxes(leaves, measured) ?? paneRects(l);
  const next = paneInDirection(boxes, l.focusedPaneId, dir);
  if (next === null || next === l.focusedPaneId) return l;
  return { ...l, focusedPaneId: next };
}

function measuredBoxes(
  leaves: readonly PaneId[],
  measured: Readonly<Record<PaneId, PaneRect>> | undefined,
): PaneBox[] | null {
  if (measured === undefined) return null;
  const boxes: PaneBox[] = [];
  for (const id of leaves) {
    const rect = measured[id];
    if (rect === undefined || rect.width <= 0 || rect.height <= 0) return null;
    boxes.push({ id, rect });
  }
  return boxes;
}

export function bindPane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout {
  if (!(id in l.panes)) return l;
  return { ...l, boundPaneId: id };
}

export function tiledPaneIds(l: WorkspaceLayout): PaneId[] {
  return leafIds(l.root);
}

// Sets the sizes of the SplitNode identified by `splitId`, wherever it sits
// in the tree. No-op (returns the layout unchanged) when the split isn't
// found — including when there is no root at all.
export function setSplitSizes(
  l: WorkspaceLayout,
  splitId: SplitId,
  sizes: [number, number],
): WorkspaceLayout {
  if (l.root === null) return l;
  // setNodeSizes returns the tree it was given, by reference, when the split
  // is absent — which is exactly the "leave the layout alone" case here.
  const root = setNodeSizes(l.root, splitId, sizes);
  return root === l.root ? l : { ...l, root };
}
