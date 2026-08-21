# Product specification index

Product specifications define durable user-visible behavior, business rules,
permissions, acceptance criteria, and important edge cases. They are organized
by stable capability rather than task. Temporary implementation steps do not
belong here.

| Capability                                                        | Current version | Proposed version | Proposal | Implementation | Related open plan                                                                                 |
| ----------------------------------------------------------------- | --------------- | ---------------- | -------- | -------------- | ------------------------------------------------------------------------------------------------- |
| [Initial agent workspace](initial-workspace.md)                   | None            | 2                | Approved | In progress    | [Initial agent workspace](../exec-plans/active/2026-08-15-initial-agent-workspace.md)             |
| [Scalable conversation history](scalable-conversation-history.md) | None            | 1                | Approved | Not started    | [Scalable conversation history](../exec-plans/active/2026-08-16-scalable-conversation-history.md) |
| [Thread management](thread-management.md)                         | 2               | None             | None     | Current        | —                                                                                                 |
| [Thread workspaces](thread-workspaces.md)                         | 2               | None             | None     | Current        | —                                                                                                 |
| [Tiling workspace surface](tiling-workspace-surface.md)           | None            | 1                | Draft    | In progress    | [Tiling workspace surface](../exec-plans/active/2026-08-21-tiling-workspace-surface.md)           |

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
and compact inline run-state signals.

Tiling workspace surface is a Draft proposal for version 1, distilled from the
multi-agent tiling workspace design as its first phase. It turns the project
route into a terminal-style tiling surface of panes with a bottom dock,
user-controlled collapse and restore, a settled-unread attention signal, the
approved keybinding set, close-archives-thread behavior, and device-local layout.
Later phases of that design — additional agent backends, worktree forking, the
bound right-hand panel, theming, and the server-side efficiency projection —
remain separate capabilities. Product approval is pending; implementation is in
progress under the linked plan and the proposal becomes Current only after the
user approves it and the behavior is verified.

When durable behavior changes, prefer a bounded proposed revision in the
canonical capability document that already governs it. Create a new file only
for a distinct durable capability with an independent lifecycle and normal
reader entry point. Keep the Current contract readable while proposals are
Draft or Approved, and promote an approved version to Current only after its
coherent behavior is implemented and verified.

Link every canonical specification from this index and keep its current/proposed
version, implementation state, and overlapping open plan visible here.
