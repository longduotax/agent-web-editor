# Thread management

**Current version:** 2

**Proposed version:** 3

**Proposal status:** Draft

**Implementation status:** In progress

**Product approval:** Pending for specification version 3

**Subsystem:** Thread sidebar actions, archival, and run-state indicators

**Last verified:** 2026-08-22

**Related ExecPlans:** [Codex-style thread actions](../exec-plans/completed/2026-08-16-thread-actions.md)

**Related documents:** [Initial agent workspace](initial-workspace.md),
[architecture overview](../architecture/overview.md), and
[application persistence](../design/application-persistence.md)

## Purpose

Thread management keeps a growing project sidebar useful without deleting
conversation history. It also puts compact run feedback beside the thread title
so users can scan multiple threads while work is in progress.

## Current contract (version 2)

Threads are ordered by recent activity under their project. Version 2 retains
title validation, durable unread semantics, project ownership, and
non-destructive native Pi history while adding the management behavior below.

### TM-01 — Codex-style thread action menu

Right-clicking a thread row opens a compact context menu with `Rename` and
`Archive` actions. Hovering or moving keyboard focus into a thread row reveals a
trailing Archive icon button for the direct common action; activating it archives
that thread without first opening the menu. The context menu is also available
from the keyboard, so right-click is not the only way to reach both actions. The
menu closes on selection, Escape, outside interaction, or navigation.

Choosing `Rename` opens the existing inline title editor with the current title
selected. Enter or Save submits a non-empty title of at most 200 characters;
Escape or Cancel preserves the prior title. A failed rename leaves the editor
and draft title available with a visible error.

### TM-02 — Non-destructive thread archival

Choosing `Archive` durably removes an inactive thread from normal project
navigation without deleting its application run metadata or native Pi session
history. Archival is idempotent. An archived thread does not contribute to
project unread counts and cannot be opened, prompted, steered, renamed, or
selected through normal active-thread routes.

A running thread, including one whose prompt is still in preflight, cannot be
archived. Its Archive action is disabled with an accessible explanation, and a
racing server request fails visibly rather than hiding active work.

If the selected thread is archived, navigation moves to the project and resolves
to that project's most recently active unarchived thread. If no unarchived
thread remains, the project's empty-thread state is shown. Archival does not
change source files, project registration, or Pi history.

### TM-05 — Archival is reversible (proposed version 3)

Archiving is no longer a one-way door. Every project's sidebar section carries a
collapsed **Archived** disclosure listing that project's archived threads, and
each row offers **Restore**. Restoring returns the thread to normal project
navigation with its metadata, run history and native Pi session intact, and
without changing its position in the list (it is not promoted to most-recent)
or the project's last-opened thread. Restore is idempotent: replaying the same
command, or restoring a thread that is already active, succeeds without a second
write. A failed restore surfaces the server's reason rather than doing nothing.

The archived list is not fetched until the disclosure is opened, so the ordinary
sidebar costs nothing extra.

Version 2 deferred this deliberately ("an archived-thread browser … or restore
UI in version 2" was a non-goal). It is promoted here because archival with no
inverse made an ordinary mis-click unrecoverable from the product: the only
remedy was editing the metadata database by hand.

### TM-03 — Inline compact thread status

The sidebar places the status signal on the same row as the thread title. A
running thread shows an animated spinner and no visible `Running` line. An
unread completion shows the existing solid blue signal and no visible `Unread`
line. Failed and interrupted states remain visually and accessibly distinct on
the title row. Every signal has an accessible text label and a non-color shape
or animation cue.

Opening a completed result retains current behavior: it marks that completion
viewed, clears its blue thread signal, and updates the aggregate project signal.

### Acceptance criteria

1. Right-click and keyboard invocation open one accessible Rename/Archive menu;
   hovering or focusing a row reveals a trailing direct Archive icon; and Rename
   uses the inline editor without a permanent pencil button.
2. Archiving an inactive selected or unselected thread hides it after refresh
   and server restart while leaving its database records and native session
   untouched.
3. Archiving a running or preflight thread is disabled in the UI and rejected
   by the server if requested directly or during a race.
4. Archiving the selected thread chooses the most recent remaining active
   thread, or shows the project's empty-thread state when none remains.
5. Archived unread completions no longer contribute to project unread counts;
   active unread threads retain the existing durable viewed behavior.
6. Running and unread-completion signals appear beside the title with no visible
   second-line status text, while screen readers announce the state.
7. Malformed archive requests and malformed or legacy persisted archive values
   fail or migrate at their owning boundaries without exposing unrelated
   records.
8. A project's Archived disclosure lists exactly that project's archived threads
   and nothing else, fetches nothing until it is opened, and Restore returns the
   thread to the active sidebar list — leaving its ordering position and the
   project's last-opened thread unchanged — while a failed restore shows the
   server's reason.
9. Restoring is idempotent and rejects an unknown thread with a not-found error
   rather than inventing one; malformed unarchive commands are rejected at the
   contract boundary.
10. Archiving several threads in quick succession stages each one independently:
    starting a second archive neither commits nor cancels a first that is still
    inside its undo window, and a failure on any of them names its thread and is
    visible.

### Non-goals

- Permanent deletion of application metadata or native Pi history.
- Search, bulk archive, or bulk restore. (A per-project archived list with a
  per-thread Restore arrives in version 3; a full archive browser does not.)
- Automatically archiving completed threads or stopping work in order to
  archive it.
- Changing run-state, completion-viewed, project-removal, or thread-ordering
  semantics beyond excluding archived threads from active navigation and unread
  aggregation.

## Version history

- Version 1 recorded the implemented permanent pencil rename action, unavailable
  archival, and second-line visible status text.
- The user approved version 2 on 2026-08-16. Version 2 makes archival
  non-destructive while deferring a restore UI; retained metadata remains
  available for a future archive manager.
- Version 3 (proposed 2026-08-22) spends that retained metadata: it adds TM-05,
  a per-project Archived list and a per-thread Restore, and makes concurrent
  archive staging independent so no undo window is cut short.
