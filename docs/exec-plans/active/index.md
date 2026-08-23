# Active execution plans

Open Plan-lane work belongs here from initial Draft through Ready, Active, or
Blocked implementation. Keep each plan's questions, approval version, progress,
and decisions current, then move it to `../completed/` when it is completed,
superseded, or abandoned.

- [Initial agent workspace](2026-08-15-initial-agent-workspace.md) — Active plan
  version 2 revises run orchestration to permit concurrent Pi-backed threads in
  one project through a thread-scoped persisted lease, while retaining the
  broader TDD workspace, reconnection, inspector, and terminal plan.
- [Tiling workspace surface](2026-08-21-tiling-workspace-surface.md) — Active plan
  version 1, technical approval granted 2026-08-21. Phase 1 of the multi-agent tiling
  workspace design: replaces single-thread project selection with a terminal-style
  tiling surface of panes (split, focus, close), device-local per-project layout
  persistence, and approved keybindings. Its original collapse-to-dock pane tier
  and dock attention signal are struck by
  [Codex-style workspace surface](2026-08-22-codex-workspace-surface.md), which
  also implements the right panel and theming this plan deferred. Phase 1
  implementation is complete and verified (unit coverage plus an end-to-end
  Playwright spec); kept Active pending merge. Agent backends and worktree
  forking are later phases.
- [Codex-style workspace surface](2026-08-22-codex-workspace-surface.md) — Active
  plan version 1, technical approval granted 2026-08-22. Restyles the tiling workspace to a
  calm, near-borderless Codex desktop aesthetic; ships complete light and dark
  themes (System default, live OS follow, before-paint apply) behind a new
  Settings page; renders a single shared, focus-following Environment right
  panel; surfaces a four-way run status (working / needs-approval / done /
  failed) in each pane header and the sidebar; reduces pane actions to Split and
  immediate Close with an undo toast; and removes the collapse-to-dock pane tier
  entirely, migrating any persisted docked panes back into the tiling tree
  (layout v1→v2). Implementation is complete and verified (unit coverage,
  end-to-end Playwright coverage, and the tiling-spec supersession); kept Active
  pending merge.
- [Scalable conversation history](2026-08-16-scalable-conversation-history.md) —
  Draft plan version 3 has technical approval pending. Product specification v1
  remains approved, but implementation is paused pending plan-v3 approval. The
  plan adds bounded latest/history pages, an adapter-owned bounded streaming
  projection, append-stable opaque cursors, a bounded browser page window,
  polite live following, latest-edge entry, anchor-preserving older-history
  navigation, and a restrained transcript scrollbar.
- [Codex agent runtime](2026-08-22-codex-agent-runtime.md) — Ready plan version 1,
  technical approval granted 2026-08-22, governed by the Approved
  [Agent backends](../../product-specs/agent-backends.md) specification version 1.
  Phase 2 of the multi-agent tiling workspace design: adds a `packages/codex-adapter`
  implementation of `AgentRuntime` over the Codex app-server protocol, a durable
  per-thread `runtime` discriminator in persistence and the transport contract
  (existing chats backfilled to `pi`), a server-side runtime registry replacing the
  single injected adapter, and a backend choice in the new-chat composer with Codex
  as the default, layered over a device-local Settings preference. Codex chats run
  with approvals disabled and confined to their execution root by default. Both
  approvals are in place; implementation starts at Task 1 and the plan becomes
  Active with the first production edit.
- [Codex tool-call replay](2026-08-23-codex-tool-call-replay.md) — Draft plan
  version 1 with technical approval pending, governed by the Draft
  [Agent backends](../../product-specs/agent-backends.md) specification
  version 2. A reopened Codex chat currently replays messages but not the shell
  commands and file changes it showed live, because the app-server serves only
  message items for a past turn. This plan adds a reverse reader over the session
  file the app-server itself names, covering both stored dialects, splicing tool
  entries back into their turns, reading only as far back as the displayed
  history needs so it composes with paged conversation history, and degrading to
  today's message-only history whenever the private format cannot be read. It reverses
  version 1's app-server-only posture deliberately and states the exit criterion
  for doing so. No contract, schema, route, or browser change.
