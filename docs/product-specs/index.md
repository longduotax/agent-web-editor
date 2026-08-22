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
| [Agent backends](agent-backends.md)                               | None            | 2                | Draft    | In progress    | [Codex tool-call replay](../exec-plans/active/2026-08-23-codex-tool-call-replay.md)               |

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

Codex-style workspace surface is a Draft proposal for version 1 that restyles
the tiling surface to a calm, near-borderless Codex desktop aesthetic; adds
complete light and dark themes (System default, live OS follow, before-paint
apply) behind a new Settings page; keeps exactly one right-hand column — the
`Changes | Files | Terminal` inspector, which follows the focused pane;
surfaces a four-way pane-header and sidebar run status
(working / needs-approval / done / failed); reduces pane actions to Split and a
non-destructive Close; and removes the tiling surface's
collapse-to-dock pane tier entirely, migrating any persisted docked panes back
into the tiling tree. Product approval is pending; implementation is in
progress under the linked plan and the proposal becomes Current only after the
user approves it and the behavior is verified.

Agent backends carries two proposals. Version 1 — approved by the user on
2026-08-22 together with its plan version 1, and implemented but not yet
promoted — is the first slice of the "three agent backends" intent in the
multi-agent tiling workspace design: it makes a chat's coding agent an explicit,
durable, immutable per-chat property, adds Codex beside Pi, makes Codex the
default for new chats, and shows the backend wherever a chat appears. Existing
chats are Pi and are unchanged. Codex chats run with interactive approvals
disabled and, by default, confined to their execution root with no network — a
deliberately stricter boundary than Pi's, stated rather than hidden. Version 2
is a Draft proposal layered on it, with product approval pending: a reopened
Codex chat replays the shell commands and file changes it showed live, bounded
so that opening a chat does not cost more as the chat grows, and degrading to
today's message-only history rather than failing when Codex's private storage
format cannot be read. Neither version becomes Current until its behavior is
implemented and verified.

When durable behavior changes, prefer a bounded proposed revision in the
canonical capability document that already governs it. Create a new file only
for a distinct durable capability with an independent lifecycle and normal
reader entry point. Keep the Current contract readable while proposals are
Draft or Approved, and promote an approved version to Current only after its
coherent behavior is implemented and verified.

Link every canonical specification from this index and keep its current/proposed
version, implementation state, and overlapping open plan visible here.
