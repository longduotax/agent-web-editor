# Technical design index

Technical designs record important decisions, considered alternatives,
tradeoffs, and the reasoning behind a selected approach. They do not duplicate
current architecture or implementation task lists.

The approved initial-workspace designs are:

- [Local-client security](local-client-security.md) — configurable plain
  loopback launch URL, deliberate absence of client authentication, Host/Origin
  policy, CSRF signal, WebSocket access, and the bounded outbound URL probe,
  self-origin refusal, and frame sandbox the browser tab needs.
- [Application persistence](application-persistence.md) — Drizzle with SQLite,
  metadata schema, runtime row parsing, transactions, migrations, backups, and
  recovery.
- [Runtime and Pi adapter](runtime-and-pi-adapter.md) — SDK-neutral runtime
  ownership, native sessions, Pi-compatible resources and trust, direct tool
  execution, and run lifecycle.
- [Live events and idempotency](live-events-and-idempotency.md) — durable command
  receipts, snapshots, sequenced WebSocket events, replay, and reset behavior.
- [Inspector and terminal boundaries](inspector-and-terminal.md) — safe file and
  Git access, the Origin-restricted browser PTY lifecycle (now several terminals
  per execution scope, keyed by terminal identity and capped), the bounded
  working-directory probe, and the browser-embedding decision. Its browser
  surface is the [workspace panel](../product-specs/workspace-panel.md); the
  inspector it was named for is retired.
- [Web workspace composition](web-workspace-composition.md) — routes, browser
  state ownership, safe rendering, responsive layout, accessibility, and test
  stack.
- [Multi-agent tiling workspace](multi-agent-tiling-workspace.md) — _Draft._
  Tiling pane surface for all runs, Codex/Claude backends beside Pi, fork-of-
  running-chat worktree lineage, a bound git-and-terminal right panel, and a
  full light theme with efficiency tiers for many concurrent live runs.
