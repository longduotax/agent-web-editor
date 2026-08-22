import {
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type { TreeNode } from "../layout/binaryTree.js";
import type { GroupId, PanelState } from "./panelModel.js";
import { TabGroupView } from "./TabGroupView.js";
import type { TabContext } from "./panelTabs.js";
import type { PanelActions } from "./usePanelState.js";

// The panel's own tiling tree (WSP-01). A sibling of the chat surface's
// `TilingSurface`, deliberately: same geometry module, same divider
// affordance, same keyboard resize. What differs is only what a leaf holds.

// Smallest fraction either side of a split may shrink to by pointer or
// keyboard. The model clamps further (0.05); this is the more generous floor
// the interaction uses, exactly as the chat surface does.
const MIN_FRACTION = 0.1;
const RESIZE_STEP = 0.05;

export interface PanelTreeProps {
  node: TreeNode<"group", GroupId>;
  state: PanelState;
  actions: PanelActions;
  focusRequest: number;
  focusedContext: TabContext | null;
  panelVisible: boolean;
  /** The group that carries the panel's single close control. */
  closeControlGroupId: GroupId | null;
  onClosePanel: () => void;
}

export function PanelTree(props: PanelTreeProps): JSX.Element | null {
  const { node, state } = props;
  if (node.type !== "split") {
    const group = state.groups[node.id];
    if (group === undefined) return null;
    return (
      <TabGroupView
        group={group}
        tabs={state.tabs}
        actions={props.actions}
        focused={state.focusedGroupId === node.id}
        focusRequest={props.focusRequest}
        focusedContext={props.focusedContext}
        panelVisible={props.panelVisible}
        onClosePanel={
          props.closeControlGroupId === node.id ? props.onClosePanel : undefined
        }
      />
    );
  }
  return <SplitRegion {...props} node={node} />;
}

function SplitRegion(
  props: PanelTreeProps & {
    node: Extract<PanelTreeProps["node"], { type: "split" }>;
  },
): JSX.Element {
  const { node, actions } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingPointer = useRef<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const [first, second] = node.children;
  const [firstSize, secondSize] = node.sizes;
  const vertical = node.axis === "row"; // a vertical divider between side-by-side groups

  const applyFraction = (fraction: number) => {
    const clamped = Math.min(
      1 - MIN_FRACTION,
      Math.max(MIN_FRACTION, fraction),
    );
    actions.resizeGroups(node.id, [clamped, 1 - clamped]);
  };

  const resizeFromPointer = (clientX: number, clientY: number) => {
    const element = containerRef.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const fraction = vertical
      ? (clientX - rect.left) / rect.width
      : (clientY - rect.top) / rect.height;
    applyFraction(fraction);
  };

  const finishResize = (element: HTMLDivElement, pointerId: number) => {
    resizingPointer.current = null;
    if (
      typeof element.hasPointerCapture === "function" &&
      typeof element.releasePointerCapture === "function" &&
      element.hasPointerCapture(pointerId)
    )
      element.releasePointerCapture(pointerId);
    setResizing(false);
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const forwardKey = vertical ? "ArrowRight" : "ArrowDown";
    const backwardKey = vertical ? "ArrowLeft" : "ArrowUp";
    let nextFirst: number | undefined;
    if (event.key === forwardKey) nextFirst = firstSize + RESIZE_STEP;
    else if (event.key === backwardKey) nextFirst = firstSize - RESIZE_STEP;
    else if (event.key === "Home") nextFirst = MIN_FRACTION;
    else if (event.key === "End") nextFirst = 1 - MIN_FRACTION;
    if (nextFirst === undefined) return;
    event.preventDefault();
    applyFraction(nextFirst);
  };

  return (
    <div ref={containerRef} className={`panel-split panel-split-${node.axis}`}>
      <div
        className="panel-split-child"
        style={{ flexGrow: firstSize, flexBasis: 0 }}
      >
        <PanelTree {...props} key={first.id} node={first} />
      </div>
      <div
        className={`panel-divider ${resizing ? "resizing" : ""}`}
        role="separator"
        aria-label="Resize panel groups"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(MIN_FRACTION * 100)}
        aria-valuemax={Math.round((1 - MIN_FRACTION) * 100)}
        aria-valuenow={Math.round(firstSize * 100)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          resizingPointer.current = event.pointerId;
          if (typeof event.currentTarget.setPointerCapture === "function")
            event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (resizingPointer.current === event.pointerId)
            resizeFromPointer(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          finishResize(event.currentTarget, event.pointerId);
        }}
        onPointerCancel={(event) => {
          finishResize(event.currentTarget, event.pointerId);
        }}
        onKeyDown={resizeWithKeyboard}
      />
      <div
        className="panel-split-child"
        style={{ flexGrow: secondSize, flexBasis: 0 }}
      >
        <PanelTree {...props} key={second.id} node={second} />
      </div>
    </div>
  );
}
