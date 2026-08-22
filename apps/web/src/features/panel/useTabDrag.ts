import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { leafIds } from "../layout/binaryTree.js";
import { groupAccessibleName, panelGroupElementId } from "./TabGroupView.js";
import type { GroupId, PanelState } from "./panelModel.js";
import type { TabId } from "./panelTabs.js";
import {
  DRAG_CANCELLED_MESSAGE,
  dragPickUpMessage,
  dropOutcomeMessage,
  dropTargetMessage,
  moveIndexFor,
  planDrop,
  resolveDropTarget,
  sameDropTarget,
  stripScrollStep,
  type DragPoint,
  type DragRect,
  type DropTarget,
  type GroupZone,
  type StripTabBox,
} from "./tabDrag.js";
import type { PanelActions } from "./usePanelState.js";

// WSP-03's drag, driven by pointer events with pointer capture — the same
// pattern the chat surface's divider drag and the panel's own resize
// separators use (`TilingSurface.tsx`, `PanelTree.tsx`), and deliberately
// NOT the HTML5 drag-and-drop API: that API has no touch support, gives
// almost no control over the drag image, and fires unreliably across nested
// scroll containers, of which the tab strip is now one.
//
// The rules this hook exists to keep, all of them from WSP-03 and WSP-09:
//
//  - A press is not a drag. Nothing happens until the pointer has moved a
//    few pixels, so a plain click still activates a tab and the close
//    affordance still closes one.
//  - Every rectangle is measured ONCE, when the drag begins, and again only
//    if something scrolls or the window resizes underneath it. A drag that
//    re-measures per pointer move does not track the pointer.
//  - A drag that changes nothing dispatches nothing. `panelModel` returns
//    the same state object by reference for a no-op move; dispatching a
//    doomed move anyway would defeat that, so `planDrop` recognises the
//    no-op cases and this hook never asks for them.
//  - Nothing here moves a tab body. `PanelBodies` mounts one body per tab
//    and moves its host element between groups, so a dragged terminal keeps
//    its process for exactly the same reason a chorded one does.

/** How far the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;

export interface TabDragState {
  tabId: TabId;
  /** The dragged tab's title, for the ghost and the announcements. */
  title: string;
  /** What a release here would do, or null over no target at all. */
  target: DropTarget | null;
  /** The rectangles measured when the drag began. */
  zones: readonly GroupZone[];
}

export interface TabDragController {
  drag: TabDragState | null;
  /** The element that follows the pointer while a drag is in progress. */
  ghostRef: RefObject<HTMLDivElement | null>;
  onTabPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    tab: { tabId: TabId; title: string; groupId: GroupId },
  ) => void;
  onTabPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onTabPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onTabPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * True when the click now arriving on `tabId` is the tail of a drag, and
   * must therefore neither activate nor close the tab.
   */
  consumeClick: (tabId: TabId) => boolean;
  /** This group's measured rectangle, for drawing its drop targets. */
  zoneFor: (groupId: GroupId) => GroupZone | undefined;
}

interface Tracking {
  pointerId: number;
  tabId: TabId;
  title: string;
  groupId: GroupId;
  startX: number;
  startY: number;
  /** The tab element, which captured the pointer on the press (G3). */
  element: HTMLElement;
  dragging: boolean;
}

function boxOf(element: Element): DragRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Every visible group's rectangle, its strip band, and its tabs' offsets.
 *
 * Tab offsets are `offsetLeft`/`offsetWidth` rather than client rectangles
 * because they are stated in the strip's own scrolled content coordinates,
 * so they survive the strip scrolling under the drag; the strip's live
 * scroll offset is added back at resolve time.
 */
function measureZones(
  state: PanelState,
  listElements: Map<GroupId, HTMLElement>,
): GroupZone[] {
  listElements.clear();
  const zones: GroupZone[] = [];
  for (const groupId of leafIds(state.root)) {
    const element = document.getElementById(panelGroupElementId(groupId));
    if (element === null) continue;
    const stripElement = element.querySelector(".panel-tabstrip");
    const listElement = element.querySelector(".panel-tab-options");
    let strip: GroupZone["strip"] = null;
    if (stripElement !== null && listElement instanceof HTMLElement) {
      const tabs: StripTabBox[] = [];
      for (const child of listElement.children)
        if (child instanceof HTMLElement) {
          const tabId = child.dataset.panelTab;
          if (tabId !== undefined)
            tabs.push({
              tabId,
              left: child.offsetLeft,
              width: child.offsetWidth,
            });
        }
      strip = {
        rect: boxOf(stripElement),
        list: boxOf(listElement),
        scrollLeft: listElement.scrollLeft,
        tabs,
      };
      listElements.set(groupId, listElement);
    }
    zones.push({ groupId, rect: boxOf(element), strip });
  }
  return zones;
}

