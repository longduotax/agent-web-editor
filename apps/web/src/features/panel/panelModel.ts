import type { TerminalId } from "@pi-web/contracts";

import {
  containsLeaf,
  leafIds,
  removeLeaf,
  setSplitSizes,
  splitLeaf,
} from "../layout/binaryTree.js";
import type { TreeNode } from "../layout/binaryTree.js";
import { sameTarget } from "./panelTabs.js";
import type { NewPanelTab, PanelTab, TabContext, TabId } from "./panelTabs.js";

// The workspace panel's state: a tiling tree of tab groups (WSP-01) whose
// tabs are durable and carry their own context (WSP-02). Every operation
// here is pure — it returns a new state and never mutates its input — so the
// whole panel can be persisted, restored, and undone as a value (WSP-04).

export type GroupId = string;

export interface TabGroup {
  id: GroupId;
  tabIds: TabId[]; // strip order, left to right
  activeTabId: TabId | null; // null only while the group is empty
}

export interface PanelState {
  root: TreeNode<"group", GroupId> | null; // null = no groups, panel closed
  groups: Record<GroupId, TabGroup>;
  tabs: Record<TabId, PanelTab>;
  focusedGroupId: GroupId | null;
  width: number;
  open: boolean;
}

export const PANEL_DEFAULT_WIDTH = 400;
// Below this the panel cannot show a diff or a terminal line without
// wrapping into nonsense, so a resize refuses to go further (WSP-04).
export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 4096;

export type PanelEdge = "top" | "bottom" | "left" | "right";

// Which fields of a tab may be updated after it is opened: its view state,
// and nothing that says *what* it addresses. Its type never changes, and
// neither does its id. Keys that do not belong to the addressed tab's type
// are ignored, so a caller cannot graft a browser's `url` onto a file tab.
//
// `path` and `context` are deliberately absent. A File or Diff tab's path is
// its identity — WSP-05 opens a *different* tab for a different file — and a
// tab's context is fixed when it is opened (WSP-02). Patching either could
// point one tab at what another already holds, and openTab's dedupe (a
// contract, not an optimisation: WSP-09) only ever ran at open time.
// `bindTabContext` is the one route that may set a context, because it is
// the one that resolves the collision that creates.
export interface TabPatch {
  search?: string;
  view?: "preview" | "source";
  collapsedHunks?: string[];
  cwd?: string;
  terminalId?: TerminalId | null;
  url?: string;
  history?: string[];
  historyIndex?: number;
}

export function createEmptyPanel(makeId: () => string): PanelState {
  const groupId = makeId();
  return {
    root: { type: "group", id: groupId },
    groups: { [groupId]: { id: groupId, tabIds: [], activeTabId: null } },
    tabs: {},
    focusedGroupId: groupId,
    width: PANEL_DEFAULT_WIDTH,
    open: false,
  };
}

// Record minus some keys, built fresh: `delete` would mutate a record the
// caller still owns, and every operation here returns a new state.
function without<T>(
  record: Record<string, T>,
  removed: ReadonlySet<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !removed.has(key)),
  );
}

function groupOf(state: PanelState, tabId: TabId): TabGroup | null {
  for (const group of Object.values(state.groups))
    if (group.tabIds.includes(tabId)) return group;
  return null;
}

// The tab that should take over when `tabIds[index]` leaves the strip: the
// one that slid into its place (its right neighbour), else the one to its
// left, else nothing.
function neighbourAfterRemoval(
  remaining: TabId[],
  removedIndex: number,
): TabId | null {
  return remaining[removedIndex] ?? remaining[removedIndex - 1] ?? null;
}

