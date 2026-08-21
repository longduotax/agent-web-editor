import {
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

import type { LayoutNode, PaneId, SplitNode } from "./layoutTree.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";
import { ThreadPane } from "./ThreadPane.js";
import { NewChatPane } from "./NewChatPane.js";

export interface TilingSurfaceProps {
  projectId: ProjectId;
  controller: WorkspaceLayoutController;
  // caller archives if threadId set, then removes the pane
  onClosePane: (paneId: PaneId, threadId: ThreadId | null) => void;
}

// Smallest fraction either side of a split is allowed to shrink to in the
// UI. The layout model clamps further (to 0.05) internally, so this is a
// slightly more generous floor purely for pointer/keyboard interaction.
const MIN_FRACTION = 0.1;
const RESIZE_STEP = 0.05;

// A split's immediate children can themselves be splits once either side is
// divided again. `setPaneParentSizes` only knows how to locate a split via a
// *direct* pane child, so the divider for a given split can only drive
// resizing when at least one of its two immediate children is still a leaf
// pane. That holds for every split created by `splitPane` until its side is
// further subdivided; deeper splits still resize via their own dividers.
function directPaneId(node: LayoutNode): PaneId | null {
  return node.type === "pane" ? node.id : null;
}

export function TilingSurface(props: TilingSurfaceProps): JSX.Element {
  const { controller, projectId, onClosePane } = props;
  const { root } = controller.layout;

  if (root === null) {
    return <EmptyState controller={controller} />;
  }

  return (
    <div className="tiling-surface">
      <LayoutNodeView
        node={root}
        controller={controller}
        projectId={projectId}
        onClosePane={onClosePane}
      />
    </div>
  );
}

function EmptyState({ controller }: { controller: WorkspaceLayoutController }) {
  const mostRecentlyDocked = controller.layout.docked[0];
  return (
    <div className="tiling-empty" role="status">
      <p>No panes are open.</p>
      {mostRecentlyDocked !== undefined ? (
        <button
          type="button"
          onClick={() => {
            controller.restore(mostRecentlyDocked);
          }}
        >
          Restore last pane
        </button>
      ) : (
        <p>Start a new chat from the sidebar to open a pane here.</p>
      )}
    </div>
  );
}

interface LayoutNodeViewProps {
  node: LayoutNode;
  controller: WorkspaceLayoutController;
  projectId: ProjectId;
  onClosePane: (paneId: PaneId, threadId: ThreadId | null) => void;
}

function LayoutNodeView(props: LayoutNodeViewProps): JSX.Element {
  const { node, controller, projectId, onClosePane } = props;
  if (node.type === "pane") {
    return (
      <PaneRegion
        paneId={node.id}
        controller={controller}
        projectId={projectId}
        onClosePane={onClosePane}
      />
    );
  }
  return (
    <SplitRegion
      node={node}
      controller={controller}
      projectId={projectId}
      onClosePane={onClosePane}
    />
  );
}

function PaneRegion({
  paneId,
  controller,
  projectId,
  onClosePane,
}: {
  paneId: PaneId;
  controller: WorkspaceLayoutController;
  projectId: ProjectId;
  onClosePane: (paneId: PaneId, threadId: ThreadId | null) => void;
}) {
  const focused = paneId === controller.layout.focusedPaneId;
  const threadId = controller.layout.panes[paneId]?.threadId ?? null;
  return (
    <div className="tiling-region" aria-current={focused ? "true" : undefined}>
      {threadId !== null ? (
        <ThreadPane
          projectId={projectId}
          threadId={threadId}
          focused={focused}
          onFocus={() => {
            controller.focus(paneId);
          }}
          onCollapse={() => {
            controller.collapse(paneId);
          }}
          onClose={() => {
            onClosePane(paneId, threadId);
          }}
          onBind={() => {
            controller.bind(paneId);
          }}
        />
      ) : (
        <NewChatPane
          projectId={projectId}
          focused={focused}
          onFocus={() => {
            controller.focus(paneId);
          }}
          onClose={() => {
            onClosePane(paneId, null);
          }}
          onThreadStarted={(newThreadId) => {
            controller.assignThreadToPane(paneId, newThreadId);
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
}: {
  node: SplitNode;
  controller: WorkspaceLayoutController;
  projectId: ProjectId;
  onClosePane: (paneId: PaneId, threadId: ThreadId | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingPointer = useRef<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const [first, second] = node.children;
  const [firstSize, secondSize] = node.sizes;
  // Prefer the first child's id (per the resize contract), falling back to
  // the second when the first child is itself a nested split.
  const targetPaneId = directPaneId(first) ?? directPaneId(second);
  const vertical = node.axis === "row"; // divider is a vertical line when panes sit side by side

  const applyFraction = (fraction: number) => {
    if (targetPaneId === null) return;
    const clamped = Math.min(
      1 - MIN_FRACTION,
      Math.max(MIN_FRACTION, fraction),
    );
    controller.resize(targetPaneId, [clamped, 1 - clamped]);
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
          node={first}
          controller={controller}
          projectId={projectId}
          onClosePane={onClosePane}
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
          node={second}
          controller={controller}
          projectId={projectId}
          onClosePane={onClosePane}
        />
      </div>
    </div>
  );
}
