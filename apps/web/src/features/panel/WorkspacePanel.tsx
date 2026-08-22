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
import { PANEL_RESIZE_STEP, panelMaxWidth } from "./panelGeometry.js";
import type { TabContext } from "./panelTabs.js";
import type { PanelController } from "./usePanelState.js";

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
          <PanelTree
            node={state.root}
            state={state}
            actions={actions}
            focusRequest={focusRequest}
            focusedContext={focusedContext}
            groupOrder={groupOrder}
            closeControlGroupId={closeControlGroupId}
            onClosePanel={closePanel}
          />
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