// Detaches a tab from its group without touching `state.tabs`, cleaning the
// group away if that emptied it. Shared by closeTab, moveTab, and
// splitGroupWithTab so all three collapse an emptied group identically.
function detachTab(
  state: PanelState,
  group: TabGroup,
  tabId: TabId,
): PanelState {
  const removedIndex = group.tabIds.indexOf(tabId);
  const tabIds = group.tabIds.filter((id) => id !== tabId);
  if (tabIds.length === 0) return removeGroup(state, group.id);
  const activeTabId =
    group.activeTabId === tabId
      ? neighbourAfterRemoval(tabIds, removedIndex)
      : group.activeTabId;
  return {
    ...state,
    groups: { ...state.groups, [group.id]: { ...group, tabIds, activeTabId } },
  };
}

// Removes a group from both the tree and the group table. The surviving
// sibling is promoted by removeLeaf; when the last group goes, the panel has
// nothing left to show, so it closes (WSP-01).
function removeGroup(state: PanelState, groupId: GroupId): PanelState {
  const order = leafIds(state.root);
  const position = order.indexOf(groupId);
  const root = state.root === null ? null : removeLeaf(state.root, groupId);
  const groups = without(state.groups, new Set([groupId]));

  if (root === null || Object.keys(groups).length === 0)
    return {
      ...state,
      root: null,
      groups: {},
      focusedGroupId: null,
      open: false,
    };

  // Focus follows the group that took the closed one's place on screen,
  // which in in-order terms is whatever now sits at the same position.
  const remaining = leafIds(root);
  const focusedGroupId =
    state.focusedGroupId === groupId || state.focusedGroupId === null
      ? (remaining[Math.min(Math.max(position, 0), remaining.length - 1)] ??
        null)
      : state.focusedGroupId;
  return { ...state, root, groups, focusedGroupId };
}

// The group a new tab should land in: the caller's choice when it is real,
// else the focused group, else the first group on screen.
function targetGroupId(state: PanelState, requested?: GroupId): GroupId | null {
  if (requested !== undefined && requested in state.groups) return requested;
  if (state.focusedGroupId !== null && state.focusedGroupId in state.groups)
    return state.focusedGroupId;
  return leafIds(state.root)[0] ?? null;
}

// The one route by which a tab's context is set after it is opened; see the
// note on TabPatch, which deliberately cannot. Spelled out per type for the
// same reason as `withId`.
function withContext(tab: PanelTab, context: TabContext): PanelTab {
  switch (tab.type) {
    case "changes":
      return { ...tab, context };
    case "files":
      return { ...tab, context };
    case "file":
      return { ...tab, context };
    case "diff":
      return { ...tab, context };
    case "terminal":
      return { ...tab, context };
    case "browser":
      return tab; // a browser tab reads no worktree, so it has no context
  }
}

function withId(tab: NewPanelTab, id: TabId): PanelTab {
  switch (tab.type) {
    case "changes":
      return { ...tab, id };
    case "files":
      return { ...tab, id };
    case "file":
      return { ...tab, id };
    case "diff":
      return { ...tab, id };
    case "terminal":
      return { ...tab, id };
    case "browser":
      return { ...tab, id };
  }
}

// Opens a tab, or reveals the one already addressing the same thing.
//
// The dedupe is a contract, not an optimisation: WSP-09 requires that
// reaching an already-open tab neither re-fetches its content nor loses its
// scroll position, and a second tab pointing at the same file would do both.
// Terminal and browser tabs never dedupe — see sameTarget.
export function openTab(
  state: PanelState,
  tab: NewPanelTab,
  makeId: () => string,
  options?: { groupId?: GroupId },
): PanelState {
  const existing = Object.values(state.tabs).find((open) =>
    sameTarget(open, tab),
  );
  if (existing !== undefined)
    return { ...activateTab(state, existing.id), open: true };

  const id = makeId();
  const created = withId(tab, id);
  const target = targetGroupId(state, options?.groupId);

  if (target === null) {
    // No group at all — the panel was emptied down to nothing, so this tab
    // rebuilds it as the root group.
    const groupId = makeId();
    return {
      ...state,
      root: { type: "group", id: groupId },
      groups: { [groupId]: { id: groupId, tabIds: [id], activeTabId: id } },
      tabs: { ...state.tabs, [id]: created },
      focusedGroupId: groupId,
      open: true,
    };
  }

  const group = state.groups[target];
  if (group === undefined) return state;
  return {
    ...state,
    groups: {
      ...state.groups,
      [target]: { ...group, tabIds: [...group.tabIds, id], activeTabId: id },
    },
    tabs: { ...state.tabs, [id]: created },
    focusedGroupId: target,
    open: true,
  };
}

