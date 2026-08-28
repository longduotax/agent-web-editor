# Thread management

**Current version:** 3

**Proposed version:** None

**Proposal status:** None

**Implementation status:** Current

**Product approval:** Not applicable — no proposed revision; version 3 was approved by the user on 2026-08-29 (the unchanged bounded inline-title revision approved in conversation as revision 2.1 was renumbered to the required positive-integer version 3)

**Subsystem:** Thread sidebar actions, archival, title editing, and run-state indicators

**Last verified:** 2026-08-29

**Related ExecPlans:** [Codex-style thread actions](../exec-plans/completed/2026-08-16-thread-actions.md) and [inline thread title editing](../exec-plans/completed/2026-08-29-inline-thread-title-editing.md)

**Related documents:** [Initial agent workspace](initial-workspace.md),
[architecture overview](../architecture/overview.md), and
[application persistence](../design/application-persistence.md)

## Purpose

Thread management keeps a growing project sidebar useful without deleting
conversation history. It provides direct, consistent title editing where a
thread is read and compact run feedback for scanning concurrent work.

## Current contract (version 3)

Threads are ordered by recent activity under their project. Version 3 retains
version 2's title bounds, durable unread semantics, project ownership, and
non-destructive native Pi history while replacing the prior wrapping
Save/Cancel rename form with one shared one-row editor.

### TM-01 — Codex-style thread action menu

Right-clicking a thread row opens a compact context menu with `Rename` and
`Archive` actions. The menu is also available from the keyboard, so right-click
is not the only route. It closes on selection, Escape, outside interaction, or
navigation. The row's trailing actions control remains persistently visible.

Choosing `Rename` opens the same inline editor as double-clicking the sidebar
thread or its pane-header title. A normal single click on a sidebar thread keeps
its navigation behavior.

### TM-02 — Non-destructive thread archival

Choosing `Archive` durably removes an inactive thread from normal project
navigation without deleting application run metadata or native Pi session
history. Archival is idempotent. An archived thread does not contribute to
project unread counts and cannot be opened, prompted, steered, renamed, or
selected through normal active-thread routes.

A running thread, including one whose prompt is still in preflight, cannot be
archived. Its Archive action is disabled with an accessible explanation, and a
racing server request fails visibly rather than hiding active work.

If the selected thread is archived, navigation moves to the project and resolves
to that project's most recently active unarchived thread. If none remains, the
project's empty-thread state is shown. Archival does not change source files,
project registration, or Pi history.

### TM-03 — Inline compact thread status

The sidebar places the status signal on the same row as the thread title. A
running thread shows an animated spinner and no visible `Running` line. An
unread completion shows the existing solid blue signal and no visible `Unread`
line. Failed and interrupted states remain visually and accessibly distinct on
the title row. Every signal has an accessible text label and a non-color shape
or animation cue.

Opening a completed result retains current behavior: it marks that completion
viewed, clears its blue thread signal, and updates the aggregate project signal.

### TM-06 — One-row inline title editing

A user can enter rename mode where an active thread title is already visible:
by double-clicking the sidebar thread, by double-clicking the title in a
threaded pane's header, or by choosing the sidebar menu's `Rename` action.

Both placements use the same compact editor. The title becomes one inline,
single-row text field in its existing space, with the current title selected.
It never wraps, adds an action row, or changes the sidebar row or pane-header
height. Long titles scroll inside the field. The field retains automatic text
direction and accepts at most 200 characters.

There is no accept, Save, Cancel, or confirmation control. Pressing Enter or
moving focus outside the editor saves the trimmed title when it is non-empty
and changed. An unchanged title exits without a command. An empty title is not
sent and remains editable with a compact visible validation message.

The editor exposes one quiet trailing **Revert** control. Revert or Escape
restores the prior title and exits without sending a rename, and Revert wins
when its pointer activation would otherwise cause a blur-save. While one save
is pending, another blur or Enter cannot send a duplicate. A failed rename
leaves the one-row editor and its draft available, identifies the failure
visibly and accessibly without changing row or header height, and lets the user
retry or Revert.

A successful rename updates the same durable display title in the pane header
and sidebar. It does not change thread ordering, routing, run state, archival,
worktree directory, branch, or native Pi session identity.

### Acceptance criteria

1. Right-click and keyboard invocation open one accessible Rename/Archive menu;
   a normal sidebar click navigates; and double-clicking an active sidebar
   thread or pane-header title opens the same inline editor as `Rename`.
2. The current title starts selected in one non-wrapping row without changing
   its containing row/header height; long and right-to-left titles remain
   editable in their logical direction.
3. Enter and focus leaving each save one non-empty changed title. An unchanged
   title sends no command, and an empty title remains editable with a visible
   validation message.
4. No accept, Save, Cancel, or confirmation control appears. Revert and Escape
   restore the prior title without a request, including when pointer ordering
   would otherwise blur-save first.
5. Pending saves cannot duplicate. A rejected save preserves the draft with a
   compact visible error and a path to retry or Revert.
6. A successful rename appears in both sidebar and pane header without reload
   and changes no ordering, routing, run, archive, worktree, branch, or native
   session state.
7. Archiving an inactive selected or unselected thread hides it after refresh
   and restart while leaving its database records and native session untouched.
8. Archiving a running or preflight thread is disabled in the UI and rejected
   by the server if requested directly or during a race.
9. Archiving the selected thread chooses the most recent remaining active
   thread, or shows the project's empty-thread state when none remains.
10. Archived unread completions no longer contribute to project unread counts;
    active unread threads retain durable viewed behavior.
11. Running and unread-completion signals appear beside the title with no
    visible second-line status text, while screen readers announce the state.
12. Malformed archive requests and malformed or legacy persisted archive values
    fail or migrate at their owning boundaries without exposing unrelated
    records.

### Non-goals

- Permanent deletion of application metadata or native Pi history.
- Search, bulk archive, or bulk restore.
- Automatically archiving completed threads or stopping work to archive it.
- Renaming a new-chat pane, archived thread, project, branch, worktree, or Pi
  session.
- A permanent rename icon, modal, multiline title field, pane-header context
  menu, server schema change, or title-generation change.
- Changing run-state, completion-viewed, project-removal, or thread-ordering
  semantics beyond excluding archived threads from active navigation and unread
  aggregation.

## Deferred archival-recovery candidate — not Current or Proposed

The following candidate was drafted on 2026-08-22 and parts are present in the
working implementation, but it has not received product approval and is not
part of Current version 3. It needs its own later integer version and approval
before promotion.

### TM-05 — Archival is reversible

Every project's sidebar section carries a collapsed **Archived** disclosure
listing that project's archived threads, and each row offers **Restore**.
Restoring returns the thread to normal navigation with its metadata, run history,
and native Pi session intact, without promoting its list position or changing
the project's last-opened thread. Restore is idempotent. A failed restore
surfaces the server's reason, and the archived list is not fetched until its
disclosure opens.

The candidate also makes staged archives independent: starting a second archive
must not commit, cancel, or shorten a first thread's undo window, and each
failure remains attached to its thread.

## Version history

- Version 1 recorded the permanent pencil rename action, unavailable archival,
  and second-line visible status text.
- The user approved version 2 on 2026-08-16. It introduced the Codex-style
  action menu, non-destructive inactive-thread archival, and compact status.
- The user approved the bounded inline-title revision on 2026-08-29 under its
  conversational label 2.1. It was renumbered without a content change to
  positive-integer version 3 to satisfy repository lifecycle metadata, then
  implemented and verified under the linked plan.
- The archival-recovery candidate is deliberately separate and unapproved.
