import {
  dropRefusalMessage,
  movedTabMessage,
  splitOutcomeMessage,
  EDGE_WORDS,
  type DropRefusal,
} from "./panelAnnouncements.js";
import type { GroupId, PanelEdge } from "./panelModel.js";
import type { TabId } from "./panelTabs.js";

// The arithmetic behind WSP-03's drag: which rectangle a point is in, which
// region of that rectangle, and what the model should therefore be asked to
// do. All of it is pure, and none of it touches the DOM — `useTabDrag`
// measures, this decides. Two reasons, both learned the hard way on this
// feature: jsdom reports every rectangle as zero, so a component test cannot
// exercise geometry at all; and a drag that recomputes rectangles per
// pointer move does not track the pointer (WSP-09), so the measurements are
// taken once and this module reads a snapshot rather than the page.

export interface DragPoint {
  x: number;
  y: number;
}

/** A measured box in viewport coordinates. */
export interface DragRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One tab's box, in the strip's own scrolled content coordinates. */
export interface StripTabBox {
  tabId: TabId;
  left: number;
  width: number;
}

export interface StripZone {
  /**
   * The whole strip band, including the `+` and close controls: dropping
   * anywhere along the strip is a strip drop, which is what "large enough to
   * hit without precision" means here.
   */
  rect: DragRect;
  /** The scrolling tab list inside that band. */
  list: DragRect;
  /**
   * How far that list is scrolled. Read live rather than snapshotted: the
   * strip scrolls during a drag, both from the drag's own edge scrolling and
   * from the active tab being scrolled into view.
   */
  scrollLeft: number;
  tabs: readonly StripTabBox[];
}

export interface GroupZone {
  groupId: GroupId;
  rect: DragRect;
  /** Null only for a group whose strip could not be measured. */
  strip: StripZone | null;
}

export type DropTarget =
  | { kind: "strip"; groupId: GroupId; index: number }
  | { kind: "centre"; groupId: GroupId }
  | { kind: "edge"; groupId: GroupId; edge: PanelEdge };

/**
 * How thick an edge drop target is.
 *
 * A percentage alone is wrong at the sizes this panel actually reaches: the
 * panel's minimum outer width is 280px and a group's floor is 240px wide by
 * 160px tall (`panelGeometry`), where 15% of the short side is 24px — a
 * band a pointer has to be aimed at. So the fraction has a pixel floor, and
 * WSP-03's "large enough to hit without precision" is met at every size the
 * panel allows rather than only at comfortable ones.
 *
 * The ceiling is the other half of the same problem: four bands and a centre
 * share one box, and in a short group two 32px bands would meet in the
 * middle and leave no centre — the target that means "move into this group"
 * — at all. Capping each band at 35% of its own axis keeps at least 30% of
 * the group as centre whatever its size.
 */
export const EDGE_BAND_FRACTION = 0.15;
export const EDGE_BAND_MIN_PX = 32;
export const EDGE_BAND_MAX_FRACTION = 0.35;

/** How thick this group's horizontal and vertical edge bands are. */
export function edgeBands(rect: DragRect): { x: number; y: number } {
  const base = Math.max(
    EDGE_BAND_FRACTION * Math.min(rect.width, rect.height),
    EDGE_BAND_MIN_PX,
  );
  return {
    x: Math.min(base, rect.width * EDGE_BAND_MAX_FRACTION),
    y: Math.min(base, rect.height * EDGE_BAND_MAX_FRACTION),
  };
}

function contains(rect: DragRect, point: DragPoint): boolean {
  return (
    point.x >= rect.left &&
    point.x < rect.left + rect.width &&
    point.y >= rect.top &&
    point.y < rect.top + rect.height
  );
}

/**
 * Which edge band the point is in, or null for the centre.
 *
 * A corner is inside two bands at once, so the nearer edge wins — nearer in
 * proportion to its own band, since the horizontal and vertical bands are
 * different thicknesses in a group that is not square.
 */
function edgeAt(rect: DragRect, point: DragPoint): PanelEdge | null {
  const bands = edgeBands(rect);
  if (bands.x <= 0 || bands.y <= 0) return null;
  const candidates: { edge: PanelEdge; ratio: number }[] = [
    { edge: "left", ratio: (point.x - rect.left) / bands.x },
    { edge: "right", ratio: (rect.left + rect.width - point.x) / bands.x },
    { edge: "top", ratio: (point.y - rect.top) / bands.y },
    { edge: "bottom", ratio: (rect.top + rect.height - point.y) / bands.y },
  ];
  let nearest: { edge: PanelEdge; ratio: number } | null = null;
  for (const candidate of candidates)
    if (
      candidate.ratio < 1 &&
      (nearest === null || candidate.ratio < nearest.ratio)
    )
      nearest = candidate;
  return nearest === null ? null : nearest.edge;
}

