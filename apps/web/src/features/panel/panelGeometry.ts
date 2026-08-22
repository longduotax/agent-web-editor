import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./panelModel.js";

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
