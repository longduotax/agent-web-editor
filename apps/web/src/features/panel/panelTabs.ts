import type { ProjectId, TerminalId, ThreadId } from "@pi-web/contracts";

// A workspace-panel tab: a durable, independently addressed view (WSP-02).
// Everything a tab needs to come back exactly as it was left lives on the tab
// itself, because the panel is restored from device-local storage (WSP-04)
// with no help from the server.

export type TabId = string;

export interface TabContext {
  projectId: ProjectId;
  threadId: ThreadId;
  // Execution-scope identity: the project id for a shared thread, the
  // worktree id for an isolated one. Two tabs with the same (projectId,
  // scopeKey) read the same working tree, which is what makes them
  // interchangeable to the user.
  scopeKey: string;
  label: string; // short human label for the worktree chip
}

// `context` is nullable on every thread-bound tab because a tab migrated
// from the v1 inspector preference records only its type — the shipped
// inspector followed the focused pane, so it never stored which thread its
// content belonged to. Rather than invent a context, the migration restores
// the tab with a null one and the UI binds it to the focused pane on first
// render. A null context is never treated as equal to any other (see
// sameTarget): an unknown scope cannot be proven to address the same thing.
export type PanelTab =
  | { id: TabId; type: "changes"; context: TabContext | null }
  | {
      id: TabId;
      type: "files";
      context: TabContext | null;
      search: string;
      // The workspace-relative paths of the directories the user has
      // expanded. On the tab rather than in component state because WSP-05
      // requires clearing a search to restore the tree at exactly its
      // previous expansion, and because WSP-04 requires that expansion to
      // survive a reload and a drag between groups.
      expanded: string[];
      // The explicit opt-in to seeing paths the working tree's ignore rules
      // match. Off by default: a dependency directory must not be able to
      // bury the project's own files.
      showIgnored: boolean;
    }
  | {
      id: TabId;
      type: "file";
      context: TabContext | null;
      path: string;
      view: "preview" | "source";
    }
  | {
      id: TabId;
      type: "diff";
      context: TabContext | null;
      path: string;
      collapsedHunks: string[];
    }
  | {
      id: TabId;
      type: "terminal";
      context: TabContext | null;
      cwd: string;
      // null once the process is gone or not yet attached. A restored
      // terminal always starts null so it re-attaches or restarts rather
      // than claiming a process it does not have (WSP-07).
      terminalId: TerminalId | null;
    }
  | {
      id: TabId;
      type: "browser";
      context: null; // a browser tab reads no worktree, so it has no context
      url: string;
      history: string[];
      historyIndex: number;
    };

// A tab that has not been created yet: everything but its id. openTab takes
// this shape so a duplicate can be recognised before an id is minted.
export type NewPanelTab = PanelTab extends infer T
  ? T extends { id: TabId }
    ? Omit<T, "id">
    : never
  : never;

// Last non-empty path segment, so "a/b/c.ts" and "a/b/c.ts/" both read "c.ts".
function basename(path: string): string | null {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? null;
}

// The short label shown on the tab strip. Deliberately not unique: two tabs
// of the same file from different worktrees share a title and are told apart
// by their worktree chip (WSP-02).
export function tabTitle(tab: NewPanelTab): string {
  switch (tab.type) {
    case "changes":
      return "Changes";
    case "files":
      return "Files";
    case "file":
    case "diff":
      return basename(tab.path) ?? "Untitled";
    case "terminal":
      return basename(tab.cwd) ?? "Terminal";
    case "browser":
      return browserTitle(tab.url);
  }
}

/**
 * The whole of what a tab addresses: its tooltip, and what tells two tabs
 * apart when their titles do not (J6).
 *
 * `docs/README.md` and `frontend/node_modules/flatted/README.md` both title
 * as `README.md`, both computed the accessible name "README.md", the tab
 * carried no `title` at all, and both close controls read "Close README.md".
 * Browsing a repository produces that collision constantly — `README.md`,
 * `index.ts`, `package.json` — and the file-tree row that opened the tab
 * carries the full path on its own tooltip while the tab it opened did not.
 */
export function tabTooltip(tab: PanelTab): string {
  switch (tab.type) {
    case "file":
    case "diff":
      return tab.path;
    case "terminal":
      return tab.cwd;
    case "browser":
      return tab.url.trim() === "" ? tabTitle(tab) : tab.url;
    case "changes":
    case "files":
      return tabTitle(tab);
  }
}

