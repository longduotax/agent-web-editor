import { useState, type JSX } from "react";

import { ChangesTab } from "./ChangesTab.js";
import { DiffTab } from "./DiffTab.js";
import { FilesTab } from "./FilesTab.js";
import { FileTab } from "./FileTab.js";
import { TerminalTab } from "./TerminalTab.js";
import type { TabGroup } from "./panelModel.js";
import type { PanelTab, TabContext, TabId } from "./panelTabs.js";
import { TabStrip, tabElementId, tabPanelElementId } from "./TabStrip.js";
import type { PanelActions } from "./usePanelState.js";

// One tab group: its strip, plus the bodies of the tabs that have been
// activated at least once.
//
// The mounting rule is WSP-09's other half. A body is mounted the first time
// its tab is activated and stays mounted for the life of the tab — that is
// what preserves its scroll position, its fetched data and, for a terminal,
// its process — but it is hidden with `hidden` plus `inert`, so it paints
// nothing and focus cannot wander into it. A tab that has never been
// activated is never mounted at all, so opening ten tabs costs one body.

export interface TabGroupViewProps {
  group: TabGroup;
  tabs: Record<TabId, PanelTab>;
  actions: PanelActions;
  focused: boolean;
  focusRequest: number;
  focusedContext: TabContext | null;
  /** False while the whole panel is closed: nothing in it does work then. */
  panelVisible: boolean;
  onClosePanel?: (() => void) | undefined;
}

export function TabGroupView(props: TabGroupViewProps): JSX.Element {
  const {
    group,
    tabs,
    actions,
    focused,
    focusRequest,
    focusedContext,
    panelVisible,
    onClosePanel,
  } = props;
  const activeTabId = group.activeTabId;

  // Adjusted during render rather than in an effect: mounting a body one
  // render later would paint an empty group for a frame on every first
  // activation. See https://react.dev/learn/you-might-not-need-an-effect
  const [mounted, setMounted] = useState<readonly TabId[]>(() =>
    activeTabId === null ? [] : [activeTabId],
  );
  const live = mounted.filter((tabId) => group.tabIds.includes(tabId));
  const missing = activeTabId !== null && !live.includes(activeTabId);
  if (missing || live.length !== mounted.length)
    setMounted(missing && activeTabId !== null ? [...live, activeTabId] : live);
  const bodies =
    missing && activeTabId !== null ? [...live, activeTabId] : live;

  return (
    <section
      className={`panel-group ${focused ? "focused" : ""}`}
      aria-label="Panel tab group"
    >
      <TabStrip
        group={group}
        tabs={tabs}
        actions={actions}
        focused={focused}
        focusRequest={focusRequest}
        focusedContext={focusedContext}
        onClosePanel={onClosePanel}
      />
      <div className="panel-bodies">
        {group.tabIds.length === 0 && (
          <div className="empty">No tabs open. Use ＋ to open one.</div>
        )}
        {bodies.map((tabId) => {
          const tab = tabs[tabId];
          if (tab === undefined) return null;
          const active = tabId === activeTabId;
          return (
            <div
              key={tabId}
              id={tabPanelElementId(tabId)}
              className="panel-tabpanel"
              role="tabpanel"
              aria-labelledby={tabElementId(tabId)}
              hidden={!active}
              inert={!active}
            >
              <TabBody
                tab={tab}
                visible={active && panelVisible}
                actions={actions}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TabBody({
  tab,
  visible,
  actions,
}: {
  tab: PanelTab;
  visible: boolean;
  actions: PanelActions;
}): JSX.Element | null {
  switch (tab.type) {
    case "changes":
      return <ChangesTab tab={tab} visible={visible} actions={actions} />;
    case "files":
      return <FilesTab tab={tab} visible={visible} actions={actions} />;
    case "file":
      return <FileTab tab={tab} visible={visible} actions={actions} />;
    case "diff":
      return <DiffTab tab={tab} visible={visible} actions={actions} />;
    case "terminal":
      return <TerminalTab tab={tab} visible={visible} actions={actions} />;
    case "browser":
      // WSP-08 arrives in milestone 7. Nothing can create one of these yet,
      // and a persisted record carrying one is not silently blank.
      return (
        <div className="empty">
          Browser tabs are not available in this version of the workspace.
        </div>
      );
  }
}