export function closeTab(state: PanelState, tabId: TabId): PanelState {
  const group = groupOf(state, tabId);
  if (group === null) return state;
  const detached = detachTab(state, group, tabId);
  return { ...detached, tabs: without(detached.tabs, new Set([tabId])) };
}

export function activateTab(state: PanelState, tabId: TabId): PanelState {
  const group = groupOf(state, tabId);
  if (group === null) return state;
  return {
    ...state,
    groups: { ...state.groups, [group.id]: { ...group, activeTabId: tabId } },
    focusedGroupId: group.id,
  };
}

// Moves a tab within its strip or into another group. `index` addresses the
// target strip as it will be *after* the tab has left its old position, so
// moving a tab to the index it already holds is the identity — which is what
// makes an aborted drag (WSP-03) cost nothing.
export function moveTab(
  state: PanelState,
  tabId: TabId,
  targetGroup: GroupId,
  index: number,
): PanelState {
  const source = groupOf(state, tabId);
  const target = state.groups[targetGroup];
  if (source === null || target === undefined) return state;

  if (source.id === target.id) {
    const current = source.tabIds.indexOf(tabId);
    const remaining = source.tabIds.filter((id) => id !== tabId);
    const at = clampIndex(index, remaining.length);
    if (at === current) return state; // nothing to do, so nothing changes
    const tabIds = [...remaining.slice(0, at), tabId, ...remaining.slice(at)];
    return {
      ...state,
      groups: {
        ...state.groups,
        [source.id]: { ...source, tabIds, activeTabId: tabId },
      },
      focusedGroupId: source.id,
    };
  }

  const detached = detachTab(state, source, tabId);
  // detachTab may have removed the emptied source group, but never the
  // target: they are different groups and the target still holds tabs.
  const destination = detached.groups[target.id];
  if (destination === undefined) return state;
  const at = clampIndex(index, destination.tabIds.length);
  const tabIds = [
    ...destination.tabIds.slice(0, at),
    tabId,
    ...destination.tabIds.slice(at),
  ];
  return {
    ...detached,
    groups: {
      ...detached.groups,
      [target.id]: { ...destination, tabIds, activeTabId: tabId },
    },
    focusedGroupId: target.id,
  };
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

// Splits `targetGroup` along the axis matching the edge the tab was dropped
// on and puts the tab alone in the new half (WSP-03).
export function splitGroupWithTab(
  state: PanelState,
  tabId: TabId,
  targetGroup: GroupId,
  edge: PanelEdge,
  makeId: () => string,
): PanelState {
  const source = groupOf(state, tabId);
  if (source === null || !(targetGroup in state.groups)) return state;
  if (state.root === null || !containsLeaf(state.root, targetGroup))
    return state;
  // Dropping a group's only tab on that same group's edge would move the tab
  // out and straight back in, leaving the layout different but the content
  // identical. Nothing to do.
  if (source.id === targetGroup && source.tabIds.length === 1) return state;

  const newGroupId = makeId();
  const splitId = makeId();
  const root = splitLeaf(state.root, targetGroup, {
    splitId,
    axis: edge === "left" || edge === "right" ? "row" : "column",
    leaf: { type: "group", id: newGroupId },
    side: edge === "left" || edge === "top" ? "before" : "after",
  });

  const withNewGroup: PanelState = {
    ...state,
    root,
    groups: {
      ...state.groups,
      [newGroupId]: { id: newGroupId, tabIds: [tabId], activeTabId: tabId },
    },
  };
  // Detach after the split so the source group's leaf is still in the tree
  // when it is looked up — and so that an emptied source is collapsed out of
  // the tree the split just rebuilt.
  const detachFrom = withNewGroup.groups[source.id];
  if (detachFrom === undefined) return state;
  const detached = detachTab(withNewGroup, detachFrom, tabId);
  return { ...detached, focusedGroupId: newGroupId };
}

export function closeGroup(state: PanelState, groupId: GroupId): PanelState {
  const group = state.groups[groupId];
  if (group === undefined) return state;
  const tabs = without(state.tabs, new Set(group.tabIds));
  return { ...removeGroup(state, groupId), tabs };
}

export function focusGroup(state: PanelState, groupId: GroupId): PanelState {
  if (!(groupId in state.groups)) return state;
  return { ...state, focusedGroupId: groupId };
}

export function setGroupSizes(
  state: PanelState,
  splitId: string,
  sizes: [number, number],
): PanelState {
  if (state.root === null) return state;
  // setSplitSizes hands back the identical tree when the split is absent.
  const root = setSplitSizes(state.root, splitId, sizes);
  return root === state.root ? state : { ...state, root };
}

export function setPanelWidth(state: PanelState, width: number): PanelState {
  if (!Number.isFinite(width)) return state;
  const clamped = Math.min(
    Math.max(Math.round(width), PANEL_MIN_WIDTH),
    PANEL_MAX_WIDTH,
  );
  return clamped === state.width ? state : { ...state, width: clamped };
}

export function setPanelOpen(state: PanelState, open: boolean): PanelState {
  return open === state.open ? state : { ...state, open };
}

export function updateTab(
  state: PanelState,
  tabId: TabId,
  patch: TabPatch,
): PanelState {
  const tab = state.tabs[tabId];
  if (tab === undefined) return state;
  const next = patchTab(tab, patch);
  return { ...state, tabs: { ...state.tabs, [tabId]: next } };
}

// `terminalId` is applied with an explicit `undefined` check because null is
// a meaningful value for it: a terminal whose process has gone is detached
// by patching it back to null.
function patchTab(tab: PanelTab, patch: TabPatch): PanelTab {
  switch (tab.type) {
    case "changes":
      return tab; // a Changes tab has no state of its own to patch
    case "files":
      return { ...tab, search: patch.search ?? tab.search };
    case "file":
      return { ...tab, view: patch.view ?? tab.view };
    case "diff":
      return {
        ...tab,
        collapsedHunks: patch.collapsedHunks ?? tab.collapsedHunks,
      };
    case "terminal":
      return {
        ...tab,
        cwd: patch.cwd ?? tab.cwd,
        terminalId:
          patch.terminalId === undefined ? tab.terminalId : patch.terminalId,
      };
    case "browser":
      return {
        ...tab,
        url: patch.url ?? tab.url,
        history: patch.history ?? tab.history,
        historyIndex: patch.historyIndex ?? tab.historyIndex,
      };
  }
}

// Every structural rule the panel must satisfy, as a list of human-readable
// problems (empty when the state is sound). The tests assert this after
// every operation, and panelStorage rejects a persisted record that fails
// it — a record whose tree references a missing group parses fine but would
// render a blank half of the panel (WSP-04: never referenced-but-absent).
export function panelStateProblems(state: PanelState): string[] {
  const problems: string[] = [];
  const treeGroups = leafIds(state.root);
  const seenLeaves = new Set<GroupId>();

  for (const groupId of treeGroups) {
    if (seenLeaves.has(groupId))
      problems.push(`group ${groupId} appears twice in the tree`);
    seenLeaves.add(groupId);
    if (!(groupId in state.groups))
      problems.push(`tree references unknown group ${groupId}`);
  }

  const groupIds = Object.keys(state.groups);
  for (const groupId of groupIds)
    if (!seenLeaves.has(groupId))
      problems.push(`group ${groupId} is not in the tree`);

  const owner = new Map<TabId, GroupId>();
  for (const [groupId, group] of Object.entries(state.groups)) {
    if (group.id !== groupId)
      problems.push(`group ${groupId} is keyed as ${group.id}`);
    // An empty group is only ever the whole panel waiting for its first tab;
    // one sitting beside others would render as a blank tile (WSP-01).
    if (group.tabIds.length === 0 && groupIds.length > 1)
      problems.push(`group ${groupId} is empty`);
    if (group.activeTabId === null && group.tabIds.length > 0)
      problems.push(`group ${groupId} shows nothing`);
    if (group.activeTabId !== null && !group.tabIds.includes(group.activeTabId))
      problems.push(`group ${groupId} activates a tab it does not hold`);
    for (const tabId of group.tabIds) {
      if (!(tabId in state.tabs))
        problems.push(`group ${groupId} references unknown tab ${tabId}`);
      const existing = owner.get(tabId);
      if (existing !== undefined)
        problems.push(`tab ${tabId} is in both ${existing} and ${groupId}`);
      owner.set(tabId, groupId);
    }
  }

  for (const [tabId, tab] of Object.entries(state.tabs)) {
    if (tab.id !== tabId) problems.push(`tab ${tabId} is keyed as ${tab.id}`);
    if (!owner.has(tabId)) problems.push(`tab ${tabId} belongs to no group`);
  }

  // Opening a tab that addresses something already open reveals the open one
  // instead of stacking a second on top of it (WSP-09: reaching an
  // already-open tab must not re-fetch its content or lose its scroll
  // position). That dedupe used to be enforced at open time only, so it was
  // a rule about one operation rather than about the panel. It is a rule
  // about the panel: two tabs rendering the same content, each doing the
  // same work, is a state nothing may produce. Terminal and browser tabs are
  // never the same target, so several of either remain sound (WSP-07).
  const seen: PanelTab[] = [];
  for (const tab of Object.values(state.tabs)) {
    const twin = seen.find((other) => sameTarget(other, tab));
    if (twin !== undefined)
      problems.push(`tab ${tab.id} and tab ${twin.id} address the same thing`);
    seen.push(tab);
  }

  if (state.focusedGroupId !== null && !(state.focusedGroupId in state.groups))
    problems.push(`focus points at unknown group ${state.focusedGroupId}`);

  return problems;
}

// Gives a context to a tab restored without one (D-1: the v1 inspector
// record names only a tab type, because the shipped inspector followed the
// focused pane and never stored which thread its content belonged to).
//
// Binding is not a plain `updateTab`, because it can create a duplicate that
// nothing else would ever collapse: `openTab` dedupes at open time only, and
// two Changes tabs of one scope are structurally sound, so a migrated tab
// bound to a scope the user has already opened a tab for would sit beside it
// forever with an identical title. The collision is resolved the way opening
// a duplicate is — one tab survives and is revealed — and the survivor is
// the older of the two, since that is the one the user has been reading.
export function bindTabContext(
  state: PanelState,
  tabId: TabId,
  context: TabContext,
): PanelState {
  const tab = state.tabs[tabId];
  // A browser tab's null context is permanent and correct: it reads no
  // worktree at all.
  if (tab === undefined || tab.type === "browser" || tab.context !== null)
    return state;

  const boundTab = withContext(tab, context);
  const bound: PanelState = {
    ...state,
    tabs: { ...state.tabs, [tabId]: boundTab },
  };
  const duplicate = Object.values(bound.tabs).find(
    (other) => other.id !== tabId && sameTarget(other, boundTab),
  );
  if (duplicate === undefined) return bound;

  // Insertion order is creation order, and it survives the JSON round trip
  // the panel record makes, so it is a usable "which came first".
  const order = Object.keys(bound.tabs);
  const keepId =
    order.indexOf(tabId) <= order.indexOf(duplicate.id) ? tabId : duplicate.id;
  const dropId = keepId === tabId ? duplicate.id : tabId;
  return activateTab(closeTab(bound, dropId), keepId);
}
