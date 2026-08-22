import type { TreeNode } from "../layout/binaryTree.js";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./panelModel.js";
import type { GroupId } from "./panelModel.js";

// How wide the panel is allowed to be, given what else has to fit on the
// row. The model clamps to an absolute ceiling, which alone would let the
// panel be dragged wider than the window and squash the chat surface to
// nothing; the real ceiling depends on the viewport, so it lives here rather
// than in the pure model.

/** The sidebar's fixed desktop width (see `.workspace` in styles.css). */
export const DESKTOP_SIDEBAR_WIDTH = 272;
/** Below this a chat pane cannot show a message and its composer. */
export const MIN_THREAD_WIDTH = 360;
/** One arrow-key press on the panel's resize separator. */
export const PANEL_RESIZE_STEP = 24;

export function panelMaxWidth(viewportWidth: number): number {
  return Math.min(
    PANEL_MAX_WIDTH,
    Math.max(
      PANEL_MIN_WIDTH,
      viewportWidth - DESKTOP_SIDEBAR_WIDTH - MIN_THREAD_WIDTH,
    ),
  );
}

/**
 * A stored or dragged width, brought inside what the viewport can carry.
 * Applied both when resizing and when rendering a restored width, because a
 * record written on a wide monitor is read on a narrow one.
 */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return PANEL_MIN_WIDTH;
  return Math.min(
    panelMaxWidth(viewportWidth),
    Math.max(PANEL_MIN_WIDTH, Math.round(width)),
  );
}

/**
 * The smallest a tab group may be drawn, in pixels (F6, WSP-04).
 *
 * The panel had a minimum outer width but bounded its groups only by
 * `MIN_FRACTION`, which is a proportion and therefore no floor at all: at
 * `PANEL_MIN_WIDTH` split in two, each group was 139px wide and the terminal
 * in one of them negotiated `{ columns: 16, rows: 73 }`. WSP-04 says the
 * panel "never shrinks a group into an unreadable state", so the floor is
 * stated in the unit the user experiences.
 *
 * The width is what a tab strip needs to show a title beside its `+` and
 * close controls, and what a terminal needs to be worth reading. The height
 * is the strip, the unsandboxed-shell warning, and enough rows under them to
 * be a terminal rather than a slot.
 */
export const PANEL_MIN_GROUP_WIDTH = 240;
export const PANEL_MIN_GROUP_HEIGHT = 160;

/**
 * How small a subtree of groups may be drawn.
 *
 * Along a split's own axis the halves sit end to end, so their minimums add;
 * across it they overlap, so the larger wins. The dividers cost nothing:
 * `.panel-divider` is 10px with -5px margins, so its layout contribution is
 * zero by construction.
 *
 * The panel then SCROLLS rather than shrinking past this, which is exactly
 * what the chat surface does (`MIN_PANE_WIDTH_PX` and `.tiling-surface`'s
 * `overflow-x: auto`). Following that precedent rather than refusing the
 * split keeps one behaviour in the product for one problem, and keeps a
 * split from being a chord that sometimes silently does nothing.
 */
export function treeMinWidth(node: TreeNode<"group", GroupId> | null): number {
  if (node === null) return 0;
  if (node.type !== "split") return PANEL_MIN_GROUP_WIDTH;
  const [first, second] = node.children;
  const a = treeMinWidth(first);
  const b = treeMinWidth(second);
  return node.axis === "row" ? a + b : Math.max(a, b);
}

export function treeMinHeight(node: TreeNode<"group", GroupId> | null): number {
  if (node === null) return 0;
  if (node.type !== "split") return PANEL_MIN_GROUP_HEIGHT;
  const [first, second] = node.children;
  const a = treeMinHeight(first);
  const b = treeMinHeight(second);
  return node.axis === "column" ? a + b : Math.max(a, b);
}
