# Active execution plans

Open Plan-lane work belongs here from initial Draft through Ready, Active, or
Blocked implementation. Keep each plan's questions, approval version, progress,
and decisions current, then move it to `../completed/` when it is completed,
superseded, or abandoned.

- [Initial agent workspace](2026-08-15-initial-agent-workspace.md) — Active plan
  version 2 revises run orchestration to permit concurrent Pi-backed threads in
  one project through a thread-scoped persisted lease, while retaining the
  broader TDD workspace, reconnection, inspector, and terminal plan.
- [Scalable conversation history](2026-08-16-scalable-conversation-history.md) —
  Draft plan version 3 has technical approval pending. Product specification v1
  remains approved, but implementation is paused pending plan-v3 approval. The
  plan adds bounded latest/history pages, an adapter-owned bounded streaming
  projection, append-stable opaque cursors, a bounded browser page window,
  polite live following, latest-edge entry, anchor-preserving older-history
  navigation, and a restrained transcript scrollbar.