/**
 * The part of a group the edges and the centre share: everything below its
 * tab strip.
 *
 * The strip is a drop target in its own right and it is about 40px tall,
 * while the top band has a 32px floor, so the two would otherwise overlap
 * almost exactly. Giving the strip priority alone is not enough — that would
 * leave the top edge with whatever few pixels the strip did not cover, or
 * with none at all in a short group, and WSP-03 asks for four edges that can
 * each be hit without precision. So the strip is taken off the top first and
 * the four edges divide what is left, which is also exactly what the overlay
 * draws.
 */
export function contentRect(zone: GroupZone): DragRect {
  const stripHeight = zone.strip === null ? 0 : zone.strip.rect.height;
  return {
    left: zone.rect.left,
    top: zone.rect.top + stripHeight,
    width: zone.rect.width,
    height: zone.rect.height - stripHeight,
  };
}

/**
 * The drop target under the pointer, or null when it is over none — which
 * WSP-03 requires to leave the layout exactly as it was.
 */
export function resolveDropTarget(
  point: DragPoint,
  zones: readonly GroupZone[],
): DropTarget | null {
  const zone = zones.find((candidate) => contains(candidate.rect, point));
  if (zone === undefined) return null;
  if (zone.strip !== null && contains(zone.strip.rect, point))
    return {
      kind: "strip",
      groupId: zone.groupId,
      index: stripInsertIndex(zone.strip, point.x),
    };
  const body = contentRect(zone);
  const edge = edgeAt(body, point);
  if (edge !== null) return { kind: "edge", groupId: zone.groupId, edge };
  return { kind: "centre", groupId: zone.groupId };
}

/** Where in the strip a drop at viewport `x` would insert the tab. */
export function stripInsertIndex(strip: StripZone, x: number): number {
  const offset = x - strip.list.left + strip.scrollLeft;
  let index = 0;
  for (const tab of strip.tabs) {
    if (offset < tab.left + tab.width / 2) break;
    index += 1;
  }
  return index;
}

/** Where the insertion caret is drawn, in the strip's content coordinates. */
export function stripCaretOffset(strip: StripZone, index: number): number {
  const before = strip.tabs[index];
  if (before !== undefined) return before.left;
  const last = strip.tabs[strip.tabs.length - 1];
  return last === undefined ? 0 : last.left + last.width;
}

/**
 * How far to scroll the strip this move, so a drop index off the end of an
 * overflowing strip is reachable. At the panel's minimum width the strip
 * fits two tabs, so this is the ordinary case rather than an extreme one.
 */
export const STRIP_SCROLL_EDGE_PX = 28;
export const STRIP_SCROLL_STEP_PX = 12;

export function stripScrollStep(strip: StripZone, x: number): number {
  if (x - strip.list.left < STRIP_SCROLL_EDGE_PX) return -STRIP_SCROLL_STEP_PX;
  if (strip.list.left + strip.list.width - x < STRIP_SCROLL_EDGE_PX)
    return STRIP_SCROLL_STEP_PX;
  return 0;
}

/**
 * The index `moveTab` wants, given the index the pointer is pointing at.
 *
 * `moveTab` addresses the target strip as it will be *after* the tab has
 * left its old position, so a within-strip move to a later position is one
 * short of where the pointer is.
 */
export function moveIndexFor(
  insertIndex: number,
  currentIndex: number | null,
): number {
  return currentIndex !== null && currentIndex < insertIndex
    ? insertIndex - 1
    : insertIndex;
}

/** What a release on a target should ask the model to do. */
export type DropPlan =
  | { kind: "move"; groupId: GroupId; index: number }
  | { kind: "split"; groupId: GroupId; edge: PanelEdge }
  /**
   * Nothing — and WHY nothing, because the drag now has to know that before
   * it highlights the target rather than after it has been released on it
   * (G4). A refused target is drawn as refused and says its reason; it used
   * to highlight and announce exactly as an actionable one does, and then
   * answer the release with "Nothing moved."
   */
  | { kind: "none"; reason: DropRefusal };

