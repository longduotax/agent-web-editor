// Pure binary tiling tree, shared by every surface that tiles.
//
// The chat surface (`features/workspace/layoutTree.ts`) and the workspace
// panel (`features/panel/panelModel.ts`) tile the same way but hold different
// leaves, and both persist their trees under their own storage keys. So the
// tree is generic over the leaf's discriminant tag and id type: the chat
// surface keeps its `{ type: "pane" }` leaves — whose shape is already on
// disk in users' browsers — while the panel uses `{ type: "group" }`.
//
// Every narrowing below is on `type === "split"`, never on the leaf tag, so
// adding a new surface with a new tag needs no change here — provided that
// tag is not itself "split", which is the one thing a new surface must not
// choose. `LeafTag` makes that a compile error rather than a convention.

export type SplitAxis = "row" | "column"; // row = side by side; column = stacked

/**
 * A leaf's tag, which may never be "split".
 *
 * Every narrowing in this module is on `type === "split"`, so a surface that
 * tagged its leaves "split" would have `isSplit` classify a leaf as a split
 * and `const [a, b] = node.children` throw on a node that has no children.
 * The rule is enforced rather than documented: `LeafTag<"split">` is `never`,
 * so no leaf of a `TreeNode<"split", Id>` can be constructed.
 */
export type LeafTag<Tag extends string> = Tag extends "split" ? never : Tag;

export interface TreeLeaf<Tag extends string, Id> {
  type: LeafTag<Tag>;
  id: Id;
}

export interface TreeSplit<Tag extends string, Id> {
  type: "split";
  id: string; // stable identity, independent of position in the tree — used
  // for React keys and as the resize handle, so a split survives a sibling
  // being promoted/removed around it instead of being reused positionally.
  axis: SplitAxis;
  children: [TreeNode<Tag, Id>, TreeNode<Tag, Id>];
  sizes: [number, number]; // fractions in (0,1) summing to 1
}

export type TreeNode<Tag extends string, Id> =
  TreeLeaf<Tag, Id> | TreeSplit<Tag, Id>;

// A divider can never squeeze a tile below this fraction of its parent: a
// tile at 0 would be unreachable by pointer, so the user could not get it
// back.
export const MIN_SIZE_FRACTION = 0.05;

// `Tag` is an unresolved type parameter, so `node.type === "split"` alone
// cannot discriminate the union (TypeScript cannot prove `Tag` excludes
// "split"). This predicate does the narrowing once, in one place.
function isSplit<Tag extends string, Id>(
  node: TreeNode<Tag, Id>,
): node is TreeSplit<Tag, Id> {
  return node.type === "split";
}

// Returns a new tree with the leaf identified by `targetId` replaced by
// whatever `make` returns for it. Only the ancestors on the path to that
// leaf are rebuilt; every subtree that contained no match is returned by
// reference, so React can bail out of re-rendering unrelated tiles. When the
// target is not a leaf of `node` (including when it names a split), the
// original tree is returned unchanged, by reference.
export function replaceLeaf<Tag extends string, Id>(
  node: TreeNode<Tag, Id>,
  targetId: Id,
  make: (leaf: TreeLeaf<Tag, Id>) => TreeNode<Tag, Id>,
): TreeNode<Tag, Id> {
  if (!isSplit(node)) return node.id === targetId ? make(node) : node;
  const [a, b] = node.children;
  const na = replaceLeaf(a, targetId, make);
  const nb = replaceLeaf(b, targetId, make);
  if (na === a && nb === b) return node;
  return { ...node, children: [na, nb] };
}

// Replaces the leaf `targetId` with a split holding that leaf and
// `options.leaf`, ordered by `options.side`: "before" puts the new leaf
// left/above the original, "after" puts it right/below. No-op (by reference)
// when the target is not a leaf of the tree.
export interface SplitLeafOptions<Tag extends string, Id> {
  splitId: string;
  axis: SplitAxis;
  leaf: TreeLeaf<Tag, Id>;
  side: "before" | "after";
}

