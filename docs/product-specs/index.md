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

The initial workspace is not yet Current. Proposed version 2 retains the
version 1 baseline and revises its run lease to allow concurrent runs in
distinct threads of one project. The user approved product and technical
version 2 on 2026-08-16; the concurrency slice is implemented and verified
while the broader initial-workspace plan remains in progress.

Scalable conversation history is a separate Approved capability for bounded
latest pages, progressive older-history navigation, polite live following, and
a bounded browser rendering window. The user approved product specification
version 1 on 2026-08-16. Technical approvals for plan versions 1 and 2 are
invalidated; plan version 3 is Draft with technical approval pending, and
implementation remains paused until that approval is granted.

Thread management version 2 is Current. It provides a Codex-style action menu,
non-destructive inactive-thread archival, a direct hover/focus Archive action,
and compact inline run-state signals.

When durable behavior changes, prefer a bounded proposed revision in the
canonical capability document that already governs it. Create a new file only
for a distinct durable capability with an independent lifecycle and normal
reader entry point. Keep the Current contract readable while proposals are
Draft or Approved, and promote an approved version to Current only after its
coherent behavior is implemented and verified.

Link every canonical specification from this index and keep its current/proposed
version, implementation state, and overlapping open plan visible here.
