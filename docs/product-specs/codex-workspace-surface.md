# Codex-style workspace surface

**Current version:** None

**Proposed version:** 1

**Proposal status:** Draft

**Implementation status:** In progress

**Product approval:** Pending for specification version 1

**Subsystem:** Browser workspace composition — pane visual surface, theming, and
the single workspace inspector

**Last verified:** 2026-08-22

**Related ExecPlans:** [Codex-style workspace surface implementation plan](../exec-plans/active/2026-08-22-codex-workspace-surface.md)

**Related documents:**
[Tiling workspace surface](tiling-workspace-surface.md) (revised by this spec),
[Multi-agent tiling workspace design](../design/multi-agent-tiling-workspace.md),
[Web workspace composition](../design/web-workspace-composition.md),
[Inspector and terminal](../design/inspector-and-terminal.md).
Visual reference mockups (device-local, not shipped):
[`thread-surface-codex.html`](../design/thread-surface-codex.html) (single pane),
[`thread-surface-tiled.html`](../design/thread-surface-tiled.html) (tiled, right
panel, run states), and [`thread-surface-bubbles.html`](../design/thread-surface-bubbles.html)
(rejected direction, kept for contrast).

## Purpose

The tiling workspace surface gave the project route a multi-pane layout, but its
look reads as a generic web page rather than a native desktop tool, it ships dark
only, and it carries a collapse-to-dock tier that adds model and UI complexity.

This capability restyles the surface to match the calm, near-borderless Codex
desktop aesthetic, adds a light theme as the default alongside dark, keeps
**exactly one** right-hand workspace panel — the `Changes | Files | Terminal`
inspector — and **removes the collapse-to-dock pane tier entirely** so the pane
model is simply: split, focus, close. The user outcome is a workspace that looks
and feels like a first-class agent desktop app, is comfortable in light or dark,
and lets them tell at a glance which of several parallel runs on a project needs
them — without a second, minimized tier of panes to manage and without a second
right-hand column restating what the first already shows.

The visual reference is the mockup set in `docs/design/thread-surface-*.html`;
those files are the authoritative source for spacing, color roles, and component
shapes referenced below.

## Terminology

- **Pane**, **tiling tree**, **focused pane**, **new-chat pane**, and **settled
  run** carry the meanings defined in
  [Tiling workspace surface](tiling-workspace-surface.md).
- The **workspace inspector** is the single right-hand column of the thread
  route, carrying the `Changes | Files | Terminal` tabs. It is the tiling
  surface's "right-panel binding target", rendered. There is no second
  right-hand column.
- The **reading column** is the one centered measure the transcript, the
  composer and the new-chat card all share, expressed as a single CSS custom
  property (`--surface-measure`). No component carries a measure of its own.
- A **theme** is the light or dark visual token set applied to the whole app,
  stored as a device-local preference.
- **Run status** is the settled/unsettled state a pane surfaces in its header:
  working, needs-approval, done, or failed.
- The **dock** term from [Tiling workspace surface](tiling-workspace-surface.md)
  is **removed** by this spec and must no longer appear in the shipped product.

## Current contract

