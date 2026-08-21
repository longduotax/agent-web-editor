# Codex-style workspace surface

**Current version:** None

**Proposed version:** 1

**Proposal status:** Draft

**Implementation status:** In progress

**Product approval:** Pending for specification version 1

**Subsystem:** Browser workspace composition — pane visual surface, theming, and
the focus-bound right panel

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
desktop aesthetic, adds a light theme as the default alongside dark, renders the
focus-bound right-hand **Environment** panel that the tiling surface only carried
as a binding target, and **removes the collapse-to-dock pane tier entirely** so
the pane model is simply: split, focus, close. The user outcome is a workspace
that looks and feels like a first-class agent desktop app, is comfortable in
light or dark, and lets them tell at a glance which of several parallel runs on a
project needs them — without a second, minimized tier of panes to manage.

The visual reference is the mockup set in `docs/design/thread-surface-*.html`;
those files are the authoritative source for spacing, color roles, and component
shapes referenced below.

## Terminology

- **Pane**, **tiling tree**, **focused pane**, **new-chat pane**, and **settled
  run** carry the meanings defined in
  [Tiling workspace surface](tiling-workspace-surface.md).
- The **Environment panel** is a device-local right-hand column that reflects the
  focused pane's run environment (changes, worktree, branch, sources). It
  replaces the tiling surface's unrendered "right-panel binding target."
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
dividers, split-to-new-chat-pane, close-archives-thread, device-local layout, and
server authority over threads and runs — is retained unchanged.

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

### CWS-03 — Pane header surfaces run status at a glance

Each threaded pane's header shows, in reading order: a **run-status indicator**
(working, needs-approval, done, or failed) as a labeled, color-plus-text element
with an optional elapsed timer for running work; the **thread title**; a compact
**project/worktree chip**; and the pane action controls. The status is legible
without opening or scrolling the transcript, so a user monitoring several panes
can identify which run needs them from the headers alone. The same status
indicators appear against each run in the sidebar run list. A new-chat pane with
no thread shows no run status. A run changing to needs-approval or failed updates
its pane header and its sidebar indicator but **never steals focus or moves the
focus ring**; attention is surfaced, not forced.

### CWS-04 — Pane actions are Split and Close only

The pane header exposes exactly two pane actions: **Split** and **Close**. Close
archives the pane's thread exactly as specified by the tiling surface
(`TWS-07`): metadata-only, non-destructive, and a no-op archive for a new-chat
pane. Close is **immediate** and shows a brief undo affordance (an "Archived —
Undo" toast); it never opens a confirmation modal. There is no collapse,
minimize, or dock action anywhere on the pane. The focused pane is visually
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

### CWS-06 — The Environment panel renders and follows the focused pane

The right-hand panel, which the tiling surface carried only as an unrendered
binding target, now renders as a **docked right column** (never a floating
overlay that covers panes). It reflects the **focused pane's** run environment
and updates whenever focus moves between panes. It shows: a focus header naming
the run it describes (title and run status), the run's **changes** summary
(added/removed counts), its **worktree** and **branch**, a commit-or-push
affordance, and **sources** (e.g. GitHub). There is exactly **one** Environment
panel for the whole surface — it is shared and focus-following, not per-pane. Its
visibility is toggleable and is a device-local preference: on a fresh device it is
**open while the surface has a single pane and hidden once the surface tiles**,
and after the user toggles it that choice is remembered per device. When no pane
is focused, the panel shows an empty state.

The panel's scope in this version is the environment and git summary only; an
embedded terminal is out of scope (see [Non-goals](#non-goals)).

### CWS-07 — Readability across pane densities

Inside a pane the centered fixed reading measure is dropped so a pane uses its
full width with comfortable padding, keeping the transcript readable when a pane
is narrow (for example at three-up or two-by-two). The surface **enforces a
minimum usable pane width**; when more panes are open than fit at that minimum,
the surface **scrolls** rather than shrinking panes below it. Panes never shrink
past the minimum into an unreadable state.

### CWS-08 — Settings page hosts theme selection

The app has a **Settings page** reachable from the app chrome (for example from
the user or project switcher region of the sidebar). Version 1 of the page hosts
the **theme selection** control — a three-way choice of System, Light, and Dark
(CWS-02) — with System selected by default. Selecting an option applies it
immediately and persists it as a device-local preference. The page is the durable
home for future device-local preferences (such as right-panel default visibility
and keybinding display); version 1 need only contain the theme control, but its
structure must accommodate additional settings without a redesign. Settings are
device-local and are never sourced from or written to the server.

## Acceptance criteria

1. The project workspace visually matches the Codex mockups: user turns are
   quiet right-aligned pills, assistant turns are bubble-less flowing text, tool
   activity is grouped in hairline cards under a collapsed run header, and the
   trust warning is an inline line rather than a full-width banner.
2. The app follows the OS theme by default and updates live on OS change; a
   Settings page offers System / Light / Dark; the choice persists per device and
   applies before first paint; and no state is conveyed by color alone.
3. Each threaded pane header shows a labeled run-status indicator (working /
   needs-approval / done / failed, with an elapsed timer while running), the
   thread title, and a project/worktree chip; a user can identify which pane
   needs them from headers alone, and the same statuses appear in the sidebar.
4. The only pane actions are Split and Close; there is no collapse/minimize/dock
   control anywhere, the focused pane shows a ring, and clicking a non-focused
   pane focuses it.
5. There is no dock strip, no collapse or restore keybinding, and no docked pane
   tier; a persisted layout that references a dock loads with its previously
   docked panes restored into the tiling tree (its splits preserved), and no pane
   is silently dropped.
6. The Environment panel renders as a docked right column, reflects the focused
   pane's changes/worktree/branch/sources, updates when focus changes, is a
   single shared panel (not per-pane), and its visibility persists per device.
7. A pane uses its full width for the transcript with no centered fixed measure,
   and remains readable at three-up and two-by-two densities down to the defined
   minimum pane width.
8. All retained tiling behavior is unchanged: binary tiling tree, resizable
   dividers, split opens a focused new-chat pane, close archives the thread
   non-destructively, layout is device-local, and threads/runs/transcripts stay
   server-authoritative.
9. A Settings page is reachable from the app chrome, hosts the System/Light/Dark
   theme control with System preselected, applies a change immediately, persists
   it per device, and is structured to hold further settings later.

## Superseded requirements

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

- An embedded per-pane terminal in the right panel; version 1 renders the
  environment and git summary only. The terminal remains covered by
  [Inspector and terminal](../design/inspector-and-terminal.md) and is promoted
  separately.
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
- Close friction → **immediate with an undo toast**, no modal (CWS-04).
- Right-panel default visibility → **open on a single pane, remembered per
  device** thereafter (CWS-06).
