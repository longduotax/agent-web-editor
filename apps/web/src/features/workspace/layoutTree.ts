import type { ThreadId } from "@pi-web/contracts";

export type PaneId = string;
export type SplitId = string;
export type SplitAxis = "row" | "column"; // row = split right; column = split down
export type FocusDirection = "left" | "right" | "up" | "down";

export interface PaneNode {
  type: "pane";
  id: PaneId;
}
export interface SplitNode {
  type: "split";
  id: SplitId; // stable identity, independent of position in the tree — used
  // for React keys and as the resize handle, so a split survives a sibling
  // being promoted/removed around it instead of being reused positionally.
  axis: SplitAxis;
  children: [LayoutNode, LayoutNode];
  sizes: [number, number]; // fractions in (0,1) summing to 1
}
export type LayoutNode = PaneNode | SplitNode;

export interface WorkspaceLayout {
  root: LayoutNode | null; // null = no tiled panes
  panes: Record<PaneId, { threadId: ThreadId | null }>; // all panes, all tiled
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
  // Same generator as pane ids; only the field it's stored in (and thus its
  // uniqueness within the tree) matters, not which pool it came from.
  const splitId: SplitId = makeId();
  const root = replaceNode(l.root, target, (pane): LayoutNode => ({
    type: "split",
    id: splitId,
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
  // no longer exists). replaceNode no-ops when its target isn't found, which
  // would silently drop the docked pane being folded in here — so only trust
  // focusedPaneId when it really is a leaf; otherwise fall back to the first
  // leaf, same as when focusedPaneId is absent.
  const target =
    l.focusedPaneId !== null && nodeContains(l.root, l.focusedPaneId)
      ? l.focusedPaneId
      : leafIds(l.root)[0];
  if (target === undefined) return l;
  const splitId: SplitId = `split-${crypto.randomUUID()}`;
  const root = replaceNode(l.root, target, (pane): LayoutNode => ({
    type: "split",
    id: splitId,
    axis: "row",
    children: [pane, { type: "pane", id }],
    sizes: [0.5, 0.5],
  }));
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

  function update(node: LayoutNode): { node: LayoutNode; found: boolean } {
    if (node.type === "pane") return { node, found: false };
    if (node.id === splitId)
      return {
        node: { ...node, sizes: normalizeSizes(sizes) },
        found: true,
      };
    const [a, b] = node.children;
    const ua = update(a);
    const ub = update(b);
    if (!ua.found && !ub.found) return { node, found: false };
    return { node: { ...node, children: [ua.node, ub.node] }, found: true };
  }

  const result = update(l.root);
  return result.found ? { ...l, root: result.node } : l;
}

function normalizeSizes(sizes: [number, number]): [number, number] {
  const clamped: [number, number] = [
    Math.max(sizes[0], MIN_SIZE_FRACTION),
    Math.max(sizes[1], MIN_SIZE_FRACTION),
  ];
  const total = clamped[0] + clamped[1];
  return [clamped[0] / total, clamped[1] / total];
}
