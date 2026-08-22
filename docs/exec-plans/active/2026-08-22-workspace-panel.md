# Workspace panel implementation plan

**Status:** Draft

**Plan version:** 2

**Technical approval:** Pending for plan version 2 — the added file-tree and
ignore-rule milestone (milestone 4), which brings a new server listing mode,
ignore-rule parsing at the file boundary, and a persisted-shape change to the
`files` tab, and the added tab-body positioning milestone (milestone 8), which
replaces the body-moving strategy with a positioned layer. Plan version 1 was
approved by the user on 2026-08-22 and every milestone it covered is carried
forward unchanged; that approval is not retracted, and milestones already
implemented stay implemented. What is pending is approval of those two
milestones and of the accessibility and overflow fix items folded into
milestones 3 and 5. Product approval for the governing revision (specification
version 2) was **granted by the user on 2026-08-23**.

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
`apps/server/src/app.ts`, `apps/server/src/inspector/files.ts`, new
`apps/server/src/inspector/ignoreRules.ts`, new
`apps/server/src/inspector/trackedFiles.ts`, new
`apps/web/src/features/panel/FileTree.tsx`,
`apps/web/src/features/panel/FilesTab.tsx`,
`packages/contracts/src/index.ts` (terminal client and
server frames, a terminals-listing response, a browser-probe request and
response, a directory-scoped file-listing query and response),
`apps/web/package.json` (Shiki), `e2e/workspace-panel.spec.ts` (milestone 8's
evidence is end-to-end, because jsdom computes no layout), and the design and
architecture documents named below. No database, migration, agent-runtime, or Pi-adapter
change.

