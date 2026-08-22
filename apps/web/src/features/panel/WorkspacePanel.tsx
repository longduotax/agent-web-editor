import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { leafIds } from "../layout/binaryTree.js";
import { NewTabMenu } from "./NewTabMenu.js";
import { PanelBodies } from "./PanelBodies.js";
import { PanelRightIcon } from "./PanelRightIcon.js";
import { PanelTree } from "./PanelTree.js";
import { PANEL_MIN_WIDTH } from "./panelModel.js";
import {
  PANEL_RESIZE_STEP,
  panelMaxWidth,
  treeMinHeight,
  treeMinWidth,
} from "./panelGeometry.js";
import { tabElementId } from "./TabStrip.js";
import type { TabContext } from "./panelTabs.js";
import type { PanelController } from "./usePanelState.js";
import { useTabDrag } from "./useTabDrag.js";

// The docked column right of the chat surface (WSP-01): a keyboard-operable
// resize separator, the tree of tab groups, and — when the panel is closed —
// the rail that brings it back. Both are docked grid columns of the
// workspace; neither ever floats over chat content.

export function WorkspacePanel({
  controller,
  focusedContext,
}: {
  controller: PanelController;
  /** The focused chat pane's execution scope, or null when none owns one. */
  focusedContext: TabContext | null;
}): JSX.Element {
  const { state, actions, focusRequest, announcement } = controller;
  // Owned here rather than by a strip: a drag spans every group, and the
  // group it started in may be unmounted by the drop that ends it.
  const drag = useTabDrag(state, actions);
  const [resizing, setResizing] = useState(false);
  const resizingPointer = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const maxWidth = panelMaxWidth(viewportWidth);
  const effectiveWidth = Math.min(
    maxWidth,
    Math.max(PANEL_MIN_WIDTH, state.width),
  );

  useEffect(() => {
    const resized = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("resize", resized);
    };
  }, []);

  const resizeFromClientX = (clientX: number) => {
    actions.setWidth(
      Math.min(
        maxWidth,
        Math.max(PANEL_MIN_WIDTH, Math.round(window.innerWidth - clientX)),
      ),
    );
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
    let nextWidth: number | undefined;
    if (event.key === "ArrowLeft")
      nextWidth = effectiveWidth + PANEL_RESIZE_STEP;
    if (event.key === "ArrowRight")
      nextWidth = effectiveWidth - PANEL_RESIZE_STEP;
    if (event.key === "Home") nextWidth = PANEL_MIN_WIDTH;
    if (event.key === "End") nextWidth = maxWidth;
    if (nextWidth === undefined) return;
    event.preventDefault();
    actions.setWidth(Math.min(maxWidth, Math.max(PANEL_MIN_WIDTH, nextWidth)));
  };

  // WSP-10's focus management, owned here rather than by a tab strip (F5).
  //
  // A strip cannot do this: after a split, the group that should take focus
  // is one that has just been MOUNTED, and a freshly mounted component has
  // no way to tell "the request that created me" from "a request that
  // predates me". This element outlives every structural change, so the
  // question has one answer in one place: whichever tab the model now calls
  // active in the group it now calls focused.
  const handledFocusRequest = useRef(focusRequest);
  useEffect(() => {
    if (handledFocusRequest.current === focusRequest) return;
    handledFocusRequest.current = focusRequest;
    if (!state.open) return;
    const groupId = state.focusedGroupId;
    if (groupId === null) return;
    const activeTabId = state.groups[groupId]?.activeTabId ?? null;
    if (activeTabId === null) return;
    document.getElementById(tabElementId(activeTabId))?.focus();
  });

  const open = state.open;
  const closePanel = () => {
    actions.setOpen(false);
  };
  const groupOrder = leafIds(state.root);
  // One close control for the whole panel, on the first group in reading
  // order — where the shipped one was, and where it still is whenever
  // the panel holds a single group.
  const closeControlGroupId = groupOrder[0] ?? null;

  return (
    <>
      <aside
        className="panel"
        aria-label="Workspace panel"
        aria-hidden={!open}
        inert={!open}
      >
        <div
          className={`panel-resizer ${resizing ? "resizing" : ""}`}
          role="separator"
          aria-label="Resize workspace panel"
          aria-orientation="vertical"
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={maxWidth}
          aria-valuenow={effectiveWidth}
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
              resizeFromClientX(event.clientX);
          }}
          onPointerUp={(event) => {
            finishResize(event.currentTarget, event.pointerId);
          }}
          onPointerCancel={(event) => {
            finishResize(event.currentTarget, event.pointerId);
          }}
          onKeyDown={resizeWithKeyboard}
        />
        {state.root === null ? (
          <EmptyPanel
            context={focusedContext}
            controller={controller}
            onClosePanel={closePanel}
          />
        ) : (
          // The tree scrolls rather than shrinking a group past its floor
          // (F6), which is what the chat surface does with panes: below the
          // floor a group is not small, it is unusable — 139px of terminal
          // negotiated 16 columns — and a scrollbar is a far better answer
          // than a tile nobody can read.
          <div className="panel-tree-scroll">
            <div
              className="panel-tree-tiles"
              style={{
                minWidth: treeMinWidth(state.root),
                minHeight: treeMinHeight(state.root),
              }}
            >
              <PanelTree
                node={state.root}
                state={state}
                actions={actions}
                drag={drag}
                focusedContext={focusedContext}
                groupOrder={groupOrder}
                closeControlGroupId={closeControlGroupId}
                onClosePanel={closePanel}
              />
            </div>
          </div>
        )}
        {/* Renders no markup of its own: every tab body is portalled into
            the group that currently owns its tab, so regrouping moves a body
            instead of tearing it down (WSP-09). */}
        <PanelBodies state={state} actions={actions} panelVisible={open} />
        {/* Always rendered, never conditionally mounted: a live region has
            to exist before its text arrives to be announced at all. It is
            how a chord that refused says so (WSP-10, D8). */}
        <p className="panel-announcement" role="status">
          {announcement}
        </p>
        {/* The dragged tab's ghost: a label following the pointer, never a
            clone of the tab's body — cloning one would mount a second
            terminal, and the body's own host element must not move until the
            drop does move it (PanelBodies.tsx). */}
        {drag.drag !== null && (
          <div
            className="panel-drag-ghost"
            ref={drag.ghostRef}
            aria-hidden="true"
          >
            {drag.drag.title}
          </div>
        )}
      </aside>
      {!open && (
        <div className="panel-rail">
          <div className="panel-rail-head">
            <button
              type="button"
              className="panel-reopen"
              aria-label="Open workspace panel"
              title="Open panel"
              onClick={() => {
                actions.setOpen(true);
              }}
            >
              <PanelRightIcon />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// The panel after its last tab was closed and then reopened from the rail:
// it has no group to render, so it offers the one thing that can create one.
function EmptyPanel({
  context,
  controller,
  onClosePanel,
}: {
  context: TabContext | null;
  controller: PanelController;
  onClosePanel: () => void;
}): JSX.Element {
  return (
    <section className="panel-group" aria-label="Panel tab group">
      <div className="panel-tabstrip">
        <div
          className="panel-tab-options"
          role="tablist"
          aria-label="Panel tabs"
        />
        <NewTabMenu context={context} actions={controller.actions} />
        <button
          type="button"
          className="panel-close"
          aria-label="Close workspace panel"
          title="Close panel"
          onClick={onClosePanel}
        >
          <PanelRightIcon />
        </button>
      </div>
      <div className="panel-bodies">
        <div className="empty">No tabs open. Use ＋ to open one.</div>
      </div>
    </section>
  );
}
