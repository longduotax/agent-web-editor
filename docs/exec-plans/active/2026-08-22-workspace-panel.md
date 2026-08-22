# Workspace panel implementation plan

**Status:** Ready

**Plan version:** 1

**Technical approval:** Approved for plan version 1 (user, 2026-08-22)

**Subsystem:** Browser workspace composition — the docked right-hand panel, its
tab groups and durable tabs, and the server multi-terminal, terminal-cwd, and
URL-probe boundaries those tabs require

**Affected paths or contracts:** new `apps/web/src/features/layout/**`, new
`apps/web/src/features/panel/**`, `apps/web/src/features/workspace/layoutTree.ts`
(internals only; public API and persisted format unchanged),
`apps/web/src/App.tsx`, `apps/web/src/App.test.tsx`, `apps/web/src/styles.css`,
`apps/web/src/features/TerminalView.tsx`,
`apps/web/src/features/settings/SettingsPage.tsx`,
`apps/web/src/inspectorPreferences.ts` (deleted),
`apps/web/src/api/client.ts`, new `apps/server/src/terminal/cwd.ts`,
`apps/server/src/terminal/manager.ts`, new `apps/server/src/browser/probe.ts`,
`apps/server/src/app.ts`, `packages/contracts/src/index.ts` (terminal client and
server frames, a terminals-listing response, a browser-probe request and
response), `apps/web/package.json` (Shiki), and the design and architecture
documents named below. No database, migration, agent-runtime, or Pi-adapter
change.

**Governing specification:** [Workspace panel](../../product-specs/workspace-panel.md)
— WSP-01 through WSP-10

