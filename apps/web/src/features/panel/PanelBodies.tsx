import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";

import { ChangesTab } from "./ChangesTab.js";
import { DiffTab } from "./DiffTab.js";
import { FilesTab } from "./FilesTab.js";
import { FileTab } from "./FileTab.js";
import { TerminalTab } from "./TerminalTab.js";
import type { GroupId, PanelState } from "./panelModel.js";
import type { PanelTab, TabId } from "./panelTabs.js";
import { tabElementId, tabPanelElementId } from "./TabStrip.js";
import type { PanelActions } from "./usePanelState.js";

// Every mounted tab body in the panel, mounted ONCE PER TAB rather than once
// per group — the whole of WSP-09's "a tab moved between groups keeps its
// process, scroll position, and state".
//
// Why this is not simply rendered inside `TabGroupView`. The panel's tree
// renders a different element type per node (a split is a `div.panel-split`,
// a leaf is a `section.panel-group`), so any change of the tree's shape at a
// position unmounts the whole React subtree there. When a body was a child
// of its group, that meant splitting a group, or closing a group and letting
// its sibling be promoted, tore down bodies that had not moved: a running
// terminal's socket was closed, its process orphaned, and a fresh one
// started, and every scroll position in the group was lost.
//
// So each body gets a host element of its own, created once and never
// replaced, which this component renders into with a portal. The host is
// then *moved* into whichever group's `.panel-bodies` node currently owns
// the tab. Moving a DOM node does not unmount the React tree inside it — no
// effect re-runs, no socket is reopened — which is exactly the guarantee
// WSP-09 asks for. Detaching a node does reset its scroll offsets, so the
// host records them and puts them back after every move.

/** The node a group offers as the slot its tab bodies are moved into. */
export function groupBodiesElementId(groupId: GroupId): string {
  return `panel-bodies-${groupId}`;
}

export interface PanelBodiesProps {
  state: PanelState;
  actions: PanelActions;
  /** False while the whole panel is closed: nothing in it does work then. */
  panelVisible: boolean;
}

export function PanelBodies({
  state,
  actions,
  panelVisible,
}: PanelBodiesProps): JSX.Element {
  // Which tab each group holds, and which one it shows. Built once per
  // render so a body can find its own group without scanning every group.
  const ownerOfTab = new Map<TabId, GroupId>();
  const activeTabIds = new Set<TabId>();
  for (const group of Object.values(state.groups)) {
    for (const tabId of group.tabIds) ownerOfTab.set(tabId, group.id);
    if (group.activeTabId !== null) activeTabIds.add(group.activeTabId);
  }

  // Adjusted during render rather than in an effect: mounting a body one
  // render later would paint an empty group for a frame on every first
  // activation. See https://react.dev/learn/you-might-not-need-an-effect
  const [mounted, setMounted] = useState<readonly TabId[]>(() => [
    ...activeTabIds,
  ]);
  // Mounted, minus tabs that have since been closed, plus any tab being
  // shown for the first time. A tab that has never been activated is never
  // mounted at all, so opening ten tabs still costs one body.
  const live = mounted.filter((tabId) => tabId in state.tabs);
  const bodies = [
    ...live,
    ...[...activeTabIds].filter((tabId) => !live.includes(tabId)),
  ];
  if (
    bodies.length !== mounted.length ||
    bodies.some((tabId, index) => tabId !== mounted[index])
  )
    setMounted(bodies);

  return (
    <>
      {bodies.map((tabId) => {
        const tab = state.tabs[tabId];
        const groupId = ownerOfTab.get(tabId);
        if (tab === undefined || groupId === undefined) return null;
        const active = state.groups[groupId]?.activeTabId === tabId;
        return (
          <TabBodyHost
            key={tabId}
            tab={tab}
            groupId={groupId}
            active={active}
            visible={active && panelVisible}
            actions={actions}
          />
        );
      })}
    </>
  );
}

