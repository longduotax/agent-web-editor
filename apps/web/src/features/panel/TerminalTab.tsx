import { memo, type JSX } from "react";

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
// Multi-terminal scopes, the persisted working directory and
// re-attach-with-replay are milestone 6; this is the shipped terminal,
// wrapped.

export const TerminalTab = memo(function TerminalTab({
  tab,
  visible,
}: TabBodyProps<"terminal">): JSX.Element {
  const context = tab.context;
  if (context === null) return <UnboundNotice />;
  // `visible` used to be accepted and dropped (D4). It is the terminal's
  // half of WSP-09: the process and the buffer are kept either way, but a
  // hidden terminal must not measure itself — see TerminalView's own note.
  return (
    <TerminalView
      projectId={context.projectId}
      threadId={context.threadId}
      visible={visible}
    />
  );
});
