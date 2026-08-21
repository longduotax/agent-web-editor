# Tiling workspace surface

**Current version:** None

**Proposed version:** 1

**Proposal status:** Draft

**Implementation status:** In progress

**Revision note:** revised by
[Codex-style workspace surface](codex-workspace-surface.md), which strikes the
dock/collapse/restore tier (see [Superseded requirements](#superseded-requirements))

**Product approval:** Pending — not yet approved by the user for specification version 1

**Subsystem:** Browser workspace composition — pane tiling, keybindings, and device-local layout

**Last verified:** 2026-08-22

**Related ExecPlans:** [Tiling workspace surface implementation plan](../exec-plans/active/2026-08-21-tiling-workspace-surface.md),
[Codex-style workspace surface implementation plan](../exec-plans/active/2026-08-22-codex-workspace-surface.md)
(implements the supersession below)

**Related documents:** [Codex-style workspace surface](codex-workspace-surface.md)
(supersedes the dock/collapse/restore tier of this spec; see
[Superseded requirements](#superseded-requirements)),
[Multi-agent tiling workspace design](../design/multi-agent-tiling-workspace.md),
[Web workspace composition](../design/web-workspace-composition.md),
[Initial agent workspace](initial-workspace.md), and
[Thread workspaces](thread-workspaces.md)

## Purpose

The tiling workspace surface reshapes a project's browser view from "sidebar
plus one selected thread" into a single terminal-style tiling surface where every
thread of the project is a pane the user can split, focus, and close. It lets the
user see and steer many runs of one project at once, deciding for themselves what
stays visible, while layout stays a device-local view preference and the server
remains authoritative for threads, runs, and transcripts.

This capability is the first phase of the broader
[multi-agent tiling workspace design](../design/multi-agent-tiling-workspace.md).
It covers only the tiling surface itself. Additional agent backends and worktree
forking are separate durable capabilities specified and promoted on their own as
they are implemented. The bound right-hand git-and-terminal panel and theming,
originally listed as separate future capabilities here, are now specified by
[Codex-style workspace surface](codex-workspace-surface.md); the collapse-to-dock
pane tier this spec originally proposed is removed by that same spec (see
[Superseded requirements](#superseded-requirements)).

## Terminology

- A **pane** is the visual home of one thread within a project's workspace. A
  pane is the unit that tiles, focuses, and closes.
- A **new-chat pane** is a pane with no thread yet; it holds the new-chat
  configuration bar and first-message composer until its first prompt starts a
  thread.
- The **tiling tree** is the binary layout tree that arranges tiled panes into
  non-overlapping rectangles with draggable dividers.
- The **focused pane** is the single pane that receives workspace keyboard
  commands and text entry.
- A **settled** run is a run that has completed, failed, or been interrupted, as
  opposed to a running run.
- **Device-local layout** is the per-project arrangement — the tiling tree,
  focus, and right-panel binding — stored in the browser as a view preference,
  never on the server.

> The **dock** term this section previously defined is removed by
> [Codex-style workspace surface](codex-workspace-surface.md) and must no
> longer appear in the shipped product; see
> [Superseded requirements](#superseded-requirements).

## Current contract

There is no current version. The behavior below is proposed version 1 and is
being implemented under the related ExecPlan; it becomes Current only after the
user approves the product intent and the behavior is verified.

## Proposed contract (version 1)

### TWS-01 — The project route is a tiling pane surface

The project route (`/projects/:projectId`) presents a tiling pane manager rather
than a single-thread center column. Each thread of the project is on screen at
once, each pane rendering that thread's existing transcript, activity,
composer, steering, and stop controls. The former project/thread sidebar is
reduced to a compact project switcher that still adds, browses, and removes
projects but no longer selects an individual thread.

Deep links to `/projects/:projectId/threads/:threadId` remain valid and resolve
by focusing that thread's pane, and adopting it into a pane if it is not yet
present. On first load with no persisted layout, the surface seeds a single
new-chat pane.

> The "restoring it from the dock first if it is collapsed" clause originally
> in this requirement is removed; see
> [Superseded requirements](#superseded-requirements).

### TWS-02 — Binary tiling tree with resizable dividers

The arrangement is a binary tiling tree: every split divides one pane into two
along a horizontal or vertical axis, so the surface is always a set of
non-overlapping rectangles separated by draggable dividers. A divider is
resizable by pointer and by keyboard within bounded minimum fractions. The
geometry is predictable and serializable; panes never free-float or overlap.

### TWS-03 — Splitting opens a focused new-chat pane

Splitting the focused pane divides it and opens a new-chat pane in the new half,
which immediately takes focus so the user can type. Split right divides along the
horizontal axis; split down divides along the vertical axis. A new-chat pane has
no thread until its first prompt is submitted, at which point it starts a thread
in the project and becomes that thread's pane. The clean-worktree start state is
the default for a pane started this way, consistent with
[Thread workspaces](thread-workspaces.md).

### ~~TWS-04 — User-controlled collapse, dock, and restore~~ (superseded — removed)

> **Superseded in full** by [Codex-style workspace surface](codex-workspace-surface.md)
> CWS-05. Panes can no longer be collapsed, docked, minimized, or restored;
> every thread on the surface is a full pane. See
> [Superseded requirements](#superseded-requirements).
>
> ~~The user may collapse any pane to the bottom dock to declutter and restore a
> docked pane back into the tiling tree later. Collapse and restore are always
> user-driven; the application never auto-collapses or auto-restores a pane. A
> restored pane re-enters the tiling tree and takes focus. Removing a pane from
> the tree — by collapse or close — replaces its parent split with the
> surviving sibling so the remaining geometry stays a valid tiling tree.~~

### ~~TWS-05 — Dock attention signal for settled, unread work~~ (superseded — removed)

> **Superseded in full** by [Codex-style workspace surface](codex-workspace-surface.md)
> CWS-05. The dock attention signal is removed along with the dock; the
> equivalent "this one wants you" cue is carried instead by the pane-header run
> status (CWS-03) and the sidebar run list. See
> [Superseded requirements](#superseded-requirements).
>
> ~~A docked pane shows a single attention indicator when its thread has a
> settled run whose result has not been viewed since the pane was last seen —
> the state that means "this one wants you." Running-but-not-settled and
> already-viewed docked panes show no indicator, and a new-chat pane with no
> thread never shows one. The indicator clears when the pane is restored and
> viewed. Status is never conveyed by color alone: the indicator always
> carries an accessible label.~~

### TWS-06 — Approved workspace keybindings

The workspace binds the keyboard command set approved on 2026-08-21. macOS uses
`Cmd` as the primary modifier; Windows and Linux use `Alt`.

| Action                           | macOS                 | Windows/Linux         | Notes                                              |
| -------------------------------- | --------------------- | --------------------- | -------------------------------------------------- |
| Split right                      | `Shift+Cmd+=`         | `Shift+Alt+=`         | —                                                  |
| Split down                       | `Shift+Cmd+-`         | `Shift+Alt+-`         | —                                                  |
| Move focus between panes         | `Cmd+Alt+Arrow`       | `Ctrl+Alt+Arrow`      | —                                                  |
| Close focused pane               | `Shift+Cmd+Backspace` | `Shift+Alt+Backspace` | Closing a pane archives, never deletes, its thread |
| Bind right panel to focused pane | `Cmd+Alt+Enter`       | `Ctrl+Alt+Enter`      | Binding target consumed by a later capability      |

> The "Collapse focused pane to dock" (`Shift+Cmd/Alt+Down`) and "Restore
> last-docked / cycle dock" (`Shift+Cmd/Alt+Up`) rows originally in this table
> are removed; see [Superseded requirements](#superseded-requirements). All
> other rows above are retained unchanged.

Because this stays a browser application, the workspace captures its shortcuts
with `preventDefault` while a pane surface holds focus so they do not leak to
browser defaults such as zoom or tab management. Any unavoidable conflict with a
browser-reserved combination is resolved during implementation with the user.

### TWS-07 — Closing a pane archives its thread

Closing the focused pane removes it from the surface and archives its thread.
Archival is metadata-only and non-destructive: it never deletes the thread, its
worktree, or its native agent history. A new-chat pane with no thread closes
without archiving anything. A closed thread remains recoverable through the
existing thread-archival behavior.

### TWS-08 — Layout is a device-local view preference

The tiling tree, focus, and right-panel binding are device-local view
preferences stored in versioned browser storage keyed by project. Malformed or
unknown-version stored state is discarded explicitly and the surface falls back
to a single default pane, following the existing device-local preference
pattern. Selection, unread state, run state, and transcripts are never sourced
from device-local storage; they remain server-authoritative and are read through
the existing thread and run contracts.

> [Codex-style workspace surface](codex-workspace-surface.md) CWS-05 amends
> this requirement's storage shape (the dock-membership field this requirement
> originally listed is dropped) and its fallback rule (a stored layout that
> references a dock migrates its panes into the tiling tree on read instead of
> being discarded; only an otherwise-malformed or unknown-version payload still
> falls back to a single default pane).

### ~~TWS-09 — Docked panes cost almost nothing~~ (superseded — removed)

> **Superseded in full** by [Codex-style workspace surface](codex-workspace-surface.md)
> CWS-05. There is no docked tier, so there is nothing to keep cheap; every
> thread on the surface is a full pane. See
> [Superseded requirements](#superseded-requirements).
>
> ~~A docked pane does not mount a transcript view or a terminal. It subscribes
> only to the lightweight thread summary needed to render its dock chip and
> attention indicator (thread title, run state, and unread state). Expanded
> panes render their thread at full fidelity. This tier keeps the surface
> responsive when a project has many threads, without introducing a per-pane
> live connection.~~

## Acceptance criteria

1. Opening a project shows every thread as a tiled pane at once, with the
   sidebar reduced to a project switcher that adds, browses, and removes
   projects but does not select individual threads.
2. A deep link to a thread route focuses that thread's pane and adopts it when
   not yet present; a project with no persisted layout opens with one new-chat
   pane.
3. Split right and split down each divide the focused pane and open a new-chat
   pane that takes focus; the arrangement remains a set of non-overlapping
   rectangles, and dividers resize by pointer and keyboard within bounds.
4. Submitting the first prompt in a new-chat pane starts a thread with the
   clean-worktree default and turns that pane into the thread's pane.
5. ~~Collapsing a pane moves it to the dock and restoring it returns it to the
   tiling tree with focus; the application never auto-collapses or
   auto-restores, and a removed pane's parent split is replaced by its
   surviving sibling.~~ **Removed** — there is no collapse/dock/restore; see
   [Superseded requirements](#superseded-requirements). The surviving-sibling
   rule for a removed pane's parent split is retained for **close**, per item 8.
6. ~~A docked pane shows an accessible attention indicator only while its
   thread has a settled, unread run, and the indicator clears on
   restore-and-view; a new-chat pane never shows one.~~ **Removed** — the dock
   attention signal is replaced by the pane-header run status and the sidebar
   run list (Codex-style workspace surface CWS-03); see
   [Superseded requirements](#superseded-requirements).
7. Each approved shortcut fires its action for the focused pane and does not leak
   to the browser default while a pane holds focus.
8. Closing a threaded pane archives its thread without deleting the thread, its
   worktree, or its native history; closing a new-chat pane archives nothing.
9. Reloading the browser restores the persisted per-project layout and focus;
   malformed or unknown-version stored layout is discarded and the surface
   falls back to a single default pane.
10. Selection, unread, run state, and transcripts continue to come from the
    server and never from device-local storage.
11. ~~A docked pane mounts no transcript view or terminal and subscribes only
    to its thread summary; expanded panes render at full fidelity.~~
    **Removed** — there is no docked tier; every pane renders at full
    fidelity. See [Superseded requirements](#superseded-requirements).

## Superseded requirements

[Codex-style workspace surface](codex-workspace-surface.md) v1 revises this
spec by striking the collapse-to-dock pane tier in full. The following no
longer describe shipped behavior (struck in place above, each with a pointer
back to this section):

- **TWS-04 (user-controlled collapse, dock, and restore)** — removed in full.
- **TWS-05 (dock attention signal)** — removed; replaced by pane-header status
  and the sidebar run list (CWS-03).
- **TWS-09 (docked panes cost almost nothing)** — removed; there is no docked
  tier.
- **TWS-06 keybindings** — the "Collapse focused pane to dock" and "Restore
  last-docked / cycle dock" rows are removed; all other rows are retained.
- **TWS-01 deep-link resolution** — the "restoring it from the dock first if
  it is collapsed" clause is removed; a deep link focuses or adopts the pane.
- **TWS-08 device-local layout shape and fallback** — the dock-membership
  field is dropped, and a stored layout referencing a dock migrates its panes
  into the tiling tree on read instead of falling back to a single pane (see
  CWS-05); only an otherwise-malformed or unknown-version payload still falls
  back.
- **Terminology and acceptance criteria** — the **dock** term is removed, and
  acceptance items 5, 6, and 11 (as originally written) are removed or
  reworded to the no-dock model.
- **Non-goals** — the right-panel and theming non-goals are lifted; both are
  now specified by [Codex-style workspace surface](codex-workspace-surface.md)
  (CWS-06 and CWS-02/CWS-08, respectively).

## Non-goals

The following are explicitly out of scope for this capability and are specified
and promoted separately as they are implemented:

- Additional agent backends (Codex and Claude beside Pi) and per-pane agent
  selection.
- The fork-of-a-running-chat start state and its worktree lineage.
- The server-side status projection and transcript virtualization tiers.
  Version 1's layout-side cost bound (not mounting docked transcripts or
  terminals) no longer applies now that the dock tier is removed; reducing
  many-thread cost, if needed, is addressed separately and must not
  reintroduce a dock ([Codex-style workspace surface](codex-workspace-surface.md)
  CWS-05, Non-goals).
- Cross-device or server-persisted layout synchronization; layout stays a
  device-local view preference.
- Geometric (as opposed to in-order) focus movement between panes, which may be a
  later refinement.

## Open product questions

- None. The keybinding set was approved on 2026-08-21; any browser-reserved
  conflict discovered during implementation is resolved with the user without
  changing this contract.
