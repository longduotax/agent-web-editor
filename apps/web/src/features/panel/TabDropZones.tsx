import type { CSSProperties, JSX } from "react";

import type { GroupId, PanelEdge } from "./panelModel.js";
import {
  contentRect,
  edgeBands,
  type DropTarget,
  type GroupZone,
} from "./tabDrag.js";

// The five drop targets a group offers while a tab is being dragged over the
// panel (WSP-03): its four edges, which split it, and its centre, which
// moves the tab into it. Mounted only during a drag, and only ever a picture
// of it — the drag resolves its target from the measurements in `tabDrag`,
// never by hit-testing these elements, so what the user sees and what a
// release does are computed from the same numbers and cannot drift.
//
// `aria-hidden`, deliberately. These are not operable: they exist only while
// a pointer is down and vanish when it lifts, so exposing them as controls
// would advertise a route assistive technology cannot take. The labelled,
// reachable route WSP-10 asks for is the chord set — reorder, move, split —
// and the drag itself is narrated through the panel's live region as it
// crosses each of these.

const EDGES: readonly PanelEdge[] = ["top", "bottom", "left", "right"];

export function TabDropZones({
  groupId,
  zone,
  target,
}: {
  groupId: GroupId;
  /**
   * This group's rectangle as the drag measured it, or undefined when it
   * could not be measured — in which case there is nothing to draw.
   */
  zone: GroupZone | undefined;
  target: DropTarget | null;
}): JSX.Element | null {
  if (zone === undefined) return null;
  const body = contentRect(zone);
  const bands = edgeBands(body);
  const active = target !== null && target.groupId === groupId ? target : null;
  return (
    <div
      className="panel-drop-zones"
      aria-hidden="true"
      // The strip is its own drop target and is excluded from the edges, so
      // the overlay starts where the strip ends.
      style={{ top: body.top - zone.rect.top }}
    >
      {EDGES.map((edge) => (
        <div
          key={edge}
          className={`panel-drop-edge panel-drop-${edge} ${
            active?.kind === "edge" && active.edge === edge ? "active" : ""
          }`}
          style={edgeStyle(edge, bands)}
        />
      ))}
      <div
        className={`panel-drop-centre ${
          active?.kind === "centre" ? "active" : ""
        }`}
        style={{
          top: bands.y,
          bottom: bands.y,
          left: bands.x,
          right: bands.x,
        }}
      />
    </div>
  );
}

// Sized from the same `edgeBands` the resolver uses, and in pixels rather
// than percentages: the band has a pixel floor and a ceiling, so a
// percentage would draw a different shape from the one that is hit.
function edgeStyle(
  edge: PanelEdge,
  bands: { x: number; y: number },
): CSSProperties {
  if (edge === "top" || edge === "bottom") return { height: bands.y };
  return { width: bands.x, top: bands.y, bottom: bands.y };
}