function TabBodyHost({
  tab,
  groupId,
  active,
  visible,
  actions,
}: {
  tab: PanelTab;
  groupId: GroupId;
  active: boolean;
  visible: boolean;
  actions: PanelActions;
}): JSX.Element {
  // The one node this body's whole DOM subtree lives in, for the life of the
  // tab. `display: contents` so the tabpanel inside it is still a flex item
  // of the group's bodies container.
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "panel-tabpanel-host";
    return element;
  });
  const panelRef = useRef<HTMLDivElement>(null);
  // Every scroller inside this body, not just the body element itself (G1).
  //
  // The body used to BE the scroller, and recording its own two offsets was
  // enough. The F2 fix moved the scrolling region inward — `.file-preview`
  // and `.diff-view` are now flex columns whose `pre` scrolls inside a
  // height-bounded box — so the offsets that matter belong to a descendant,
  // and the body's own are permanently 0. Which element scrolls is a
  // decision each tab type makes in CSS, so this records whatever actually
  // scrolled rather than naming a node.
  const scroll = useRef(new Map<Element, { top: number; left: number }>());
  // Whether this body was showing on the previous commit, so the restore
  // can tell "shown again" from "still showing".
  const wasActive = useRef(active);

  // A capture-phase listener, and native rather than React's `onScroll`: a
  // scroll event does not bubble, and React stopped simulating bubbling for
  // it in React 17, so a `pre` scrolling inside the body never reached the
  // body's own handler. Capture sees every one of them.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const record = (event: Event) => {
      const element = event.target;
      if (!(element instanceof Element)) return;
      // A hidden body's scrollers may be reset to 0 by the browser, and
      // that reset arrives as a scroll event like any other. It is not the
      // user scrolling, and recording it would throw away the offset this
      // exists to put back.
      if (!wasActive.current) return;
      scroll.current.set(element, {
        top: element.scrollTop,
        left: element.scrollLeft,
      });
    };
    panel.addEventListener("scroll", record, true);
    return () => {
      panel.removeEventListener("scroll", record, true);
    };
  }, []);

  const restoreScroll = () => {
    const panel = panelRef.current;
    if (panel === null) return;
    for (const [element, offsets] of scroll.current) {
      // A scroller React has since replaced is not this body's any more.
      if (!panel.contains(element)) {
        scroll.current.delete(element);
        continue;
      }
      if (element.scrollTop !== offsets.top) element.scrollTop = offsets.top;
      if (element.scrollLeft !== offsets.left)
        element.scrollLeft = offsets.left;
    }
  };

  // Deliberately without a dependency list. The group's DOM node is replaced
  // whenever the tree changes shape at its position — which happens on a
  // split, and again when a sibling is promoted after a group closes — even
  // though the group's id has not changed. "Is the host still in the right
  // parent?" is the only question with a reliable answer, and it is cheap.
  useLayoutEffect(() => {
    const parent = document.getElementById(groupBodiesElementId(groupId));
    const moved = parent !== null && host.parentNode !== parent;
    if (moved) parent.appendChild(host);
    // Both ways a scroll offset is lost, and both are the browser's layout
    // rather than anything React does (measured in HeadlessChrome/151, on a
    // bare page as well as on this one):
    //  - detaching a node resets every scroller inside it, permanently, so
    //    a move sends the user back to the top of a long diff;
    //  - a body that leaves layout under `hidden` reports 0 while it is
    //    hidden. This browser restores it on the way back; one that does
    //    not is why the offset is put back here rather than trusted.
    // A body that is hidden has no layout box, so an assignment now does
    // nothing — which is why "shown again" restores as well as "moved".
    const shown = active && !wasActive.current;
    wasActive.current = active;
    if (moved || shown) restoreScroll();
  });

  useEffect(() => {
    return () => {
      host.remove();
    };
  }, [host]);

  return createPortal(
    <div
      ref={panelRef}
      id={tabPanelElementId(tab.id)}
      className="panel-tabpanel"
      role="tabpanel"
      aria-labelledby={tabElementId(tab.id)}
      hidden={!active}
      inert={!active}
      // A body is not a child of its group in the React tree any more, so
      // the group's own focus handler never sees this. Without it, focusing
      // something inside a body would leave the panel's chords acting on
      // whichever group the pointer last touched (D2).
      onFocusCapture={() => {
        actions.focusGroup(groupId);
      }}
    >
      <TabBody tab={tab} visible={visible} actions={actions} />
    </div>,
    host,
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
