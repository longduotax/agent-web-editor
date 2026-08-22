import {
  useEffect,
  useRef,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { NewTabMenu } from "./NewTabMenu.js";
import { PanelRightIcon } from "./PanelRightIcon.js";
import type { TabGroup } from "./panelModel.js";
import { tabTitle } from "./panelTabs.js";
import type { PanelTab, TabContext, TabId } from "./panelTabs.js";
import { showsWorktreeChip } from "./tabContext.js";
import type { PanelActions } from "./usePanelState.js";

// One tab group's strip: a real tablist with a roving tabindex (WSP-10),
// a per-tab close control, the worktree chip (WSP-02), and the `+` menu.

export function tabElementId(tabId: TabId): string {
  return `panel-tab-${tabId}`;
}

export function tabPanelElementId(tabId: TabId): string {
  return `panel-tabpanel-${tabId}`;
}

// Whether a click inside a tab landed on its close affordance rather than
// on the tab itself.
function isCloseAffordance(target: EventTarget): boolean {
  return (
    target instanceof Element && target.closest("[data-tab-close]") !== null
  );
}

export interface TabStripProps {
  group: TabGroup;
  tabs: Record<TabId, PanelTab>;
  actions: PanelActions;
  /** Whether this group is the panel's focused one. */
  focused: boolean;
  /** Bumped when the keyboard asks the panel to take focus. */
  focusRequest: number;
  /** The focused chat pane's scope: what `+` opens tabs for, and what the
   * worktree chip is compared against. */
  focusedContext: TabContext | null;
  /** Supplied to exactly one strip, so the panel has one close control. */
  onClosePanel?: (() => void) | undefined;
}

export function TabStrip(props: TabStripProps): JSX.Element {
  const {
    group,
    tabs,
    actions,
    focused,
    focusRequest,
    focusedContext,
    onClosePanel,
  } = props;
  const activeTabId = group.activeTabId;
  const activeTab = activeTabId === null ? undefined : tabs[activeTabId];
  const handledFocusRequest = useRef(focusRequest);

  // Keyboard "focus the panel" lands on the focused group's active tab,
  // which is both the strip's one tab stop and the way into its body.
  useEffect(() => {
    if (handledFocusRequest.current === focusRequest) return;
    handledFocusRequest.current = focusRequest;
    if (!focused || activeTabId === null) return;
    document.getElementById(tabElementId(activeTabId))?.focus();
  }, [focusRequest, focused, activeTabId]);

  // Overflow must never hide the tab the user is looking at: the strip
  // scrolls, and the active tab is scrolled back into it.
  useEffect(() => {
    if (activeTabId === null) return;
    const element = document.getElementById(tabElementId(activeTabId));
    if (typeof element?.scrollIntoView !== "function") return;
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const order = group.tabIds;
    if (order.length === 0 || activeTabId === null) return;
    const current = order.indexOf(activeTabId);
    let target: TabId | undefined;
    if (event.key === "ArrowRight")
      target = order[(current + 1) % order.length];
    else if (event.key === "ArrowLeft")
      target = order[(current - 1 + order.length) % order.length];
    else if (event.key === "Home") target = order[0];
    else if (event.key === "End") target = order[order.length - 1];
    if (target === undefined) return;
    event.preventDefault();
    actions.activateTab(target);
    // The roving tabindex follows the selection, so focus has to as well or
    // the next Tab press would leave from an element that is now -1.
    document.getElementById(tabElementId(target))?.focus();
  };

  return (
    <div
      className="panel-tabstrip"
      onPointerDown={() => {
        if (!focused) actions.focusGroup(group.id);
      }}
    >
      <div
        className="panel-tab-options"
        role="tablist"
        aria-label="Panel tabs"
        aria-orientation="horizontal"
        onKeyDown={moveFocus}
      >
        {group.tabIds.map((tabId) => {
          const tab = tabs[tabId];
          if (tab === undefined) return null;
          const title = tabTitle(tab);
          const active = tabId === activeTabId;
          return (
            <button
              type="button"
              role="tab"
              key={tabId}
              id={tabElementId(tabId)}
              // Only the active tab names a panel: a tab that has never been
              // activated has no body mounted (WSP-09 mounts on first use),
              // so pointing at one would be a dangling reference.
              aria-controls={active ? tabPanelElementId(tabId) : undefined}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`panel-tab ${active ? "active" : ""}`}
              onClick={(event) => {
                if (isCloseAffordance(event.target)) actions.closeTab(tabId);
                else actions.activateTab(tabId);
              }}
            >
              <span className="panel-tab-title">{title}</span>
              {showsWorktreeChip(tab.context, focusedContext) &&
                tab.context !== null && (
                  <span className="panel-tab-chip">{tab.context.label}</span>
                )}
              {/* A pointer affordance, deliberately not a control of its
                  own: ARIA lets a tablist own nothing but tabs, and a real
                  button inside a tab is a nested interactive. Keyboard and
                  assistive-technology users close the active tab through the
                  strip's own close control (below) or the "Close panel tab"
                  chord, both of which are announced. */}
              <span
                className="panel-tab-close"
                data-tab-close=""
                aria-hidden="true"
                title={`Close ${title}`}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>
      {activeTab !== undefined && (
        <button
          type="button"
          className="panel-close-tab"
          aria-label={`Close ${tabTitle(activeTab)} tab`}
          title={`Close ${tabTitle(activeTab)}`}
          onClick={() => {
            actions.closeTab(activeTab.id);
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
      <NewTabMenu
        context={focusedContext}
        groupId={group.id}
        actions={actions}
      />
      {onClosePanel !== undefined && (
        <button
          type="button"
          className="panel-close"
          aria-label="Close workspace panel"
          title="Close panel"
          onClick={onClosePanel}
        >
          <PanelRightIcon />
        </button>
      )}
    </div>
  );
}
