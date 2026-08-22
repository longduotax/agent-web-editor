# Workspace panel

**Current version:** None

**Proposed version:** 2

**Proposal status:** Draft

**Implementation status:** In progress

**Product approval:** Pending for specification version 2 — the bounded Files-tab
revision below (navigable tree, ignore rules honoured by default, flat search,
accessible naming), drafted 2026-08-22 after a hands-on pass at a real
repository. **Specification version 1 remains approved** (user, 2026-08-22, from
the design as presented in session, which the user approved and directed to
implementation; the user has not yet read this document itself, so a discrepancy
between it and that discussion resolves in favour of the discussion and returns
that proposal to Draft), and its implementation continues. Version 2 adds
behaviour to WSP-05 alone and reopens no other requirement.

**Subsystem:** Browser workspace composition — the right-hand workspace surface,
its tabs, its internal tiling, and the file, diff, terminal, and browser views it
hosts

**Last verified:** 2026-08-22

**Related ExecPlans:** [Workspace panel implementation plan](../exec-plans/active/2026-08-22-workspace-panel.md)

**Related documents:**
[Codex-style workspace surface](codex-workspace-surface.md) (CWS-06 revised by
this spec),
[Tiling workspace surface](tiling-workspace-surface.md),
[Inspector and terminal](../design/inspector-and-terminal.md),
[Local-client security](../design/local-client-security.md),
[Web workspace composition](../design/web-workspace-composition.md).

## Purpose

The shipped workspace inspector is a fixed three-tab strip — `Changes | Files |
Terminal` — that shows exactly one thing at a time and re-targets itself
whenever the user focuses a different chat pane. It cannot hold a diff and the
terminal that produced it side by side, it forgets a directory the moment the
user changes focus, it can run only one shell per worktree, and it cannot show a
rendered document or a running dev server at all.

This capability replaces it with a **workspace panel**: a small tiling area of
**tab groups** whose tabs are durable, independently addressed views. The user
outcome is a workspace that behaves like the tool panels in a desktop editor —
open several things at once, arrange them by dragging, and have every one of
them still be there, still pointing where it was left, on the next visit.

## Terminology

- **Pane**, **tiling tree**, **focused pane**, and **split** carry the meanings
  defined in [Tiling workspace surface](tiling-workspace-surface.md). They
  describe the **chat surface**, which this spec does not change.
- The **workspace panel** is the single region docked right of the chat surface.
  It replaces the **workspace inspector** defined in CWS-06; the term
  "inspector" is retired by this spec and must not appear in the shipped
  product.
- A **tab group** is a leaf of the panel's own tiling tree: one tab strip plus
  the one tab it currently shows.
- A **tab** is a durable, independently addressed view with a type, a context,
  and its own persisted state.
- A tab's **context** is the `(project, thread, execution scope)` triple that
  fixes which worktree the tab reads from. A tab's context is set when it is
  opened and never changes afterwards.
- The **execution scope** is the project root for a shared thread and the
  worktree root for an isolated thread, exactly as
  [Inspector and terminal](../design/inspector-and-terminal.md) defines it.

## Current contract

