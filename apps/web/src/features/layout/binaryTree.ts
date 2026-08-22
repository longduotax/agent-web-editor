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
// adding a new surface with a new tag needs no change here.

export type SplitAxis = "row" | "column"; // row = side by side; column = stacked

export interface TreeLeaf<Tag extends string, Id> {
  type: Tag;
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

// Clamps both fractions to a floor and rescales them to sum to 1, so a
// divider drag can never produce a tile that cannot be grabbed back.
export function normalizeSizes(sizes: [number, number]): [number, number] {
  const clamped: [number, number] = [
    Math.max(sizes[0], MIN_SIZE_FRACTION),
    Math.max(sizes[1], MIN_SIZE_FRACTION),
  ];
  const total = clamped[0] + clamped[1];
  return [clamped[0] / total, clamped[1] / total];
}