/**
 * Turns a target into a model call, or into nothing at all.
 *
 * The "nothing at all" cases are the point of this function. WSP-03 requires
 * a drag that changes nothing to leave the layout *exactly* as it was, and
 * the model already guarantees that by returning the same state object by
 * reference for a no-op move. The UI defeats that guarantee if it dispatches
 * anyway and something downstream rebuilds an equal-but-different state, so
 * the cases the model would refuse are recognised here and never dispatched.
 */
export function planDrop(
  target: DropTarget | null,
  source: { groupId: GroupId; index: number; groupLength: number },
  targetGroupLength: number,
): DropPlan {
  if (target === null) return { kind: "none", reason: "no-target" };
  const ownGroup = target.groupId === source.groupId;
  switch (target.kind) {
    case "centre":
      // WSP-03 names this one explicitly: a tab dropped on the centre of the
      // group it is already in has arrived where it already is.
      return ownGroup
        ? { kind: "none", reason: "already-there" }
        : { kind: "move", groupId: target.groupId, index: targetGroupLength };
    case "strip": {
      const index = moveIndexFor(target.index, ownGroup ? source.index : null);
      return ownGroup && index === source.index
        ? { kind: "none", reason: "already-there" }
        : { kind: "move", groupId: target.groupId, index };
    }
    case "edge":
      // The model refuses to split a group with its own only tab: the tab
      // would leave the old half empty and the new half would hold exactly
      // what the old one showed.
      return ownGroup && source.groupLength === 1
        ? { kind: "none", reason: "split-needs-two-tabs" }
        : { kind: "split", groupId: target.groupId, edge: target.edge };
  }
}

export function sameDropTarget(
  a: DropTarget | null,
  b: DropTarget | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind || a.groupId !== b.groupId) return false;
  if (a.kind === "strip" && b.kind === "strip") return a.index === b.index;
  if (a.kind === "edge" && b.kind === "edge") return a.edge === b.edge;
  return true;
}

// WSP-10's announcements. A pointer drag is invisible to a screen reader
// unless it is narrated, so the pick-up, every change of target, and the
// outcome each go to the panel's one live region.

export const DRAG_CANCELLED_MESSAGE = "Drag cancelled. Nothing moved.";
export const DRAG_UNCHANGED_MESSAGE = "Nothing moved.";

/**
 * The pick-up, and what the pointer is already over.
 *
 * They are one sentence because they are one moment. Announcing the pick-up
 * and then the first target as two messages means the second overwrites the
 * first before a live region has read it, which is why the first target
 * after a pick-up was never announced at all (G5): `startDrag` assigned the
 * target directly and never spoke it, and a drag straight out of the panel
 * produced two messages in total, the pick-up and "Nothing moved."
 */
export function dragPickUpMessage(
  title: string,
  target: string | null,
): string {
  return target === null
    ? `Dragging ${title}. Move it over a tab group, or press Escape to cancel.`
    : `Dragging ${title}. ${target} Press Escape to cancel.`;
}

/** What the live region says about the target the pointer is over. */
export function dropAnnouncement(
  plan: DropPlan,
  target: DropTarget | null,
  label: DropTargetLabel,
): string {
  if (plan.kind === "none") return dropRefusalMessage(plan.reason);
  return target === null
    ? DRAG_UNCHANGED_MESSAGE
    : dropTargetMessage(target, label);
}

export interface DropTargetLabel {
  /** The target group's own accessible name, so two groups are told apart. */
  groupLabel: string;
  /** How many tabs the target strip holds, for "position 2 of 3". */
  stripLength: number;
}

export function dropTargetMessage(
  target: DropTarget,
  label: DropTargetLabel,
): string {
  switch (target.kind) {
    case "strip":
      return `Drop into ${label.groupLabel} tab strip, position ${String(
        target.index + 1,
      )} of ${String(label.stripLength)}.`;
    case "centre":
      return `Drop into ${label.groupLabel}.`;
    case "edge":
      return `Split ${label.groupLabel} ${EDGE_WORDS[target.edge]}.`;
  }
}

export function dropOutcomeMessage(
  plan: DropPlan,
  title: string,
  label: { groupLabel: string; sameGroup: boolean; stripLength: number },
): string {
  switch (plan.kind) {
    case "move":
      return movedTabMessage(title, {
        groupLabel: label.groupLabel,
        sameGroup: label.sameGroup,
        index: plan.index,
        stripLength: label.stripLength,
      });
    case "split":
      return splitOutcomeMessage(title, label.groupLabel, plan.edge);
    case "none":
      return DRAG_UNCHANGED_MESSAGE;
  }
}