There is no Current contract for this capability. Its baseline is CWS-06 of
[Codex-style workspace surface](codex-workspace-surface.md), which is Draft and
in progress. This spec supersedes CWS-06 in full (see
[Superseded requirements](#superseded-requirements)). All chat-surface
behavior — the binary tiling tree, resizable dividers, split-to-new-chat-pane,
device-local layout, pane headers, run status, theming, and server authority
over threads and runs — is retained unchanged.

## Proposed contract (version 1)

### WSP-01 — The panel is a tiling area of tab groups

The workspace panel is a docked column to the right of the chat surface. It
contains one or more **tab groups** arranged in a binary tiling tree with
draggable dividers, using the same geometry rules the chat surface already
uses: binary splits, a surviving sibling promoted when a group closes, and
clamped size fractions.

Each tab group renders a horizontal **tab strip** and the content of its
**active tab**. A group with no tabs left closes itself and its sibling takes
its place. When the last tab in the last group closes, the panel closes and
leaves only its reopen control in the docked rail.

The panel is never a floating overlay and never overlaps chat content at any
width, and neither does its reopen control.

### WSP-02 — Tabs are durable and carry their own context

A tab is opened once and persists until the user closes it. Focusing a
different chat pane does **not** swap, retarget, close, or reorder any tab.

Every tab stores its own context. A `Diff` tab opened against thread A keeps
reading thread A's worktree even while the user works in thread B. When a tab's
context differs from the currently focused chat pane's thread, the tab displays
a compact **worktree chip** naming the thread or branch it belongs to, so two
tabs of the same type from different worktrees are never ambiguous.

New tabs are opened from a `+` control on the tab strip and from the keyboard.
The `+` menu opens tabs **for the focused chat pane's thread**; when no chat
pane owns a thread, the menu offers only tabs that need no thread context and
explains why the others are unavailable.

A tab whose context becomes unavailable — its thread archived, its worktree
removed, its project deregistered — does not disappear. It renders an explicit
unavailable state naming what went missing and offering to close the tab.

### WSP-03 — Tabs are rearranged by dragging

Dragging a tab shows drop targets on every visible tab group:

- dropping on a group's **tab strip** moves the tab into that group at the drop
  index;
- dropping on a group's **centre** moves the tab into that group and activates
  it;
- dropping on a group's **top, bottom, left, or right edge** splits that group
  along the corresponding axis and places the tab in the new half.

Drop targets are shown only while a drag is in progress, are highlighted
individually as the pointer enters them, and are large enough to hit without
precision. Dragging a tab onto its own group's centre is a no-op that does not
disturb the layout. A drag cancelled with `Escape` or released outside every
drop target leaves the layout exactly as it was.

Tab reordering within a strip, moving between groups, and edge-splitting are all
reachable from the keyboard as well; see WSP-10.

### WSP-04 — Panel geometry and device-local persistence

The panel's outer width, its internal tree, every group's tab list and active
tab, and each tab's own restorable state are a **device-local preference**,
persisted and restored across reloads. Nothing about the panel is sent to or
sourced from the server.

The panel enforces a minimum outer width and a minimum group size; it never
shrinks a group into an unreadable state. Its outer edge is a keyboard-operable
resize separator, as the shipped inspector's already is.

**Migration.** A persisted record from the shipped inspector preference
(`open`, `activeTab`, `width`) is migrated on read into a single tab group
holding one tab of the recorded type at the recorded width and open state. A
record that is otherwise malformed or of an unknown version is discarded to the
default panel — a single group holding one `Changes` tab. A persisted tab is
never silently dropped: anything that cannot be restored is either migrated or
accounted for by a full reset, never left referenced-but-absent.

### WSP-05 — Files and File tabs

_Revised by [proposed version 2](#proposed-revision-version-2--the-files-tab-is-a-navigable-ignore-aware-tree),
which replaces this requirement's Files-tab listing behavior. The File-tab rules
below are unchanged by that revision._

A **Files** tab lists the files of its context's execution scope with the
existing bounded, searchable, `.git`-excluding traversal. Activating a file
opens a **File** tab for it rather than previewing in place, so a document the
user is reading survives further browsing.

A **File** tab is strictly read-only; the product offers no editing affordance
of any kind.

- A markdown file renders as a **formatted preview** by default, with an
  explicit toggle to view its source. The rendered preview does not load remote
  images or execute embedded scripts.
- A text file that is not markdown renders with **syntax highlighting** derived
  from the active theme's tokens, and remains readable — as plain monospace
  text — if highlighting is unavailable for its language or has not finished
  loading. Highlighting never blocks first paint of the file's content.
- Binary, oversized, truncated, missing, and inaccessible files each render
  their own explicit labelled state, as the shipped preview already does.
- The tab offers copy-path and copy-content actions. Copy-path yields the
  normalized workspace-relative path; absolute server paths are never shown.

### WSP-06 — Changes and Diff tabs

A **Changes** tab shows the working-tree status of its context's execution
scope: a summary line of added / modified / deleted counts, or an explicit "no
changes" state, and a list of changed paths with their change kind carried by a
letter as well as a colour. Activating a path opens a **Diff** tab for it.

A **Diff** tab renders the unified diff of one path as structured content, not
as an undifferentiated block of text:

- staged and unstaged sections are separately labelled;
- each hunk carries its header, is individually collapsible, and shows old-side
  and new-side line numbers;
- added and removed lines keep their `+`/`-` prefix characters, so the
  distinction is never carried by colour alone;
- the file header is sticky while the body scrolls and states the path and the
  add/delete counts;
- truncated diffs say so explicitly.

Both tabs are always labelled as current working-tree state of a named
worktree, never as thread-attributed output.

### WSP-07 — Terminal tabs

A user may open **several terminals per execution scope**, each as its own tab,
up to a fixed per-scope limit; reaching the limit is reported as a clear
message rather than a silent failure.

Every terminal tab **stores the directory it is in**. The tab displays its
current working directory, persists it as device-local state, and reuses it as
the starting directory when that terminal is restarted or when the user reopens
the workspace after the process is gone. Where the platform cannot observe a
running shell's working directory, the tab shows the directory it was started
in and does not present it as the live one.

A terminal's process outlives a browser reload: reopening the workspace
re-attaches the tab to its still-running process, with replay, rather than
orphaning it or starting a second shell. A process that is genuinely gone —
after a server restart, an exit, or an explicit terminate — is reported as gone,
with an explicit restart action.

Terminals remain unsandboxed local shells running with the user's permissions,
carrying the persistent warning the shipped terminal already carries. That
warning appears once per terminal tab, not once per panel.

### WSP-08 — Browser tab

A **Browser** tab embeds a web page with an address field and back, forward, and
reload controls. Its address and history position are device-local tab state and
are restored with the tab.

Its primary purpose is viewing a local development server run from a terminal in
the workspace. It accepts any `http` or `https` address.

Because many sites refuse to be embedded, the tab **must not present a blank or
broken frame**. When the target declines embedding, the tab renders an explicit
state naming the site, explaining that it blocks embedding, and offering to open
it in a real browser tab. The same explicit treatment covers addresses that
cannot be reached at all.

The tab never presents embedded content as trusted: the embedded page cannot
reach the workspace's own storage, cannot script the workspace, and cannot
navigate the workspace away from itself.

### WSP-09 — The panel stays responsive

The panel is used continuously while work runs, so responsiveness is part of its
contract rather than an implementation concern:

- Switching between already-open tabs is immediate and never re-fetches content
  the tab already has. An inactive tab's content is retained, not rebuilt from
  scratch, so returning to it restores its scroll position.
- Only the **active tab of a visible group** does ongoing work. Hidden tabs do
  not poll, do not re-render on unrelated updates, and do not keep timers
  running. A terminal that is not visible keeps its process and buffers output
  but performs no rendering work.
- Long lists and long documents render within a bounded budget regardless of
  their true size: file listings, status lists, diffs, and file previews each
  cap the work they do per frame and state plainly when they are showing a
  bounded portion of a larger whole.
- Dragging a tab, dragging a divider, and resizing the panel track the pointer
  without visible lag, and neither re-fetches content nor reloads a terminal or
  browser tab. A tab moved between groups keeps its process, scroll position,
  and state.
- Typing in the file search does not issue a request per keystroke, and does not
  blank a result list that is still valid.

### WSP-10 — Keyboard, accessibility, and defined states

The panel is fully operable without a pointer. Every action available by drag —
switching tabs, reordering within a strip, moving a tab to another group,
splitting a group, closing a tab or group, and resizing — has a keyboard route,
and each is listed on the Settings page's keyboard-shortcuts list, which is
generated from the same table the handler dispatches from so an inert binding
cannot be advertised.

The tab strip is a tablist with correct roles, selection state, and focus
management. Drag-and-drop is announced to assistive technology, and drop targets
are reachable and labelled. Focus never escapes into a hidden tab's content, and
a closed panel is inert rather than merely invisible.

Every tab type defines and renders a loading state, an empty state, an error
state with a retry, and — where it needs a selection — a no-selection state. All
of them read correctly in both light and dark themes, and no state is conveyed
by colour alone.

## Acceptance criteria

1. The workspace panel replaces the inspector: no `Changes | Files | Terminal`
   fixed strip and no element named "inspector" exists in the DOM at any width,
   and the panel hosts one or more tab groups in a binary tiling tree with
   draggable dividers, promoting a sibling when a group empties and closing
   itself when its last tab closes.
2. A tab opened against one thread keeps reading that thread's worktree while a
   different chat pane is focused; it shows a worktree chip when its context and
   the focused pane's thread differ; and no tab is swapped, retargeted, closed,
   or reordered by a focus change.
3. Dragging a tab onto a strip, a centre, or any of four edges moves or splits
   as specified; every drop target is individually highlighted on hover; a drag
   cancelled with `Escape`, released outside a target, or dropped on its own
   group's centre leaves the layout byte-identical; and a moved tab keeps its
   process, scroll position, and state.
4. The panel's width, tree, per-group tab lists, active tabs, and per-tab state
   survive a reload; a persisted shipped-inspector record migrates into a single
   group holding that tab at that width; a malformed or unknown-version record
   resets to a single `Changes` tab; and no persisted tab is left referenced but
   absent.
5. Activating a file in a Files tab opens a File tab rather than replacing the
   list; markdown renders as a formatted preview with a source toggle and loads
   no remote images; non-markdown text is syntax-highlighted from theme tokens
   and remains readable before and without highlighting; binary, oversized,
   truncated, missing, and inaccessible files each render their own labelled
   state; and no editing affordance exists.
6. Activating a path in a Changes tab opens a Diff tab showing separately
   labelled staged and unstaged sections, per-hunk headers that collapse,
   old-side and new-side line numbers, retained `+`/`-` prefixes, a sticky file
   header with add/delete counts, and an explicit truncation notice.
7. Several terminal tabs can run against one execution scope up to a stated
   limit, which is reported rather than failing silently; each shows and
   persists its working directory and restarts into it; a reload re-attaches to
   the still-running process with replay instead of orphaning it or starting a
   second shell; a gone process is reported as gone with a restart action; and
   the unsandboxed-shell warning appears once per terminal tab.
8. A Browser tab loads an `http`/`https` address with working back, forward, and
   reload, restores its address after a reload, and — for a site that refuses
   embedding or cannot be reached — renders a named, explained state with an
   open-in-browser action instead of a blank frame. The embedded page cannot
   reach workspace storage, script the workspace, or navigate it away.
9. Switching between open tabs neither re-fetches retained content nor loses
   scroll position; hidden tabs issue no polling, run no timers, and perform no
   rendering; file lists, status lists, diffs, and previews stay within a
   bounded render budget and state when they are showing a bounded portion;
   drags and resizes track the pointer without reloading a terminal or browser
   tab; and file search neither fires per keystroke nor blanks a still-valid
   list.
10. Every drag action has a keyboard equivalent, all of them appear on the
    Settings shortcuts list and none that is inert does; the tab strip exposes
    correct tablist roles, selection, and focus management; drag-and-drop is
    announced to assistive technology; a closed panel is inert; and every tab
    type renders defined loading, empty, error-with-retry, and no-selection
    states that read correctly in both themes without relying on colour alone.

## Proposed revision (version 2) — the Files tab is a navigable, ignore-aware tree

**Proposal status:** Draft; product approval pending.

**Scope.** This revision replaces the Files-tab listing behavior of
[WSP-05](#wsp-05--files-and-file-tabs) and adds acceptance criteria 11 through 14. Every other requirement of version 1 — WSP-01 through WSP-04 and WSP-06
through WSP-10 — is untouched, as are version 1's non-goals. In particular the
**read-only** non-goal stands in full: a tree adds navigation, never editing,
and no expansion, tooltip, or copy affordance introduced here writes anything.

**Why.** On 2026-08-22 a reviewer drove the running application against a real
repository and verified the result in the DOM. Two things made the Files tab
unusable there, and neither is an implementation miss against version 1:

- **The traversal excludes only `.git`.** Searching `README.md` returned
  hundreds of `frontend/node_modules/@babel/…`, `@eslint/…`, and `@floating-ui/…`
  matches and buried the project's own README.
  [Inspector and terminal](../design/inspector-and-terminal.md) deferred
  ignore-file support — "ignore behavior is explicit and can later incorporate
  parsed ignore files" — and that deferral was tolerable while Files was one
  third of a cramped strip that also had to hold Changes and Terminal. It is not
  tolerable now that Files is a first-class, durable, independently addressed
  tab whose whole purpose is browsing a repository.
- **Files is a flat list of paths from the execution root**, with no directory
  expansion, no collapsing, and rows that truncate. The user asked for a
  VS-Code-like surface; this is the one place the panel clearly is not one.
  Version 1's WSP-05 required only the existing traversal, so a tree is a
  contract change rather than a defect, which is why it is proposed here instead
  of being fixed silently.

### WSP-05 — Files and File tabs (revised by version 2)

A **Files** tab presents the files of its context's execution scope as a
**navigable tree**. Activating a file opens a **File** tab for it rather than
previewing in place, so a document the user is reading survives further
browsing.

- **The listing is hierarchical.** Directories and files are shown in a tree.
  A directory is **expandable and collapsible in place**, and expanding one
  reveals its own children rather than replacing the view. A file's row shows
  **its own name**, not its path from the execution root; the full
  workspace-relative path is available on the row's tooltip and through
  copy-path. Which directories are expanded is part of the tab's own persisted
  state (WSP-04), so a tab reopened after a reload is expanded exactly as it was
  left.
- **Ignore rules are honoured by default.** Both the listing and the search
  exclude paths matched by the repository's own ignore rules, in addition to
  `.git`. A dependency directory therefore cannot bury the project's own files.
  The user may **explicitly opt into showing ignored files**, and while ignored
  files are hidden the tab **says so** — a listing that quietly under-reports
  what is on disk is not acceptable, in the tree or in a search result count.
- **Search stays flat.** While a search term is active the tab shows flat
  matching paths rather than a tree, because a tree of sparse matches is harder
  to read than a list. Clearing the search returns to the tree **at its previous
  expansion state**, not to a collapsed root.
- **Every row and every tab exposes its name to assistive technology.** A file
  row is announced by its file name, a directory row by its directory name and
  its expanded or collapsed state, and each tab in a tab strip by the title it
  displays. This restates WSP-10 rather than extending it. It is restated
  because the tree introduces a row type WSP-10 was written before — a directory
  whose announced state changes as it expands — and because naming here was
  reported as broken and turned out not to be: see
  [Findings against version 1](#findings-against-version-1), which records both
  the evidence and the fact that the inspection tool, not the page, was at
  fault. The requirement stands; how it is verified is what that finding
  changed.
- The tree stays inside WSP-09's render budget: an expanded directory with more
  children than the budget allows states that it is showing a bounded portion,
  exactly as the flat list already does.

A **File** tab is strictly read-only; the product offers no editing affordance
of any kind.

- A markdown file renders as a **formatted preview** by default, with an
  explicit toggle to view its source. The rendered preview does not load remote
  images or execute embedded scripts.
- A text file that is not markdown renders with **syntax highlighting** derived
  from the active theme's tokens, and remains readable — as plain monospace
  text — if highlighting is unavailable for its language or has not finished
  loading. Highlighting never blocks first paint of the file's content.
- Binary, oversized, truncated, missing, and inaccessible files each render
  their own explicit labelled state, as the shipped preview already does.
- The tab offers copy-path and copy-content actions. Copy-path yields the
  normalized workspace-relative path; absolute server paths are never shown.

### Acceptance criteria added by version 2

Continuing the numbering of the version 1 list above.

11. A Files tab opened on a repository shows a tree: directories expand and
    collapse in place, a file row displays only its own name while its tooltip
    and copy-path give the full workspace-relative path, and the set of
    expanded directories survives a reload with the tab.
12. Neither the listing nor the search returns a path matched by the
    repository's ignore rules or by `.git`; searching a name that also exists
    inside an ignored dependency directory returns the project's own file and
    not the dependency's copies; the tab states that ignored files are hidden;
    and an explicit opt-in reveals them and is itself persisted with the tab.
13. Entering a search term switches the tab to a flat list of matching paths,
    and clearing it restores the tree with exactly the directories that were
    expanded before the search.
14. Every file row, every directory row (including its expanded or collapsed
    state), and every tab in every tab strip exposes an accessible name equal to
    the text it displays, confirmed by computing the accessible name rather than
    by an automated rule scan alone.

## Findings against version 1

The same hands-on pass of 2026-08-22 reported six issues. Two were contract gaps
and are answered by proposed version 2 above. The other four were reported as
defects against behavior version 1 already requires; on follow-up in the running
application, **two of those four were false positives from the inspection tool
rather than faults in the page**. All of them are recorded here so the
specification is not read as silent about any of them, and the live ones are
tracked in the
[implementation plan](../exec-plans/active/2026-08-22-workspace-panel.md).

### Confirmed, needing no contract change

| Finding                                                                                                    | Requirement involved                      | Tracked in  |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------- |
| Only the active tab exposes an announced close control — one "Close X tab" button rather than one per tab. | WSP-10 (every action reachable and named) | Milestone 3 |
| File content does not wrap and is clipped at the panel's right edge, with no visible horizontal scroll.    | WSP-05's "remains readable" clause        | Milestone 5 |

The first of these is a **design decision to confirm rather than a defect to
fix**: a tablist may own only tabs, so a real button nested inside a tab is a
nested interactive control, and the strip's single close control names the
selected tab while arrow keys move the selection. What must hold is that any tab
can be closed in one step without a pointer. The second is unconfirmed as to
mechanism and open.

### Closed as not defects — the tool was at fault, not the page

Panel tabs and file-list rows were reported as exposing **no accessible name**,
with the accessibility tree showing bare `tab` and `button` nodes. Both reports
were re-checked against the live DOM and are **wrong**. The markup is:

```html
<button class="panel-tab" role="tab">
  <span class="panel-tab-title">Changes</span>
  <span
    class="panel-tab-close"
    data-tab-close
    aria-hidden="true"
    title="Close Changes"
    >×</span
  >
</button>
```

```html
<button>
  <span aria-hidden="true">·</span
  ><span>frontend/node_modules/@alloc/quick-lru/readme.md</span>
</button>
```

In each case the label-bearing span is **not** `aria-hidden`; `tab` and `button`
are both name-from-content roles; and the `aria-hidden` close affordance is
excluded from the name computation without suppressing its sibling. The
accessible name therefore computes correctly, and no requirement is violated.

**The empty `name` field came from the accessibility-tree dump tool, which
renders a name-from-content role as blank.** That is the durable lesson, and it
is recorded here so the same tool output is not re-reported as the same defect
later: an empty `name` in a tree dump is evidence about the dump, not about the
page, until the accessible name has actually been computed. Verification of
naming therefore uses a computed accessible name — never a tree dump alone, and
never an automated rule scan alone.

## Superseded requirements

### In the Codex-style workspace surface spec

This spec supersedes **CWS-06 — One right-hand panel: the workspace inspector**
in full. On approval, `codex-workspace-surface.md` must record that:

- the fixed `Changes | Files | Terminal` inspector is replaced by the workspace
  panel defined here;
- the **inspector-follows-the-focused-pane** rule is struck. It existed because
  a route addresses one thread while the surface holds several panes; durable
  per-tab context (WSP-02) answers that problem directly and better, because a
  tab states which worktree it reads instead of silently changing it.
- the inspector's device-local visibility preference is replaced by the panel's
  device-local record (WSP-04), which migrates it.

CWS-06's constraints that this spec **retains**: exactly one region is docked
right of the chat surface; it is docked, never floating; neither it nor its
reopen control ever overlaps chat content; worktree mode and branch appear in
the chat pane's own header and are not restated as a second column; and every
view defines its loading, empty, and no-selection states in both themes.

All other CWS requirements — CWS-01 through CWS-05, CWS-07, and CWS-08 — are
unaffected.

## Non-goals

- **Editing files.** Every file view is read-only. No editor, no save, no
  create, no rename, no delete.
- **Docking the panel anywhere but right.** A bottom or left dock position, and
  a unified tree that mixes chat panes with panel tabs, are both out of scope
  at this version.
- **Tearing a tab out into an operating-system window.**
- **A general-purpose embedded web browser.** The browser tab embeds pages that
  permit embedding; it does not proxy, rewrite, or strip the protections of
  sites that refuse, and it carries no bookmarks, profiles, or extensions.
- **Server-persisted or cross-device panel state.** The panel is device-local,
  like layout and theme.
- **Terminal processes surviving a server restart.**
- **Committing, pushing, staging, or otherwise mutating Git state** from the
  panel. The Changes and Diff tabs are read-only views.

## Open product questions

None. The four questions raised during drafting were resolved with the user on
2026-08-22 and folded into the contract above:

- Browser scope → **embed any address, lead with localhost previews, and fail
  with an explicit open-in-browser state** rather than a blank frame (WSP-08).
- Tab lifetime → **durable tabs carrying their own context**, not a strip that
  follows the focused pane (WSP-02).
- Split scope → **inside the panel only**; the chat surface keeps its own tree
  (WSP-01).
- Diff and preview fidelity → **structured unified diff** (WSP-06) and
  **lazy-loaded syntax highlighting** (WSP-05).

Proposed version 2 raises no new product question. It awaits product approval,
not a decision: the behavior it specifies was chosen from what the hands-on pass
showed, and the one judgement inside it — flat results while a search is active,
a tree otherwise — is stated in the requirement rather than left open.
