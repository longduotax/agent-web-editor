import type { JSX } from "react";

import { groupBodiesElementId } from "./PanelBodies.js";
import type { GroupId, TabGroup } from "./panelModel.js";
import type { PanelTab, TabContext, TabId } from "./panelTabs.js";
import { TabDropZones } from "./TabDropZones.js";
import { TabStrip } from "./TabStrip.js";
import type { PanelActions } from "./usePanelState.js";
import type { TabDragController } from "./useTabDrag.js";

// One tab group: its strip, plus the slot its tab bodies are placed into.
//
// The bodies themselves are NOT rendered here. They are mounted once per tab
// by `PanelBodies`, at the panel's level, and moved into this group's slot —
// because this component is unmounted whenever the tree changes shape at its
// position, and a body that went down with it would lose a running terminal
// and every scroll position in the group (WSP-09). See PanelBodies.tsx.

/** The element a drag measures this group's rectangle from. */
export function panelGroupElementId(groupId: GroupId): string {
  return `panel-group-${groupId}`;
}

export interface TabGroupViewProps {
  group: TabGroup;
  tabs: Record<TabId, PanelTab>;
  actions: PanelActions;
  /** The panel-wide tab drag (WSP-03), idle or in progress. */
  drag: TabDragController;
  focused: boolean;
  focusedContext: TabContext | null;
  /** 1-based position in reading order, for the group's accessible name. */
  index: number;
  /** How many groups the panel holds, so a lone group needs no number. */
  groupCount: number;
  onClosePanel?: (() => void) | undefined;
}

/**
 * A split panel would otherwise expose two landmarks both called "Panel tab
 * group" and two tablists both called "Panel tabs", which a screen-reader
 * user cannot tell apart (WSP-10). Numbering them in reading order is stable
 * under tab switching — an active tab's title is not — and a single group
 * keeps the plain name, because there is nothing to distinguish it from.
 */
export function groupAccessibleName(index: number, groupCount: number): string {
  return groupCount > 1
    ? `Panel tab group ${String(index)} of ${String(groupCount)}`
    : "Panel tab group";
}

export function TabGroupView(props: TabGroupViewProps): JSX.Element {
  const {
    group,
    tabs,
    actions,
    drag,
    focused,
    focusedContext,
    index,
    groupCount,
    onClosePanel,
  } = props;

  return (
    <section
      className={`panel-group ${focused ? "focused" : ""}`}
      id={panelGroupElementId(group.id)}
      aria-label={groupAccessibleName(index, groupCount)}
      // Every panel chord acts on the focused group, so keyboard focus has
      // to move it — a pointer press on the strip was the only thing that
      // did, which left chords acting on a group the user was not in (D2).
      onFocusCapture={() => {
        if (!focused) actions.focusGroup(group.id);
      }}
    >
      <TabStrip
        group={group}
        tabs={tabs}
        actions={actions}
        drag={drag}
        focused={focused}
        focusedContext={focusedContext}
        index={index}
        groupCount={groupCount}
        onClosePanel={onClosePanel}
      />
      <div className="panel-bodies" id={groupBodiesElementId(group.id)}>
        {group.tabIds.length === 0 && (
          <div className="empty">No tabs open. Use ＋ to open one.</div>
        )}
      </div>
      {/* Only while a drag is in progress (WSP-03), and after the bodies so
          it covers them. */}
      {drag.drag !== null && (
        <TabDropZones
          groupId={group.id}
          zone={drag.zoneFor(group.id)}
          target={drag.drag.target}
        />
      )}
    </section>
  );
}