export function splitLeaf<Tag extends string, Id>(
  node: TreeNode<Tag, Id>,
  targetId: Id,
  options: SplitLeafOptions<Tag, Id>,
): TreeNode<Tag, Id> {
  const { splitId, axis, leaf, side } = options;
  return replaceLeaf(node, targetId, (target) => ({
    type: "split",
    id: splitId,
    axis,
    children: side === "before" ? [leaf, target] : [target, leaf],
    sizes: [0.5, 0.5],
  }));
}

// Removes the leaf `id` from the tree. When a split loses a child, the
// surviving sibling takes the split's place — a split with one child would
// render as a divider with nothing on one side of it. Returns null when the
// whole subtree was removed, and the identical tree when `id` is absent.
export function removeLeaf<Tag extends string, Id>(
  node: TreeNode<Tag, Id>,
  id: Id,
): TreeNode<Tag, Id> | null {
  if (!isSplit(node)) return node.id === id ? null : node;
  const [a, b] = node.children;
  const na = removeLeaf(a, id);
  const nb = removeLeaf(b, id);
  if (na === null) return nb; // surviving sibling replaces the split
  if (nb === null) return na;
  if (na === a && nb === b) return node;
  return { ...node, children: [na, nb] };
}

// In-order leaf ids: left-to-right for row splits, top-to-bottom for column
// splits, which is the order the leaves appear on screen.
export function leafIds<Tag extends string, Id>(
  node: TreeNode<Tag, Id> | null,
): Id[] {
  if (node === null) return [];
  if (!isSplit(node)) return [node.id];
  return [...leafIds(node.children[0]), ...leafIds(node.children[1])];
}

export function containsLeaf<Tag extends string, Id>(
  node: TreeNode<Tag, Id> | null,
  id: Id,
): boolean {
  if (node === null) return false;
  if (!isSplit(node)) return node.id === id;
  return (
    containsLeaf(node.children[0], id) || containsLeaf(node.children[1], id)
  );
}

// Sets the sizes of the split identified by `splitId`, wherever it sits in
// the tree, normalizing them first. Returns the identical tree when the
// split is not found — and when the normalized sizes are the ones it
// already has — so callers can detect a miss, or a drag that ended where it
// started, by reference.
export function setSplitSizes<Tag extends string, Id>(
  node: TreeNode<Tag, Id>,
  splitId: string,
  sizes: [number, number],
): TreeNode<Tag, Id> {
  if (!isSplit(node)) return node;
  if (node.id === splitId) {
    const next = normalizeSizes(sizes);
    if (next[0] === node.sizes[0] && next[1] === node.sizes[1]) return node;
    return { ...node, sizes: next };
  }
  const [a, b] = node.children;
  const na = setSplitSizes(a, splitId, sizes);
  const nb = setSplitSizes(b, splitId, sizes);
  if (na === a && nb === b) return node;
  return { ...node, children: [na, nb] };
}

// Turns a pair into shares of 1 and holds each of them at a floor, so a
// divider drag — or a stored pair from anywhere — can never produce a tile
// that cannot be grabbed back.
//
// Rescale FIRST, then clamp. Clamping the raw pair and rescaling afterwards
// divided the floor away again: `[-5, 900]` clamped to `[0.05, 900]` and
// normalised to ~5.6e-5, so the "floor" bounded nothing (F6). It also
// inflated small shares — `[0.001, 0.2]`, a half-percent share, came out as
// a fifth of the split. Clamping the share is what makes the number mean
// what its name says.
export function normalizeSizes(sizes: [number, number]): [number, number] {
  const total = sizes[0] + sizes[1];
  // A pair that says nothing about the ratio — zeroes, or anything not a
  // number — is an even split rather than an arbitrary one.
  const share =
    Number.isFinite(total) && total > 0 && Number.isFinite(sizes[0])
      ? sizes[0] / total
      : 0.5;
  const first = Math.min(
    1 - MIN_SIZE_FRACTION,
    Math.max(MIN_SIZE_FRACTION, share),
  );
  return [first, 1 - first];
}