/**
 * What each tab is CALLED in the strip, once its neighbours are taken into
 * account.
 *
 * A title is the basename until two open tabs share one while addressing
 * different things; then each of them grows a parent directory, and another,
 * until it is unique — the conventional editor answer, and the shortest
 * label that is still unambiguous.
 *
 * Two tabs addressing the SAME thing are deliberately left alone. That is a
 * file open against two worktrees, which WSP-02 tells apart with the
 * worktree chip; prefixing both with an identical directory would add noise
 * and disambiguate nothing.
 */
export function tabTitles(tabs: readonly PanelTab[]): Record<TabId, string> {
  const sharing = new Map<string, PanelTab[]>();
  for (const tab of tabs) {
    const title = tabTitle(tab);
    const group = sharing.get(title);
    if (group === undefined) sharing.set(title, [tab]);
    else group.push(tab);
  }
  const titles: Record<TabId, string> = {};
  for (const [title, group] of sharing) {
    const distinct = new Set(group.map((tab) => tabTooltip(tab)));
    for (const tab of group)
      titles[tab.id] = distinct.size <= 1 ? title : distinguish(tab, group);
  }
  return titles;
}

/** The shortest tail of this tab's target that no sibling's tail matches. */
function distinguish(tab: PanelTab, group: readonly PanelTab[]): string {
  const own = segmentsOf(tabTooltip(tab));
  const others = group
    .filter(
      (other) => other.id !== tab.id && tabTooltip(other) !== tabTooltip(tab),
    )
    .map((other) => segmentsOf(tabTooltip(other)));
  for (let take = 2; take <= own.length; take += 1) {
    const label = own.slice(-take).join("/");
    if (others.every((other) => other.slice(-take).join("/") !== label))
      return label;
  }
  return own.join("/");
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function browserTitle(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "New tab";
  try {
    // The host carries the port, which is the part that distinguishes one
    // local dev server from another — the whole point of this tab (WSP-08).
    const host = new URL(trimmed).host;
    if (host.length > 0) return host;
  } catch {
    // A half-typed address is not an error state; show it as typed.
  }
  return trimmed;
}

// Same execution scope: the project plus the worktree the tab reads from. A
// null context matches nothing, including another null one.
function sameScope(a: TabContext | null, b: TabContext | null): boolean {
  if (a === null || b === null) return false;
  return a.projectId === b.projectId && a.scopeKey === b.scopeKey;
}

// True when two tabs address the identical thing, so opening the second
// should reveal the first instead of stacking a duplicate on top of it
// (WSP-09: switching to an already-open tab must not re-fetch what is
// already there).
//
// Each branch tests `b`'s own type rather than relying on an earlier
// `a.type !== b.type` guard: a comparison the compiler cannot carry across
// two independent unions is one a reader cannot carry either, and File and
// Diff both hold a path, so "same path, therefore same target" is only true
// once both sides are known to be the same one of the two.
export function sameTarget(a: NewPanelTab, b: NewPanelTab): boolean {
  switch (a.type) {
    // Asking for a terminal means "give me another shell" (WSP-07 allows
    // several per scope) and asking for a browser tab means "give me another
    // viewport", so neither is ever the same target as anything — deduping
    // either would take away the only way to get a second one.
    case "terminal":
    case "browser":
      return false;
    case "changes":
      return b.type === "changes" && sameScope(a.context, b.context);
    case "files":
      return b.type === "files" && sameScope(a.context, b.context);
    case "file":
      return (
        b.type === "file" &&
        sameScope(a.context, b.context) &&
        a.path === b.path
      );
    case "diff":
      return (
        b.type === "diff" &&
        sameScope(a.context, b.context) &&
        a.path === b.path
      );
  }
}

// The addresses a Browser tab may hold: `http` and `https`, and nothing else
// (WSP-08). Applied wherever an address enters the tab — including when it
// is read back from device-local storage, because that record is an
// arbitrary string under a key any script on the origin can write, and a
// `javascript:` address that reaches an `iframe` `src` runs on the
// workspace's own origin.
export function isEmbeddableAddress(address: string): boolean {
  try {
    const { protocol } = new URL(address);
    return protocol === "http:" || protocol === "https:";
  } catch {
    // Not an absolute address at all: a half-typed one is not embeddable
    // either, and the tab shows its no-address state.
    return false;
  }
}

// Whether a tab of this type can only exist against a thread's execution
// scope. Everything that reads the filesystem or Git does; a browser tab
// does not, which is what lets the `+` menu still offer something when no
// chat pane owns a thread (WSP-02).
export function tabNeedsThread(type: PanelTab["type"]): boolean {
  return type !== "browser";
}
