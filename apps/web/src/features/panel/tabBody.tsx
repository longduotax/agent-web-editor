import type { JSX } from "react";

import type { PanelTab } from "./panelTabs.js";
import type { PanelActions } from "./usePanelState.js";

// What every tab body is handed. `visible` is the whole of WSP-09's
// "only the active tab of a visible group does ongoing work": a body stays
// mounted when it is hidden — that is what keeps its scroll position and its
// data — but every query and timer inside it is gated on this flag.

/**
 * How long a tab body's data is trusted without asking again.
 *
 * WSP-09 requires that switching between open tabs never re-fetches what the
 * tab already has. A query gated on visibility is otherwise refetched the
 * moment it is re-enabled, because react-query treats it as stale
 * immediately — so switching away and back would cost a request every time.
 * Beyond this window the tab does refetch, but in the background: the
 * retained content stays on screen, so nothing blanks and no scroll position
 * is lost.
 *
 * The Files and File bodies use this. The Changes and Diff bodies
 * deliberately do NOT: they claim to show the CURRENT working tree (WSP-06),
 * nothing invalidates that claim, and a status list that is thirty seconds
 * wrong is worse than a request. See ChangesTab for the full reasoning.
 */
export const PANEL_QUERY_STALE_TIME = 30_000;

export interface TabBodyProps<Type extends PanelTab["type"]> {
  tab: Extract<PanelTab, { type: Type }>;
  visible: boolean;
  actions: PanelActions;
}

/**
 * The state a thread-bound tab shows when it has no worktree to read.
 *
 * Reachable only through the v1 inspector migration, which restores a tab
 * with no context because the shipped inspector never recorded one (D-1).
 * The tab binds itself to the focused chat pane's thread as soon as one
 * exists, so this is what the user sees in between.
 */
export function UnboundNotice(): JSX.Element {
  return (
    <div className="empty">
      This tab is not bound to a worktree yet. Focus a chat pane that owns a
      thread and it will read that thread&apos;s worktree from then on.
    </div>
  );
}
