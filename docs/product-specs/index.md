# Product specification index

Product specifications define durable user-visible behavior, business rules,
permissions, acceptance criteria, and important edge cases. They are organized
by stable capability rather than task. Temporary implementation steps do not
belong here.

| Capability                                      | Current version | Proposed version | Proposal | Implementation | Related open plan                                                                     |
| ----------------------------------------------- | --------------- | ---------------- | -------- | -------------- | ------------------------------------------------------------------------------------- |
| [Initial agent workspace](initial-workspace.md) | None            | 1                | Approved | In progress    | [Initial agent workspace](../exec-plans/active/2026-08-15-initial-agent-workspace.md) |

The initial workspace is approved but not yet Current. Its complete first
contract is proposed version 1 while implementation remains in progress.

When durable behavior changes, prefer a bounded proposed revision in the
canonical capability document that already governs it. Create a new file only
for a distinct durable capability with an independent lifecycle and normal
reader entry point. Keep the Current contract readable while proposals are
Draft or Approved, and promote an approved version to Current only after its
coherent behavior is implemented and verified.

Link every canonical specification from this index and keep its current/proposed
version, implementation state, and overlapping open plan visible here.