/** A group's own accessible name, so an announcement names one of two. */
function groupLabel(state: PanelState, groupId: GroupId): string {
  const order = leafIds(state.root);
  return groupAccessibleName(order.indexOf(groupId) + 1, order.length);
}

export function useTabDrag(
  state: PanelState,
  actions: PanelActions,
): TabDragController {
  const [drag, setDrag] = useState<TabDragState | null>(null);
  const tracking = useRef<Tracking | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const point = useRef<DragPoint>({ x: 0, y: 0 });
  // The measurements and the current target, held as refs as well as state:
  // a pointer move has to read the previous target and write the next one
  // synchronously, and React state is neither.
  const zones = useRef<readonly GroupZone[]>([]);
  const target = useRef<DropTarget | null>(null);
  const listElements = useRef(new Map<GroupId, HTMLElement>());
  const swallowClickFor = useRef<TabId | null>(null);
  // The pointer and key handlers are installed once and close over nothing
  // but refs, so the state they act on is read from here rather than
  // captured — the panel changes shape underneath a drag's own listeners.
  const latest = useRef(state);
  latest.current = state;

  const dragging = drag !== null;

  const positionGhost = () => {
    const ghost = ghostRef.current;
    if (ghost === null) return;
    // A transform rather than left/top: it is composited, so following the
    // pointer costs no layout (WSP-09). The offset keeps the ghost clear of
    // the pointer itself, which is over the drop target being resolved.
    ghost.style.transform = `translate(${String(point.current.x + 12)}px, ${String(point.current.y + 12)}px)`;
  };

  // The ghost is rendered by the panel, so it does not exist until the
  // render that starts the drag has committed; place it before that paint.
  useLayoutEffect(() => {
    if (dragging) positionGhost();
  });

  const liveZones = (): readonly GroupZone[] =>
    zones.current.map((zone) => {
      const list = listElements.current.get(zone.groupId);
      if (zone.strip === null || list === undefined) return zone;
      return {
        ...zone,
        strip: { ...zone.strip, scrollLeft: list.scrollLeft },
      };
    });

  const announceTarget = (next: DropTarget) => {
    const current = latest.current;
    const source = tracking.current;
    const ownGroup = source !== null && next.groupId === source.groupId;
    const length = current.groups[next.groupId]?.tabIds.length ?? 0;
    const at =
      source === null
        ? -1
        : (current.groups[source.groupId]?.tabIds.indexOf(source.tabId) ?? -1);
    actions.announce(
      dropTargetMessage(
        // A strip index counts the strip as it is now, and a tab moving
        // within its own strip has to leave its old place first — so
        // "position 3 of 2" is what an uncorrected index announces.
        next.kind === "strip" && ownGroup
          ? { ...next, index: moveIndexFor(next.index, at < 0 ? null : at) }
          : next,
        {
          groupLabel: groupLabel(current, next.groupId),
          // A tab arriving from another group makes that strip one longer,
          // so "position 3 of 3" counts the tab being dropped.
          stripLength: ownGroup ? length : length + 1,
        },
      ),
    );
  };

  const setTarget = (next: DropTarget | null) => {
    if (sameDropTarget(target.current, next)) return;
    target.current = next;
    setDrag((current) =>
      current === null ? current : { ...current, target: next },
    );
    if (next !== null) announceTarget(next);
  };

  const releaseCapture = (current: Tracking) => {
    const { element, pointerId } = current;
    if (
      typeof element.hasPointerCapture === "function" &&
      typeof element.releasePointerCapture === "function" &&
      element.hasPointerCapture(pointerId)
    )
      element.releasePointerCapture(pointerId);
  };

  const finish = (current: Tracking, announcement: string | null) => {
    releaseCapture(current);
    tracking.current = null;
    zones.current = [];
    target.current = null;
    listElements.current.clear();
    swallowClickFor.current = current.tabId;
    setDrag(null);
    if (announcement !== null) actions.announce(announcement);
  };

  const cancel = () => {
    const current = tracking.current;
    if (current === null) return;
    // Nothing is dispatched, so the state object the panel is rendering is
    // the one it was rendering before the drag — WSP-03's "leaves the layout
    // exactly as it was", by reference rather than by rebuilding an equal
    // one.
    finish(current, current.dragging ? DRAG_CANCELLED_MESSAGE : null);
  };

  const commit = (current: Tracking) => {
    const now = latest.current;
    const chosen = target.current;
    const source = now.groups[current.groupId];
    const plan = planDrop(
      chosen,
      {
        groupId: current.groupId,
        index: source?.tabIds.indexOf(current.tabId) ?? 0,
        groupLength: source?.tabIds.length ?? 0,
      },
      chosen === null ? 0 : (now.groups[chosen.groupId]?.tabIds.length ?? 0),
    );
    const label = groupLabel(
      now,
      plan.kind === "none" ? current.groupId : plan.groupId,
    );
    if (plan.kind === "move")
      actions.moveTab(current.tabId, plan.groupId, plan.index);
    else if (plan.kind === "split")
      actions.splitWithTab(current.tabId, plan.groupId, plan.edge);
    finish(current, dropOutcomeMessage(plan, current.title, label));
  };

  // Escape cancels (WSP-03), and a drag survives neither a scroll nor a
  // resize of the geometry it measured, so both re-measure rather than
  // leaving the drop targets where the groups used to be. Capture phase, so
  // Escape reaches this before anything else treats it as its own.
  useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    const remeasure = () => {
      zones.current = measureZones(latest.current, listElements.current);
      setDrag((current) =>
        current === null ? current : { ...current, zones: zones.current },
      );
      setTarget(resolveDropTarget(point.current, liveZones()));
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  });

  const startDrag = (current: Tracking) => {
    current.dragging = true;
    // The pointer was captured on `pointerdown`, not here (G3).
    zones.current = measureZones(latest.current, listElements.current);
    const next = resolveDropTarget(point.current, zones.current);
    target.current = next;
    setDrag({
      tabId: current.tabId,
      title: current.title,
      target: next,
      zones: zones.current,
    });
    actions.announce(dragPickUpMessage(current.title));
  };

  const autoScrollStrip = () => {
    const zone = liveZones().find(
      (candidate) =>
        candidate.strip !== null &&
        point.current.x >= candidate.strip.rect.left &&
        point.current.x <=
          candidate.strip.rect.left + candidate.strip.rect.width &&
        point.current.y >= candidate.strip.rect.top &&
        point.current.y <=
          candidate.strip.rect.top + candidate.strip.rect.height,
    );
    const strip = zone?.strip ?? null;
    if (zone === undefined || strip === null) return;
    const step = stripScrollStep(strip, point.current.x);
    if (step === 0) return;
    const list = listElements.current.get(zone.groupId);
    // The strip fits two tabs at the panel's minimum width, so a drop index
    // past the end of it is ordinary rather than extreme; without this the
    // user could not reach it.
    if (list !== undefined) list.scrollLeft += step;
  };

  return {
    drag,
    ghostRef,
    onTabPointerDown: (event, tab) => {
      // Secondary buttons open menus; a non-primary pointer is a second
      // finger, which must not start a second drag.
      if (event.button !== 0 || !event.isPrimary) return;
      swallowClickFor.current = null;
      // Captured HERE, on the press, rather than once the threshold is
      // crossed (G3). `onTabPointerMove` is bound to the tab, so before this
      // the first move had to land on the tab to be delivered at all — and a
      // tab is 78 x 43px, so a flick at about 1300px/s left its box in one
      // event, no move ever reached the handler, and the whole gesture was
      // silently dropped: no announcement, no drop zones, no layout change.
      // Capturing on the press makes every subsequent move this tab's,
      // wherever the pointer is. The 4px threshold below is untouched, and
      // is what still protects a plain click; the capture is released again
      // on a release that never became a drag.
      if (typeof event.currentTarget.setPointerCapture === "function")
        event.currentTarget.setPointerCapture(event.pointerId);
      tracking.current = {
        pointerId: event.pointerId,
        tabId: tab.tabId,
        title: tab.title,
        groupId: tab.groupId,
        startX: event.clientX,
        startY: event.clientY,
        element: event.currentTarget,
        dragging: false,
      };
      point.current = { x: event.clientX, y: event.clientY };
    },
    onTabPointerMove: (event) => {
      const current = tracking.current;
      if (current?.pointerId !== event.pointerId) return;
      point.current = { x: event.clientX, y: event.clientY };
      if (!current.dragging) {
        // WSP-03 says nothing about a threshold; the users of every tab
        // strip do. Without one, the smallest tremor during a click starts a
        // drag, and a tab that sometimes does not activate when clicked is a
        // worse defect than no drag at all.
        if (
          Math.abs(event.clientX - current.startX) < DRAG_THRESHOLD_PX &&
          Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD_PX
        )
          return;
        startDrag(current);
        return;
      }
      positionGhost();
      autoScrollStrip();
      setTarget(resolveDropTarget(point.current, liveZones()));
    },
    onTabPointerUp: (event) => {
      const current = tracking.current;
      if (current?.pointerId !== event.pointerId) return;
      if (!current.dragging) {
        // A press that never became a drag: the click that follows is a
        // plain click and belongs to the tab, so the capture taken on the
        // press is given back.
        releaseCapture(current);
        tracking.current = null;
        return;
      }
      commit(current);
    },
    onTabPointerCancel: (event) => {
      if (tracking.current?.pointerId !== event.pointerId) return;
      cancel();
    },
    consumeClick: (tabId) => {
      if (swallowClickFor.current !== tabId) return false;
      swallowClickFor.current = null;
      return true;
    },
    zoneFor: (groupId) => drag?.zones.find((zone) => zone.groupId === groupId),
  };
}