**Governing specification:** [Workspace panel](../../product-specs/workspace-panel.md)
— WSP-01 through WSP-10, with WSP-05 as revised by that specification's
[proposed version 2](../../product-specs/workspace-panel.md#proposed-revision-version-2--the-files-tab-is-a-navigable-ignore-aware-tree)

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

**Last updated:** 2026-08-23

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

**Specification version 2 is approved.** The user approved it on 2026-08-23,
under the same qualification as version 1: the approval is of **the behaviour as
described in session** — the 2026-08-22 report that the Files tab was flooded by
`node_modules` and flat where it should be hierarchical, and the instruction
that followed it — and not of a reading of the specification document. A
discrepancy between that document and that discussion resolves in favour of the
discussion, returns the proposal to Draft, and invalidates this plan's approval
of the milestone that implements it.

**Plan version 2 and specification version 2.** On 2026-08-22, after milestone 2
shipped and the automated suite was green, a hands-on pass at a real repository
found six issues (see Discoveries and blockers). Four are defects against
requirements version 1 already carries; two — the Files tab's flat listing and
its lack of ignore rules — are behavior version 1 does not require, so they are
proposed as **specification version 2**, a bounded revision of WSP-05, which the
user **approved on 2026-08-23** (see the approval context above). Of the four
reported as defects, two were
subsequently **closed as false positives from the inspection tool** (see
Discoveries), leaving one open question and one open defect. This plan version
accordingly:

- adds **milestone 4**, the file tree and ignore rules, and renumbers the
  milestones after it;
- adds **milestone 8**, the positioned tab-body layer, added on 2026-08-23 from
  the decision recorded in the log below, and renumbers the browser-tab
  milestone after it to 9;
- folds the close-control question into **milestone 3** and the file-content
  overflow defect into **milestone 5**, rather than queueing either behind
  feature work;
- keeps the computed-accessible-name and keyboard-walk verification the closed
  findings prompted, in milestone 3, because the episode showed that axe and an
  accessibility-tree dump can mislead in opposite directions;
- adds a standing hands-on UI verification step to every remaining milestone,
  whose findings are confirmed before they become work.

Milestone 4's gate — no production work until specification version 2 is
approved — **is satisfied**: the user approved that version on 2026-08-23. The
milestone was implemented on the coordinator's instruction before that approval
was recorded; the sequence is in Discoveries and blockers, and the approval that
has since been given covers the behaviour that was built. Every other milestone
except milestone 8, added later in plan version 2, is unchanged from plan
version 1 and is covered by that version's technical approval; the defect fix
items are corrections to work already approved, not new scope.

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

| Spec requirement                                                                                                                        | Technical consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WSP-01](../../product-specs/workspace-panel.md#wsp-01--the-panel-is-a-tiling-area-of-tab-groups)                                       | `apps/web/src/features/layout/binaryTree.ts` holds the geometry; `panelModel.ts` instantiates it as `TreeNode<"group", GroupId>`; `PanelSurface.tsx` renders splits with the same divider affordance the chat surface uses; empty group is removed and its sibling promoted; last tab closing sets `root = null, open = false`.                                                                                                                                                                                                                                                                   | `binaryTree.test.ts` (promotion, clamping, split ids); `panelModel.test.ts` (`closeGroup` promotes sibling, last-tab close closes the panel); `PanelSurface.test.tsx` (dividers resize, rail replaces the panel when closed).                                                                                                                                                                                                                                                                                                          |
| [WSP-02](../../product-specs/workspace-panel.md#wsp-02--tabs-are-durable-and-carry-their-own-context)                                   | Every tab record carries a frozen `TabContext`; the panel never reads `focusedThreadId` except to seed a **new** tab and to decide whether to render the worktree chip; the `+` menu filters by `tabNeedsThread`; an unresolvable context renders an unavailable state with a close action.                                                                                                                                                                                                                                                                                                       | `panelModel.test.ts` (focus change is not an input to any operation); `App.test.tsx` (focus a second pane, assert every tab's content and context are unchanged and the chip appears); `PanelTabContent.test.tsx` (unavailable state).                                                                                                                                                                                                                                                                                                 |
| [WSP-03](../../product-specs/workspace-panel.md#wsp-03--tabs-are-rearranged-by-dragging)                                                | `moveTab`, `reorderTab`, and `splitGroupWithTab(edge)` are pure model operations; `useTabDrag.ts` maps pointer and keyboard gestures onto them; drop zones are computed per visible group (strip, centre, four edges) and are only mounted during a drag; cancel restores the pre-drag state object by reference.                                                                                                                                                                                                                                                                                 | `panelModel.test.ts` (each operation, plus own-group-centre is referentially identity); `TabDrag.test.tsx` (`Escape` and outside-release leave the state object identical; a moved terminal tab keeps its `terminalId`).                                                                                                                                                                                                                                                                                                               |
| [WSP-04](../../product-specs/workspace-panel.md#wsp-04--panel-geometry-and-device-local-persistence)                                    | `panelStorage.ts` reads and writes a zod-validated record at `pi-workspace:panel` version 2, migrating `pi-workspace:inspector` version 1; the panel's outer edge keeps the existing keyboard-operable separator; `PANEL_MIN_WIDTH` and a per-group minimum are enforced in the model, not only in CSS.                                                                                                                                                                                                                                                                                           | `panelStorage.test.ts` (round trip; v1 migration; malformed, unknown version, and dangling-tab-reference all reset to one `Changes` tab; no persisted tab is dropped silently); `App.test.tsx` reload assertion.                                                                                                                                                                                                                                                                                                                       |
| [WSP-05](../../product-specs/workspace-panel.md#wsp-05--files-and-file-tabs)                                                            | `FilesTab` reuses the existing bounded `getFiles` query and opens a `File` tab instead of previewing in place; `FileTab` renders markdown through the existing `react-markdown` configuration with raw HTML and remote images disabled, and non-markdown text through a dynamically imported Shiki highlighter over theme tokens.                                                                                                                                                                                                                                                                 | `FilesTab.test.tsx` (activation opens a tab, list survives); `FileTab.test.tsx` (markdown preview and source toggle; plain text paints before the highlighter resolves; binary, oversized, truncated, missing, inaccessible states; no editing control; copy-path is relative).                                                                                                                                                                                                                                                        |
| [WSP-05 as revised by specification version 2](../../product-specs/workspace-panel.md#wsp-05--files-and-file-tabs-revised-by-version-2) | `GET …/files` gains a directory-scoped, single-level `depth=1` mode so the browser expands lazily instead of pulling a 20,000-entry recursive tree; `apps/server/src/inspector/ignoreRules.ts` parses the working tree's ignore files at the boundary and filters **both** the listing and the search; `FileTree.tsx` renders one level at a time, shows a row's own name with the workspace-relative path on its `title` and copy-path, and keeps `expanded` and `showIgnored` in the `files` tab record (panel storage version 3); an active search bypasses the tree and renders flat matches. | `ignoreRules.test.ts` (pattern forms, negation, precedence, absent and unreadable ignore files, a hostile 5 MiB ignore file); `files.test.ts` (single-level listing, ignored paths absent from the listing and from search, opt-in reveal, `.git` still excluded); `FileTree.test.tsx` (expand, collapse, persisted expansion, row name versus tooltip, flat search, expansion restored on clear, accessible names and expanded state); `panelStorage.test.ts` (version 2 record migrates into version 3 with an empty expansion set). |
| [WSP-06](../../product-specs/workspace-panel.md#wsp-06--changes-and-diff-tabs)                                                          | `parseUnifiedDiff.ts` turns the existing `GitDiffResponse` staged/unstaged strings into hunks with old/new line numbers; `DiffTab` renders labelled sections, collapsible hunks, retained `+`/`-` prefixes, a sticky header with counts, and an explicit truncation notice. The server diff contract is unchanged.                                                                                                                                                                                                                                                                                | `parseUnifiedDiff.test.ts` (headers, counts, renames, no-newline marker, malformed input degrades to raw text); `DiffTab.test.tsx` (sections, collapse, dual gutters, sticky header, truncation).                                                                                                                                                                                                                                                                                                                                      |
| [WSP-07](../../product-specs/workspace-panel.md#wsp-07--terminal-tabs)                                                                  | `ProjectTerminalManager.owners` is rekeyed by `TerminalId` with a `scopeId -> Set<TerminalId>` index and a per-scope cap of 8; the `attach` frame gains optional `terminalId` and `cwd`; a `create` frame is added; `GET …/terminals` lists live terminals for the scope; `terminal/cwd.ts` polls the working directory at most 1 Hz while attached and pushes a `cwd` server frame.                                                                                                                                                                                                              | `manager.test.ts` (N per scope, cap rejection, re-attach by id, cross-scope id rejected, spawn cwd containment, disposal); `cwd.test.ts` (Linux, macOS, unsupported platform, timeout, non-UTF-8); `app.test.ts` (listing route); `TerminalTab.test.tsx` (reload re-attaches, gone state, per-tab warning).                                                                                                                                                                                                                            |
| [WSP-08](../../product-specs/workspace-panel.md#wsp-08--browser-tab)                                                                    | `POST /api/browser/probe` reports only whether the target refuses framing; `BrowserTab` renders an explicit named state instead of a blank frame; an address whose origin equals the workspace's own is refused at parse time; the iframe is sandboxed with `allow-same-origin` but **without** either top-navigation token, so the embedded page cannot navigate the workspace away; production CSP gains `frame-src http: https:` while `X-Frame-Options: DENY` on our own responses stays.                                                                                                     | `probe.test.ts` (scheme allowlist, same-origin refusal before any request, redirect bound, timeout, body never read or returned, `X-Frame-Options` and `frame-ancestors` detection); `app.test.ts` (CSP header contains `frame-src http: https:` and still `frame-ancestors 'none'`); `BrowserTab.test.tsx` (blocked, unreachable, and self-origin states, address restore, exact sandbox token set).                                                                                                                                  |
| [WSP-09](../../product-specs/workspace-panel.md#wsp-09--the-panel-stays-responsive)                                                     | Tab bodies stay mounted and are hidden with `hidden`/`content-visibility` rather than unmounted, and from milestone 8 every body host lives in one never-detached layer positioned over its group's rectangle rather than being moved into it; every query and timer in a tab body is gated on `isVisible`; the file list keeps the existing 200-row render cap and the debounced search with `keepPreviousData`; diffs and previews cap rendered lines with an explicit notice; drag and resize mutate only geometry.                                                                            | `Panel.perf.test.tsx` (hidden tab issues no query and runs no timer; switching back keeps scroll offset; a moved tab does not remount its terminal); existing `useDebouncedValue` tests retained; `App.test.tsx` search assertions retained.                                                                                                                                                                                                                                                                                           |
| [WSP-10](../../product-specs/workspace-panel.md#wsp-10--keyboard-accessibility-and-defined-states)                                      | `panelKeybindings.ts` is a single table of `{ id, keys, label, command }`; the handler dispatches from it and `SettingsPage` renders the same table, so an inert binding cannot be advertised; the tab strip is a real `tablist`; drag is mirrored by a keyboard move mode with `aria-live` announcements; a closed panel is `inert`.                                                                                                                                                                                                                                                             | `panelKeybindings.test.ts` (every advertised id resolves to a command and every command is advertised); `TabStrip.test.tsx` (roles, selection, roving focus); axe checks in every tab-body test; `SettingsPage.test.tsx` (list matches the table).                                                                                                                                                                                                                                                                                     |

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

**The file listing.** `apps/server/src/inspector/files.ts` exports
`listProjectFiles(rootPath, searchText)`, which walks the target **recursively
and in full**, skipping directory entries named `.git`, stopping at
`MAX_TREE_ENTRIES = 20_000` or at 500 while a search is active, and returning
`{ entries, truncated }` with each entry carrying its display path relative to
the listed root. `GET /api/projects/:projectId/threads/:threadId/files` already
accepts a `path` query and resolves it with `resolveContained`, so a
directory-scoped listing needs no new route — only a depth bound and a
correspondingly bounded recursion. The browser never sends `path`:
`getFiles(projectId, threadId, search)` in `apps/web/src/api/client.ts` sends
only `search`, and `FilesTab.tsx` renders the returned paths as a flat list
capped at `FILE_LIST_RENDER_LIMIT = 200`. Ignore rules are not read anywhere on
this path; `.git` is the entire exclusion set.

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
- The existing `getFile` / `getStatus` / `getDiff` contracts are sufficient for
  the File, Changes, and Diff tabs: the structure those tabs demand is a
  browser-side parse of data the server already returns, and neither needs a new
  read route. **This no longer holds for `getFiles`** — WSP-05 as revised needs
  a depth bound and ignore filtering, which are server behavior and cannot be
  synthesised in the browser from a listing that already omitted nothing and
  contained everything. It still needs no new route: the existing files route
  gains a query parameter (milestone 4).
- Shiki's `createHighlighterCore` with individually imported language and theme
  modules keeps the highlighter out of the entry chunk. Vite 8 code-splits a
  dynamic import automatically; no manual chunk configuration is assumed.

**Unresolved technical decisions:** none blocking. Three were resolved during
planning and are recorded in the decision log: the migrated inspector tab's
missing context (D-1), the typed terminal rejection channel (D-2), and the
iframe sandbox's token set together with the self-origin address refusal that
carries the protection instead (D-3). A fourth, raised as milestone 9's blocking
prerequisite — whether tab body hosts keep being relocated between groups — was
resolved by the user on 2026-08-23 in favour of positioning them, which is
milestone 8.

## Implementation milestones

Nine milestones, in this order. Each is independently shippable and each ends
with the repository building, the full unit suite green, and no half-wired
surface. Milestone 2 is the only one that removes a shipped feature, and it
delivers its replacement in the same milestone. Milestone 4 was added in plan
version 2 and the milestones after it were renumbered; a reference to
"milestone 4" written before 2026-08-22 means the File tab, which is now
milestone 5. Milestone 8, the positioned tab-body layer, was added on 2026-08-23
and the browser tab moved after it; a reference to "milestone 8" written before
that date means the browser tab, which is now milestone 9.

**Standing verification step — a hands-on UI pass.** Every remaining milestone
(3 through 9) ends with a **hands-on pass in the running application, driven
through the browser**, exercising that milestone's behavior against a real
repository — not a fixture — and reporting what it finds. It is **distinct from
and additional to** the milestone's automated suite: a milestone is not done
because `vitest` is green, and the pass is not satisfied by an end-to-end spec,
because a scripted spec asserts only what someone already thought to assert. At
minimum each pass drives the milestone's own surface, inspects the resulting
accessibility tree — treating what it shows as a lead to confirm, not as a
verdict — and resizes the panel to its minimum width. Anything it
finds is recorded in Discoveries and blockers with its date and the fact that it
came from a manual pass.

This cadence was requested by the user on 2026-08-22, after the automated suite
passed milestone 2 and a manual pass immediately found six issues in it — two of
them contract-level gaps that no test could have failed on, because nothing
required the behavior they were missing. **A pass reports; it does not by itself
create work.** Two of those same six findings were false positives from the
inspection tool, so every finding is confirmed against the live DOM, or by
computing the value in question, before it becomes a fix item — and the
confirmation, or the refutation, is recorded either way.

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
   v2 record. The v1 key is **left in place**: it is only ever read when no v2
   record exists, so persisting the migrated panel is itself what ends the
   migration, and deleting it would strand a user who rolls back to a release
   that still reads it. This plan deletes the module that wrote that record, so
   a delete here would have no second chance to be undone;
3. otherwise remove the `pi-workspace:panel` key — not the v1 one, for the same
   reason — and return the default: one group, one `Changes` tab, `open: false`,
   `width: 400`.

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
milestone 7. In this milestone a `Diff` tab renders the existing labelled
staged/unstaged text through the current `classifyDiff` colouring, and a `File`
tab renders the existing `<pre>` preview; both are replaced properly in
milestones 5 and 6. That keeps this milestone a strict port with no regression
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

### Milestone 3 — Drag and drop with keyboard equivalents, and accessible-name verification

`useTabDrag.ts` drives the pure operations from milestone 1. Drop zones are
mounted only while a drag is in progress: per visible group, one strip zone with
per-index insertion points, one centre zone, and four edge zones sized to a
minimum of 15% of the group's short side and at least 32 px so they can be hit
without precision — capped, as built, at 35% of their own axis so a short
group still has a centre, and measured against the group MINUS its strip, so
the top edge is a full band below the strip rather than whatever the strip did
not cover. Each zone highlights individually on pointer entry. Dropping
on the drag's own group centre returns the same state object by reference.
`Escape`, a release outside every zone, and a `pointercancel` all restore the
pre-drag state object by reference — not a rebuilt equal one, so a referential
assertion is a valid test of "leaves the layout exactly as it was".

The keyboard route is the chord set rather than a move mode — see the decision
log entry of 2026-08-22, which records why the mode this plan first proposed
was not built. Every drag action has a chord, and every chord is a row in
`features/workspace/keybindings.ts`, which is also what the Settings page
renders, so an inert binding cannot be advertised (WSP-10). The one action
that had no chord — reordering within a strip — is now what `End` and `Home`
do: they walk the tab one place along its strip and into the adjacent group
once it is at that end.

**Naming and the close control** (findings 3, 4, and 5 of the 2026-08-22
hands-on pass). Findings 3 and 4 — panel tabs and file rows exposing no
accessible name — were **re-checked against the live DOM and closed as not
defects**: the label-bearing span in each is not `aria-hidden`, `tab` and
`button` are name-from-content roles, and the `aria-hidden` close affordance is
excluded from the name computation without suppressing its sibling, so the name
computes correctly. The empty `name` field came from the accessibility-tree dump
tool, which renders a name-from-content role as blank. The evidence is in
Discoveries and in the governing specification's
[Findings against version 1](../../product-specs/workspace-panel.md#findings-against-version-1).
No markup change is owed. What remains from that group is one open item:

- [x] **Confirm that every tab is closable from the keyboard and from assistive
      technology.** Confirmed, and the design is unchanged: arrow keys carry
      the selection along the strip and the single close control's accessible
      name follows it, so any tab is closed by arrowing to it and then either
      `Tab` + `Enter` or the close chord. `TabStrip.test.tsx` now walks that
      sequence with the keyboard only, so the decision is pinned by a test
      rather than by this paragraph. Original wording follows.
      The pass found exactly one announced "Close X tab" control,
      for the active tab. That is a deliberate decision recorded in
      `TabStrip.tsx` — a tablist may own only tabs, and a real button nested
      inside a tab is a nested interactive — so this is a **design decision to
      confirm, not a defect to fix**, and the answer is not necessarily one
      close button per tab. What must hold is that closing any tab takes one
      obvious step without a pointer: arrow keys move the selection along the
      strip, and the strip's close control and the close chord both act on the
      selected tab and name it. Confirm that holds, or change the design if it
      does not, and record the outcome as a decision so the next reviewer does
      not re-report it.

**Naming is verified by computation from here on, and an axe pass is not
evidence.** This milestone keeps the verification requirement that the closed
findings prompted, because the episode showed both directions of failure: axe
passed markup that was reported as broken, and a tree dump reported as broken
markup that was correct. Neither tool settles a naming question on its own, so
the panel's naming is asserted by a **computed accessible name** and exercised
by a **keyboard-only walk** of the strip and the list, in addition to the
automated rule scan. That is cheap, it is a regression guard for the real thing,
and it is what makes the next such report answerable in one step.

**Milestone 3 verification:** `panelModel.test.ts` referential-identity cases,
`TabDrag.test.tsx` with `@testing-library/user-event` pointer and keyboard
sequences, an axe check on a mid-drag render, and an e2e drag that splits a
group at an edge and asserts a moved terminal tab did not reconnect. Added in
plan version 2: `TabStrip.test.tsx` and `FilesTab.test.tsx` assert the
**computed accessible name** of every tab and every row — queried by name, not
by class or test id, so an empty name fails the test — and a keyboard-only
sequence closes a non-active tab. Then the **standing hands-on UI pass**: drive
the panel in the running application, confirm by **computed accessible name**
— not by a tree dump — that each tab and row is announced by its own text, and
close a tab without a pointer.

### Milestone 4 — File tree: directory-scoped listing, ignore rules, flat search

Added in plan version 2. It implements
[WSP-05 as revised by specification version 2](../../product-specs/workspace-panel.md#wsp-05--files-and-file-tabs-revised-by-version-2),
whose approval gated it — **that gate is now satisfied**: the user approved
specification version 2 on 2026-08-23. The milestone was built before that
approval was recorded, on the coordinator's instruction; Discoveries and
blockers records the order events actually happened in. It carries both server
and browser work, and the server half comes
first: the browser cannot synthesise a tree or an ignore rule from a listing
that already flattened and already included everything.

**Server — a directory-scoped listing.** The current
`listProjectFiles(rootPath, search)` returns the whole recursive tree capped at
20,000 entries. That is both the flooding problem and a latency problem: on a
real repository the unsearched listing takes hundreds of milliseconds to
seconds, and the browser then throws away all but 200 rows of it.

- `apps/server/src/inspector/files.ts` gains a **depth bound**. The route's
  `fileQuerySchema` gains `depth`, parsed as exactly `"1" | "full"` and
  defaulting to `"full"` so an older browser sees today's behavior; the panel
  sends `depth=1` and expands one level at a time. The route already accepts
  `path` and already resolves it through `resolveContained`, so no new route and
  no new containment logic is introduced — the depth bound is the only change to
  how the walk is driven.
- Entries' `path` is **relative to the execution root**, not to the listed
  directory, so a row carries everything needed to open a `File` tab, a `Diff`
  tab, or a nested listing without the browser reassembling paths. Entries are
  ordered directories first, then files, each case-insensitively by name, so a
  child's identity is stable across two listings of the same directory.
- **Ignore-rule filtering is applied to both the listing and the search**, not
  to the listing alone. A search that ignores ignore rules is precisely the
  failure that was reported.
- `FileTreeResponseSchema` in `packages/contracts/src/index.ts` gains
  `ignoredHidden: boolean` — whether this listing omitted anything because of an
  ignore rule — so the tab can say so instead of silently under-reporting, and
  the query gains `showIgnored` for the explicit opt-in. `.git` stays excluded
  in **both** modes: it is not an ignore rule and is not revealed by the opt-in.

**Server — ignore rules, parsed at the boundary.** New
`apps/server/src/inspector/ignoreRules.ts`. Ignore-file contents are
**untrusted input read from the user's working tree** — an arbitrary file of
arbitrary size that the user, a dependency, or a generator wrote — so it gets
the same Parse-Don't-Validate treatment as every other boundary here: a bounded
read, a total parse into a value, and no partially-trusted intermediate.

- `parseIgnoreFile(text): IgnorePattern[]` is pure and total: it drops blank
  lines and comments, handles a trailing-slash directory rule, a leading-slash
  root anchor, a `!` negation, and an escaped leading `#`/`!`, and **discards**
  any line it cannot represent rather than approximating it. Bounds: at most
  256 KiB per ignore file, at most 4,000 patterns per directory, and at most
  1,024 bytes per line; anything beyond a bound is dropped with the rest of the
  file's parsed patterns kept, never an unbounded buffer and never a thrown
  request.
- `loadIgnoreRules(root)` reads the execution root's `.gitignore` and
  `.git/info/exclude` and, while walking, each visited directory's own
  `.gitignore`, composing them so a nearer file wins and a later negation wins
  within one file. A missing, unreadable, or oversized ignore file contributes
  no patterns and never fails the listing — the tab degrades to showing more,
  which is visible, rather than to an error or to silently showing less.
- The matcher is a pure predicate `matches(relativePath, isDirectory): boolean`
  over already-normalized, already-contained relative paths. It never touches
  the filesystem, so it cannot be made to follow a symlink or to escape the
  root; containment remains the job of `resolveContained`, unchanged.
- **Rejected alternative:** shelling out to `git check-ignore`. It costs a
  process per listing on a hot path, answers nothing for a non-Git project — the
  file routes deliberately do not imply Git ownership — and turns a pure
  predicate into a parsed subprocess boundary for no gain in fidelity that the
  user would notice.
- **Out of scope:** the user's global `core.excludesFile` and nested repository
  or submodule rule scoping. Both are named here so their absence is a decision
  rather than an oversight.

**Browser — the tree, its persisted expansion, and flat search.**

- New `apps/web/src/features/panel/FileTree.tsx`; `FilesTab.tsx` is rewritten
  around it. A directory row is a disclosure that expands **in place**; each
  expanded directory is its own query keyed
  `["files", projectId, threadId, path]`, gated on `visible` as every panel query
  is (WSP-09), so collapsing a directory stops its work and expanding it again
  serves the retained result.
- A row displays **its own name**. The workspace-relative path is on the row's
  `title` and is what copy-path yields; absolute server paths still never reach
  the browser.
- **The `files` tab's persisted shape changes**, which is a storage-schema
  change and is called out as one: the tab record gains
  `expanded: string[]` (the workspace-relative paths of expanded directories)
  and `showIgnored: boolean`. `panelStorage.ts` therefore moves from record
  version 2 to **version 3**, with a version 2 → 3 migration that fills an empty
  expansion set and `showIgnored: false`, and the `pi-workspace:inspector` v1 →
  v2 → v3 chain preserved so a device that has not opened the panel since the
  inspector still migrates in one read. The existing rule stands: anything that
  fails to parse resets to the default panel, and no tab is left referenced but
  absent.
- **Search renders flat.** While the debounced search term is non-empty the tab
  renders matching paths as a list — full paths, since a bare name is ambiguous
  across directories — and not as a tree. Clearing it restores the tree with
  exactly the previously expanded directories, which is why expansion lives in
  the tab record rather than in component state.
- The ignored-files disclosure states plainly that ignored files are hidden when
  `ignoredHidden` is true, next to the opt-in that reveals them; the opt-in is
  persisted with the tab.
- Accessibility is part of this milestone, not a follow-up: the tree is a real
  `tree` with `treeitem` rows carrying `aria-expanded` and `aria-level`, roving
  `tabindex`, and arrow-key navigation, and it degrades to a plain list — with
  the role changing with it — in flat search mode. Every row's accessible name
  is the name it displays.
- The per-directory render budget is the existing one: at most
  `FILE_LIST_RENDER_LIMIT` children painted per expanded directory with the
  "showing the first N of M" notice, so one enormous directory cannot blow the
  frame budget (WSP-09).

**Documentation this milestone must carry.** The file-path and read policy in
[Inspector and terminal boundaries](../../design/inspector-and-terminal.md)
currently reads "Tree traversal excludes `.git` … Ignore behavior is explicit
and can later incorporate parsed ignore files." That deferral is retired by this
milestone and the bullet is rewritten when it ships, together with the required
tests listed there.

**Milestone 4 verification:** `ignoreRules.test.ts` over the pattern forms, a
negation, precedence between a root and a nested ignore file, a comment and an
escaped `#`, an unrepresentable line discarded, a missing file, an unreadable
file, a 5 MiB file, a 100,000-line file, and a line of 1 MiB — asserting bounded
memory and a total parse in every case; `files.test.ts` for the single-level
listing, root-relative entry paths, deterministic ordering, ignored paths absent
from the listing **and** from the search, `showIgnored` revealing them,
`ignoredHidden` reported truthfully, `.git` excluded in both modes, and a
symlinked directory still not followed; `app.test.ts` for the `depth` parameter
including its `"full"` default and a rejected value; `panelStorage.test.ts` for
the v2 → v3 migration and the v1 → v3 chain; `FileTree.test.tsx` for expand,
collapse, expansion surviving a reload, the row name versus its tooltip, flat
search, expansion restored on clearing the search, the ignored-files notice and
opt-in, computed accessible names, and `aria-expanded`. From the hands-on pass:
`trackedFiles.test.ts` and `files.test.ts` for a tracked file an ignore rule
matches, the tracked-only contents of an excluded directory, and the requested
root refused as `.git`, as ignored, and as absent; `app.test.ts` for each of
those over HTTP; `client.test.ts` for the read deadline and the retry policy;
`FileTree.test.tsx` for the error row under that policy and for a 404;
`WorkspacePanel.test.tsx` for focus after an activation, after a tab chord, and
after the panel closes; `useTabDrag.test.tsx` for an interrupted gesture; and
end-to-end cases for the deep-row measurement at `PANEL_MIN_WIDTH`, the failing
listing and its retry, the deleted directory, keyboard focus after opening a
file, and the interrupted drag with a real pointer. Then the **standing
hands-on UI pass**, which for this milestone is the exact scenario that produced
the finding: open the Files tab on a repository containing `node_modules`,
search `README.md`, and confirm the project's own README is in the first screen
of results and no dependency path is; expand and collapse several directories;
reload and confirm the expansion returns; and toggle ignored files on and off.

### Milestone 5 — File tab: markdown preview, lazy highlighting, bounded states

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

**Long lines are readable, fixed in this milestone** (finding 6 of the
2026-08-22 hands-on pass). File content does not wrap and is **clipped at the
panel's right edge with no visible horizontal scroll**, so the end of a long
line is unreachable by any means. That is a defect against WSP-05's "remains
readable" clause and needs no contract change. `.file-preview pre` already sets
`overflow: auto`, so the likely cause is not the `pre` itself but a flex or grid
ancestor between it and the panel body that never gets `min-width: 0` and
therefore lets the `pre` grow past the panel instead of scrolling inside it —
**confirm that before changing the `pre`**. Whichever it is, the fix must give
the tab a deliberate answer for a long line rather than an accidental one: a
horizontal scroll container that is actually reachable, or an explicit soft-wrap
toggle, and in either case the line-number gutter and the sticky header must
stay aligned with the content. The same check applies to the `Diff` tab, which
shares the pattern and will show the same defect for a long diff line.

**Milestone 5 verification:** `FileTab.test.tsx` with the highlighter module
mocked to a never-resolving promise (asserting readable plain text) and to a
rejecting one (asserting the same); a markdown fixture with a remote image
asserting no request is issued; every explicit state; an axe check in both
themes; and `pnpm --filter @pi-web/web build` showing Shiki in a separate chunk.
Added in plan version 2: a layout assertion that a file containing a 2,000-
character line produces a scrollable — or wrapped — content region and does not
widen the panel or the page. Then the **standing hands-on UI pass**: open a
minified file and a long-lined source file in a narrow panel, confirm the end of
the line is reachable, and confirm the page itself never scrolls sideways.

### Milestone 6 — Diff tab: structured unified diff

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

**Milestone 6 verification:** `parseUnifiedDiff.test.ts` over the fixtures;
`DiffTab.test.tsx` for sections, collapse state surviving a tab switch, gutter
values, sticky header counts, and truncation; axe in both themes. Then the
**standing hands-on UI pass**: open a Diff tab on a real working tree with a
staged and an unstaged change, collapse and re-expand hunks, switch to another
tab and back, and read the accessibility tree of the hunk disclosures.

### Milestone 7 — Many terminals per scope, cwd probe, terminal tab

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

**Milestone 7 verification:** `manager.test.ts` for N terminals in one scope, the
cap rejection, re-attach by id, a foreign-scope id rejected, a spawn `cwd`
outside the root rejected, disposal removing both map entries, and no leaked
listeners; `cwd.test.ts` for each platform branch, a timeout, and non-UTF-8
output; `app.test.ts` for the listing route and its scope ownership; a real
`node-pty` smoke test in a generated temporary project only, never against a
user project. Then the **standing hands-on UI pass**: run two terminals in one
worktree, `cd` in one, reload the browser, confirm both re-attach with replay
and the changed directory is shown, and confirm the ninth terminal is refused
with the cap message.

### Milestone 8 — Tab bodies are positioned, not relocated

Added on 2026-08-23 from the decision recorded in the log below, and it comes
**before** the Browser tab because that tab cannot be built on the strategy this
milestone replaces.

**What is being replaced.** `PanelBodies.tsx` gives every tab a host element
created once and _moved_, with `appendChild`, into whichever group's
`.panel-bodies` node currently owns the tab. Moving a DOM node re-runs no React
effect, which is the whole reason a dragged terminal keeps its socket and its
process. But moving is also a **removal followed by an insertion**, and a
removal is not free for every element: taking an `iframe` out of the document
discards its nested browsing context, so a relocated Browser tab reloads its
page and loses its navigation history, its scroll position, and any form state.
That is specified HTML behaviour rather than a browser quirk, and no care in the
move makes it survivable. Media elements lose playback state the same way. The
relocation is also why `PanelBodies` carries a scroll save/restore workaround,
and that workaround has already been the source of one regression — G1, where it
went on recording the body's own offsets after the F2 fix moved the scrolling
element inward, so it saved zeros and restored zeros.

**The decision: stop relocating hosts.** Every tab body host lives in one layer
that is never detached, and each is **positioned over its owning group's
rectangle** instead of being moved into it. Nothing is ever removed from the
document, so a browser tab, a terminal, a playing media element, and a scroll
offset all survive a drag identically and by the same mechanism, and the scroll
workaround is retired rather than re-fixed.

**The positioning layer.**

- One `.panel-bodies-layer` element, a child of the panel's own positioned root
  and a sibling of the tree, holding every mounted host for the life of the
  panel. It is the only parent a host ever has. `PanelBodies` keeps its portal
  and its one-host-per-tab rule; what changes is that the host is never
  re-parented.
- Each group keeps a `.panel-bodies` node, but it becomes a **measured
  placeholder** rather than a parent: it is what states where a body belongs,
  and `groupBodiesElementId` keeps naming it. The host is placed over that
  rectangle in the layer's own coordinates.
- Placement is `left`/`top`/`width`/`height`, not a transform. A body must lay
  out at its real size: xterm's fit addon measures its container (F4), the
  file and diff bodies are height-bounded flex columns (F2), and the render
  budgets of WSP-09 are stated in rows that only exist at a real size. A
  transform would scale or offset a box that still had the wrong size.
  `.panel-tabpanel-host`'s `display: contents` goes with this: a positioned
  host has to be a real box.
- Only the active tab of each group is shown. Every other host stays **in the
  document** and keeps `hidden` and `inert`, exactly as today — `hidden`
  removes a box from layout but does not detach the node, so an `iframe` under
  it keeps its browsing context and a terminal keeps its socket. A hidden host
  is not positioned at all until it is shown.
- **During a drag**, nothing moves: the model does not change until the drop
  commits, so no rectangle changes and no host is repositioned. The drag ghost
  stays portalled into `document.body` (G2) and the layer must not become a new
  containing block for it — a positioned ancestor is exactly the hazard G2 was.
- **During a divider resize**, the group rectangles change continuously. This is
  the path that must not measure per pointer move; see the WSP-09 note below.
- **When the panel is closed**, the layer is hidden and inert with the panel and
  positions nothing; hosts stay attached, so a terminal keeps its process and a
  browser tab keeps its page, and the first observation after it reopens places
  them again. The same holds for the narrow-width drawer, which hides the panel
  rather than unmounting it.
- **When a group is removed** — a sibling promoted after a close, or the last
  tab closing the panel — a host whose tab moved to another group is
  repositioned over the new slot, and a host whose tab was closed is unmounted
  and removed. Closing a tab is the only path that legitimately detaches a host,
  and it is the one path where nothing is owed to what the host contained.

**Rectangle tracking, and why it stays inside WSP-09.** WSP-09 forbids per-move
layout work: it is why the drag path measures every group's rectangle **once at
pick-up** (`measureZones` in `useTabDrag.ts`) and why the ghost is deliberately
not clamped to the viewport. This milestone must not reintroduce that cost from
the other side.

- Positions are read in a **`ResizeObserver`** over the placeholders, not in a
  pointer handler. The observer's callback runs after the browser has already
  computed layout for that frame, so reading a rectangle there forces no reflow;
  the same read inside a `pointermove` handler would force one on every event.
  A divider drag therefore keeps writing size fractions only, and the layer
  answers afterwards, once per frame the browser actually laid out.
- One observer, one callback: it **reads every changed placeholder's rectangle
  first and writes every style afterwards**, so a frame never interleaves reads
  and writes and cannot thrash layout, however many groups exist.
- Only changed slots are written, and a hidden host is skipped entirely, so a
  panel showing two of ten tabs positions two boxes.
- The observer is disconnected while the panel is closed, so a closed panel does
  no work at all — the same rule the tab bodies already follow.
- A structural change (split, promotion, tab move) repositions in the same
  layout effect that already runs for it, so the first paint after the change is
  already correct rather than corrected a frame later.

**Retiring the scroll save/restore workaround.** Nothing is detached any more,
so the browser keeps every scroller's offset by itself. The capture-phase
`scroll` listener, the per-body `Map` of scrollers, `restoreScroll`, and the
`wasActive` bookkeeping in `PanelBodies.tsx` all go. Hidden bodies keep `hidden`
— it is what stops a hidden tab doing layout work — so the one remaining
browser-dependent behaviour is that a box which left layout under `hidden`
restores its offset when it comes back, measured true in HeadlessChrome/151
under G1. That is a claim about the browser, so it keeps its **end-to-end**
guard rather than being trusted.

Tests that pin the workaround, and what happens to each:

- `PanelBodies.test.tsx` → **"records and restores the offset of a descendant
  scroller, not the body's own"** pins the record-and-restore mechanism, with
  the browser's reset stood in for by hand. The mechanism is gone; the case is
  **deleted with it**, not adjusted to keep passing.
- `PanelBodies.test.tsx` → **"keeps a body's scroll position across a split"**
  and **"keeps a body's scroll position across a tab switch"** state the
  guarantee rather than the mechanism, so they stay — but they are recorded here
  as **weak** evidence: jsdom neither detaches on a move nor lays anything out,
  so they can pass vacuously. The evidence is the two e2e cases below.
- e2e → **"panel file tab: returning to a tab restores the scroll offset of the
  element that scrolls"** and **"panel drag: a dragged tab keeps the scroll
  offset of the element that scrolls"** must stay green unchanged. They are the
  guarantee, and they are what proves the workaround was removable rather than
  load-bearing.

**Every guarantee the current strategy verifies must still hold.** These are the
existing cases the milestone is not allowed to break, weaken, or rewrite; if one
needs editing, the positioning is wrong.

Unit:

- `PanelBodies.test.tsx` — "keeps a running terminal's socket across a split and
  across the promotion that follows" (a body survives every change of tree shape
  with **zero** new sockets).
- `WorkspacePanel.test.tsx` — "mounts and queries only the tab a restored panel
  shows" (a never-activated tab is never mounted, measured from a restored
  panel because opening a tab activates it); "keeps a hidden tab mounted and
  inert, and issues nothing for it even when its data is invalidated"; "issues
  nothing further when the panel is toggled shut and open"; "is inert rather
  than merely invisible while it is closed, and the rail brings it back".
- `TabStrip.test.tsx` — "is a tablist whose active tab points at its own panel",
  whose last assertion is that a never-activated tab claims no `aria-controls`,
  because it has no body.
- `tabBodies.test.tsx` — the four "issues no request while it is hidden" cases,
  one per ported body (Changes, Files, File, Diff).

End to end:

- "panel drag: a dragged terminal keeps its shell and its scrollback".
- "panel terminal: contained at every width, and in a split group" and "panel
  terminal: the rendered screen fits its container at every height" — the F4
  arithmetic depends on the container's real size, which is what the layer now
  supplies.
- "panel groups: a split at the minimum width scrolls rather than shrinking"
  (F6): the panel scrolls when the tree cannot fit, so a slot's rectangle moves
  with the scroll and a host must follow it.
- "panel drag: a tab dropped on another group's centre moves into it", "panel
  drag: a tab dragged along its own strip is reordered", and "panel keyboard: a
  chord splits, moves a tab, and says when it cannot split".
- "panel drag: the ghost follows the pointer in viewport coordinates" (G2) — the
  new layer must not become the ghost's containing block.

**Milestone 8 verification.** jsdom computes no layout, so the substance of this
milestone is invisible to the unit suite by construction and the evidence is end
to end, in `e2e/workspace-panel.spec.ts`:

- each visible host's client rectangle equals its group's `.panel-bodies`
  rectangle, within a pixel — at rest, after a divider drag, after an
  edge-split, after a sibling promotion, after a panel resize, at the panel's
  minimum width, and after the panel is closed and reopened;
- a terminal tab dragged into another group keeps the **same** `WebSocket`
  (asserted as today, by counting sockets) **and** its rendered screen still
  fits its new group, which is the pairing the move-based strategy could satisfy
  only because it moved the real box;
- a file body scrolled, hidden by a tab switch, and shown again keeps its
  offset, and the same after a drop into another group — the two existing cases,
  now with no restore code behind them;
- the drag ghost's client rectangle still tracks the pointer in viewport
  coordinates and is still not parented inside the panel;
- **a bounded-measurement case for WSP-09**: instrument
  `Element.prototype.getBoundingClientRect`, drag a divider from one edge to the
  other in forty steps, and assert the call count does not grow with the number
  of pointer moves — the same claim the drag path makes by measuring once at
  pick-up, made from the resize side.

Unit-side, `PanelBodies.test.tsx` keeps the socket and mount-count cases,
loses the record-and-restore case, and gains one asserting that a host's parent
node is the layer and is **unchanged** across a split, a promotion, and a move
between groups — the jsdom-visible half of "nothing is ever detached".

Then the **standing hands-on UI pass**: with a terminal, a file, and a diff open
across two groups, drag each between groups, drag the divider, resize the panel,
close and reopen it, and confirm every body sits exactly over its group with
nothing clipped, no terminal reconnecting, and no scroll position lost. Milestone
9's own pass adds the case this milestone exists for — a Browser tab dragged
between groups does not reload — because it needs the tab to exist first.

### Milestone 9 — Browser tab, probe endpoint, CSP, and sandboxing

**Blocking prerequisite: milestone 8 must land first.** A Browser tab cannot use
the body-**moving** strategy milestone 3 shipped. `PanelBodies.tsx` gives every
tab a host element that is created once and _moved_ into whichever group owns
the tab, because moving a DOM node re-runs no effect and so keeps a terminal's
socket alive. That guarantee does not extend to an `iframe`: removing an
`iframe` from the document discards its nested browsing context, so reparenting
one reloads the page, losing its navigation history, scroll position, and any
form state. The behaviour is specified, not a browser quirk, and no amount of
care in the move makes it survivable. The same applies to media elements'
playback state. That is why milestone 8 exists, and it is why the explanation
stays here: without it, this milestone reads as an arbitrary ordering.

The consequence is that WSP-03's "a moved tab keeps its process, scroll
position, and state" and WSP-08's restorable address cannot both hold for a
Browser tab while hosts are relocated. **Resolved on 2026-08-23 by the user**
(see the decision log): hosts are positioned rather than relocated, in milestone 8. The alternative — **accepting a reload for Browser tabs only** and saying so
in the product — was **rejected**: it is cheap and honest, but it makes one tab
type behave unlike every other, which is the kind of inconsistency WSP-02 exists
to avoid, and it would have left the scroll save/restore workaround in place.
This milestone therefore starts from a panel in which no host is ever detached,
and its e2e coverage adds the case that proves it: a Browser tab dragged into
another group keeps its page — same document, unchanged history position and
scroll offset — rather than reloading.

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

**Milestone 9 verification:** `probe.test.ts` against a local fixture server for
the scheme allowlist, a redirect chain of exactly three and of four, a
non-responding host inside and outside the deadline, `X-Frame-Options: DENY` /
`SAMEORIGIN` / absent, a `frame-ancestors` directive, a `HEAD`-refusing server,
and an assertion that the fixture's body bytes are never read; `app.test.ts` for
the exact CSP string and the retained `X-Frame-Options`; `BrowserTab.test.tsx`
for the sandbox attribute's exact value — including that it contains
`allow-same-origin` and contains **neither** top-navigation token — the blocked
and unreachable states, and address restoration. Then the **standing hands-on UI
pass**: point a Browser tab at a local dev server, at a site that refuses
framing, and at this workspace's own address, and confirm each renders its named
state rather than a blank frame. Same-origin refusal is tested
at both ends: the route rejects a self-origin URL with `same_origin_refused`
before issuing any request, and the tab renders its named state without ever
mounting an `iframe`, for a typed address and for one restored from storage.
Added with the milestone-8 decision: an e2e case that drags a Browser tab
showing a local page into another group and asserts the page **did not reload** —
same document, unchanged history position and scroll offset — which is the
guarantee milestone 8 was built to make available here.

## Untrusted-data-boundary analysis

| Source and raw representation                                                                                                                                                       | Entry/read point                                                                              | Runtime parser                                                                                                                                                                                   | Trusted output and guarantees                                                                                                                                                                             | Failure behavior                                                                                                                                                                                                                        | Boundary tests                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device-local panel record — an arbitrary string under `pi-workspace:panel`, editable by the user and by any script on the origin                                                    | `readPanelState()` in `panelStorage.ts`                                                       | JSON guard, then a zod v2 schema, then a referential-integrity pass (groups are leaves, each tab in exactly one group, `activeTabId` valid)                                                      | A `PanelState` whose tree, groups, and tabs are mutually consistent; widths and sizes clamped; no tab referenced without a record                                                                         | Remove the key and return the default single-`Changes`-tab panel. A dangling reference is a full reset, never a dropped tab                                                                                                             | Round trip; malformed JSON; unknown version; group not a leaf; tab in two groups; `activeTabId` absent; storage throwing                                                                                                                      |
| Legacy inspector record — arbitrary string under `pi-workspace:inspector`                                                                                                           | The same read, only after the v2 read misses                                                  | The retained private v1 zod schema (`version: 1, open, activeTab, width`)                                                                                                                        | One group, one tab of the recorded type at the recorded width and open state, `context: null`; the v1 key is left in place so a rollback still finds it                                                   | Falls through to the same default reset                                                                                                                                                                                                 | Each of the three `activeTab` values migrates; a width outside the v1 schema's own `[280, 4096]` bound; unknown version; the v1 key survives, and a v2 record then wins over it                                                               |
| `cwd` field of the `attach`/`create` terminal client frame — a client-supplied string over the WebSocket                                                                            | `apps/server/src/app.ts` terminal socket handler                                              | `TerminalClientFrameSchema` (`RelativePathSchema`), then `resolveContained(executionRoot, cwd)`                                                                                                  | An absolute spawn directory that is the realpath'd execution root or provably under it, used as the PTY's cwd                                                                                             | Typed `error` frame with a `path_rejected` code; no PTY is spawned                                                                                                                                                                      | Absolute, drive, UNC, `..`, encoded `..`, NUL, backslash, empty segment, symlink escaping the root, and a valid nested directory                                                                                                              |
| `terminalId` field of the `attach`/`input`/`resize`/`restart`/`terminate` frames — a client-supplied UUID                                                                           | The same handler, then `activeOwner`                                                          | `TerminalIdSchema`, then an owner lookup requiring `projectId` **and** `scopeId` to match the request's                                                                                          | A `TerminalOwner` proven to belong to the requesting project and execution scope                                                                                                                          | Typed `error` frame with `terminal_gone`; no write reaches any PTY                                                                                                                                                                      | Unknown id; a live id from another thread's worktree scope; a live id from another project; a disposed id; a well-formed non-UUID                                                                                                             |
| Browser-probe URL — a user-typed string in a POST body                                                                                                                              | `POST /api/browser/probe`                                                                     | Zod string, then `new URL()`, then a protocol allowlist of exactly `http:`/`https:`, then an **origin check refusing the workspace's own origin**                                                | An absolute `http`/`https` URL, proven not to be this workspace's own origin, fetched with no client-controlled headers, method, or body, at most three redirect hops, a 5 s deadline, and no credentials | 400 with a stable code — `same_origin_refused` for a self-origin address — for a bad scheme, a self-origin address, or an unparseable URL, before any socket is opened; `reachable: false` for a timeout, refusal, or a fourth redirect | Each rejected scheme; a credentialed authority; the workspace's own origin rejected with no request issued; a differing port accepted; three hops accepted and four rejected; a redirect loop; a hanging host; a `HEAD`-refusing host         |
| Probe target response — arbitrary remote headers and body from a host the user named                                                                                                | The same route                                                                                | Only `X-Frame-Options` and a `frame-ancestors` directive are inspected; the body stream is destroyed unread                                                                                      | Three booleans/enums. No remote bytes, header values, redirect chain, or error text are returned to the browser                                                                                           | Any parse ambiguity resolves to `embeddable: false`, which is the safe direction — the tab shows its explicit state rather than a blank frame                                                                                           | A hostile 1 GiB body is never buffered; header values containing control characters; a `frame-ancestors` list; the response is asserted byte-free                                                                                             |
| Terminal cwd probe output — an OS-provided absolute path from `readlink /proc/<pid>/cwd` or `lsof` stdout                                                                           | `probeCwd` in `apps/server/src/terminal/cwd.ts`, then the manager                             | Bounded `execFile` (argument array, no shell, 2 s timeout, 64 KiB buffer), UTF-8 decode, first `n` record                                                                                        | A **workspace-relative** display path, `""` for the root, or `null`. Absolute server paths never enter a browser DTO                                                                                      | `null` on a non-zero exit, timeout, unparseable output, unsupported platform, or a directory outside the execution root                                                                                                                 | Each platform branch; a directory outside the root yields `null`; a timeout; non-UTF-8 bytes; a path containing a newline; no shell is invoked                                                                                                |
| Persisted or typed browser-tab address — restored from the panel record, or entered, before it becomes an `iframe` `src`                                                            | `BrowserTab`, on restore and on commit                                                        | The same `new URL()`, protocol allowlist, **and self-origin refusal** as the probe, applied client-side before the element is rendered                                                           | An `http`/`https` `src` that is provably not this workspace's own origin, on a frame granted neither top-navigation token                                                                                 | The tab renders its named refusal state and mounts **no** `iframe`; a rejected address is cleared from tab state                                                                                                                        | A persisted `javascript:` or `data:` address never becomes an `src`; a persisted self-origin address renders the refusal state and mounts no frame; a persisted valid address survives a reload                                               |
| Ignore-file contents — `.gitignore` at the execution root and in each visited directory, and `.git/info/exclude`: arbitrary bytes written by the user, a dependency, or a generator | `loadIgnoreRules` in `apps/server/src/inspector/ignoreRules.ts`, during a listing or a search | A bounded read (at most 256 KiB per file, 1,024 bytes per line, 4,000 patterns per directory), then `parseIgnoreFile`, a total parse that discards any line it cannot represent                  | An `IgnoreMatcher`: a pure predicate over already-normalized, already-contained relative paths, which touches no filesystem and therefore cannot follow a symlink or escape the root                      | A missing, unreadable, or oversized ignore file contributes no patterns; the listing shows **more** than it might have, never fewer, and never fails the tab                                                                            | Each pattern form; negation; root anchor; directory-only rule; comment and escaped `#`/`!`; an unrepresentable line discarded; a 5 MiB file; a 100,000-line file; a 1 MiB single line; an unreadable file; a `.gitignore` that is a directory |
| `depth` and `showIgnored` query parameters on the files route — client-supplied strings                                                                                             | `fileQuerySchema` in `apps/server/src/app.ts`                                                 | Zod: `depth` is exactly `"1"` or `"full"` and defaults to `"full"`; `showIgnored` is a strict boolean flag defaulting to false                                                                   | A bounded walk depth and an explicit reveal decision; `.git` stays excluded regardless of either value                                                                                                    | 400 from the existing schema-parse path; no walk is started                                                                                                                                                                             | An unknown `depth`; a numeric `depth`; a missing `depth` yielding the full listing; `showIgnored` not revealing `.git`                                                                                                                        |
| Persisted tree expansion — the `files` tab's `expanded` array in the device-local panel record, arbitrary strings that become listing requests                                      | `readPanelState()`, then `FileTree` when it issues a directory query                          | The v3 zod schema parses each entry with the relative-path rules, and the route re-parses and re-contains every `path` it receives; a path that no longer exists simply returns an empty listing | Expansion state that can only ever address a normalized relative path inside the execution root                                                                                                           | A malformed entry drops that entry from the expansion set, not the tab; a malformed record resets the panel as today                                                                                                                    | An absolute, `..`, NUL, or backslash entry never reaches a request; a stale path renders as collapsed-and-empty rather than as an error                                                                                                       |
| File extension driving syntax highlighting — derived from a server-supplied path                                                                                                    | `languageForPath` in the File tab                                                             | A fixed map from extension to one of a pre-imported allowlist of Shiki language modules                                                                                                          | A language id from a closed set, or `null`                                                                                                                                                                | `null` renders plain monospace text; no highlighter is loaded                                                                                                                                                                           | An unknown extension; an extension-shaped path segment; an assertion that no `import()` specifier is ever built from path text                                                                                                                |

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
pnpm --filter @pi-web/server exec vitest run src/inspector   # milestone 4
pnpm --filter @pi-web/contracts exec vitest run
```

Final:

```sh
pnpm check      # format:check, lint, typecheck, test, build, test:docs, docs:check
pnpm test:e2e --grep workspace
```

**The hands-on UI pass is a required step of every remaining milestone**, not a
closing formality: drive the running application through the browser against a
real repository, exercise that milestone's behavior, read the resulting
accessibility tree, confirm each finding against the live DOM or by computing
the value in question, and record what it finds in Discoveries and blockers with
its date and its confirmation. It is additional to everything above, and a green suite does not
stand in for it — the six findings of 2026-08-22 were all made against a green
suite. Its per-milestone content is stated in each milestone.

Runtime and manual checks that no unit test covers:

- open a Files tab on a repository that contains `node_modules`, search
  `README.md`, and confirm the project's own README is in the first screen and
  no dependency path is; expand and collapse directories; reload and confirm the
  expansion returns;
- **compute** the accessible name of every tab in a strip and every row in a
  file list — a tree dump's `name` field is not evidence for a name-from-content
  role — confirm each is the text it displays, and close a non-active tab
  without a pointer;
- open a file with a 2,000-character line in a narrow panel and confirm the end
  of the line is reachable;

- with a terminal, a file, and a diff open across two groups, drag each between
  groups, drag the divider, resize the panel, and close and reopen it, and
  confirm every body sits exactly over its group with nothing clipped, no
  terminal reconnecting, and no scroll position lost (milestone 8);
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
`pi-workspace:panel` v2, performed on read, with the v1 key **kept** so a
rollback still finds it; the v2 record the migration writes wins on every later
read.
The chat surface's `pi-workspace:layout:<projectId>` record is **not** migrated
and must not be — this plan does not change its shape, and a version bump there
would be a bug, not a feature. Any panel record that fails validation resets to
the default panel; the user loses tab arrangement, never data, because the panel
holds no unsaved content.

**Deployment.** Milestones ship in order. Milestone 2 is the user-visible
switch; the milestones after it add capability to a working panel and can each
stop at any point without leaving a broken surface. Milestones 4, 7, and 9 are
the only ones touching the server and can be deployed independently of each
other. Milestone 8 is browser-only and changes no contract, persisted record, or
route: it changes how a tab body is placed in the document and nothing a user
can name. Milestone 4's server change is additive — a new query parameter and a
filter — so a browser built before it still receives the listing it expects,
and a browser built after it degrades to the full recursive listing if the
parameter is ignored.

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

- [x] Milestone 1 — generic binary tree, tab model, panel model, storage.
      Reviewed 2026-08-22; six defects found and fixed, three of them at the
      persistence boundary (unclamped width and split fractions, a tree deep
      enough to poison storage on every read, and `updateTab` walking through
      the dedupe that `openTab` enforces).
- [x] Milestone 2 — panel shell, ported tabs, inspector deleted. Reviewed
      2026-08-22; fourteen defects found and fixed, the worst being that any
      change of tree shape unmounted the tab bodies in a group and killed
      running terminals.
- [x] Milestone 3 — drag and drop with keyboard equivalents, accessible-name
      verification, close-control question confirmed. Its standing hands-on UI
      pass was performed on 2026-08-22 and found six defects, all fixed: scroll
      offsets lost on a switch and a drag (a regression from F2 moving the
      scrolling element inward), a drag ghost drawn off-screen by a transformed
      ancestor, a fast flick dropping the gesture before pointer capture, a
      refused drop announcing success, four narration gaps, and a 9x16px close
      target.
- [x] Milestone 4 — file tree, directory-scoped listing, ignore rules, flat
      search. Its standing hands-on UI pass was performed on 2026-08-23 and
      found seven defects, all fixed and pinned: a tracked file hidden by an
      ignore rule, a requested path exempt from the rules its entries obey, an
      unreadable indent at the panel's floor, focus dropped on opening a file,
      an unbounded read, an untyped not-found, and a drag that outlived its
      gesture. See Discoveries and blockers. Implemented on the coordinator's instruction ahead of the recorded
      approval of specification version 2; that approval was given by the user
      on 2026-08-23 and the gate is now satisfied (see Discoveries and
      blockers). Shipped 2026-08-23: `apps/server/src/inspector/ignoreRules.ts`
      and its 36 cases, the `depth`/`showIgnored` query parameters and
      `ignoredHidden` response field, `apps/web/src/features/panel/FileTree.tsx`
      and its 22 cases, panel record version 3, and five end-to-end specs
      against a real working tree. The deferral in
      [Inspector and terminal boundaries](../../design/inspector-and-terminal.md)
      is retired and that bullet rewritten, as this milestone required.
- [x] Milestone 5 — File tab, markdown preview, lazy Shiki, long-line overflow
      fixed. Shipped 2026-08-23: `fileLanguage.ts` (a closed language union
      chosen from the extension, never from the response's `language` field),
      `markdownLinks.ts` (a repository link resolved under the read boundary's
      own path rules), `syntaxHighlight.ts` (Shiki behind a dynamic import,
      themed from `--code-*` CSS variables, one grammar module per language),
      `FilePreviewMarkdown.tsx` (the preview's own renderer, not the
      transcript's), and a rewritten `FileTab.tsx` carrying every state the
      read boundary can produce. 69 new unit cases and four new end-to-end
      cases; the three existing `wide.json` cases now settle the highlighting
      before they measure and still pass, so G1 holds with highlighted content
      in the `pre`. The long-line overflow item is **not** re-fixed here: F2
      already fixed it, the existing case still measures the scrollbar on
      screen at both widths, and the markdown preview joins the `pre` as the
      other bounded scrolling region rather than adding a second one.
      **Its standing hands-on UI pass is still owed** and is performed by a
      separate agent.
- [ ] Milestone 6 — Diff tab, structured unified diff
- [ ] Milestone 7 — multi-terminal server, cwd probe, terminal tab
- [ ] Milestone 8 — tab bodies positioned in one never-detached layer, scroll
      workaround retired
- [ ] Milestone 9 — browser tab, probe endpoint, CSP, sandbox
- [ ] Documentation — designs and architecture updated, CWS-06 supersession
      recorded

## Discoveries and blockers

- **A `treeitem` takes its name from its children too** (2026-08-23, milestone
  4, found by the component suite). The tree's first shape put the row's name
  in a `span` beside the nested `ul role="group"`, which is the ARIA
  authoring-practices layout. Querying `getByRole("treeitem", { name: "src" })`
  then matched nothing, and `/Could not list src/` matched two elements: an
  expanded `src` computed as "src features main.ts". The row now carries
  `aria-labelledby` pointing at the one element holding its own name. Recorded
  because the natural markup is wrong in a way an axe pass does not report —
  the name is non-empty, just not the row's — and because it is the second
  time on this plan that a naming question needed the name **computed** rather
  than eyeballed.
- **Clicking an expanded directory row hit its children** (2026-08-23,
  milestone 4, found by the end-to-end pass, invisible to jsdom). With the
  click handler on the `li`, a pointer click at the element's centre landed
  wherever the centre happened to be — which, once the directory was open, was
  a child row. The component suite passed throughout, because
  `user.click(element)` dispatches at the element rather than at a point. The
  handler moved to the row's own line, which is the row as the user sees it.

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

**2026-08-22 — six findings from a hands-on UI pass, not from the tests.** After
milestone 2 shipped and the whole automated suite was green, a reviewer drove
the running application against a **real repository** and verified each result
in the DOM and in the accessibility tree. Nothing below came from a test
failure; the suite passed throughout. Two are contract gaps and four are
defects.

1. **The Files tab is unusable on a real repository (contract gap).** The
   traversal excludes only `.git`, so searching `README.md` returned hundreds of
   `frontend/node_modules/@babel/…`, `@eslint/…`, and `@floating-ui/…` matches
   and buried the project's own README. The ignore-file deferral recorded in
   [Inspector and terminal boundaries](../../design/inspector-and-terminal.md)
   was tolerable while Files was one third of a cramped strip; it is not
   tolerable now that Files is a first-class tab. Addressed by specification
   version 2 and milestone 4.
2. **Files is a flat list of paths from the root, not a tree (contract gap).**
   No directory expansion, no collapsing, rows truncate. WSP-05 as approved
   required only that the existing traversal be ported, so this is a
   specification gap rather than an implementation miss. Addressed by
   specification version 2 and milestone 4.
3. **Panel tabs expose no accessible name — reported as a WSP-10 regression,
   _closed as a false positive_.** The accessibility-tree dump showed bare `tab`
   nodes with no label. A follow-up probe of the live DOM the same day showed
   the markup is
   `<button class="panel-tab" role="tab"><span class="panel-tab-title">Changes</span><span class="panel-tab-close" data-tab-close aria-hidden="true" title="Close Changes">×</span></button>`:
   the label-bearing span is not `aria-hidden`, `tab` is a name-from-content
   role, and the `aria-hidden` close affordance is excluded from the name
   computation without suppressing its sibling. The name computes correctly.
   **The dump tool renders a name-from-content role as a blank `name`; the page
   was never at fault.** No work is owed, and no markup was changed to satisfy
   the report.
4. **File-list rows expose no accessible name — reported as a WSP-10 violation,
   _closed as a false positive_.** Same tool, same cause. The live markup is
   `<button><span aria-hidden="true">·</span><span>frontend/node_modules/@alloc/quick-lru/readme.md</span></button>`
   — an unhidden label span inside a name-from-content `button`. The name
   computes correctly.
5. **Only the active tab exposes an announced close control (open, WSP-10).**
   There is exactly one "Close X tab" control rather than one per tab. This one
   is a **deliberate** decision in `TabStrip.tsx` — a tablist may own only tabs
   — so it is a design decision to confirm rather than a defect to fix: what
   milestone 3 must establish is that every tab is closable in one step without
   a pointer, not that a per-tab button appears.
6. **File content does not wrap and is clipped at the panel's right edge**
   (open defect, WSP-05's "remains readable" clause), with no visible horizontal
   scroll. Unconfirmed as to mechanism: `.file-preview pre` already sets
   `overflow: auto`, so the hypothesis is a flex or grid ancestor without
   `min-width: 0`. Addressed in milestone 5, hypothesis first.

**Calibration: of the six findings, two were false positives from the inspection
tool.** Findings 1 and 2 were re-confirmed the same day — a `README.md` search
still returns 200 rendered rows, every one under `frontend/node_modules/` — and
findings 5 and 6 stand as an open question and an open defect. But findings 3
and 4 were artifacts of how the accessibility-tree dump renders
name-from-content roles, and had they been taken at face value the fix would
have been markup changes to a page that was already correct.

Both halves of that are the lesson, and both are why the standing hands-on UI
pass is written as it is. A hands-on pass finds real things the suite cannot —
the two contract gaps are things no test could have failed on, because nothing
required the behavior they were missing — and it also invents things the suite
would have disproved. So a pass **reports**; its findings are **confirmed
against the live DOM, or by computing the value in question, before they become
work**; and a tool's output is evidence about the tool until it is corroborated.
A green suite says the code does what the plan said, and says nothing about
whether the plan said enough; a red flag from an inspector says something looked
wrong to that inspector, and says nothing until it is reproduced.

**2026-08-22 — six defects from a second hands-on UI pass, every one measured
against a real PTY in a real browser.** Each was reproduced from the reported
measurement before anything was changed, and each is pinned by a test that
fails without its fix. Where the mechanism is CSS or layout the test is an
end-to-end measurement, because jsdom loads no stylesheet and therefore cannot
see any of these.

1. **A shrunken group wrote an error into the user's shell and mislabelled the
   terminal for the session (F1).** At `MIN_FRACTION` the fit addon proposed
   `{ columns: 191, rows: 1 }`; the contract bounds rows at 2, so the server
   answered `{"type":"error","message":"Terminal command was rejected."}` —
   which the client wrote into the scrollback, where it is indistinguishable
   from program output and permanent, and which latched `status` at "Terminal
   error" for the rest of the session because nothing ever cleared it. Fixed at
   all three layers: the bounds are exported from `packages/contracts` and the
   client clamps to them before sending (the server's own guard reads the same
   constants, so the numbers cannot drift); a refused command is a transient
   notice beside the lifecycle status, cleared by the next frame that proves
   the exchange works; and protocol errors never reach the terminal buffer.
   The size floor itself is F6 — the clamp is a guarantee about what may be
   sent, not a substitute for a readable group.
2. **The file preview's horizontal scrollbar was off screen (F2, finding 6 of
   the first pass, and both earlier hypotheses were wrong).** Nothing
   overflowed the panel and `.file-preview pre` did scroll inside itself, so
   `min-width: 0` was never involved. The `pre` was not HEIGHT-bounded: it grew
   to its full 2534px content height inside a scrolling ancestor that ended at
   `y = 1017`, putting its real 20px scrollbar ~1600px below anything visible.
   Both bodies are now flex columns bounded to the tab's own height with the
   header pinned above one scrolling region. The Diff tab had the same shape
   and additionally scrolled its staged and unstaged sections independently;
   they now share one box.
3. **The split-refusal announcement relaid out the panel and resized the
   running shell twice (F3), a regression from the D8 fix.**
   `.panel-announcement` was an ordinary flex item of the `.panel` column, so
   one refusal measured 1383px -> 1357px -> 1383px of group height, sending
   `resize rows:73` on the way in and `rows:75` when it cleared five seconds
   later. Telling the user that nothing happened was itself the thing that
   happened, and it is the closest reproduction anyone found of the reported
   "flicker at the bottom of the terminal". It is now absolutely positioned
   over the panel's bottom edge — still visible, still in the `role="status"`
   region, owning no layout.

   **Closed by the reporter, 2026-08-22.** The user confirmed on their own
   display that the flicker is gone. This is worth recording as evidence
   rather than as a formality, because no automated check ever reproduced the
   symptom: the fixing agent could not, because headless Chromium uses
   zero-width overlay scrollbars and the feedback path needs a real scrollbar;
   and the hands-on pass could not either, across 691 consecutive stable
   frames at 60fps with a 120-character prompt at 33 columns. What the tests
   pin is the **precondition** — `.terminal-surface` is `overflow: hidden`, no
   scrollbar can appear to re-narrow the measured box, and the announcement
   owns no layout — not the oscillation itself. Three separate diagnoses of
   this symptom were wrong before the measured one (a `min-width: 0`
   max-content theory from the coordinator, a stale `.xterm-scrollable-element`
   height, and the border-box arithmetic of F4, of which only the last two were
   real defects at all). If it ever returns, start by reproducing it on a
   display with classic scrollbars; do not trust a green suite as evidence
   about this particular symptom.

4. **Every terminal was up to ~12.8px taller than its container (F4).** The fit
   addon reads `getComputedStyle(parent).height`, which for a border-box
   element is the BORDER box (218.917px measured against a 206.1px content
   box), and subtracts only the `.xterm` element's own padding, which is zero.
   `.terminal-surface`'s `padding: 0.4rem` was therefore counted as space to
   paint rows in and then clipped away. Fixed where the arithmetic goes wrong
   rather than against it: the padding stays on `.terminal-surface` and the
   addon measures a new unpadded `.terminal-canvas` inside it.
5. **Keyboard focus dropped to `<body>` after every structural chord (F5).**
   The D2 fix holds — a chord acts on the group the keyboard is in — but close,
   split, and move each destroy or reparent the focused element, and nothing
   put focus anywhere afterwards, so a keyboard user had to re-issue the
   focus-panel chord every time. Focus management moved from `TabStrip` to
   `WorkspacePanel`, the one component that outlives a structural change: a
   strip mounted BY a split cannot tell the request that created it from one
   that predates it. The focus request is bumped inside the same functional
   update that decides whether the command changed anything, so a refused chord
   still moves nothing.
6. **A group had no minimum size in pixels, only a fraction (F6).** At
   `PANEL_MIN_WIDTH` split in two, each group was 139px and the terminal
   negotiated `{ columns: 16, rows: 73 }` — WSP-04's "never shrinks a group
   into an unreadable state", unmet, because `MIN_FRACTION` is a proportion and
   a proportion is no floor. **Approach taken: the chat surface's, which is to
   scroll rather than to shrink** (`MIN_PANE_WIDTH_PX` plus `.tiling-surface`'s
   `overflow-x: auto`). A group now has a stated pixel floor, a subtree's
   minimum is computed from the tree, and the panel scrolls when the tree
   cannot fit. Refusing the split was the alternative and was rejected: it
   would make a chord that silently does nothing at some widths, which is the
   defect D8 was raised to remove.

   Taken with it, deliberately: **`normalizeSizes` now clamps the SHARE rather
   than the raw pair.** It clamped before rescaling, so the floor was divided
   away again — `[-5, 900]` normalised to ~5.6e-5, a tile no pointer could grab
   back — and small shares were inflated (`[0.001, 0.2]`, a half-percent share,
   came out as a fifth of the split). This is the same defect one level down,
   which is why it is in scope here. Three tests that pinned the old arithmetic
   are updated, in `binaryTree.test.ts`, `layoutTree.test.ts`, and
   `panelModel.test.ts`; no other chat-surface test changed.

**The three unconfirmed reports, each settled by measurement rather than by
argument.** The reporter's window was intermittently occluded, which stalls
`requestAnimationFrame` and delays `ResizeObserver`, so none of them could be
trusted as reported.

- **No scrollback replay after a reload — NOT REPRODUCED.** The server sends
  its replay ring as an `output` frame immediately after `ready`, the client
  writes every `output` frame, and text typed before a reload is on screen
  after one. Driven end to end against a real PTY; kept as a regression test
  rather than turned into a fix. The most likely explanation of the original
  observation is the stalled `requestAnimationFrame` the occlusion caused:
  xterm's write is queued and painted on a frame.
- **Restart appearing to do nothing — CONFIRMED, and it is the client.** The
  server disposes the shell, spawns another, and sends a fresh `ready` with a
  new terminal id plus the new shell's output. But `terminal.clear()` was
  called only for a `reset` frame, and a restart sends none, so the dead
  shell's screen stayed exactly where it was with the new prompt appended
  underneath — visually, nothing had happened. A `ready` naming a DIFFERENT
  terminal now clears; one naming the same terminal deliberately does not,
  because that is the re-attach path and clearing would throw the replay away.
- **Tab strip at minimum width — CONFIRMED as a pointer gap, narrower than
  reported.** Keyboard (arrow keys) and trackpad (a gesture sends `deltaX`)
  both reach the tabs a 280px strip cannot fit. A plain wheel mouse did not:
  measured in Chromium, a vertical wheel over a horizontal-only scroller moves
  nothing at all, so this was a real reachability gap rather than a missing
  decoration. The strip now scrolls by whichever axis the pointer moved.
  `scrollbar-width: none` stays, and that is the judgement call: unhiding the
  scrollbar costs 15px of strip height on every machine whose scrollbars are
  classic, buys nothing where they are overlay, and reachability — not
  decoration — was the complaint. The active tab is scrolled into view on every
  activation, so the strip is never showing the user nothing they asked for.

**What this pass says about the last one.** The two hypotheses recorded against
finding 6 were both wrong, and both were plausible enough to have been
implemented. What settled it was measuring the thing that was actually claimed
to be missing — where the scrollbar IS — rather than the mechanism that was
guessed. Three of the six defects here (F2, F3, F4) are pure layout, invisible
to a green jsdom suite by construction, and all three are now measured in the
end-to-end spec at the sizes that reproduce them.

**2026-08-22 — what milestone 3 found while building the drag.**

1. **A chorded arrow was handled twice (D14).** The tab strip's tablist took
   every `ArrowLeft`/`ArrowRight` as its own, including one carrying
   `Shift`+primary+`Alt` — which is exactly how the four split chords are
   spelled. The panel leaves keyboard focus on a tab after every structural
   chord (F5), so a split chord landed on the strip first, moved the selection
   one tab along, and only then split — with whichever tab the arrow had just
   reached rather than the one the user was looking at. Found end to end, not
   by a test: a drag case set up two groups with a chord and got the two tabs
   the other way round. A tablist's arrow keys are the unmodified ones, and
   the strip now ignores a chorded arrow.
2. **The edge bands needed a floor AND a ceiling.** 15% of a group's short
   side is 36px at the 240px group floor and 24px at the 160px height floor,
   which is a band a pointer has to be aimed at, so each band is at least
   32px. Four bands and a centre share one box, so each is also capped at 35%
   of its own axis — without that, two 32px bands meet in a short group and
   the centre, the target that means "move into this group", has no area.
   And the **strip is taken off the top before the edges divide what is
   left**: the strip is ~40px tall and the top band is at least 32px, so
   priority alone would have left the top edge with the few pixels the strip
   did not cover, or with none.
3. **The panel's chord group has one key left, and reordering needed two.**
   That group holds Alt, which composes alternate characters on macOS, so it
   is restricted to keys whose `event.key` is layout-independent: the four
   arrows, `Home`, `End`, `PageUp`, `PageDown`, `Backspace`, `Delete`,
   `Enter`, and `Space`. Eleven were bound; only `Delete` was free. `Insert`
   is absent from Mac keyboards and `Tab` and `Escape` belong to the
   operating system in this combination. So the two existing move chords
   became **"Move panel tab left / right"** — one place along the strip, and
   into the adjacent group once the tab is at that end, entering from the
   side it left. That is a superset of what they did, and it closes WSP-10's
   missing strip-reorder route without inventing a key somebody cannot press.
   See the decision log.
4. **The close-control question (finding 5) is confirmed, not changed.**
   Arrow keys carry the selection along the strip and the single close
   control's accessible name follows it, so closing any tab without a pointer
   is: arrow to it, then `Tab` and `Enter`, or the close chord. That walk is
   now a keyboard-only test in `TabStrip.test.tsx`, so the design is pinned
   rather than merely argued.
5. **A test file was silently excluded from `tsc` and `eslint` by its own
   name.** `TabDrag.test.tsx` sat beside `tabDrag.test.ts`; on a
   case-insensitive filesystem TypeScript's include-glob expansion treats two
   files differing only in extension as one and keeps the `.ts`, so the
   `.tsx` was dropped from the program entirely. `vitest` ran it, `tsc`
   never saw it and `eslint` reported only "not found by the project
   service". Renamed to `useTabDrag.test.tsx`. The durable lesson: on this
   repository a `Foo.test.tsx` beside a `foo.test.ts` is type-checked by
   nothing, and the symptom is an eslint parsing error rather than anything
   that mentions the collision.

**2026-08-22 — milestone 3's standing hands-on UI pass, and the seven defects
it found in the drag.** The pass is no longer owed: a reviewer drove the drag
in a real browser and reported six defects plus one accepted discoverability
item, each with a measurement. Every one was reproduced from that measurement
before anything was changed, and each is pinned by a test that fails without
its fix. G1 and G2 are pinned **end to end and only end to end** — one is a
scroll offset the browser resets when a box leaves layout or a node is
detached, the other is a containing block; jsdom has neither, and a jsdom
case asserting either would pass in both directions.

1. **A tab lost its scroll position on a move, and would lose it on a switch
   in any browser that does not carry it (G1, a regression from F2).** The
   cause is the one the reporter suspected: F2 made `.file-preview` and
   `.diff-view` flex columns with one bounded scrolling region, which moved
   the element that scrolls INWARD, from the tab body to its `pre`.
   `PanelBodies` went on recording the body's own two offsets, which are now
   permanently 0, and its `onScroll` never fired anyway — a scroll event does
   not bubble and React has not simulated bubbling for it since React 17, so
   a descendant's scroll reached nothing.

   Measured on the browser the suite runs, HeadlessChrome/151, on a bare page
   as well as on ours: `display: none` reports 0 while the box is gone but
   **restores** the offset when it comes back, while detaching and
   re-attaching the node loses it for good (`{top: 500, left: 300}` ->
   `{0, 0}` -> `{500, 300}` across a hide/show, and -> `{0, 0}` across a
   detach/re-attach). So the reporter's switch case does not reproduce on
   this Chromium — it is carried by the browser — and their drag case
   reproduces exactly: 1000/900 -> 0/0. Both are fixed here rather than one,
   because "the browser happens to do it" is not the same claim as "the panel
   does it", and the e2e case keeps the guard for a browser that does not.

   The fix records, per body, the offsets of **whatever descendant actually
   scrolled** — a capture-phase native listener, since capture is the only
   phase a non-bubbling event reaches an ancestor in — and puts them back
   both when the host is moved and when the body is shown again. Which
   element scrolls is a decision each tab type makes in CSS, so nothing here
   names a node.

   Pinned by two **e2e** cases (a switch, and a drop on another group's
   centre, both asserting `.file-preview pre`'s offsets and that the node is
   the same one) plus one jsdom case that pins the record-and-restore
   mechanism with the browser's reset stood in for by hand. The two existing
   `PanelBodies.test.tsx` scroll cases are left as they are and are **not**
   evidence about this: they passed throughout.

2. **The drag ghost was drawn ~1138px off screen and was never visible
   (G2).** `.panel-drag-ghost` is `position: fixed` and moved by a transform
   in viewport coordinates, but `.panel` computes a non-`none` transform from
   the slide-in rule — and a transformed element is the containing block for
   its fixed descendants, so the two offsets added. Reproduced at the
   reported measurement: pointer at x = 1870, `translate(1882px, 512px)`,
   `getBoundingClientRect().left = 3020.33` = 1882 + 1138.33, the panel's
   left edge. Vertical was right only because the panel's top is 0. Since the
   panel is always the right-hand dock, the ghost was **always** outside the
   viewport, and pick-up feedback was the source tab dimming and nothing
   else.

   Fixed by rendering the ghost through a portal into `document.body`, which
   is outside the transformed subtree. Removing the panel's transform was the
   alternative and is not available: that transform is the slide-in.

   Pinned by an **e2e** case that measures the ghost's client rectangle at
   three pointer positions and asserts it tracks the pointer in viewport
   coordinates, is inside the viewport, and is not parented inside the panel.
   It has to be e2e: a containing block is layout, and jsdom computes none —
   the same assertion there passes whether the ghost is portalled or not. The
   ghost is deliberately **not** clamped to the viewport when the pointer is
   within its own size of an edge: clamping needs the ghost's measured size
   on every pointer move, and that is the per-move layout WSP-09 forbids.

3. **A fast flick dropped the entire gesture (G3).** `onTabPointerMove` is
   bound to the tab, and `setPointerCapture` was taken **inside** `startDrag`
   — that is, only after a first `pointermove` that both crossed the 4px
   threshold and was still delivered to the tab. A tab is 78 x 43px, about
   21px from centre to edge, so a downward yank at roughly 1300px/s leaves
   its box in one event and no move is delivered at all. Reproduced at the
   reported measurement, same start and end, differing only in step size: a
   single 47 x 28px move mounted no drop zones, announced nothing, and
   changed no layout; 8px steps armed the drag and dropped normally.

   Fixed by capturing the pointer on `pointerdown`, so every subsequent move
   belongs to the tab wherever the pointer is, and releasing that capture on
   a release that never became a drag. The 4px threshold is untouched and is
   still what separates a click from a drag; the close affordance still takes
   no capture at all, because the press handler returns before it.

   Pinned by an e2e case that presses, moves once by 47 x 28px, and asserts
   the drop zones mount and the drop commits, plus a jsdom case asserting
   where the capture is taken and that a plain click gets it back.

4. **A drop that would be refused highlighted and announced as if it would
   work (G4).** In the panel's default shape — one group, one tab, which is
   also the state after every migration — picking that tab up and moving to
   any edge band highlighted it in the accent colour and announced "Split
   Panel tab group to the right."; the release then answered "Nothing moved."
   and changed nothing. The keyboard route has had a real reason for exactly
   this case since D8 (`SPLIT_NEEDS_TWO_TABS`); the drag never said it.

   Fixed by resolving the plan on **every target change** rather than only on
   the release: `planDrop` now carries a reason on its `none` case, the drag
   holds a `refused` flag beside the target, a refused band is drawn in the
   muted token with a solid border instead of the accent wash, and the live
   region says the reason. The reason string is imported, not reworded — it
   and `groupAccessibleName` moved into a new `panelAnnouncements.ts` so the
   pointer route and the keyboard route say the same sentence about the same
   thing.

   Pinned by `tabDrag.test.ts` (the reason travels with the refusal),
   `useTabDrag.test.tsx` (a refused band is drawn refused and named before
   the release), and an e2e case in the default panel, which is the shape it
   was reported in.

5. **Four gaps in the drag narration (G5).** All four are closed:
   - leaving every target used to announce nothing, so the live region went
     on reading "Drop into … position 4 of 4." while a release there would do
     nothing. `setTarget` now announces every change, including the change to
     no target at all;
   - the first target after a pick-up was never announced, because
     `startDrag` assigned `target.current` directly. The pick-up and its
     first target are now **one** message rather than two, because two
     overwrite each other in a live region before it has read the first — and
     an "already here" first target is left unsaid, since a pick-up is by
     definition over the place the tab already is;
   - every successful chord was silent — only refusals spoke — so the route a
     screen-reader user actually has narrated nothing while the pointer route
     narrated everything. `panel-move-tab`, `panel-split`, and
     `panel-close-tab` now announce what they did, sharing the drag's
     wordings; a chord that changed nothing still says nothing;
   - an in-strip reorder announced "Moved Changes into Panel tab group." — no
     position, and "into" a group it never left. A move now names the
     position and the strip, and says "into" only when the tab actually
     changed groups.

   Pinned in `tabDrag.test.ts`, `panelCommands.test.ts`, and
   `useTabDrag.test.tsx`.

6. **Discoverability of the drop targets (G7, accepted from the pass's
   subjective section).** With the ghost visible again (G2), the remaining
   gap was that all five regions were fully transparent until the pointer was
   inside one. Each band now carries a faint dashed hairline in
   `--hairline-2` for as long as the drag lasts — quiet on purpose, over a
   running terminal — and the band under the pointer is still plainly
   different. Pinned by an e2e case that reads the computed border colour of
   all five bands in **both** colour schemes and asserts none is transparent
   and the highlighted one differs.

7. **The per-tab close affordance was a 9 x 16px target (G6).** Reproduced
   exactly, by hit-testing outward from the glyph's centre: 9px of hittable
   width against the strip's own close button at 30 x 30. Its behaviour was
   never at fault — inert while the tab is inactive, arms no drag, a plain
   click closes the tab — so nothing about it changed except what a pointer
   can land on: a pseudo-element hit box, so the glyph keeps its size and the
   strip keeps the header token's height. Measured after: **25 x 30**.

   Two things came out of building it that are worth recording, because the
   first version was wrong and a test caught it. The hit box may reach right
   only as far as the tab's own padding — a close control overhanging the
   next tab closes the wrong tab — so the width has to come from the left,
   and a first attempt at 12px of left reach put the CENTRE of a 53px "Files"
   tab inside its own close control. Clicking that tab to switch to it closed
   it, which the keyboard end-to-end case failed on immediately. So the tab
   now has a `min-width` of 3.5rem as well: it is the only way to state "the
   hit area can never reach a tab's middle" in CSS, since the shortest
   possible title would otherwise make a 36px tab. The right-hand padding
   grew by 0.15rem to buy the last of the width. The strip's height is
   unchanged and is asserted against the `--header-h` token rather than
   against a number.

**The robustness note about `commit()` — considered, and acted on.** The
reviewer could not reproduce the misfire with real input because Chrome
always delivers a `pointermove` at the release point first, and this pass did
not reproduce it either. It is still resolved from `pointerup`'s own
coordinates when they differ from the last move, because the cost is one
comparison and the failure mode it removes — committing a move to a target
the pointer has left — is silent and unrecoverable by the user. A synthetic
release far from the last move is exactly what an assistive or automation
tool produces, so "no real pointer does this" is not the whole population.

**2026-08-23 — milestone 4 was implemented before its approval was recorded, and
the approval has since been given.** The order events actually happened in,
recorded rather than tidied away, because this plan's own Discoveries section is
the record of how this work went:

1. On 2026-08-22 the coordinator reported the hands-on pass's findings to the
   user — the Files tab flooded by `node_modules` and flat where it should be
   hierarchical — and the user answered "however you think is best to fix all of
   these issues, put it into the plan of fixes".
2. Specification version 2 and milestone 4 were drafted from that instruction,
   and the milestone was **implemented and shipped on 2026-08-23** on the
   coordinator's instruction, while this plan still said milestone 4 must not
   start production work until specification version 2 was approved and the
   specification still recorded that approval as pending. The gate was crossed
   before it was recorded as open.
3. On 2026-08-23 the coordinator put that discrepancy to the user explicitly —
   that they had approved the **behaviour** described in session and not the
   document — and the user confirmed the approval stands as intended. The gate
   is now satisfied, under the same qualification version 1 carries: a
   discrepancy between the specification document and that discussion resolves
   in favour of the discussion and returns the proposal to Draft.

The durable lesson is the one the ExecPlan lifecycle already states: an approval
gate is satisfied by a recorded approval, not by a well-founded expectation of
one. Nothing implemented is being undone by this entry — the approved behaviour
and the built behaviour are the same behaviour — but the sequence is not erased,
because the next reader is entitled to know that the document trailed the work.

**2026-08-23 — milestone 4's standing hands-on UI pass, and the seven defects
it found in the file tree.** A reviewer drove the running application against
a real repository and measured every finding before reporting it. Each was
reproduced from that measurement before anything was changed, each is pinned
by a test that fails without its fix, and two of them turned out to be
different defects from the ones reported — which is recorded here rather than
tidied away, because both times the reported symptom was real and the
mechanism behind it was not what it looked like.

1. **The tree hid files the repository tracks (H1).** `backend/cert.pem` and
   `backend/key.pem` are tracked — `git ls-files --error-unmatch` succeeds,
   commit `e48ff2e3` — and match `backend/.gitignore:185:*.pem`. Git never
   ignores a tracked file; a pure pattern matcher always does. Measured over
   the whole reporting repository: panel-visible 1899 against git-visible
   1901, the difference exactly those two, and **zero** files shown that Git
   would ignore. So the matcher is faithful everywhere else, and this is the
   one systematic divergence — and it is the worst kind, because the user
   knows the file is in the repository and the tree says it is not.

   **Decided: consult the index, and say why that is not the rejected
   call.** The plan rejects `git check-ignore`, and that rejection stands
   untouched: it is a per-path oracle, one process or one long-lived pipe
   consulted for every entry of every listing, on the hot path. `git ls-files
-z --cached` is a different call in every respect that made the first one
   unacceptable — **one** bounded listing per working tree, cached and served
   from memory thereafter — and it answers a question the matcher cannot
   answer at all rather than re-answering one it already answers correctly.
   Measured on this repository: 226 tracked paths, 8,947 bytes, 7 ms, against
   a 5 MiB output limit and a 10-second timeout it already inherits from the
   Git process policy `git status` uses.

   Invalidation is the identity of `.git/index` — the file `ls-files` reads,
   and the file every `add`, `commit`, `rm`, and `checkout` writes — with a
   five-second lifetime where it cannot be stamped (a linked worktree keeps
   its index elsewhere), a one-minute ceiling regardless, four working trees
   cached, and 50,000 paths each. Every failure degrades to the matcher
   alone: no Git, no repository, a non-zero exit, a timeout, truncated
   output, or too many paths all yield no index, and no index exempts
   anything. A non-Git project is bit-for-bit what it was.

   One thing came out of building it that the report did not name. Once a
   tracked file can pull the walk into an excluded directory, the directory's
   untracked siblings become visible too — a floating pattern like `dist`
   matches the directory and not the paths beneath it, and the shipped code
   relied on never descending. So the walk now carries "am I inside an
   excluded directory", and inside one only tracked paths are shown. That is
   Git's own rule that a path under an excluded directory cannot be
   re-included, and it is pinned by a case that lists `dist/keep.js` and not
   `dist/stale.js`.

2. **The requested path obeyed no rule of its own (H2).** The filter was
   applied to entries met while walking and never to the path the request
   named: `?path=.git&depth=1&showIgnored=false` answered 200 with the
   repository's machinery, `?path=.git/refs&depth=1` answered 200,
   `/file?path=.git/config` returned the config including the remote URL, and
   `?path=frontend/node_modules&showIgnored=false` returned 390 entries.
   Refused now at the resolve step every file route shares.

   **One deliberate divergence from the instruction, recorded rather than
   made quietly.** The single-file read applies the `.git` refusal and _not_
   the ignore filter. A File tab is opened from a tree that may legitimately
   be showing ignored paths — that is what the opt-in is for — it is durable,
   and it carries no ignore mode of its own; a check that every real caller
   would have to bypass is not a boundary, it is a parameter with one value.
   The ignore rules govern what a **listing** offers, which is what WSP-05
   and the read policy actually require of them. Written into the read policy
   so the boundary states what it holds.

3. **Deep rows were unreadable at the panel's floor (H3).** At
   `PANEL_MIN_WIDTH` a level-14 row computed `padding-inline-start: 11.05rem`
   inside a 248px line, leaving a 44px name column for a name 128px wide;
   level 13 left 58px, and about 13.6px goes per level. The tree did not
   scroll sideways (`scrollWidth === clientWidth === 259`) and the page did
   not overflow, so the only recovery was the row's tooltip and ten
   consecutive rows read `eleme… playw… reque… sessi…`.

   **Chosen: scroll, not compress.** A row is as wide as its own content and
   never narrower than the tree. Capping or compressing the indent past some
   depth was the alternative and was rejected: the indent is the only thing
   on screen that says how deep a row is, and flattening it exactly where the
   tree is deepest trades one unreadable thing for another; a smaller unit
   only moves the width at which the same failure happens. Scrolling keeps
   both the depth and the name, which is what the editor this tab is
   modelled on does.

   The trap was the one this feature has already fallen into once. A
   horizontal scroller whose height is unbounded puts its scrollbar at the
   bottom of the whole list, hundreds of pixels below the visible area — F2,
   exactly. So the Files tab became a column, the arrangement the file
   preview already uses, and the tree is a bounded box whose scrollbars are
   at the edges of the panel. Measured at the floor: the name is not clipped,
   the tree scrolls, its bottom edge is on screen, and the page's own
   horizontal overflow is still zero.

4. **Focus dropped to `<body>` after opening a file (H4).** F5's defect on
   the path F5 did not cover: it fixed the structural chords, and an
   activation hides a body just as surely as a split does. Opening a tab now
   asks the panel for focus. Two further paths hide a body the keyboard may
   be inside, and both are covered: the tab-switching chord, which moves
   focus only when the keyboard was in the body it just hid — read from
   `document.activeElement` before the command runs, so a chord issued from
   elsewhere on the page still does not steal focus into the panel — and
   closing the panel, whose own close control is inside the panel that is
   about to become inert.

5. **The failing-listing report was true about the symptom and wrong about
   the cause (H5).** Investigated before anything was changed, as the report
   asked. The error row and its retry are **reachable**: under the
   application's own retry policy a rejecting listing settles in about three
   seconds and the row reads "Could not list src. Activate this row to try
   again." — in jsdom, and against the real server in a real browser, where
   the row's retry also recovers. So "30+ seconds still Listing…" cannot be
   explained by a failing request at all.

   What it is explained by is a request that never **settles**. React Query
   can retry a rejected promise and then fail it; it can do nothing with a
   pending one, and nothing in the client bounded how long a read would wait.
   That is a permanent "Listing…" row with no error, no retry, and no
   recovery short of a reload — including the part of the report that looked
   strangest, that unpatching the server changed nothing, because the promise
   already in flight never settles either. The most likely origin of the
   observation is the patched `fetch` itself: a stand-in `Response` whose
   `json()` never resolves produces precisely this and is invisible from the
   page.

   Fixed where the gap actually is: a panel read carries a ten-second
   deadline — the same one the server gives its own Git calls — and aborts
   the request rather than abandoning it, reporting a typed `request_timeout`.
   The retry policy moved out of `main.tsx` into `shouldRetryRequest`, where
   it is unit-tested: a client error and a timeout go to the view's error
   state at once, everything else is retried twice. The old policy
   special-cased 401 and retried a 404 three times.

6. **A path that is not there was an internal error (H6).** `path=does/not/
exist` answered `500 {"error":{"code":"internal_error"}}`. Typed now:
   `path_not_found` (404) for a path that is gone, `path_not_directory` and
   `file_not_regular` (400) for one that exists and is the wrong kind,
   `path_unreadable` (403) for one that cannot be read; the tree renders that
   row's own error state on the first answer, because a client error is not
   worth repeating twice before saying so. Containment was never at fault:
   `path=../../../etc` was a correct 400 before and still is.

   Worth recording, because it changes what the defect is: the realistic
   trigger the report names — a persisted expansion pointing at a deleted
   directory — does **not** reach the server. A collapsed-away path is only
   requested when a row for it exists, and the row comes from its parent's
   listing, which no longer holds it. The reachable case is narrower and
   real: a directory deleted while the tab is open, whose row the tab is
   still showing from the listing it read before. That is what the
   end-to-end case drives.

7. **An interrupted drag stranded the panel, and it is reachable by a real
   pointer (H7).** Reported as unconfirmed for real input because the
   reporting harness could not deliver a second real `pointerdown`. It is
   confirmed: Chrome delivers it, and a second `mouse.down()` mid-drag
   reproduces the stranded state exactly — the drop zones still mounted, the
   ghost still on screen, the source tab still at 0.45 opacity, and Escape
   inert. The mechanism is the one the reviewer identified in code, verified
   line by line: a second press replaces `tracking.current` with a
   non-dragging record, its `pointerup` takes the "never became a drag" early
   return and nulls tracking without clearing `drag`, and `cancel()` — which
   begins by reading `tracking.current` — early-returns for ever, so Escape,
   whose whole job is to cancel, cannot. A press now ends whatever the
   previous gesture left behind, a release and a `pointercancel` clear a drag
   they find stranded, and `cancel()` clears drag state on its own terms when
   there is no tracking record to clear it through.

**The `README.md` search figure, corrected by measuring it twice.** The pull
request's table says 7 matches; the pass reported 9 against its own ground
truth. Both are right, about different working trees, and the figure is a
property of the tree rather than of the code: on **this** repository the
search returns exactly 7, and `git ls-files` plus untracked-not-ignored
contains exactly 7 paths matching `README.md` — checked independently, and
they agree path for path. The pass's 9 belongs to the repository its other
measurements come from, the one with `backend/` and `frontend/node_modules/`.
What the figure supports is unchanged and verified in both places: no
dependency copies, project files first. The lesson is the small one — a
number measured against one working tree is not a property of the feature —
and the documentation now says which tree it counted.

**What this pass says about the last one.** Two of the seven reports
described a real symptom and a mechanism that was not there (H5's failing
listing, H6's persisted expansion), and one described a mechanism precisely
while doubting it could happen at all (H7). All three were settled the same
way: by reproducing the measurement first and only then reading the code, or
by driving the real browser at the exact sequence in question. The standing
instruction to confirm a finding before it becomes work earned its place
again — and so did its converse, that a finding whose mechanism is wrong is
still a finding, because the symptom was real every time.

**2026-08-23 — what milestone 5 found while building the File tab.** None of
these came from a hands-on pass; the pass for this milestone is still owed.
Each is recorded because it changed a decision.

1. **A theme cannot be handed to Shiki as CSS variables — except that it
   can.** The expectation, from vscode-textmate's history, was that a theme's
   `foreground` had to parse as a hex colour and that anything else would be
   dropped, which would have meant sentinel colours and a reverse map from
   sentinel to variable. Measured before building on it: `@shikijs/vscode-textmate`
   10.0.2 carries a theme colour through tokenization as an opaque string, so
   `var(--code-keyword)` arrives intact on the token and reaches the DOM as an
   inline `color:`, where the cascade resolves it. That is what makes a theme
   switch re-map a highlighted file with **no re-highlight, no listener, and no
   reload** — pinned end to end by switching `prefers-color-scheme` and
   re-reading the same node's computed colour. Recorded because the sentinel
   design was one commit away from being written, and because the property it
   depends on is a library behaviour rather than a documented contract: if a
   future Shiki drops non-hex colours, the symptom is uncoloured text and the
   fix is the sentinel map.
2. **react-markdown's own URL sanitiser refuses `data:`, which settled the
   image question.** The plan said the image renderer should refuse "any
   non-`data:` remote URL", i.e. that an inline `data:` image would be shown. It
   is not: `defaultUrlTransform` empties a `data:` `src` before the renderer
   sees it, and re-enabling it would have meant passing a custom `urlTransform`
   for arbitrary working-tree content. **Decided the other way instead: no
   image element is rendered at all**, and every reference — remote, inline, or
   relative — becomes a labelled placeholder naming what would have been there.
   A file preview then has exactly one element class it cannot be made to
   fetch, and the reader is told what is missing rather than shown a gap.
3. **A `pre` that is highlighted is still the same `pre`, and that is what the
   scroll cases depend on.** Swapping plain text for ~8,000 token spans
   replaces the children of the element `PanelBodies` records the offset of,
   not the element itself, so G1's mechanism is untouched. The three existing
   `wide.json` cases nevertheless now wait for the tokens before they measure:
   they passed either way, but whichever content they happened to catch was a
   race, and a measurement of content the user is no longer looking at is not
   the measurement the case claims to make.
4. **`.file-preview pre` had to become `.file-preview > pre`.** The rule that
   strips a preview `pre`'s margin, border and radius matched a fenced code
   block **inside** a previewed markdown document too, which is a box in a
   document rather than the file filling the tab. The same applied to the
   header-button rule, which would have restyled a document's in-repository
   links, since those are buttons. Both are direct-child selectors now.

**2026-08-23 — milestone 5 against this repository, measured rather than
described.** Driven through a real browser against this working tree, with the
project registered the way a user registers one. First paint is the number
that matters: WSP-05 requires highlighting never to block it.

| File                                                   | Size                              | Plain text on screen   | Highlighted | Tokens |
| ------------------------------------------------------ | --------------------------------- | ---------------------- | ----------- | ------ |
| `apps/web/src/styles.css`                              | 2,736 lines                       | 218 ms after the click | +81 ms      | 7,851  |
| `e2e/workspace-panel.spec.ts`                          | 2,376 lines, the heaviest grammar | 72 ms                  | +1,029 ms   | 9,343  |
| `docs/exec-plans/active/2026-08-22-workspace-panel.md` | 2,376 lines, rendered             | 261 ms                 | n/a         | n/a    |

The TypeScript case is the interesting one: its grammar chunk is 181 kB and
tokenizing 2,000 lines of it takes about a second, during which the file is
fully readable and scrollable as plain monospace text. That is the whole shape
of the requirement, and it is why the upgrade is a swap of the `pre`'s children
rather than a gate on rendering it.

The rest of what that pass measured: both large files were bounded to 2,000
lines with the notice naming the true count (2,736 and 2,376); the `pre`'s
bottom edge and the visible bottom of the tab body were the same pixel (720),
so the horizontal scrollbar is on screen while 243 px of content extend past
the right edge; the page's own horizontal overflow was 0 in every case; and the
exec plan's preview rendered 1,832 elements, **zero** image elements, and 27
in-repository links — every one of this plan's own relative document links,
turned into a control that opens that file in its own File tab.

- No blockers. Milestone 4's gate is **satisfied** as of 2026-08-23; it was
  never blocked, only waiting on a normal lifecycle step. Its standing
  hands-on UI pass is no longer owed either: it was performed, and the seven
  defects it found are fixed above. **Milestone 5's standing hands-on UI pass
  IS owed** as of 2026-08-23: the milestone is implemented, its suites are
  green, and its numbers above come from driving the real repository — but that
  is a scripted measurement of what someone already thought to measure, which
  is exactly what the standing pass exists not to be. A separate agent performs
  it.

### 2026-08-23 — milestone 5's standing hands-on UI pass

A reviewer drove the File tab in a real browser against a real repository and
reported eleven items, every one measured: ten defects and one scope addition.
What each of them turned out to be, and what now pins it, is recorded here.
Two things the same pass looked at and found working are recorded at the end,
so neither is re-reported as a bug.

**J1 — the header wrapped the path instead of ellipsising it.**
`.file-preview > header span` carried `overflow: hidden` and
`text-overflow: ellipsis` with **no `white-space: nowrap`**, and
`text-overflow` is inert while the computed `white-space` is `normal`. So the
span wrapped. Measured against a markdown file, whose header carries three
buttons:

| panel width     | path span  | header height |
| --------------- | ---------- | ------------- |
| 280 (the floor) | 0 × 88px   | 107px         |
| 352             | 58 × 73px  | 92px          |
| 400             | 106 × 59px | 78px          |
| 544             | 250 × 29px | 48px          |

At 280–328px the path rendered **one character per line** in a 10px column and
the header took 107px — 83px of the file's own reading area — to say nothing.
Fixed by nowrapping the path, and then by deciding where the ellipsis should
fall: the tail of a path names the file and the head names a hundred files, so
the header now paints `docs/product-specs/` and `workspace-panel.md` as two
spans, the directories carrying a shrink factor 999 times the name's, and the
whole path on the element's `title`. The header's controls moved into a
wrapping group of their own, so at the floor the header becomes two short rows
rather than one tall one. Re-measured, same file tab, at three widths:

| panel width | path span  | header height |
| ----------- | ---------- | ------------- |
| 550         | 347 × 15px | 37.6px        |
| 400         | 197 × 15px | 37.6px        |
| 280         | 256 × 15px | 58.2px        |

The file name is whole at every one of them (135.75px painted against 136px
needed) and the tab body's horizontal overflow is 0. Pinned twice, because the
defect has two halves that fail in different places: `styles.test.ts` reads the
stylesheet and asserts the declaration that was missing, since **jsdom applies
no author CSS at all and cannot tell a missing rule from a present one**; and
an end-to-end case measures the rendered header at 550, 400 and 280.

## Decision and revision log

- 2026-08-23: **A previewed markdown file gets its own renderer, not the
  transcript's.** `components/Markdown.tsx` renders assistant messages: content
  this application produced in this session, whose links are addresses. A File
  tab renders arbitrary bytes out of the working tree, including files the user
  did not write, whose links and images are **repository paths**. Reusing the
  transcript's renderer would have been safe and wrong: it sends every `href`
  to `window.open` as a URL, so `../design/notes.md` would resolve against the
  workspace's own origin and navigate the workspace to a page that does not
  exist. So `FilePreviewMarkdown` shares the plugin set and the
  no-raw-HTML rule — that part must not drift — and answers links in three
  ways: an in-repository path opens another File tab (WSP-05's own rule for
  activating a file, applied to a link), an `http`/`https`/`mailto` address
  goes to a real browser tab with `rel="noreferrer noopener"` and says where it
  goes **in its accessible name**, and everything else — `javascript:`,
  `data:`, `file:`, a fragment the preview gives no ids for, a path that leaves
  the workspace — is inert text rather than a link that silently does nothing.
  Rejected: rendering an inert case as a live anchor carrying its original
  `href`, which is the one thing the classifier exists to prevent.

- 2026-08-23: **No image element is rendered in a file preview, of any kind.**
  The plan allowed an inline `data:` image; react-markdown's own sanitiser
  refuses one, and re-enabling it for untrusted content buys a rare case at the
  price of the single element class that can carry bytes. Every reference
  becomes a labelled placeholder naming the resolved target instead, so a
  document whose diagram is missing says what was there — a blank space reads
  as a rendering fault, and this one is a decision.

- 2026-08-23: **The highlighting theme names CSS variables rather than
  colours.** WSP-05 requires highlighting "derived from the active theme's
  tokens". A bundled Shiki theme carries hex colours chosen against its own
  background and would ignore `styles.css` entirely; resolving the tokens in
  JavaScript at highlight time would work but would need a `matchMedia`
  listener and a re-highlight on every theme change, because this application
  has three theme blocks and one of them is a media query. Naming
  `var(--code-*)` in the theme puts the resolution in the cascade, where a
  theme switch is free. The `--code-*` tokens are aliases of the existing
  palette except for two hues it has no member for, which are redefined in both
  dark blocks like every other literal in that file.

- 2026-08-23: **Twenty-one grammars, one dynamic import each, selected by
  extension through a closed union.** The language id becomes a module
  specifier, so it may never be a value that arrived over the wire: the
  file-preview response's `language` falls back to the bare extension for
  anything the server does not recognise, and it is not used for this at all.
  `languageForPath` maps an extension to one member of `CodeLanguage` or to
  `null`, and the grammar table is a `Record` over that union, so a language
  with no grammar cannot compile. Measured: the entry chunk contains no Shiki,
  the highlighter is a 148 kB chunk of its own, and each grammar is a chunk of
  its own from 2.8 kB (JSON) to 797 kB (C++) — none of which is requested until
  a file of that language is opened.

- 2026-08-23: **Markdown is deliberately absent from the grammar table.** A
  markdown file's default view is the rendered preview, and its source view
  exists to show the raw characters; highlighting it would load the markdown
  grammar, which embeds a dozen others, for the one view a reader switches to
  in order to stop seeing rendering. It is also what makes "the chunk is not
  requested until a non-markdown file is opened" a testable claim.

- 2026-08-23: **Tab body hosts are positioned over their group's rectangle, not
  relocated into it.** Decided by the user, from the two options milestone 9's
  blocking prerequisite put to them. Every host stays in one layer that is never
  detached, and each is placed over the rectangle of its owning group's
  `.panel-bodies` slot; nothing is ever removed from the document, so a browser
  tab, a terminal, a media element, and a scroll offset all survive a drag by
  the same mechanism, and the scroll save/restore workaround in `PanelBodies` is
  retired rather than re-fixed — it has already produced one regression (G1).
  The cost is rectangle tracking on resize and on layout change, which stays
  inside WSP-09 by reading in a `ResizeObserver` callback, after the browser has
  laid out, rather than in a pointer handler.

  **Rejected: accepting a reload for Browser tabs only**, and saying so in the
  product. It is cheap and it is honest, and it was rejected because it makes
  one tab type behave unlike every other — the inconsistency WSP-02 exists to
  avoid — for a limitation that is fixable, and because it would have left the
  scroll workaround in place as a permanent second mechanism. The reason a
  relocated `iframe` cannot survive is unchanged and is kept in milestone 9:
  removing an `iframe` from the document discards its nested browsing context,
  which is specified HTML behaviour rather than a browser quirk.

  This lands as **milestone 8**, before the browser tab, which becomes milestone 9. It is added inside plan version 2 rather than opening a version 3: version
  2 is Draft with technical approval pending, so no granted approval is
  invalidated and there is nothing to re-approve separately — the pending
  approval now covers this milestone too, and the Technical approval field says
  so.

- 2026-08-23: **Specification version 2 is approved, and milestone 4's gate is
  satisfied.** Approved by the user on 2026-08-23, under version 1's
  qualification: the approval is of the behaviour as described in session — the
  2026-08-22 report and the instruction that followed it — not of a reading of
  the specification document, and a discrepancy between document and discussion
  resolves in favour of the discussion, returns the proposal to Draft, and
  invalidates the approval of the milestone that implements it. Recorded here
  with the fact that the milestone was implemented before the approval was
  recorded, on the coordinator's instruction; the sequence is in Discoveries and
  blockers and is deliberately not erased.

- 2026-08-23 (milestone 4): **A directory's children are ordered directories
  first, then files, each case-insensitively by name, with a case-sensitive
  tie-break.** The requirement is only that the order be deterministic, and
  the shipped flat listing met that with one global `localeCompare` over the
  full path. A tree cannot: it lists one directory at a time, so the order has
  to be decidable from one directory's own entries. Case-insensitive because a
  listing that separates `Docs` from `apps` reads as unsorted; the
  case-sensitive tie-break after it keeps the comparison total, so two
  listings of a directory holding both `README` and `readme` never disagree
  about which came first.
- 2026-08-23 (milestone 4): **The 256 KiB ignore-file bound truncates and
  keeps, and discards the partial final line.** The plan states both "at most
  256 KiB per ignore file … anything beyond a bound is dropped with the rest
  of the file's parsed patterns kept" and "a missing, unreadable, or oversized
  ignore file contributes no patterns", which are different behaviours for an
  oversized file. Truncate-and-keep was chosen because it is the only reading
  under which all three bounds behave the same way, and both readings satisfy
  the governing rule that a bound degrades towards showing MORE. What the
  bound must never do is honour half a rule: a line straddling the bound is a
  rule nobody wrote and could hide a file, so the partial final line is
  dropped. `loadRootIgnoreLayers` still contributes no patterns at all for a
  missing, unreadable, or non-regular ignore file.
- 2026-08-23 (milestone 4): **Ignore patterns are matched by a linear segment
  walk, not by a compiled regular expression.** Compiling a glob to a regex is
  the obvious implementation and is what most ignore libraries do; it is also
  a backtracking hazard on exactly this input. A `.gitignore` is arbitrary
  bytes from the user's working tree, and `*a*a*a…b` against a long name is
  the classic exponential shape — reachable here in a 1,024-byte line. The
  classic wildcard walk with one remembered backtrack point answers the same
  grammar in O(pattern x path) steps and constant memory, and is pinned by two
  timing cases rather than by this paragraph.
- 2026-08-23 (milestone 4): **Each tree row is labelled by the element holding
  its own name, and the row's pointer target is its line rather than the whole
  `treeitem`.** Both follow from the same structural fact: a directory's
  `treeitem` element contains its children. Name-from-content therefore
  announced an expanded `src` as "src features main.ts" — verified in the
  component suite, which is why acceptance criterion 14 is asserted by
  querying rows _by name_ rather than by class — and a click on the middle of
  that element landed on whichever child was there, which the end-to-end pass
  caught and jsdom could not. `aria-labelledby` on the row and the click
  handler on the row's own line answer both, and keep the accessible name
  exactly the text the row displays.

- 2026-08-22: **The drag's keyboard equivalent is the chord set, not a move
  mode.** Milestone 3 as written proposed a mode — a key on a focused tab
  enters it, arrows choose a target zone, `Enter` commits — and that is not
  what was built. What WSP-10 requires is that every action available by drag
  has a keyboard route, and every one of them already had a chord except
  reordering within a strip, which the move chords now cover (below). A move
  mode would add a second, modal way to reach the same six operations, would
  need its own arrow bindings on a surface whose arrows are already the split
  chords, and would have to explain itself to a screen reader in a state the
  rest of the panel does not have. The plainer answer is that the drag is a
  pointer affordance and the chords are the keyboard one, both driving the
  same pure operations in `panelCommands.ts` and `tabDrag.ts` so they cannot
  drift.
- 2026-08-22: **`panel-move-tab` walks a tab left or right through the panel
  rather than jumping to the next group.** `End` and `Home` are unchanged as
  keys and their commands are unchanged in shape; what changed is that the
  chord now moves the tab one place along its own strip first and only
  crosses into the adjacent group once the tab is at that end of it, entering
  from the side it left. The advertised labels changed with the behaviour
  ("Move panel tab right" / "left"), so the Settings list still says exactly
  what the handler does. The alternative — two new bindings — was rejected on
  the key arithmetic recorded in Discoveries: the panel's chord group has
  exactly one layout-independent key left and reordering needs two, so a
  second pair would have had to use `Insert`, which Mac keyboards do not
  have, or `Tab`/`Escape`, which the operating system takes.
- 2026-08-22: **The workspace panel's docked outer edge carries a soft shadow
  as well as its hairline.** Requested by the user on 2026-08-22 against a
  reference screenshot of a desktop tool panel, and called out for **light
  mode** in particular, where a hairline between two white surfaces gives
  almost no separation. Recorded here because it is a deliberate departure:
  [CWS-01](../../product-specs/codex-workspace-surface.md) says the surface is
  "near-borderless: elevation and grouping come from background and hairline
  dividers, not from an outline on every element", and a shadow is a third
  mechanism that clause does not anticipate. It is not a contradiction — the
  panel genuinely is a different plane from the chat surface it is docked
  against, which is what elevation is for — but it is **scoped to the panel's
  outer docked edge and nothing else**. CWS-01's hairline rule continues to
  govern everything inside the panel, including the dividers between tab
  groups, and the whole chat surface. The value is a token (`--dock-shadow`)
  defined per theme in all three theme blocks, because a shadow tuned for a
  white page is invisible on a dark one; dark uses a black shadow that deepens
  the gutter between the page and the panel's lighter surface.
- 2026-08-22: **Created plan version 2** after the hands-on pass recorded in
  Discoveries. It adds milestone 4 (file tree, ignore rules, flat search),
  renumbers the milestones after it, folds findings 3–5 into milestone 3 and
  finding 6 into milestone 5, and adds a standing hands-on UI pass to every
  remaining milestone. Adding a server listing mode, an ignore-rule parser at
  the file boundary, and a persisted-shape change to the `files` tab is
  material technical replanning, so the version increments and the status
  returns to Draft with technical approval pending, per the ExecPlan lifecycle.
  Plan version 1's approval is not retracted: every milestone it covered is
  carried forward unchanged and the milestones already implemented stay
  implemented.
- 2026-08-22: **The two reported accessible-name defects are closed as not
  defects, and the verification they prompted is kept anyway.** A live-DOM probe
  showed the label span in both a panel tab and a file row is unhidden inside a
  name-from-content role, so the accessible name computes; the blank `name` came
  from the accessibility-tree dump tool. No markup was changed to satisfy a
  misreading. The computed-accessible-name assertions and the keyboard-only walk
  stay in milestone 3 on their own merits: axe passed this markup, and a tree
  dump failed it, so naming is settled by computing the name and by using the
  keyboard, not by either tool's verdict. The one item that survives from that
  group — that every tab is closable without a pointer — is carried as a design
  decision to confirm rather than as a fix.
- 2026-08-22: **Every remaining milestone ends with a hands-on UI pass in the
  running application, driven through the browser**, distinct from and
  additional to the automated suite. Requested by the user on 2026-08-22 after
  the automated suite passed milestone 2 and a manual pass immediately found six
  issues in it. Recorded as a standing step rather than a one-off task so it
  cannot be treated as satisfied by the end-to-end spec, which asserts only what
  someone already thought to assert.
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
