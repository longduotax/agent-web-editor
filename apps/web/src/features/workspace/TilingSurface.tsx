import {
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

import type { LayoutNode, PaneId, SplitId, SplitNode } from "./layoutTree.js";
import { tiledPaneIds } from "./layoutTree.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";
import { ThreadPane } from "./ThreadPane.js";
import { NewChatPane } from "./NewChatPane.js";

// Smallest usable pane width before the surface scrolls horizontally
// instead of shrinking panes further. Panes never shrink below this.
export const MIN_PANE_WIDTH_PX = 360;

export interface TilingSurfaceProps {
  projectId: ProjectId;
  controller: WorkspaceLayoutController;
  // Removes the pane from the layout. Purely a layout operation: closing a
  // pane never archives, deletes or otherwise mutates its thread (R2-5).
  onClosePane: (paneId: PaneId) => void;
  // caller assigns the thread to the pane and decides whether to navigate
  // (e.g. only when the pane started as the new-chat route's entry pane)
  onThreadStarted: (paneId: PaneId, threadId: ThreadId) => void;
}

// Smallest fraction either side of a split is allowed to shrink to in the
// UI. The layout model clamps further (to 0.05) internally, so this is a
// slightly more generous floor purely for pointer/keyboard interaction.
const MIN_FRACTION = 0.1;
const RESIZE_STEP = 0.05;

export function TilingSurface(props: TilingSurfaceProps): JSX.Element {
  const { controller, projectId, onClosePane, onThreadStarted } = props;
  const { root } = controller.layout;

  if (root === null) {
    return (
      <EmptyState
        onOpenPane={() => {
          controller.newPane();
        }}
      />
    );
  }

  const paneCount = tiledPaneIds(controller.layout).length;

  return (
    // `--pane-min-width` is the one number behind CWS-07's minimum: the
    // stylesheet clamps each .tiling-region to it, so the constant lives here
    // and cannot drift from the CSS. The total floor on .tiling-tiles is kept
    // as a backstop -- it is what guarantees the surface can still SCROLL to
    // reach every pane if a future rule ever relaxes a region's minimum.
    <div
      className="tiling-surface"
      style={
        {
          "--pane-min-width": `${String(MIN_PANE_WIDTH_PX)}px`,
        } as CSSProperties
      }
    >
      <div
        className="tiling-tiles"
        style={{ minWidth: paneCount * MIN_PANE_WIDTH_PX }}
      >
        <LayoutNodeView
          key={root.id}
          node={root}
          controller={controller}
          projectId={projectId}
          onClosePane={onClosePane}
          onThreadStarted={onThreadStarted}
        />
      </div>
    </div>
  );
}

// The empty surface must offer its own way out: closing the last pane leaves
// the URL on a thread, and a sidebar row is not always within reach (below
// 900px the sidebar is a drawer).
function EmptyState({ onOpenPane }: { onOpenPane: () => void }) {
  return (
    <div className="tiling-empty" role="status">
      <p>No panes are open.</p>
      <p>Open an empty pane here, or pick a thread in the sidebar.</p>
      <button
        type="button"
        className="tiling-empty-action"
        onClick={onOpenPane}
      >
        Open a pane
      </button>
    </div>
  );
}

interface LayoutNodeViewProps {
  node: LayoutNode;
  controller: WorkspaceLayoutController;
  projectId: ProjectId;
  onClosePane: (paneId: PaneId) => void;
  onThreadStarted: (paneId: PaneId, threadId: ThreadId) => void;
}

function LayoutNodeView(props: LayoutNodeViewProps): JSX.Element {
  const { node, controller, projectId, onClosePane, onThreadStarted } = props;
  if (node.type === "pane") {
    return (
      <PaneRegion
        paneId={node.id}
        controller={controller}
        projectId={projectId}
        onClosePane={onClosePane}
        onThreadStarted={onThreadStarted}
      />
    );
  }
  return (
    <SplitRegion
      node={node}
      controller={controller}
      projectId={projectId}
      onClosePane={onClosePane}
      onThreadStarted={onThreadStarted}
    />
  );
}

function PaneRegion({
  paneId,
  controller,
  projectId,
  onClosePane,
  onThreadStarted,
}: {
  paneId: PaneId;
  controller: WorkspaceLayoutController;
  projectId: ProjectId;
  onClosePane: (paneId: PaneId) => void;
  onThreadStarted: (paneId: PaneId, threadId: ThreadId) => void;
}) {
  const focused = paneId === controller.layout.focusedPaneId;
  const threadId = controller.layout.panes[paneId]?.threadId ?? null;
  return (
    <div className="tiling-region">
      {threadId !== null ? (
        <ThreadPane
          projectId={projectId}
          threadId={threadId}
          focused={focused}
          onFocus={() => {
            controller.focus(paneId);
          }}
          onClose={() => {
            onClosePane(paneId);
          }}
          onSplit={() => {
            controller.focus(paneId);
            controller.dispatch({ type: "split", axis: "row" });
          }}
        />
      ) : (
        <NewChatPane
          projectId={projectId}
          paneId={paneId}
          focused={focused}
          onFocus={() => {
            controller.focus(paneId);
          }}
          onClose={() => {
            onClosePane(paneId);
          }}
          onSplit={() => {
            controller.focus(paneId);
            controller.dispatch({ type: "split", axis: "row" });
          }}
          onThreadStarted={(newThreadId) => {
            onThreadStarted(paneId, newThreadId);
          }}
        />
      )}
    </div>
  );
}

function SplitRegion({
  node,
  controller,
  projectId,
  onClosePane,
  onThreadStarted,
}: {
  node: SplitNode;
  controller: WorkspaceLayoutController;
  projectId: ProjectId;
  onClosePane: (paneId: PaneId) => void;
  onThreadStarted: (paneId: PaneId, threadId: ThreadId) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingPointer = useRef<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const [first, second] = node.children;
  const [firstSize, secondSize] = node.sizes;
  const splitId: SplitId = node.id;
  const vertical = node.axis === "row"; // divider is a vertical line when panes sit side by side

  const applyFraction = (fraction: number) => {
    const clamped = Math.min(
      1 - MIN_FRACTION,
      Math.max(MIN_FRACTION, fraction),
    );
    controller.resize(splitId, [clamped, 1 - clamped]);
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
    <div
      ref={containerRef}
      className={`tiling-split tiling-split-${node.axis}`}
    >
      <div
        className="tiling-split-child"
        style={{ flexGrow: firstSize, flexBasis: 0 }}
      >
        <LayoutNodeView
          key={first.id}
          node={first}
          controller={controller}
          projectId={projectId}
          onClosePane={onClosePane}
          onThreadStarted={onThreadStarted}
        />
      </div>
      <div
        className={`tiling-divider ${resizing ? "resizing" : ""}`}
        role="separator"
        aria-label="Resize panes"
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
        className="tiling-split-child"
        style={{ flexGrow: secondSize, flexBasis: 0 }}
      >
        <LayoutNodeView
          key={second.id}
          node={second}
          controller={controller}
          projectId={projectId}
          onClosePane={onClosePane}
          onThreadStarted={onThreadStarted}
        />
      </div>
    </div>
  );
}
