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
  Draft plan version 3 has technical approval pending. Its provider-neutral
  fixed-limit latest/older page contract, explicit older control, stale reset,
  and five-page browser window were implemented and verified as the shared
  foundation approved in Agent backends v3 / Codex replay plan v2. Remaining
  plan-v3 work — page-free away-from-latest refresh, its bounded streaming
  projection, full bidirectional navigation/viewport behavior, and the
  restrained scrollbar acceptance set — remains paused pending approval.
- [Codex agent runtime](2026-08-22-codex-agent-runtime.md) — Active plan version 1,
  technical approval granted 2026-08-22, governed by Agent backends specification
  version 1. The Pi/Codex runtime discriminator, Codex adapter, runtime registry,
  new-chat backend choice, Settings default, labels, tests, documentation, and
  four manual checks are complete on the branch. The plan remains Active and the
  implemented specification remains unpromoted pending final completion.
- [Codex tool-call replay](2026-08-23-codex-tool-call-replay.md) — Active plan
  version 2, technically approved 2026-08-23 and governed by Approved Agent
  backends specification version 3. The implementation adds a confined,
  resumable reverse reader over the session file Codex names, supports both
  stored dialects, and degrades to message-only pages when private history
  cannot be read. The shared bounded-history path now opens one fixed-limit
  latest page, loads older messages and tools only on request, and retains one
  five-page browser window instead of transferring the complete chat. Automated
  unit and Playwright verification is complete; real-provider manual checks
  remain before completion and promotion.