**Related documents or issue:**
[Codex-style workspace surface](../../product-specs/codex-workspace-surface.md)
(CWS-06 superseded by the governing spec),
[Codex-style workspace surface implementation plan](2026-08-22-codex-workspace-surface.md)
(the baseline this replaces),
[Tiling workspace surface](../../product-specs/tiling-workspace-surface.md)
(chat surface, unchanged),
[Inspector and terminal boundaries](../../design/inspector-and-terminal.md)
(revised here),
[Local-client security](../../design/local-client-security.md) (revised here),
[Web workspace composition](../../design/web-workspace-composition.md),
[Architecture overview](../../architecture/overview.md),
[Parse, Don't Validate](../../architecture/data-boundaries.md).

**Last updated:** 2026-08-22

## Working specification and approval context

Governing product specification:
[Workspace panel](../../product-specs/workspace-panel.md), proposed version 1,
approved by the user on 2026-08-22 **from the design as presented in session**,
which the user approved and directed to implementation. The user has not yet
read the specification document itself; a discrepancy between it and that
discussion resolves in favour of the discussion, returns the proposal to Draft,
and invalidates this plan's technical approval. No question in its Open product
questions section remains open. This plan implements WSP-01 through WSP-10 and
performs the CWS-06 supersession bookkeeping the spec requires.

Product behavior change: yes, and it is the whole point of the change. The
shipped `Changes | Files | Terminal` inspector is removed and replaced. The
behavior invariants this plan preserves explicitly:

- the **chat surface** is untouched — binary tiling tree, dividers,
  split-to-new-chat-pane, per-project device-local layout, pane headers, run
  status, keybindings, and server authority over threads and runs all keep
  their current behavior and their current persisted format;
- the file, Git, and diff **server** boundaries keep their current containment,
  bounding, and redaction rules; this plan adds routes, it does not loosen any
  existing one;
- device-local preferences stay device-local; nothing about the panel is sent
  to or sourced from the server.

Technical approval covers, specifically: extracting the binary-tree operations
into a generic module rather than writing a second tree; deleting the inspector
outright in milestone 2 with no feature flag and no parallel run; rekeying the
server's terminal owners from execution scope to terminal id; adding a
server-side URL probe that fetches a user-typed address; and adding Shiki as a
dynamically imported dependency.

## Purpose and user-visible outcome

The user gets a workspace panel that behaves like the tool panels of a desktop
editor: several views open at once in tab groups they can split and rearrange by
dragging, each view durably pointing at the worktree it was opened against, and
all of it still there — same tabs, same directories, same running shells — after
a reload. Concretely, that means holding a diff and the terminal that produced it
side by side, running more than one shell per worktree, reading a rendered
document without losing the file list behind it, and watching a local dev server
without leaving the workspace.

The complete behavioral rules live in the governing specification; this plan
links them rather than restating them.

## Requirement traceability

| Spec requirement                                                                                      | Technical consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Verification                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WSP-01](../../product-specs/workspace-panel.md#wsp-01--the-panel-is-a-tiling-area-of-tab-groups)     | `apps/web/src/features/layout/binaryTree.ts` holds the geometry; `panelModel.ts` instantiates it as `TreeNode<"group", GroupId>`; `PanelSurface.tsx` renders splits with the same divider affordance the chat surface uses; empty group is removed and its sibling promoted; last tab closing sets `root = null, open = false`.                                                                                                                                                               | `binaryTree.test.ts` (promotion, clamping, split ids); `panelModel.test.ts` (`closeGroup` promotes sibling, last-tab close closes the panel); `PanelSurface.test.tsx` (dividers resize, rail replaces the panel when closed).                                                                                                                                                                         |
| [WSP-02](../../product-specs/workspace-panel.md#wsp-02--tabs-are-durable-and-carry-their-own-context) | Every tab record carries a frozen `TabContext`; the panel never reads `focusedThreadId` except to seed a **new** tab and to decide whether to render the worktree chip; the `+` menu filters by `tabNeedsThread`; an unresolvable context renders an unavailable state with a close action.                                                                                                                                                                                                   | `panelModel.test.ts` (focus change is not an input to any operation); `App.test.tsx` (focus a second pane, assert every tab's content and context are unchanged and the chip appears); `PanelTabContent.test.tsx` (unavailable state).                                                                                                                                                                |
| [WSP-03](../../product-specs/workspace-panel.md#wsp-03--tabs-are-rearranged-by-dragging)              | `moveTab`, `reorderTab`, and `splitGroupWithTab(edge)` are pure model operations; `useTabDrag.ts` maps pointer and keyboard gestures onto them; drop zones are computed per visible group (strip, centre, four edges) and are only mounted during a drag; cancel restores the pre-drag state object by reference.                                                                                                                                                                             | `panelModel.test.ts` (each operation, plus own-group-centre is referentially identity); `TabDrag.test.tsx` (`Escape` and outside-release leave the state object identical; a moved terminal tab keeps its `terminalId`).                                                                                                                                                                              |
| [WSP-04](../../product-specs/workspace-panel.md#wsp-04--panel-geometry-and-device-local-persistence)  | `panelStorage.ts` reads and writes a zod-validated record at `pi-workspace:panel` version 2, migrating `pi-workspace:inspector` version 1; the panel's outer edge keeps the existing keyboard-operable separator; `PANEL_MIN_WIDTH` and a per-group minimum are enforced in the model, not only in CSS.                                                                                                                                                                                       | `panelStorage.test.ts` (round trip; v1 migration; malformed, unknown version, and dangling-tab-reference all reset to one `Changes` tab; no persisted tab is dropped silently); `App.test.tsx` reload assertion.                                                                                                                                                                                      |
| [WSP-05](../../product-specs/workspace-panel.md#wsp-05--files-and-file-tabs)                          | `FilesTab` reuses the existing bounded `getFiles` query and opens a `File` tab instead of previewing in place; `FileTab` renders markdown through the existing `react-markdown` configuration with raw HTML and remote images disabled, and non-markdown text through a dynamically imported Shiki highlighter over theme tokens.                                                                                                                                                             | `FilesTab.test.tsx` (activation opens a tab, list survives); `FileTab.test.tsx` (markdown preview and source toggle; plain text paints before the highlighter resolves; binary, oversized, truncated, missing, inaccessible states; no editing control; copy-path is relative).                                                                                                                       |
| [WSP-06](../../product-specs/workspace-panel.md#wsp-06--changes-and-diff-tabs)                        | `parseUnifiedDiff.ts` turns the existing `GitDiffResponse` staged/unstaged strings into hunks with old/new line numbers; `DiffTab` renders labelled sections, collapsible hunks, retained `+`/`-` prefixes, a sticky header with counts, and an explicit truncation notice. The server diff contract is unchanged.                                                                                                                                                                            | `parseUnifiedDiff.test.ts` (headers, counts, renames, no-newline marker, malformed input degrades to raw text); `DiffTab.test.tsx` (sections, collapse, dual gutters, sticky header, truncation).                                                                                                                                                                                                     |
| [WSP-07](../../product-specs/workspace-panel.md#wsp-07--terminal-tabs)                                | `ProjectTerminalManager.owners` is rekeyed by `TerminalId` with a `scopeId -> Set<TerminalId>` index and a per-scope cap of 8; the `attach` frame gains optional `terminalId` and `cwd`; a `create` frame is added; `GET …/terminals` lists live terminals for the scope; `terminal/cwd.ts` polls the working directory at most 1 Hz while attached and pushes a `cwd` server frame.                                                                                                          | `manager.test.ts` (N per scope, cap rejection, re-attach by id, cross-scope id rejected, spawn cwd containment, disposal); `cwd.test.ts` (Linux, macOS, unsupported platform, timeout, non-UTF-8); `app.test.ts` (listing route); `TerminalTab.test.tsx` (reload re-attaches, gone state, per-tab warning).                                                                                           |
| [WSP-08](../../product-specs/workspace-panel.md#wsp-08--browser-tab)                                  | `POST /api/browser/probe` reports only whether the target refuses framing; `BrowserTab` renders an explicit named state instead of a blank frame; an address whose origin equals the workspace's own is refused at parse time; the iframe is sandboxed with `allow-same-origin` but **without** either top-navigation token, so the embedded page cannot navigate the workspace away; production CSP gains `frame-src http: https:` while `X-Frame-Options: DENY` on our own responses stays. | `probe.test.ts` (scheme allowlist, same-origin refusal before any request, redirect bound, timeout, body never read or returned, `X-Frame-Options` and `frame-ancestors` detection); `app.test.ts` (CSP header contains `frame-src http: https:` and still `frame-ancestors 'none'`); `BrowserTab.test.tsx` (blocked, unreachable, and self-origin states, address restore, exact sandbox token set). |
| [WSP-09](../../product-specs/workspace-panel.md#wsp-09--the-panel-stays-responsive)                   | Tab bodies stay mounted and are hidden with `hidden`/`content-visibility` rather than unmounted; every query and timer in a tab body is gated on `isVisible`; the file list keeps the existing 200-row render cap and the debounced search with `keepPreviousData`; diffs and previews cap rendered lines with an explicit notice; drag and resize mutate only geometry.                                                                                                                      | `Panel.perf.test.tsx` (hidden tab issues no query and runs no timer; switching back keeps scroll offset; a moved tab does not remount its terminal); existing `useDebouncedValue` tests retained; `App.test.tsx` search assertions retained.                                                                                                                                                          |
| [WSP-10](../../product-specs/workspace-panel.md#wsp-10--keyboard-accessibility-and-defined-states)    | `panelKeybindings.ts` is a single table of `{ id, keys, label, command }`; the handler dispatches from it and `SettingsPage` renders the same table, so an inert binding cannot be advertised; the tab strip is a real `tablist`; drag is mirrored by a keyboard move mode with `aria-live` announcements; a closed panel is `inert`.                                                                                                                                                         | `panelKeybindings.test.ts` (every advertised id resolves to a command and every command is advertised); `TabStrip.test.tsx` (roles, selection, roving focus); axe checks in every tab-body test; `SettingsPage.test.tsx` (list matches the table).                                                                                                                                                    |

## Current behavior and affected invariants

**The inspector.** `apps/web/src/App.tsx` lines 796–1215 hold `Inspector`,
`PanelRightIcon`, `inspectorMaxWidth`, and `DiffText`. `Inspector` owns one
`selectedPath`, one `search`, four TanStack queries gated on the active tab, and
the width-resize separator. `ProjectWorkspace` (lines 1216–1300) reads
`readInspectorPreferences()`, mirrors it to localStorage on every change,
tracks `focusedThreadId`, and remounts `Inspector` with `key={focusedThreadId}`
so the selected file, the search box, and every in-flight query are discarded
whenever chat focus moves. That remount is exactly the behavior WSP-02 removes.
`WorkspaceLayout` (lines ~1360–1470) carries `inspectorAvailable`,
`inspectorOpen`, `inspectorWidth`, the `.inspector-*` class names, the
`.inspector-rail` reopen control, and a mobile `drawer === "inspector"` state.

**The layout tree.** `apps/web/src/features/workspace/layoutTree.ts` already
contains the whole binary-tree algorithm the panel needs — `replaceNode`,
`removeLeaf`, `leafIds`, `nodeContains`, `setSplitSizes`, `normalizeSizes`, and
the `MIN_SIZE_FRACTION = 0.05` clamp — as module-private functions over a
`PaneNode | SplitNode` union that narrows on `type`. Its persisted format is
version 2 and is validated by `LayoutNodeSchema` in `layoutStorage.ts`.

**Terminals.** `ProjectTerminalManager` keys `owners` and `pendingOwners` by
`scopeId`, and `activeOwner` resolves a terminal by looking up the scope and
then requiring `owner.id === terminalId`. That is the one-PTY-per-scope
invariant. `attach` has no terminal id and no spawn directory: it takes the
execution root and returns whatever owner the scope already has, so a reload
re-attaches by luck of the scope key rather than by identity, and a second
terminal in one worktree is unrepresentable. `restart` disposes and recreates in
the same scope slot, so the terminal id changes across a restart and the client
learns the new one from the `ready` frame. `apps/server/src/app.ts` lines
560–620 relay every terminal frame and collapse **every** failure — malformed
frame, unknown thread, dead terminal, oversized input — into one untyped
`error` frame reading "Terminal command was rejected."

**Execution scope.** `ThreadExecutionContextResolver.resolve` returns
`scopeId = projectId` for a shared thread and `scopeId = worktreeId` for an
isolated one, plus a verified `executionRoot`. Both branded ids are UUIDs, which
is why `TerminalIdSchema.parse(rawScopeId)` in the manager happens to succeed
today; see Discoveries.

**Request policy.** Reads need only an exact `Host`; mutations additionally need
an exact `Origin` and `X-Pi-Web-Request: 1`. Production static responses set a
CSP with `default-src 'self'` and no `frame-src`, plus `X-Frame-Options: DENY`
and `Referrer-Policy: no-referrer`. There is no CSP in development, where Vite
serves the SPA.

## Scope, non-goals, assumptions, and unresolved technical decisions

**In scope.** Everything the governing specification requires, plus the server
work WSP-07 and WSP-08 depend on, plus the removal of the inspector and every
`inspector` identifier, class name, and test that names it.

**Out of scope**, restating the spec's non-goals as technical boundaries: no
write path to the filesystem or Git; no bottom or left dock and no unified tree
mixing chat panes with panel tabs; no torn-off window; no header-rewriting
proxy for the browser tab; no server-side or cross-device panel state; no PTY
persistence across a server restart.

**Assumptions.**

- The chat surface's layout record stays version 2. This plan changes
  `layoutTree.ts` internals only, so no chat layout migration exists to get
  wrong.
- The existing `getFiles` / `getFile` / `getStatus` / `getDiff` contracts are
  sufficient for the Files, File, Changes, and Diff tabs. Nothing in WSP-05 or
  WSP-06 needs a new read route; the structure they demand is a browser-side
  parse of data the server already returns.
- Shiki's `createHighlighterCore` with individually imported language and theme
  modules keeps the highlighter out of the entry chunk. Vite 8 code-splits a
  dynamic import automatically; no manual chunk configuration is assumed.

**Unresolved technical decisions:** none blocking. Three were resolved during
planning and are recorded in the decision log: the migrated inspector tab's
missing context (D-1), the typed terminal rejection channel (D-2), and the
iframe sandbox's token set together with the self-origin address refusal that
carries the protection instead (D-3).

## Implementation milestones

Seven milestones, in this order. Each is independently shippable and each ends
with the repository building, the full unit suite green, and no half-wired
surface. Milestone 2 is the only one that removes a shipped feature, and it
delivers its replacement in the same milestone.

### Milestone 1 — Generic binary tree, panel tab model, panel state, storage

Pure modules only. Nothing renders yet; nothing is deleted yet.

**Create `apps/web/src/features/layout/binaryTree.ts`.** Move the tree algorithm
out of `layoutTree.ts` unchanged in behavior and make it generic over the leaf's
discriminant tag and id type:

```ts
export interface TreeLeaf<Tag extends string, Id> {
  type: Tag;
  id: Id;
}
export interface TreeSplit<Tag extends string, Id> {
  type: "split";
  id: string;
  axis: SplitAxis; // "row" | "column"
  children: [TreeNode<Tag, Id>, TreeNode<Tag, Id>];
  sizes: [number, number];
}
export type TreeNode<Tag extends string, Id> =
  TreeLeaf<Tag, Id> | TreeSplit<Tag, Id>;

export const MIN_SIZE_FRACTION = 0.05;
export function leafIds<T extends string, I>(n: TreeNode<T, I> | null): I[];
export function containsLeaf<T extends string, I>(
  n: TreeNode<T, I> | null,
  id: I,
): boolean;
export function replaceLeaf<T extends string, I>(
  n: TreeNode<T, I>,
  id: I,
  make: (leaf: TreeLeaf<T, I>) => TreeNode<T, I>,
): TreeNode<T, I>;
export function removeLeaf<T extends string, I>(
  n: TreeNode<T, I>,
  id: I,
): TreeNode<T, I> | null;
export function setSplitSizes<T extends string, I>(
  n: TreeNode<T, I>,
  splitId: string,
  sizes: [number, number],
): { node: TreeNode<T, I>; found: boolean };
export function normalizeSizes(s: [number, number]): [number, number];
```

Every narrowing is on `node.type === "split"`, never on the leaf tag, which is
what lets one module serve a `"pane"` leaf and a `"group"` leaf. `TreeSplit`
must be generic — the approved sketch wrote it non-generic, but its `children`
are `TreeNode`s and `TreeNode` carries the parameters, so they have to flow
through. `Tag` must never be `"split"`; TypeScript cannot express that
constraint, so add a `// @ts-expect-error` type test asserting
`TreeNode<"split", string>` is rejected at the call sites' construction helper,
and document the rule in the module header.

**Rewrite `layoutTree.ts` over it.** `PaneNode`, `SplitNode`, and `LayoutNode`
become aliases of `TreeLeaf<"pane", PaneId>`, `TreeSplit<"pane", PaneId>`, and
`TreeNode<"pane", PaneId>`. Every exported function keeps its exact current
signature and behavior, including `restoreIntoTree`'s corrupt-`focusedPaneId`
fallback. The leaf's `{ type: "pane" }` shape is unchanged, therefore the
persisted layout record is unchanged, therefore `WORKSPACE_LAYOUT_VERSION` stays
`2`, `LayoutNodeSchema` stays as written, and there is no chat-layout migration.
The acceptance test for this milestone is that
`apps/web/src/features/workspace/layoutTree.test.ts` and
`layoutStorage.test.ts` pass **unedited**.

**Create `apps/web/src/features/panel/panelTabs.ts`** — the tab discriminated
union, its context, and title derivation:

```ts
export type TabId = string;
export interface TabContext {
  projectId: ProjectId;
  threadId: ThreadId;
  // Execution-scope identity: the project id for a shared thread, the
  // worktree id for an isolated one. Two tabs with the same
  // (projectId, scopeKey) read the same working tree.
  scopeKey: string;
  label: string; // short worktree-chip label
}
export type PanelTab =
  | { id: TabId; type: "changes"; context: TabContext | null }
  | { id: TabId; type: "files"; context: TabContext | null; search: string }
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
      terminalId: TerminalId | null;
    }
  | {
      id: TabId;
      type: "browser";
      context: null;
      url: string;
      history: string[];
      historyIndex: number;
    };
export function tabTitle(tab: PanelTab): string;
export function tabNeedsThread(type: PanelTab["type"]): boolean;
```

`context` is structurally nullable on every thread-bound tab, but only two
things ever produce a `null`: a `browser` tab, which reads no worktree, and a
tab restored by the v1 migration, which has no recorded thread to carry (D-1).
Nothing else may create one, and a null context is never treated as equal to
another null context — an unknown scope cannot be proven to address the same
thing. `scopeKey` is on the context rather than derived on demand because the
thread-to-scope mapping lives on the server, and a tab must be able to say which
worktree it reads without a round trip. `tabTitle` derives from the tab's own
state — the basename for `file` and `diff`, the directory basename for
`terminal`, the host for `browser` — and never from the focused chat pane.

**Create `apps/web/src/features/panel/panelModel.ts`.** Groups are the tree's
leaves:

```ts
export type GroupId = string;
export type PanelNode = TreeNode<"group", GroupId>;
export interface PanelGroup {
  tabs: TabId[];
  activeTabId: TabId | null;
}
export interface PanelState {
  open: boolean;
  width: number;
  root: PanelNode | null;
  groups: Record<GroupId, PanelGroup>;
  tabs: Record<TabId, PanelTab>;
  focusedGroupId: GroupId | null;
}
```

Operations, all pure and all returning the same object by reference when they
are no-ops: `openTab`, `closeTab`, `activateTab`, `moveTab(state, tabId,
toGroupId, index)`, `reorderTab`, `splitGroupWithTab(state, groupId, edge,
tabId, makeId)`, `closeGroup`, `setGroupSizes`, `setPanelWidth`, `focusGroup`,
and `updateTab(state, tabId, patch)` for per-tab restorable state. Enforced
invariants, each with its own test: every id in `group.tabs` exists in `tabs`;
every tab id appears in exactly one group; every group id is a leaf of `root`;
`activeTabId` is a member of its group or `null`; a group that loses its last
tab is removed and its sibling promoted; when the last group goes, `root`
becomes `null` and `open` becomes `false`. `setPanelWidth` clamps to
`[PANEL_MIN_WIDTH, panelMaxWidth(viewportWidth)]` using the existing
`DESKTOP_SIDEBAR_WIDTH`/`MIN_THREAD_WIDTH` arithmetic lifted out of `App.tsx`,
and `setGroupSizes` clamps through `normalizeSizes` so no group can be dragged
into an unreadable width.

**Create `apps/web/src/features/panel/panelStorage.ts`.** Key
`pi-workspace:panel`, record version 2, one global record — the same shape of
preference the single global `pi-workspace:inspector` key held, so the migration
is one-to-one with no ambiguity about which project it belongs to. The storage
guard, JSON guard, `safeParse`, and remove-on-malformed structure are copied
from `inspectorPreferences.ts` verbatim before that file is deleted in
milestone 2. Reading:

1. read `pi-workspace:panel`; if it parses against the v2 schema **and** passes
   a referential-integrity check (every group is a leaf, every tab is in exactly
   one group, every `activeTabId` is valid), return it;
2. otherwise read `pi-workspace:inspector`; if it parses against the retained
   private v1 schema, migrate it into one group holding one tab of the recorded
   type with `context: null`, at the recorded `width` and `open`, then write the
   v2 record and remove the v1 key;
3. otherwise remove both keys and return the default: one group, one `Changes`
   tab, `open: false`, `width: 400`.

There is no fourth outcome. A tab reference that cannot be resolved is a full
reset, never a silently dropped tab — that is WSP-04's "never left
referenced-but-absent" clause, and it is a test, not a comment.

**Milestone 1 verification:**
`pnpm --filter @pi-web/web exec vitest run src/features/layout src/features/panel src/features/workspace`
plus `pnpm --filter @pi-web/web build`. The workspace suite must pass with its
tests unedited.

### Milestone 2 — Panel shell, ported tab types, and deletion of the inspector

The panel becomes the product's right-hand surface and the inspector stops
existing. There is no feature flag and no parallel run: two right-hand columns
racing for the same width and the same localStorage key is a worse state than
either alternative, and neither governing specification has a Current version —
CWS-06 is a Draft proposal, the panel spec an Approved one — so nothing shipped
depends on the inspector's contract. The only migration burden is the
localStorage record, and milestone 1 already carries it. Approved by the user on
2026-08-22.

**Create** `PanelSurface.tsx` (renders `PanelNode`, with the divider
pointer/keyboard handling mirrored from `TilingSurface`), `TabGroupView.tsx`,
`TabStrip.tsx` (a real `tablist` with roving `tabindex`), `PanelTabContent.tsx`
(mounts every tab body once and hides inactive ones), `usePanel.ts` (the
controller: state, persistence effect, and command dispatch),
`panelKeybindings.ts` (the single `{ id, keys, label, command }` table),
`ChangesTab.tsx`, `FilesTab.tsx`, and `TerminalTab.tsx`.

The three ported tab types keep their current queries and their current bounded
behavior: `ChangesTab` keeps the `["git", projectId, threadId]` key and the
`summarizeChanges` line; `FilesTab` keeps `useDebouncedValue`,
`keepPreviousData`, and `FILE_LIST_RENDER_LIMIT = 200` with its
"Showing the first N of M" notice; `TerminalTab` wraps the existing
`TerminalView` unchanged for now — it gains multi-terminal and cwd behavior in
milestone 6. In this milestone a `Diff` tab renders the existing labelled
staged/unstaged text through the current `classifyDiff` colouring, and a `File`
tab renders the existing `<pre>` preview; both are replaced properly in
milestones 4 and 5. That keeps this milestone a strict port with no regression
in what the user can see.

**Delete.** From `App.tsx`: `Inspector`, `PanelRightIcon`, `inspectorMaxWidth`,
`DiffText`, the `inspectorPreferences` import and state, and the
`key={focusedThreadId}` remount. `ProjectWorkspace` keeps `focusedThreadId` —
the `+` menu still needs to know which thread a new tab should be opened
against — but nothing else reads it. Delete
`apps/web/src/inspectorPreferences.ts` and `inspectorPreferences.test.ts` after
their guard code has moved into `panelStorage.ts`, and rewrite the inspector
coverage in `App.test.tsx` (the blocks around lines 428, 911, 1514, and 1637)
against the panel.

**Rename inventory.** WSP-02 retires the word "inspector" from the shipped
product, and it is spread wider than the four deleted symbols. This is the
complete list found by audit; work through it as a checklist, because missing
one leaves a half-renamed surface that still reads "inspector" to a user or a
test.

- [ ] `WorkspaceLayout` props in `App.tsx` (~lines 1360–1380): `inspector`,
      `inspectorAvailable`, `inspectorOpen`, `inspectorWidth`,
      `onOpenInspector`, `onCloseInspector`, and the local
      `effectiveInspectorWidth` / `inspectorVisible` — all become `panel*`.
- [ ] Mobile drawer state in `App.tsx` (lines 1379–1484): the
      `"sidebar" | "inspector" | null` union member becomes `"panel"`, along
      with each of its six comparisons and the backdrop/Escape handlers.
- [ ] The nine class names composed on the workspace element and used in
      `styles.css`: `.inspector`, `.inspector-resizer`, `.inspector-tabs`,
      `.inspector-tab-options`, `.inspector-close`, `.inspector-content`,
      `.inspector-rail`, `.inspector-rail-head`, `.inspector-reopen`, plus the
      four state modifiers `.inspector-available`, `.inspector-visible`,
      `.inspector-railed`, `.inspector-open`.
- [ ] The `--inspector-width` CSS custom property (`App.tsx` line ~1414;
      `styles.css` lines ~174, ~1520) becomes `--panel-width`.
- [ ] `styles.css` rule sites: ~lines 164–174, 1389–1540, and the two responsive
      blocks at ~1518–1530 and ~1932–1955. The comments at lines 36–37 and 590
      naming "inspector tabs", "the collapsed inspector rail", and "the
      inspector's own" header row are updated to the panel's tab strip.
- [ ] Accessible names and DOM ids, which tests query by: `"Project inspector"`,
      `"Open inspector panel"`, `"Close inspector panel"`,
      `"Resize inspector panel"`, `"Open inspector drawer"`,
      `"Close inspector drawer"`, `title="Close inspector"`, the
      `inspector-content` id, and the `inspector-tab-${name}` id template.
- [ ] `PaneHeader.test.tsx` line ~126, which reaches into `.inspector-rail-head`
      to assert the shared header height.
- [ ] `e2e/` steps naming the inspector.

After this milestone, `rg -i inspector apps/ packages/ e2e/` must return nothing
outside historical documentation; that command is the milestone's exit check.

**Milestone 2 verification:** `pnpm --filter @pi-web/web exec vitest run`, then
`pnpm --filter @pi-web/web build`, then `pnpm test:e2e --grep workspace` with
the inspector steps rewritten against the panel. Manual: open the panel, open
one tab of each ported type, split the group from the tab menu and from the
keyboard, reload, and confirm the layout returns.

### Milestone 3 — Drag and drop, with keyboard equivalents

`useTabDrag.ts` drives the pure operations from milestone 1. Drop zones are
mounted only while a drag is in progress: per visible group, one strip zone with
per-index insertion points, one centre zone, and four edge zones sized to a
minimum of 15% of the group's short side and at least 32 px so they can be hit
without precision. Each zone highlights individually on pointer entry. Dropping
on the drag's own group centre returns the same state object by reference.
`Escape`, a release outside every zone, and a `pointercancel` all restore the
pre-drag state object by reference — not a rebuilt equal one, so a referential
assertion is a valid test of "leaves the layout exactly as it was".

The keyboard route is a move mode: a bound key on a focused tab enters it,
arrows choose a target zone, `Enter` commits, `Escape` cancels, and each
transition is announced through a polite live region naming the target group and
edge. Every drag action therefore has a keyboard equivalent and every one of
them is a row in `panelKeybindings.ts`, which is also what the Settings page
renders (WSP-10).

**Milestone 3 verification:** `panelModel.test.ts` referential-identity cases,
`TabDrag.test.tsx` with `@testing-library/user-event` pointer and keyboard
sequences, an axe check on a mid-drag render, and an e2e drag that splits a
group at an edge and asserts a moved terminal tab did not reconnect.

### Milestone 4 — File tab: markdown preview, lazy highlighting, bounded states

`FileTab` renders one of: a markdown preview (default for `.md`/`.markdown`)
with an explicit source toggle, using the existing `react-markdown` +
`remark-gfm` configuration with raw HTML disabled and an image renderer that
refuses any non-`data:` remote URL; or highlighted text; or one of the explicit
binary, oversized, truncated, missing, and inaccessible states the server
already reports through `FilePreviewResponse`.

Highlighting is Shiki, added to `apps/web/package.json` and loaded through a
dynamic `import()` inside an effect so it lands in its own chunk and never
blocks first paint. The tab paints plain monospace text first and swaps in
highlighted output when the highlighter resolves; if the import fails or the
language is unknown, the plain text stays and no error is shown. Themes are
generated from the existing CSS tokens rather than a bundled Shiki theme, so a
theme switch re-maps colours with no reload. **The language id is never used to
build an import specifier**: `languageForPath` maps an extension to one of a
fixed allowlist of pre-imported language modules and returns `null` otherwise.
Rendered lines are capped with an explicit "showing the first N lines" notice,
matching the file list's existing render-budget pattern (WSP-09).

**Milestone 4 verification:** `FileTab.test.tsx` with the highlighter module
mocked to a never-resolving promise (asserting readable plain text) and to a
rejecting one (asserting the same); a markdown fixture with a remote image
asserting no request is issued; every explicit state; an axe check in both
themes; and `pnpm --filter @pi-web/web build` showing Shiki in a separate chunk.

### Milestone 5 — Diff tab: structured unified diff

`parseUnifiedDiff.ts` converts a `GitDiffResponse`'s `staged` and `unstaged`
strings into `{ path, hunks: { header, oldStart, newStart, lines: { kind, old,
new, text }[] }[], added, deleted }`. It is a pure parser with its own test
fixtures — clean adds and deletes, renames, a hunk with no trailing newline, an
empty section, and malformed input, which degrades to the raw text rather than
throwing. `DiffTab` renders separately labelled staged and unstaged sections, a
per-hunk collapsible disclosure keyed by hunk header (persisted in the tab's
`collapsed` array), old-side and new-side line-number gutters, retained `+`/`-`
prefix characters so the distinction is never colour-only, a sticky file header
carrying the path and the add/delete counts, and the server's `truncated` flag
as an explicit notice. The server diff contract does not change.

**Milestone 5 verification:** `parseUnifiedDiff.test.ts` over the fixtures;
`DiffTab.test.tsx` for sections, collapse state surviving a tab switch, gutter
values, sticky header counts, and truncation; axe in both themes.

### Milestone 6 — Many terminals per scope, cwd probe, terminal tab

**Rekey the manager.** `ProjectTerminalManager.owners` becomes
`Map<TerminalId, TerminalOwner>` with a companion
`scopeTerminals: Map<string, Set<TerminalId>>`. `activeOwner(projectId,
terminalId, scopeId)` looks the owner up by id and then requires
`owner.projectId === projectId && owner.scopeId === scopeId`, so a terminal id
belonging to another scope is rejected rather than reachable. `pendingOwners`
is keyed by a creation token rather than the scope, since concurrent creates in
one scope are now legitimate. `dispose` removes the owner from both maps.
`terminate(projectId)` with no terminal id iterates all owners filtered by
project, as today. `close()` disposes every owner. A per-scope cap of
`MAX_TERMINALS_PER_SCOPE = 8` is enforced at creation.

**Frames.** In `packages/contracts/src/index.ts`, `attach` gains
`terminalId: TerminalIdSchema.optional()` (re-attach to an existing terminal)
and `cwd: RelativePathSchema.optional()` (spawn directory); a new `create`
frame carries `projectId`, `threadId`, and the same optional `cwd`. The server
`error` frame gains `code: z.enum([...]).optional()` so the cap, a stale id, and
a rejected path are distinguishable typed rejections instead of the single
untyped string `app.ts` sends today (D-2); the cap's code is
`terminal_limit_reached`. A new `cwd` server frame carries `projectId`,
`terminalId`, and `cwd: string | null` — a **workspace-relative** display path,
`""` for the execution root itself, and `null` when the directory cannot be
observed or lies outside the execution root.

**Routes.** `GET /api/projects/:projectId/threads/:threadId/terminals` returns
`{ terminals: { id, cwd }[] }` for the request's execution scope, so a reloaded
browser re-attaches to its still-running shells instead of orphaning them. It is
a read, so it needs only the exact `Host`. `cwd` is the same relative display
value as the `cwd` frame.

**The cwd probe.** New `apps/server/src/terminal/cwd.ts`, one exported
`probeCwd(pid: number): Promise<string | null>`: on Linux, `readlink
/proc/<pid>/cwd`; on macOS, `execFile("/usr/sbin/lsof", ["-a", "-p", String(pid),
"-d", "cwd", "-Fn"], { timeout: 2000, maxBuffer: 64 * 1024 })` — an argument
array, no shell, and the first `n`-prefixed record taken; on every other
platform, `null`. It is called at most once per second and only while at least
one attachment is present, and never at all where it returns `null` for the
platform. The absolute path it returns is reduced against the owner's
`executionRoot` before it leaves the server: equal to the root becomes `""`,
inside the root becomes the relative path, and anything else — including a shell
that has `cd`'d out of the worktree — becomes `null`, because an absolute server
path must never reach the browser. Where the value is `null`, the tab shows the
directory it was started in and labels it as the spawn directory, not the live
one (WSP-07).

This requires a pid the manager does not have today: `PtyProcess` gains
`readonly pid: number | null`, `NodePtyFactory` passes `pty.pid` through, and
the test fake returns `null`, which exercises the unobservable-directory path
for free.

**The tab.** `TerminalTab` opens its own WebSocket, as `TerminalView` already
does per instance, so one socket per terminal tab is retained. On mount it sends
`attach` with its persisted `terminalId` when it has one and `create` otherwise,
carrying its persisted `cwd` as the spawn directory. It records the `terminalId`
from `ready` and the relative directory from every `cwd` frame into its own tab
state through `updateTab`, so both survive a reload. A `terminal_gone` rejection
renders the explicit gone state with a restart action; `terminal_limit_reached`
renders the cap message. The unsandboxed-shell warning renders once per terminal
tab.

**Milestone 6 verification:** `manager.test.ts` for N terminals in one scope, the
cap rejection, re-attach by id, a foreign-scope id rejected, a spawn `cwd`
outside the root rejected, disposal removing both map entries, and no leaked
listeners; `cwd.test.ts` for each platform branch, a timeout, and non-UTF-8
output; `app.test.ts` for the listing route and its scope ownership; a real
`node-pty` smoke test in a generated temporary project only, never against a
user project.

### Milestone 7 — Browser tab, probe endpoint, CSP, and sandboxing

**`apps/server/src/browser/probe.ts`.** `POST /api/browser/probe` takes
`{ url: string }`. The URL is parsed with `new URL()` and its protocol must be
exactly `http:` or `https:`; anything else — `file:`, `data:`, `javascript:`, a
credentialed authority, an unparseable string — is a 400 with a stable code.
**An address whose origin equals the workspace's own origin is rejected here
too**, with its own `same_origin_refused` code, so a self-framing address never
becomes an `iframe` `src`: it fails at parse time, on the server and again in
the client's own parse, not at render time (D-3). The
request is issued with `undici`'s fetch: method `HEAD`, `redirect: "manual"`
with the server following at most three `Location` hops itself so the bound is
enforced rather than trusted, a 5-second total deadline, no client-supplied
headers, no body, no credentials, and no cookie jar. If the target answers 405
or 501 the probe retries once with `GET` and destroys the response body stream
as soon as the headers arrive; that retry counts against the deadline. The
response body is **never read and never returned**. The endpoint replies with
`{ embeddable: boolean, reason: "x-frame-options" | "frame-ancestors" | null,
reachable: boolean }` — three facts derived from `X-Frame-Options` and a
`frame-ancestors` directive in `Content-Security-Policy`, and nothing else. It
is a mutation, so the existing exact-`Origin` and `X-Pi-Web-Request: 1` policy
applies to it unchanged.

**`BrowserTab`.** An address field, back / forward / reload, and an `iframe`.
The address and history position are tab state, persisted through `updateTab`.
An address is parsed before it is committed and before it is restored: the same
`http`/`https` allowlist as the probe, plus **a hard refusal of any address whose
origin equals the workspace's own**, which renders an explicit named state
saying the workspace cannot embed itself. Then the tab probes it; a `blocked`
result renders an explicit state naming the host, saying it blocks embedding,
and offering to open it in a real browser tab, and an unreachable result renders
its own state. A blank or broken frame is never shown. The iframe is

```html
sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox
allow-same-origin"
```

`allow-same-origin` is **present**, and the omissions are what carry the weight:
neither `allow-top-navigation` nor `allow-top-navigation-by-user-activation` is
granted, which is what stops an embedded page navigating the workspace away from
itself — WSP-08's explicit requirement — and that restriction is enforced by the
browser independently of anything the frame does to its own attribute.

For a cross-origin target — and `http://localhost:3000` is cross-origin to our
`http://127.0.0.1:3001`, a different port being a different origin —
`allow-same-origin` grants the frame _its own_ real origin, never ours. It
cannot touch our DOM or our storage. It is exactly as privileged as that page is
in an ordinary browser tab and no more. Withholding it instead gives the frame
an **opaque** origin: no cookies, no `localStorage`, no IndexedDB, which breaks
or subtly misbehaves any dev app with a session, a persisted store, or an auth
token — that is, a large fraction of exactly what this tab exists to display.

The one genuine hazard is framing **our own origin**, where a same-origin frame
could reach `window.parent` and our `localStorage`. That is closed directly by
the same-origin refusal above, which is a precise fix for the actual hole rather
than a broad one that taxes every legitimate page. Recorded honestly:
`allow-scripts` together with `allow-same-origin` lets a frame clear its own
`sandbox` attribute. For cross-origin content that changes nothing real, because
such content already has full ordinary page powers, and the top-navigation
restriction does not depend on the attribute surviving.

`referrerpolicy="no-referrer"` and `allow=""` are set as well.

**CSP.** The production static header in `apps/server/src/app.ts` gains
`frame-src http: https:`; without it `default-src 'self'` blocks the iframe
outright. `frame-ancestors 'none'` and `X-Frame-Options: DENY` on our own
responses stay: they govern who may frame **us**, which this change must not
relax. Development has no CSP, so the tab works there either way; the header
test guards the production path.

**Milestone 7 verification:** `probe.test.ts` against a local fixture server for
the scheme allowlist, a redirect chain of exactly three and of four, a
non-responding host inside and outside the deadline, `X-Frame-Options: DENY` /
`SAMEORIGIN` / absent, a `frame-ancestors` directive, a `HEAD`-refusing server,
and an assertion that the fixture's body bytes are never read; `app.test.ts` for
the exact CSP string and the retained `X-Frame-Options`; `BrowserTab.test.tsx`
for the sandbox attribute's exact value — including that it contains
`allow-same-origin` and contains **neither** top-navigation token — the blocked
and unreachable states, and address restoration. Same-origin refusal is tested
at both ends: the route rejects a self-origin URL with `same_origin_refused`
before issuing any request, and the tab renders its named state without ever
mounting an `iframe`, for a typed address and for one restored from storage.

## Untrusted-data-boundary analysis

| Source and raw representation                                                                                                    | Entry/read point                                                  | Runtime parser                                                                                                                                    | Trusted output and guarantees                                                                                                                                                                             | Failure behavior                                                                                                                                                                                                                        | Boundary tests                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device-local panel record — an arbitrary string under `pi-workspace:panel`, editable by the user and by any script on the origin | `readPanelState()` in `panelStorage.ts`                           | JSON guard, then a zod v2 schema, then a referential-integrity pass (groups are leaves, each tab in exactly one group, `activeTabId` valid)       | A `PanelState` whose tree, groups, and tabs are mutually consistent; widths and sizes clamped; no tab referenced without a record                                                                         | Remove the key and return the default single-`Changes`-tab panel. A dangling reference is a full reset, never a dropped tab                                                                                                             | Round trip; malformed JSON; unknown version; group not a leaf; tab in two groups; `activeTabId` absent; storage throwing                                                                                                              |
| Legacy inspector record — arbitrary string under `pi-workspace:inspector`                                                        | The same read, only after the v2 read misses                      | The retained private v1 zod schema (`version: 1, open, activeTab, width`)                                                                         | One group, one tab of the recorded type at the recorded width and open state, `context: null`; the v1 key is then removed                                                                                 | Falls through to the same default reset                                                                                                                                                                                                 | Each of the three `activeTab` values migrates; out-of-range width; unknown version; the v1 key is gone afterwards                                                                                                                     |
| `cwd` field of the `attach`/`create` terminal client frame — a client-supplied string over the WebSocket                         | `apps/server/src/app.ts` terminal socket handler                  | `TerminalClientFrameSchema` (`RelativePathSchema`), then `resolveContained(executionRoot, cwd)`                                                   | An absolute spawn directory that is the realpath'd execution root or provably under it, used as the PTY's cwd                                                                                             | Typed `error` frame with a `path_rejected` code; no PTY is spawned                                                                                                                                                                      | Absolute, drive, UNC, `..`, encoded `..`, NUL, backslash, empty segment, symlink escaping the root, and a valid nested directory                                                                                                      |
| `terminalId` field of the `attach`/`input`/`resize`/`restart`/`terminate` frames — a client-supplied UUID                        | The same handler, then `activeOwner`                              | `TerminalIdSchema`, then an owner lookup requiring `projectId` **and** `scopeId` to match the request's                                           | A `TerminalOwner` proven to belong to the requesting project and execution scope                                                                                                                          | Typed `error` frame with `terminal_gone`; no write reaches any PTY                                                                                                                                                                      | Unknown id; a live id from another thread's worktree scope; a live id from another project; a disposed id; a well-formed non-UUID                                                                                                     |
| Browser-probe URL — a user-typed string in a POST body                                                                           | `POST /api/browser/probe`                                         | Zod string, then `new URL()`, then a protocol allowlist of exactly `http:`/`https:`, then an **origin check refusing the workspace's own origin** | An absolute `http`/`https` URL, proven not to be this workspace's own origin, fetched with no client-controlled headers, method, or body, at most three redirect hops, a 5 s deadline, and no credentials | 400 with a stable code — `same_origin_refused` for a self-origin address — for a bad scheme, a self-origin address, or an unparseable URL, before any socket is opened; `reachable: false` for a timeout, refusal, or a fourth redirect | Each rejected scheme; a credentialed authority; the workspace's own origin rejected with no request issued; a differing port accepted; three hops accepted and four rejected; a redirect loop; a hanging host; a `HEAD`-refusing host |
| Probe target response — arbitrary remote headers and body from a host the user named                                             | The same route                                                    | Only `X-Frame-Options` and a `frame-ancestors` directive are inspected; the body stream is destroyed unread                                       | Three booleans/enums. No remote bytes, header values, redirect chain, or error text are returned to the browser                                                                                           | Any parse ambiguity resolves to `embeddable: false`, which is the safe direction — the tab shows its explicit state rather than a blank frame                                                                                           | A hostile 1 GiB body is never buffered; header values containing control characters; a `frame-ancestors` list; the response is asserted byte-free                                                                                     |
| Terminal cwd probe output — an OS-provided absolute path from `readlink /proc/<pid>/cwd` or `lsof` stdout                        | `probeCwd` in `apps/server/src/terminal/cwd.ts`, then the manager | Bounded `execFile` (argument array, no shell, 2 s timeout, 64 KiB buffer), UTF-8 decode, first `n` record                                         | A **workspace-relative** display path, `""` for the root, or `null`. Absolute server paths never enter a browser DTO                                                                                      | `null` on a non-zero exit, timeout, unparseable output, unsupported platform, or a directory outside the execution root                                                                                                                 | Each platform branch; a directory outside the root yields `null`; a timeout; non-UTF-8 bytes; a path containing a newline; no shell is invoked                                                                                        |
| Persisted or typed browser-tab address — restored from the panel record, or entered, before it becomes an `iframe` `src`         | `BrowserTab`, on restore and on commit                            | The same `new URL()`, protocol allowlist, **and self-origin refusal** as the probe, applied client-side before the element is rendered            | An `http`/`https` `src` that is provably not this workspace's own origin, on a frame granted neither top-navigation token                                                                                 | The tab renders its named refusal state and mounts **no** `iframe`; a rejected address is cleared from tab state                                                                                                                        | A persisted `javascript:` or `data:` address never becomes an `src`; a persisted self-origin address renders the refusal state and mounts no frame; a persisted valid address survives a reload                                       |
| File extension driving syntax highlighting — derived from a server-supplied path                                                 | `languageForPath` in the File tab                                 | A fixed map from extension to one of a pre-imported allowlist of Shiki language modules                                                           | A language id from a closed set, or `null`                                                                                                                                                                | `null` renders plain monospace text; no highlighter is loaded                                                                                                                                                                           | An unknown extension; an extension-shaped path segment; an assertion that no `import()` specifier is ever built from path text                                                                                                        |

Nothing in this plan is "not applicable": every new field, route, and persisted
value above crosses a boundary and has a parser and a failure behavior.

## Touched-legacy-code analysis

- **`layoutTree.ts` (shipped, tested, persisted).** Its internals are replaced
  by calls into the new generic module; its public API, its behavior, and the
  `{ type: "pane" }` leaf shape in the persisted record are unchanged. The
  guard is that `layoutTree.test.ts` and `layoutStorage.test.ts` pass unedited.
  If any assertion needs editing, the extraction changed behavior and is wrong.
- **`App.tsx` (1500+ lines, route owner).** The inspector's ~420 lines leave and
  nothing replaces them in this file; the panel lives under
  `features/panel/**`. `WorkspaceLayout`'s inspector props, class names, and
  mobile drawer key are renamed rather than duplicated, so no dead
  inspector-shaped branch survives.
- **`inspectorPreferences.ts` (shipped preference).** Deleted, but only after
  its storage guard, JSON guard, and remove-on-malformed structure — which are
  the parts worth keeping — are copied into `panelStorage.ts`, and only after
  its v1 schema is retained there as the migration reader.
- **`ProjectTerminalManager` (shipped, security-relevant).** The one-PTY-per-
  scope invariant is deliberately removed, so every place that relied on
  "look up the scope, then check the id" has to be re-derived from the id.
  The risk is a terminal reachable across scopes; the mitigation is that
  `activeOwner` checks both `projectId` and `scopeId` on every call and has a
  cross-scope test.
- **`app.ts` terminal socket handler.** Its blanket `catch` currently hides the
  difference between a protocol error and a dead terminal. It gains typed codes
  rather than being rewritten, and the untyped fallback message stays for
  genuinely unclassified failures.
- **`App.test.tsx` inspector coverage (four blocks).** Rewritten against the
  panel, not deleted: persistence, the Files search debounce, the Changes states,
  and the follows-the-focused-pane block, whose assertions **invert** — the new
  test asserts a focus change leaves every tab exactly as it was.
- **`PaneHeader.test.tsx`.** One assertion reaches into `.inspector-rail-head`
  to check header alignment; it moves to the renamed class.
- **`TerminalView.tsx`.** Kept as the xterm host and extended, not rewritten:
  its theme-token reading, its `ResizeObserver` fit, and its frame parsing are
  all still correct.

## Verification

Focused, per milestone:

```sh
pnpm --filter @pi-web/web exec vitest run src/features/layout src/features/panel
pnpm --filter @pi-web/web exec vitest run src/features/workspace   # must pass unedited
pnpm --filter @pi-web/web exec vitest run src/App.test.tsx
pnpm --filter @pi-web/server exec vitest run src/terminal src/browser src/app.test.ts
pnpm --filter @pi-web/contracts exec vitest run
```

Final:

```sh
pnpm check      # format:check, lint, typecheck, test, build, test:docs, docs:check
pnpm test:e2e --grep workspace
```

Runtime and manual checks that no unit test covers:

- open a `Diff` tab against thread A and a `Terminal` tab against thread B in
  one group, focus a third chat pane, and confirm both tabs still read their own
  worktrees and both show a worktree chip;
- open two terminals in one worktree, `cd` in one, reload the browser, and
  confirm both re-attach with replay and the changed directory is shown;
- open nine terminals in one scope and confirm the ninth is refused with the cap
  message, not a silent failure;
- point a `Browser` tab at a local dev server, then at a site that sends
  `X-Frame-Options: DENY`, and confirm the second renders the named blocked
  state with a working open-in-browser action;
- point a `Browser` tab at this server's own address and confirm the framed
  document cannot read `pi-workspace:panel`;
- switch themes with a highlighted file, a diff, and a terminal open, and
  confirm all three re-map without a reload;
- run the panel at the minimum width and at three-up chat density and confirm
  the panel never overlaps chat content and the page never scrolls sideways.

## Compatibility, deployment, migration, recovery, and rollback

**Wire compatibility.** The terminal client frames gain optional fields and one
new `create` type; the server `error` frame gains an optional `code`. Both are
additive, and browser and server ship together from one build, so no mixed-
version handshake exists. The terminals-listing route and the browser-probe
route are new. No existing route, response shape, or database schema changes.

**Persisted-state migration.** One record: `pi-workspace:inspector` v1 →
`pi-workspace:panel` v2, performed on read, with the v1 key removed afterwards.
The chat surface's `pi-workspace:layout:<projectId>` record is **not** migrated
and must not be — this plan does not change its shape, and a version bump there
would be a bug, not a feature. Any panel record that fails validation resets to
the default panel; the user loses tab arrangement, never data, because the panel
holds no unsaved content.

**Deployment.** Milestones ship in order. Milestone 2 is the user-visible
switch; the milestones after it add capability to a working panel and can each
stop at any point without leaving a broken surface. Milestones 6 and 7 are the
only ones touching the server and can be deployed independently of each other.

**Recovery.** A PTY that outlives its browser is recovered through the
terminals-listing route rather than orphaned; a PTY the server no longer has is
reported as gone with a restart action. A probe failure degrades the browser tab
to its unreachable state and never blocks the panel. A Shiki import failure
degrades a file to plain text.

**Rollback.** Before milestone 2, rollback is deleting the new modules — nothing
shipped depends on them. After milestone 2, rollback is a revert of the
milestone-2 commit range; the v1 inspector record it consumed will already have
been removed on the user's device, so a rolled-back build starts from the
inspector's own defaults. That loss — one device's panel width and last tab — is
the entire cost of the no-parallel-run decision and is why it was acceptable.

## Progress

- [ ] Milestone 1 — generic binary tree, tab model, panel model, storage
- [ ] Milestone 2 — panel shell, ported tabs, inspector deleted
- [ ] Milestone 3 — drag and drop with keyboard equivalents
- [ ] Milestone 4 — File tab, markdown preview, lazy Shiki
- [ ] Milestone 5 — Diff tab, structured unified diff
- [ ] Milestone 6 — multi-terminal server, cwd probe, terminal tab
- [ ] Milestone 7 — browser tab, probe endpoint, CSP, sandbox
- [ ] Documentation — designs and architecture updated, CWS-06 supersession
      recorded

## Discoveries and blockers

- **`PtyProcess` exposes no pid.** The adapter interface in
  `apps/server/src/terminal/manager.ts` is `write`/`resize`/`kill`/`onData`/
  `onExit` only, so the cwd probe as approved has nothing to probe. Resolved by
  adding `readonly pid: number | null` to `PtyProcess`, passing `pty.pid`
  through in `NodePtyFactory`, and returning `null` from the test fake.
- **`TerminalIdSchema.parse(rawScopeId)`.** The manager validates the execution
  **scope** id with the **terminal** id schema. It passes only because
  `ProjectId`, `WorktreeId`, and `TerminalId` are all UUID brands. The rekeying
  work replaces it with `z.union([ProjectIdSchema, WorktreeIdSchema])`, which is
  what the value actually is.
- **`restart` changes the terminal id.** It disposes the owner and creates a new
  one, then sends a fresh `ready`. With per-tab persistence the tab must adopt
  the new id from that frame or a later re-attach will address a dead terminal.
  The restart path also has to carry the tab's recorded `cwd` forward, since
  WSP-07 requires a restarted terminal to reopen in its directory.
- **The v1 inspector record has no thread.** It stores only `open`, `activeTab`,
  and `width`, but a migrated tab needs a context. Resolved as D-1.
- **The terminal socket's single untyped error.** WSP-07 requires the per-scope
  cap to be "reported as a clear message rather than a silent failure", and the
  current handler cannot express that. Resolved as D-2.
- **`allow-same-origin` is a real risk only for our own origin.** A framed
  `http://localhost:3000` is cross-origin to `http://127.0.0.1:3001` either way
  — a different port is a different origin — so granting it gives that page its
  own origin, never ours, and it can reach neither our DOM nor our storage. The
  hazard exists solely for an address equal to the workspace's own origin, which
  is a case to reject by address rather than to pay for on every page. Resolved
  as D-3.
- No blockers.

## Decision and revision log

- 2026-08-22: Created plan version 1. Technical approval granted by the user for
  plan version 1 the same day, with product approval satisfied by the governing
  specification, so the plan opens at Ready rather than Draft.
- 2026-08-22: **D-1 — a migrated inspector tab carries a null context and adopts
  a thread once.** The v1 record has no project or thread, and the panel record
  is global. Rather than invent a context or drop the user's tab, the migrated
  tab is stored with `context: null`, renders a no-selection state until the
  panel is opened against a chat pane that owns a thread, and binds to that
  thread once and permanently. This is the only exception to WSP-02's
  fixed-at-open rule, it applies to at most one tab on at most one device, and
  it is tested.
- 2026-08-22: **D-2 — typed terminal rejections via an optional `code` on the
  existing `error` server frame**, rather than a new `rejected` frame type.
  Additive, keeps one error path, and lets an old client ignore the code and
  still show the message.
- 2026-08-22: **D-3 — the browser iframe keeps `allow-same-origin` and refuses
  the workspace's own origin by address.** An earlier draft of this plan omitted
  `allow-same-origin` on the stated grounds that it would otherwise let a framed
  page reach workspace storage. That reasoning was wrong for the case that
  matters: `http://localhost:3000` is cross-origin to `http://127.0.0.1:3001`,
  so the token grants such a page _its own_ origin, exactly the privileges it
  has in a normal browser tab, and never ours. Omitting it instead imposes an
  **opaque** origin — no cookies, no `localStorage`, no IndexedDB — on every
  framed page, which breaks or subtly misbehaves any dev app with a session, a
  persisted store, or an auth token, i.e. a large share of the tab's entire
  purpose. That is not an acceptable cost for a protection that was never
  guarding what it claimed.

  The one real hazard — framing our own origin, where a same-origin frame could
  reach `window.parent` and our storage — is closed precisely, by rejecting any
  address whose origin equals the workspace's own at parse time, on the server
  and in the client, before an `iframe` exists. The protection that does the
  work here is the **absence of `allow-top-navigation`** and
  `allow-top-navigation-by-user-activation`, which is what satisfies WSP-08's
  "cannot navigate the workspace away from itself" and holds regardless of
  `allow-same-origin`. Standard caveat recorded rather than glossed:
  `allow-scripts` plus `allow-same-origin` lets a frame clear its own `sandbox`
  attribute; for cross-origin content that changes nothing real, since such
  content already has ordinary page powers and the top-navigation restriction is
  enforced by the browser independently of the attribute. The residual cost is
  small and named: a framed page runs with its own real origin's powers, as it
  would in any tab.

- 2026-08-22: **The inspector is deleted outright in milestone 2**, with no flag
  and no parallel run. Two right-hand columns competing for width and for one
  localStorage key is worse than either end state, and neither governing spec
  has a Current version, so nothing shipped depends on the inspector's contract.
  Approved by the user.
- 2026-08-22: **`layoutTree.ts`'s persisted format is deliberately unchanged.**
  Narrowing on `type === "split"` rather than on the leaf tag lets one generic
  module serve both trees while the `{ type: "pane" }` leaf stays byte-identical
  on disk, so the chat surface needs no migration and its tests need no edits.

## Final outcomes

Not completed.
