import type { ThreadId } from "@pi-web/contracts";

export type PaneId = string;
export type SplitAxis = "row" | "column"; // row = split right; column = split down
export type FocusDirection = "left" | "right" | "up" | "down";

export interface PaneNode {
  type: "pane";
  id: PaneId;
}
export interface SplitNode {
  type: "split";
  axis: SplitAxis;
  children: [LayoutNode, LayoutNode];
  sizes: [number, number]; // fractions in (0,1) summing to 1
}
export type LayoutNode = PaneNode | SplitNode;

export interface WorkspaceLayout {
  root: LayoutNode | null; // null = no tiled panes
  panes: Record<PaneId, { threadId: ThreadId | null }>; // all panes, tiled + docked
  docked: PaneId[]; // dock order, index 0 = most recently docked
  focusedPaneId: PaneId | null;
  boundPaneId: PaneId | null; // right-panel binding (carried; used in a later phase)
}

const MIN_SIZE_FRACTION = 0.05;

// Returns a new tree with the pane identified by `targetId` replaced by
// whatever `make` returns for it. Every ancestor on the path is rebuilt so
// the result never shares object identity with unrelated nodes' parents.
function replaceNode(
  node: LayoutNode,
  targetId: PaneId,
  make: (p: PaneNode) => LayoutNode,
): LayoutNode {
  if (node.type === "pane") return node.id === targetId ? make(node) : node;
  const children = node.children.map((c) => replaceNode(c, targetId, make)) as [
    LayoutNode,
    LayoutNode,
  ];
  return { ...node, children };
}

// Removes the leaf pane `id` from the tree. When a split loses a child, the
// surviving sibling takes the split's place. Returns null when the whole
// subtree (a single pane) was removed.
function removeLeaf(node: LayoutNode, id: PaneId): LayoutNode | null {
  if (node.type === "pane") return node.id === id ? null : node;
  const [a, b] = node.children;
  const na = removeLeaf(a, id);
  const nb = removeLeaf(b, id);
  if (na === null) return nb; // surviving sibling replaces the split
  if (nb === null) return na;
  return { ...node, children: [na, nb] };
}

// In-order leaf ids, left-to-right / top-to-bottom.
function leafIds(node: LayoutNode | null): PaneId[] {
  if (node === null) return [];
  if (node.type === "pane") return [node.id];
  return [...leafIds(node.children[0]), ...leafIds(node.children[1])];
}

function nodeContains(node: LayoutNode | null, id: PaneId): boolean {
  if (node === null) return false;
  if (node.type === "pane") return node.id === id;
  return (
    nodeContains(node.children[0], id) || nodeContains(node.children[1], id)
  );
}

// Picks the next focus target after a pane leaves the tree: keep the
// previously-focused pane if it's still tiled, else the first tiled pane,
// else null.
function nextFocus(
  root: LayoutNode | null,
  previouslyFocused: PaneId | null,
): PaneId | null {
  if (previouslyFocused !== null && nodeContains(root, previouslyFocused))
    return previouslyFocused;
  return leafIds(root)[0] ?? null;
}

export function createInitialLayout(makeId: () => PaneId): WorkspaceLayout {
  const id = makeId();
  return {
    root: { type: "pane", id },
    panes: { [id]: { threadId: null } },
    docked: [],
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
  if (l.root === null || !nodeContains(l.root, target)) return l;
  const newId = makeId();
  const root = replaceNode(l.root, target, (pane): LayoutNode => ({
    type: "split",
    axis,
    children: [pane, { type: "pane", id: newId }],
    sizes: [0.5, 0.5],
  }));
  return {
    ...l,
    root,
    panes: { ...l.panes, [newId]: { threadId: null } },
    focusedPaneId: newId,
  };
}

function removePane(
  l: WorkspaceLayout,
  id: PaneId,
  keepInPanes: boolean,
): WorkspaceLayout {
  if (l.root === null) return l;
  const root = removeLeaf(l.root, id);
  const focusedPaneId = nextFocus(
    root,
    l.focusedPaneId === id ? null : l.focusedPaneId,
  );
  const panes = keepInPanes
    ? l.panes
    : Object.fromEntries(
        Object.entries(l.panes).filter(([paneId]) => paneId !== id),
      );
  const docked = keepInPanes ? l.docked : l.docked.filter((d) => d !== id);
  const boundPaneId = l.boundPaneId === id ? null : l.boundPaneId;
  return { ...l, root, panes, docked, focusedPaneId, boundPaneId };
}

export function closePane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout {
  return removePane(l, id, false);
}

export function collapsePane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout {
  if (l.root === null || !nodeContains(l.root, id)) return l;
  const collapsed = removePane(l, id, true);
  return { ...collapsed, docked: [id, ...collapsed.docked] };
}

export function restorePane(l: WorkspaceLayout, id: PaneId): WorkspaceLayout {
  if (!l.docked.includes(id)) return l;
  const docked = l.docked.filter((d) => d !== id);
  if (l.root === null) {
    return {
      ...l,
      root: { type: "pane", id },
      docked,
      focusedPaneId: id,
    };
  }
  const target = l.focusedPaneId ?? leafIds(l.root)[0];
  if (target === undefined) return l;
  const root = replaceNode(l.root, target, (pane): LayoutNode => ({
    type: "split",
    axis: "row",
    children: [pane, { type: "pane", id }],
    sizes: [0.5, 0.5],
  }));
  return { ...l, root, docked, focusedPaneId: id };
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

// Sets the sizes of the SplitNode that is the direct parent of `paneId`.
// No-op (returns the layout unchanged) when paneId is the root pane or
// unknown.
export function setPaneParentSizes(
  l: WorkspaceLayout,
  paneId: PaneId,
  sizes: [number, number],
): WorkspaceLayout {
  if (l.root === null || !isParentedPane(l.root, paneId)) return l;

  function updateParent(node: LayoutNode): LayoutNode {
    if (node.type === "pane") return node;
    const [a, b] = node.children;
    if (
      (a.type === "pane" && a.id === paneId) ||
      (b.type === "pane" && b.id === paneId)
    ) {
      return { ...node, sizes: normalizeSizes(sizes) };
    }
    return { ...node, children: [updateParent(a), updateParent(b)] };
  }

  return { ...l, root: updateParent(l.root) };
}

// True when `id` names a leaf pane that has a parent split (i.e. is not the
// sole root pane and does exist in the tree).
function isParentedPane(node: LayoutNode, id: PaneId): boolean {
  if (node.type === "pane") return false;
  const [a, b] = node.children;
  if ((a.type === "pane" && a.id === id) || (b.type === "pane" && b.id === id))
    return true;
  return isParentedPane(a, id) || isParentedPane(b, id);
}

function normalizeSizes(sizes: [number, number]): [number, number] {
  const clamped: [number, number] = [
    Math.max(sizes[0], MIN_SIZE_FRACTION),
    Math.max(sizes[1], MIN_SIZE_FRACTION),
  ];
  const total = clamped[0] + clamped[1];
  return [clamped[0] / total, clamped[1] / total];
}