There is no Current contract for this capability. Its baseline is the tiling
workspace surface proposed version 1, which is Draft and in progress. This spec
revises that baseline: it supersedes the tiling surface's dock, collapse, and
restore behavior (see [Superseded requirements](#superseded-requirements)) and
promotes theming and the right panel, which that spec listed as separate future
capabilities. All non-dock tiling behavior — the binary tiling tree, resizable
dividers, split-to-new-chat-pane, device-local layout, and server authority
over threads and runs — is retained unchanged. `TWS-07`'s
close-archives-the-thread coupling is superseded (see CWS-04).

## Proposed contract (version 1)

### CWS-01 — Codex visual language for the pane and transcript

Each pane renders as a self-contained rounded card on a thin gutter, composed of
a compact header, a scrolling transcript, and a compact composer. The transcript
adopts the Codex reading model:

- A **user turn** is a quiet, right-aligned neutral pill — never a full-width
  outlined card.
- An **assistant turn** is plain flowing text on the pane background with no
  bubble, at a comfortable measure and line height.
- **Tool and command activity** renders inside clean, hairline-bordered cards
  (title, status glyph, and command/file rows), grouped under a collapsed
  "Worked for …" run header rather than a raw edge-to-edge command log.
- The surface is **near-borderless**: elevation and grouping come from background
  and hairline dividers, not from an outline on every element.
- The former full-width amber trust banner is demoted to a single quiet inline
  status line in the pane header region.

The observable outcome is that the workspace visually matches
`docs/design/thread-surface-codex.html` and `thread-surface-tiled.html`.

### CWS-02 — Light and dark themes, following the system by default

The app ships two complete themes, light and dark, and a **theme setting** with
three choices: **System** (the default), **Light**, and **Dark**. On System, the
app follows the operating system's `prefers-color-scheme` and updates live when
the OS switches between light and dark. Light and Dark pin the theme regardless
of the OS. The choice is a device-local preference persisted like layout and
applied before first paint so there is no flash, and it is selected from the
Settings page (CWS-08). Every color is a design token; changing theme re-maps
tokens only and changes no layout or content. Status and state are never conveyed
by color alone; every status carries an accessible text label or icon in addition
to color.

### CWS-03 — One pane header surfaces run status at a glance

A pane has **exactly one** header. It shows the thread title once, the run
status once, and the trust/permissions notice as one quiet inline line; nothing
below it restates any of the three. It shows, in reading order: a
**run-status indicator**
(working, needs-approval, done, or failed) as a labeled, color-plus-text element
with an optional elapsed timer for running work; the **thread title**; a compact
**project/worktree chip**; and the pane action controls. The status is legible
without opening or scrolling the transcript, so a user monitoring several panes
can identify which run needs them from the headers alone. The same status
indicators appear against each run in the sidebar run list. The header's second
line is a quiet detail line carrying the thread's worktree mode and branch plus
the inline trust notice, clamped to a single ellipsised line (full text on its
tooltip). The header's height is pinned to one shared token, so every pane
header and the inspector's top row present a single continuous bottom
hairline at every width; header content never changes it. A new-chat pane with no thread shows no run status. A run changing to needs-approval or failed updates
its pane header and its sidebar indicator but **never steals focus or moves the
focus ring**; attention is surfaced, not forced.

### CWS-04 — Pane actions are Split and Close only

The pane header exposes exactly two pane actions: **Split** and **Close**.

**Revised 2026-08-22 (supersedes close-archives-thread).** Close removes the
pane from the layout and does **nothing else**: it never archives, deletes, or
otherwise mutates the pane's thread. Closing needs no confirmation precisely
_because_ it is not destructive — the thread stays in the sidebar and can be
reopened from it.

Archiving is a separate, explicitly labelled action on the sidebar's
per-thread actions menu. It is deferred behind an `Archived "<title>" — Undo`
toast (undo _prevents_ the call rather than reversing it), and a failed archive
restores the row and surfaces the error, naming the thread it belongs to,
instead of reporting success.

**Revised 2026-08-22 (NEW-R3-1).** Staged archives are **independent**:
requesting a second archive while a first is still inside its undo window must
not commit, cancel or hurry the first. Each staged archive owns its own toast,
its own timer, and its own error. Archiving is also **reversible** — see TM-05
in `thread-management.md` — so a committed archive is recoverable from the UI
rather than only from the database.

There is no collapse, minimize, or dock
action anywhere on the pane. The focused pane is visually
distinguished (a focus ring); non-focused panes are slightly de-emphasized but
fully rendered. Clicking a non-focused pane focuses it.

### CWS-05 — The collapse-to-dock tier is removed

Panes can no longer be collapsed, docked, minimized, or restored. Concretely:

- The bottom **dock** strip and its chips are removed from the workspace.
- The **collapse** and **restore/cycle-dock** keybindings are removed from the
  workspace keymap; all other approved keybindings are retained.
- The **dock attention signal** for settled, unread work is removed as a dock
  feature; the equivalent "this one wants you" cue is carried instead by the
  pane-header run status (CWS-03) and the sidebar run list.
- **Every thread on the surface is a full pane.** There is no minimized cost
  tier; the tiling surface's "docked panes cost almost nothing" optimization is
  retired along with the dock. Cost management for many-thread projects, if
  needed, is addressed separately and does not reintroduce a dock.
- **Persistence and migration:** device-local layout no longer has a dock
  membership field. A previously persisted layout that references docked panes is
  **migrated on read by restoring those panes into the tiling tree**, preserving
  the user's existing splits and losing no thread pane; the dock field is then
  dropped and never written again. Only a layout that is otherwise malformed or
  of an unknown version is discarded to a single default pane, per the existing
  device-local fallback. A docked pane must never be silently orphaned (present
  in storage but absent from the surface), and no shipped saved state may
  reference a dock.

This requirement supersedes the tiling surface clauses listed in
[Superseded requirements](#superseded-requirements).

### CWS-06 — One right-hand panel: the workspace inspector

**Revised 2026-08-22 (supersedes the Environment-panel model below).** The
workspace has exactly **one** panel docked right of the pane surface at any
width: the `Changes | Files | Terminal` **inspector**. A standalone
"Environment" column does not exist, and no control for one is rendered.

- The inspector is a **docked right column**, never a floating overlay, and
  neither it nor its open/close control ever overlaps pane content. When it is
  closed, its reopen control lives in a docked rail, not floating over the
  transcript.
- The inspector **follows the focused pane, not the URL**. Focusing a pane that
  owns a thread shows that thread's workspace at any route, without touching
  the sidebar; focusing a threadless (new-chat) pane hides the inspector and
  its rail; with no panes open it is hidden. A route addresses at most one
  thread while the surface can hold several panes, so the URL cannot express
  what the user is looking at — the focused pane can. The sidebar's selected
  thread follows the same source of truth.
- Information the removed panel carried survives in exactly one place each, and
  is never restated in a second column:
  - the focused thread's **worktree mode and branch** appear once, as the quiet
    detail line of that pane's own header (CWS-03);
  - the **changes summary** (added / modified / deleted, or "No changes")
    appears once, in the inspector's Changes tab;
  - the commit-or-push and sources rows are **dropped** at this version; they
    were inert placeholders.
- Every inspector tab has a defined loading, empty, and no-selection state, all
  rendered in muted tokens that read correctly in light and dark.

The earlier version of this requirement specified a second, focus-following
"Environment" column alongside the inspector. It shipped, the user rejected it
as a duplicate column, and it is **superseded**: the panel, its device-local
visibility preference, and its floating toggle are removed from the product.

### CWS-07 — One centered reading column

Transcript content, the composer, and the new-chat card all sit inside the
**same centered reading column**, sized by a single CSS custom property
(`--surface-measure`, currently `48rem`). A user's turn and the input that
answers it share one axis; no component may hardcode a competing measure. Below
that width the column shrinks with the pane rather than clipping.

The pane's header chrome (run status, title, project chip, pane actions, and
the quiet detail line) is full-width bar chrome, not reading content, and is
therefore not constrained to the column.

The surface still **enforces a minimum usable pane width**; when more panes are
open than fit at that minimum, the surface **scrolls** rather than shrinking
panes below it. Panes never shrink past the minimum into an unreadable state.

The earlier version of this requirement dropped the centered measure so a pane
used its full width. The user rejected the result as "too spread out"; the
centered measure is **restored** and that clause is superseded.

### CWS-08 — Settings page hosts theme selection

The app has a **Settings page** reachable from the app chrome (for example from
the user or project switcher region of the sidebar). Version 1 of the page hosts
the **theme selection** control — a three-way choice of System, Light, and Dark
(CWS-02) — with System selected by default. Selecting an option applies it
immediately and persists it as a device-local preference. The page is the durable
home for future device-local preferences (such as inspector default
visibility); version 1 contains the theme control and a **Keyboard shortcuts**
list. That list is generated from the same table the workspace's key handler
dispatches from, so it cannot drift from the bindings and an inert binding
cannot be advertised. The structure must accommodate additional settings
without a redesign. Settings are
device-local and are never sourced from or written to the server.

## Acceptance criteria

1. The project workspace visually matches the Codex mockups: user turns are
   quiet right-aligned pills, assistant turns are bubble-less flowing text, tool
   activity is grouped in hairline cards under a collapsed run header, and the
   trust warning is an inline line rather than a full-width banner.
2. The app follows the OS theme by default and updates live on OS change; a
   Settings page offers System / Light / Dark; the choice persists per device and
   applies before first paint; and no state is conveyed by color alone.
3. A threaded pane renders one header only, at a fixed shared height so every
   pane header and the inspector's top row share one bottom hairline, showing
   a labeled run-status
   indicator (working / needs-approval / done / failed, with an elapsed timer
   while running), the thread title, a project/worktree chip, and a quiet
   detail line carrying worktree/branch and the trust notice — each exactly
   once. A user can identify which pane needs them from headers alone, and the
   same statuses appear in the sidebar.
4. The only pane actions are Split and Close; Close is a pure layout
   operation that never archives or otherwise mutates the thread; there is no
   collapse/minimize/dock control anywhere, the focused pane is distinguished
   by a quiet hairline (not a saturated ring), and clicking a non-focused pane
   focuses it.
5. There is no dock strip, no collapse or restore keybinding, and no docked pane
   tier; a persisted layout that references a dock loads with its previously
   docked panes restored into the tiling tree (its splits preserved), and no pane
   is silently dropped.
6. Exactly one panel is docked right of the pane surface — the
   `Changes | Files | Terminal` inspector. No `Environment` column and no
   control for one exists in the DOM at any width; no control overlaps pane
   content; the focused thread's worktree/branch appears only in its own pane
   header, and its changes summary only in the Changes tab, which also has
   defined loading, empty, and no-selection states in both themes. The
   inspector shows the **focused pane's** thread at any route: focusing a
   thread pane while the route points elsewhere shows that thread's
   workspace, focusing a new-chat pane hides the column and its rail, and an
   empty surface hides it too.
7. The transcript, the composer, and the new-chat card share one centered
   reading column driven by a single custom property; a message and the
   composer that answers it start at the same x **and end at the same x**, at
   every pane width above and below the measure, with classic (space-consuming)
   scrollbars as well as overlay ones; and the surface still
   remains readable at three-up and two-by-two densities down to the defined
   minimum pane width, scrolling rather than shrinking past it.
8. All retained tiling behavior is unchanged: binary tiling tree, resizable
   dividers, split opens a focused new-chat pane, layout is device-local, and
   threads/runs/transcripts stay server-authoritative. Archiving is reachable
   only from the sidebar's per-thread actions menu, is metadata-only, is
   undoable for the life of its own toast independently of any other staged
   archive, and is reversible afterwards from the project's Archived section.
   With zero panes open, clicking any thread in the sidebar opens a pane for
   it — including the thread the URL already addresses — and the empty surface
   carries its own control for opening a pane.
9. A Settings page is reachable from the app chrome, hosts the System/Light/Dark
   theme control with System preselected, applies a change immediately, persists
   it per device, lists every active pane keyboard shortcut with
   platform-correct symbols (and nothing inert), and is structured to hold
   further settings later.

## Superseded requirements

### Within this spec (revised 2026-08-22, before approval)

- **CWS-06 (the Environment panel)** — the standalone focus-following
  "Environment" column, its device-local visibility preference, and its
  floating toggle are removed. CWS-06 now specifies the single-inspector
  model. The user rejected the second right-hand column as a duplicate of the
  inspector; the user's instruction outranks the drafted requirement.
- **CWS-04 (close archives the thread)** — Close no longer archives. It was a
  destructive side effect behind a button labelled only "Close", executed
  fire-and-forget with no error handling, and unrecoverable once its toast
  expired (there is no unarchive endpoint and no archived-thread list).
  Archiving moves to an explicit, labelled sidebar action that keeps the undo
  toast and surfaces failures.
- **CWS-07 (full-width panes)** — the clause "the centered fixed reading
  measure is dropped so a pane uses its full width" is struck. CWS-07 now
  specifies one centered reading column on a single custom property. The
  minimum-pane-width-and-scroll clause is retained unchanged.

### In the tiling workspace surface spec

This spec revises [Tiling workspace surface](tiling-workspace-surface.md) v1 by
striking the dock. On approval, that spec must be updated so the following no
longer describe shipped behavior:

- **TWS-04 (collapse, dock, restore)** — removed in full.
- **TWS-05 (dock attention signal)** — removed; replaced by pane-header status
  (CWS-03).
- **TWS-09 (docked panes cost almost nothing)** — removed; there is no docked
  tier.
- **TWS-06 keybindings** — the "Collapse focused pane to dock" and "Restore
  last-docked / cycle dock" rows are removed; all other rows are retained.
- **TWS-01 deep-link resolution** — the "restoring it from the dock first if it
  is collapsed" clause is removed; a deep link focuses or adopts the pane.
- **Terminology and acceptance criteria** — the **dock** term and dock-related
  acceptance items (5, 6, and 11 as written) are removed or reworded to the
  no-dock model, and the right-panel and theming non-goals are lifted because
  they are now specified here.

## Non-goals

- A second right-hand column of any kind. The commit-or-push and sources rows
  the superseded Environment panel sketched are not reintroduced at this
  version; when they land they belong in the inspector, not a new column.
- Additional agent backends and per-pane agent selection.
- The fork-of-a-running-chat start state and its worktree lineage.
- Server-persisted or cross-device synchronization of theme, layout, or panel
  visibility; all three remain device-local preferences.
- Any replacement for the dock's cost tier (transcript virtualization or a
  server-side status projection); reducing many-thread cost is out of scope here
  and must not reintroduce a dock.
- Changes to the tiling tree geometry, split semantics, or the retained
  keybindings beyond removing collapse and restore.

## Open product questions

None. The five questions raised during drafting were resolved with the user on
2026-08-22 and folded into the contract above:

- Theme default → **System**, following the OS with a Settings-page override
  (CWS-02, CWS-08).
- Minimum pane width → **enforce a minimum and scroll** past it (CWS-07).
- Attention routing → **stay passive**; surface status, never steal focus
  (CWS-03).
- Close friction → **immediate and non-destructive**, no modal; the undo
  toast moves to the sidebar's explicit Archive action, which is the only
  destructive thread operation (CWS-04).
- Right-panel default visibility → settled by the inspector's own device-local
  visibility preference; the superseded Environment panel's separate
  "open on a single pane" rule is retired with the panel (CWS-06).
