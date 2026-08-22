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

// Uses in-order leaf order from tiledPaneIds; "left"/"up" move to the
// previous leaf, "right"/"down" move to the next leaf, cyclically. This is
// a linear traversal, not geometric adjacency — a later refinement can walk
// the tree by screen position instead.
export function moveFocus(
  l: WorkspaceLayout,
  dir: FocusDirection,
): WorkspaceLayout {
  const leaves = tiledPaneIds(l);
  if (leaves.length < 2 || l.focusedPaneId === null) return l;
  const index = leaves.indexOf(l.focusedPaneId);
  if (index === -1) return l;
  const forward = dir === "right" || dir === "down";
  const nextIndex = forward
    ? (index + 1) % leaves.length
    : (index - 1 + leaves.length) % leaves.length;
  // nextIndex is always a valid index into leaves (modulo arithmetic over
  // a non-empty array), so the fallback below is unreachable.
  return { ...l, focusedPaneId: leaves[nextIndex] ?? l.focusedPaneId };
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
