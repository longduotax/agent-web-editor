# Workspace panel

**Current version:** None

**Proposed version:** 1

**Proposal status:** Approved

**Implementation status:** In progress

**Product approval:** Approved for specification version 1 (user, 2026-08-22,
from the design as presented in session, which the user approved and directed to
implementation; the user has not yet read this document itself, so a discrepancy
between it and that discussion resolves in favour of the discussion and returns
this proposal to Draft)

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
