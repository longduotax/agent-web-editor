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
- [Workspace panel](2026-08-22-workspace-panel.md) — Draft plan version 2,
  technical approval pending; plan version 1 was approved on 2026-08-22 and its
  milestones are carried forward, with milestones 1 and 2 implemented and
  milestone 4 shipped on 2026-08-23.
  Product approval for
  [Workspace panel](../../product-specs/workspace-panel.md) v1 was granted from
  the design as presented in session, not from a reading of the document;
  **specification version 2 — a bounded WSP-05 revision making the Files tab a
  navigable, ignore-aware tree — was approved by the user on 2026-08-23**, under
  the same qualification: the approval is of the behaviour as described in
  session, and a discrepancy between the document and that discussion resolves
  in favour of the discussion and returns the proposal to Draft. Plan version
  2's milestone 4 (directory-scoped server listing, ignore-rule parsing over
  both listing and search, the browser tree with persisted expansion, flat
  search, panel storage v2 → v3) was gated on that approval and was implemented
  ahead of it on the coordinator's instruction; the gate is now satisfied and
  the sequence is recorded in the plan's Discoveries section. Plan version 2
  also folds a keyboard close-control question into milestone 3 and a
  file-content overflow defect into milestone 5, and adds a standing hands-on UI
  pass to every remaining milestone, all after a 2026-08-22 manual pass found
  six issues in a milestone the automated suite had passed. On 2026-08-23 the
  user also chose to **position tab body hosts over their group's rectangle
  instead of relocating them between groups**, which becomes a new milestone 8
  (one never-detached layer, rectangle tracking through a `ResizeObserver`, the
  scroll save/restore workaround retired) and moves the browser tab to milestone
  9; the rejected alternative was accepting a page reload for Browser tabs
  alone. Two of those six —
  panel tabs and file rows reported as having no accessible name — were probed
  against the live DOM and closed as false positives from the accessibility-tree
  dump tool; the computed-name and keyboard-walk verification they prompted is
  kept, and pass findings are now confirmed before they become work.
  Replaces the
  `Changes | Files | Terminal` inspector (CWS-06, superseded) with a docked
  panel of tab groups in their own binary tiling tree, holding durable tabs
  that carry their own `(project, thread, execution scope)` context: Changes,
  Diff, Files, File, Terminal, and Browser. Extracts the chat surface's binary
  tree into a generic `features/layout/binaryTree.ts` without changing the
  chat layout's persisted format; migrates the device-local
  `pi-workspace:inspector` record to `pi-workspace:panel` v2; deletes the
  inspector outright in milestone 2 with no feature flag. Server work: terminal
  owners rekeyed from execution scope to `TerminalId` so a scope may hold up to
  eight PTYs, a `create` frame and re-attach by id, a terminals-listing route, a
  bounded working-directory probe, and a new headers-only browser URL probe
  with `frame-src` CSP and an opaque-origin iframe sandbox. Overlaps
  [Codex-style workspace surface](2026-08-22-codex-workspace-surface.md) at
  CWS-06 only; that plan's other requirements are unaffected.
- [Scalable conversation history](2026-08-16-scalable-conversation-history.md) —
  Draft plan version 3 has technical approval pending. Product specification v1
  remains approved, but implementation is paused pending plan-v3 approval. The
  plan adds bounded latest/history pages, an adapter-owned bounded streaming
  projection, append-stable opaque cursors, a bounded browser page window,
  polite live following, latest-edge entry, anchor-preserving older-history
  navigation, and a restrained transcript scrollbar.
