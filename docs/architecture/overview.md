# Architecture overview

**Status:** Current

**Subsystem:** Repository foundation

**Last verified:** 2026-08-15

This document describes the implemented scaffold. It does not imply that editor,
transport, persistence, or agent-session behavior exists.

## Repository shape

| Area                      | Responsibility                                              | Technology                                    |
| ------------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `apps/web/`               | Browser shell for the future editor and agent UI            | React, Vite, TypeScript                       |
| `apps/server/`            | Local backend process and future orchestration boundary     | Node.js, Fastify, TypeScript                  |
| `packages/contracts/`     | Shared runtime schemas and inferred wire types              | TypeScript, Zod                               |
| `packages/agent-runtime/` | Agent-agnostic interfaces                                   | TypeScript                                    |
| `packages/pi-adapter/`    | Translation boundary for the initial Pi SDK                 | TypeScript, `@earendil-works/pi-coding-agent` |
| `docs/`                   | Current architecture, workflows, and implementation history | Markdown                                      |
| `scripts/`                | Repository verification tools                               | Python                                        |

The shared package entry points are intentionally empty. Their manifests and
component guides establish ownership without inventing contracts before product
behavior is designed.

## Entry points

- `apps/web/src/main.tsx` creates the React root and renders the static scaffold
  in `App.tsx`.
- `apps/web/vite.config.ts` configures a loopback-only development listener.
- `apps/server/src/app.ts` constructs a Fastify instance with no application
  routes.
- `apps/server/src/main.ts` binds that instance to `127.0.0.1:3001` only when
  the server process is explicitly started.
- Each shared package exposes `src/index.ts` as its future public API.

## Dependency direction

Dependencies flow inward toward stable contracts:

```text
apps/web ─────────────────────────────> packages/contracts
apps/server ──> packages/pi-adapter ──> packages/agent-runtime
     │                    │                         │
     └────────────────────┴─────────────────────────┴──> packages/contracts
```

Additional rules:

- Browser code must not import server, adapter, or SDK implementation modules.
- Concrete SDK imports belong only in the matching adapter package.
- `agent-runtime` remains SDK-agnostic.
- `contracts` is a leaf and must not depend on applications or runtimes.
- Process startup, filesystem access, configuration, and networking belong in
  applications or adapter infrastructure, not shared contracts.

pnpm workspace manifests encode these allowed directions. Static analysis does
not yet enforce forbidden imports because no cross-package implementation
exists.

## Runtime and data boundaries

No application transport or persistence has been implemented. Future browser to
server communication will cross a wire contract defined in `packages/contracts`.
The server will compose runtime adapters without exposing SDK-specific values to
the browser. Every API, database read, configuration value, file, queue message,
webhook, and third-party or SDK response remains untrusted until parsed as
specified in [Parse, Don't Validate](data-boundaries.md).

## Build boundaries

- Vite produces browser assets under `apps/web/dist/`.
- TypeScript produces Node/package ESM under each corresponding `dist/`.
- Shared package manifests expose only built public entry points.
- Root scripts orchestrate package-local commands; there is no bundled desktop
  process or deployment configuration.

## Current limitations

- The browser is a static shell with no editor or agent UI.
- Fastify registers no product routes.
- Runtime and transport interfaces have not been designed.
- There is no storage, configuration schema, authentication, streaming,
  sandboxing, workspace access, or runtime lifecycle behavior.
- Vitest is configured, but there are no behavior tests until behavior exists.
