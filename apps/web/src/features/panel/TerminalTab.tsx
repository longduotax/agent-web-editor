import { memo, useCallback, type JSX } from "react";
import type { TerminalId } from "@pi-web/contracts";

import { TerminalView } from "../TerminalView.js";
import { UnboundNotice } from "./tabBody.js";
import type { TabBodyProps } from "./tabBody.js";

// A shell in this tab's execution scope (WSP-07). The unsandboxed-shell
// warning lives inside TerminalView, so it appears once per terminal tab
// rather than once per panel.
//
// The view stays mounted while the tab is hidden: its socket, its process
// and its scrollback are the tab's state, and tearing them down on a tab
// switch would kill the shell the user is running (WSP-09). That guarantee
// is not this component's to make — it holds because `PanelBodies` mounts
// each body once per tab and MOVES it between groups, so a split or a group
// promotion never unmounts this view. It used to be asserted here and
// contradicted by the group-owned bodies it was written against (D1).
//
// The tab's own durable state is the terminal it is attached to and the
// directory that terminal is in. Both are recorded through `updateTab`, so
// both are in the panel record before the next reload: the id lets the tab
// reclaim its still-running shell instead of orphaning it, and the
// directory is where a restarted or re-created shell starts (WSP-04,
// WSP-07). A scope may hold several terminals, so each tab is one shell and
// two tabs are two.

export const TerminalTab = memo(function TerminalTab({
  tab,
  visible,
  actions,
}: TabBodyProps<"terminal">): JSX.Element {
  const context = tab.context;
  const tabId = tab.id;
  const { updateTab } = actions;
  // Stable across renders so the view's own effects see one identity: the
  // view mirrors them into a ref, and a new function every render would
  // make that mirroring pointless churn.
  const onTerminalId = useCallback(
    (terminalId: TerminalId | null) => {
      updateTab(tabId, { terminalId });
    },
    [tabId, updateTab],
  );
  const onCwd = useCallback(
    (cwd: string) => {
      updateTab(tabId, { cwd });
    },
    [tabId, updateTab],
  );
  if (context === null) return <UnboundNotice />;
  // `visible` used to be accepted and dropped (D4). It is the terminal's
  // half of WSP-09: the process and the buffer are kept either way, but a
  // hidden terminal must not measure itself — see TerminalView's own note.
  return (
    <TerminalView
      projectId={context.projectId}
      threadId={context.threadId}
      visible={visible}
      terminalId={tab.terminalId}
      cwd={tab.cwd}
      onTerminalId={onTerminalId}
      onCwd={onCwd}
    />
  );
});
