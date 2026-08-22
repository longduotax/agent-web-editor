# Product specification index

Product specifications define durable user-visible behavior, business rules,
permissions, acceptance criteria, and important edge cases. They are organized
by stable capability rather than task. Temporary implementation steps do not
belong here.

| Capability                                                        | Current version | Proposed version | Proposal | Implementation | Related open plan                                                                                 |
| ----------------------------------------------------------------- | --------------- | ---------------- | -------- | -------------- | ------------------------------------------------------------------------------------------------- |
| [Initial agent workspace](initial-workspace.md)                   | None            | 2                | Approved | In progress    | [Initial agent workspace](../exec-plans/active/2026-08-15-initial-agent-workspace.md)             |
| [Scalable conversation history](scalable-conversation-history.md) | None            | 1                | Approved | Not started    | [Scalable conversation history](../exec-plans/active/2026-08-16-scalable-conversation-history.md) |
| [Thread management](thread-management.md)                         | 2               | 3                | Draft    | In progress    | [Codex-style workspace surface](../exec-plans/active/2026-08-22-codex-workspace-surface.md)       |
| [Thread workspaces](thread-workspaces.md)                         | 2               | None             | None     | Current        | —                                                                                                 |
| [Tiling workspace surface](tiling-workspace-surface.md)           | None            | 1                | Draft    | In progress    | [Tiling workspace surface](../exec-plans/active/2026-08-21-tiling-workspace-surface.md)           |
| [Codex-style workspace surface](codex-workspace-surface.md)       | None            | 1                | Draft    | In progress    | [Codex-style workspace surface](../exec-plans/active/2026-08-22-codex-workspace-surface.md)       |
| [Workspace panel](workspace-panel.md)                             | None            | 1                | Approved | In progress    | [Workspace panel](../exec-plans/active/2026-08-22-workspace-panel.md)                             |

The initial workspace is not yet Current. Proposed version 2 retains the
version 1 baseline and revises its run lease to allow concurrent runs in
distinct threads of one project. The user approved product and technical
version 2 on 2026-08-16; the concurrency slice is implemented and verified
while the broader initial-workspace plan remains in progress. Thread workspaces
version 2 is Current and provides per-chat source-checkout or isolated-worktree
execution while preserving the merged per-thread concurrency behavior.

Scalable conversation history is a separate Approved capability for bounded
latest pages, progressive older-history navigation, polite live following, and
a bounded browser rendering window. The user approved product specification
version 1 on 2026-08-16. Technical approvals for plan versions 1 and 2 are
invalidated; plan version 3 is Draft with technical approval pending, and
implementation remains paused until that approval is granted.

Thread management version 2 is Current. It provides a Codex-style action menu,
non-destructive inactive-thread archival, a direct hover/focus Archive action,
and compact inline run-state signals. Version 3 is a Draft proposal that makes
archival reversible: a per-project Archived list with a per-thread Restore, and
independently staged archives so no undo window is cut short.

Tiling workspace surface is a Draft proposal for version 1, distilled from the
multi-agent tiling workspace design as its first phase. It turns the project
route into a terminal-style tiling surface of panes with the approved
keybinding set, close-archives-thread behavior, and device-local layout. Its
original collapse-to-dock pane tier and dock attention signal are superseded by
[Codex-style workspace surface](codex-workspace-surface.md) (see that spec's
Superseded requirements). Additional agent backends and worktree forking remain
separate later-phase capabilities. Product approval is pending; implementation
is in progress under the linked plan and the proposal becomes Current only after
the user approves it and the behavior is verified.

Workspace panel is an Approved proposal for version 1, approved by the user on
2026-08-22 from the design as presented in session rather than from a reading of
the document itself. It replaces the right-hand inspector with a docked panel of tab
groups in their own binary tiling tree, holding durable tabs — Changes, Diff,
Files, File, Terminal, and Browser — that each carry the
`(project, thread, execution scope)` they were opened against and keep it when
chat focus moves. It also specifies several terminals per execution scope with a
stated limit and a remembered working directory, an embedded browser tab that
fails with an explicit named state rather than a blank frame, a device-local
panel record that migrates the shipped inspector preference, and per-tab
responsiveness and keyboard/accessibility contracts. It supersedes **CWS-06** of
[Codex-style workspace surface](codex-workspace-surface.md) in full; that spec's
other requirements are unaffected. Implementation is in progress under the
linked plan and the proposal becomes Current only after the behavior is
implemented and verified.

Codex-style workspace surface is a Draft proposal for version 1 that restyles
the tiling surface to a calm, near-borderless Codex desktop aesthetic; adds
complete light and dark themes (System default, live OS follow, before-paint
apply) behind a new Settings page; keeps exactly one right-hand column — the
`Changes | Files | Terminal` inspector, which follows the focused pane;
surfaces a four-way pane-header and sidebar run status
(working / needs-approval / done / failed); reduces pane actions to Split and a
non-destructive Close; and removes the tiling surface's
collapse-to-dock pane tier entirely, migrating any persisted docked panes back
into the tiling tree. Its CWS-06 inspector requirement is superseded in full by
[Workspace panel](workspace-panel.md) (see that spec and the CWS Superseded
requirements section); every other CWS requirement stands. Product approval is
pending; implementation is in progress under the linked plan and the proposal
becomes Current only after the user approves it and the behavior is verified.

When durable behavior changes, prefer a bounded proposed revision in the
canonical capability document that already governs it. Create a new file only
for a distinct durable capability with an independent lifecycle and normal
reader entry point. Keep the Current contract readable while proposals are
Draft or Approved, and promote an approved version to Current only after its
coherent behavior is implemented and verified.

Link every canonical specification from this index and keep its current/proposed
version, implementation state, and overlapping open plan visible here.
