# Technical design index

Technical designs record important decisions, considered alternatives,
tradeoffs, and the reasoning behind a selected approach. They do not duplicate
current architecture or implementation task lists.

The approved initial-workspace designs are:

- [Local-client security](local-client-security.md) — configurable loopback
  launch URL, process-local authentication, cookies, Host/Origin policy, CSRF,
  and WebSocket access.
- [Application persistence](application-persistence.md) — Drizzle with SQLite,
  metadata schema, runtime row parsing, transactions, migrations, backups, and
  recovery.
- [Runtime and Pi adapter](runtime-and-pi-adapter.md) — SDK-neutral runtime
  ownership, native sessions, Pi-compatible resources and trust, direct tool
  execution, and run lifecycle.
- [Live events and idempotency](live-events-and-idempotency.md) — durable command
  receipts, snapshots, sequenced WebSocket events, replay, and reset behavior.
- [Inspector and terminal boundaries](inspector-and-terminal.md) — safe file and
  Git access plus authenticated project PTY lifecycle.
- [Web workspace composition](web-workspace-composition.md) — routes, browser
  state ownership, safe rendering, responsive layout, accessibility, and test
  stack.
