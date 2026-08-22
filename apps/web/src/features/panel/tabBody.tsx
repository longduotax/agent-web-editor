import type { JSX } from "react";

import type { PanelTab } from "./panelTabs.js";
import type { PanelActions } from "./usePanelState.js";

// What every tab body is handed. `visible` is the whole of WSP-09's
// "only the active tab of a visible group does ongoing work": a body stays
// mounted when it is hidden — that is what keeps its scroll position and its
// data — but every query and timer inside it is gated on this flag.

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
