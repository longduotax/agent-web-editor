# Architecture overview

**Status:** Current

**Subsystem:** Initial local agent workspace

**Last verified:** 2026-08-15

Pi Web Workspace is a local-first React application backed by a loopback-only
Fastify process. The server owns authentication, SQLite metadata, local
filesystem and Git access, PTYs, runtime coordination, and the Pi SDK adapter.
The browser receives only parsed DTOs and opaque application identifiers.

## Repository shape

| Area                      | Responsibility                                                                        | Technology                                       |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/web/`               | Route-owned workspace UI, parsed API clients, Markdown, inspector, and terminal       | React, React Router, TanStack Query, xterm, Vite |
| `apps/server/`            | Process auth, metadata, APIs, live events, project coordination, files, Git, and PTYs | Fastify, Drizzle, SQLite, WebSocket, node-pty    |
| `packages/contracts/`     | Executable wire schemas and inferred DTO types                                        | Zod                                              |
| `packages/agent-runtime/` | SDK-neutral persistent-session and run interfaces                                     | TypeScript                                       |
| `packages/pi-adapter/`    | Pi session discovery/opening, transcript translation, and live runtime ownership      | Pi SDK 0.84.2                                    |

Dependency direction remains:

```text
apps/web -> packages/contracts
apps/server -> packages/contracts + packages/agent-runtime + packages/pi-adapter
packages/pi-adapter -> packages/agent-runtime + packages/contracts + Pi SDK
packages/agent-runtime -> packages/contracts
packages/contracts -> no workspace package
```

## Server composition and startup

`apps/server/src/main.ts` parses configuration, constructs the application, and
is the only module that binds a listener. `buildServer()` remains injectable for
test-owned stores, runtimes, clocks, and PTYs.

The configured host is always `127.0.0.1`. `--port` takes precedence over
`PI_WEB_PORT`, with `3001` as the default. Project registration can invoke an
injectable server-owned native directory chooser: `/usr/bin/osascript` on macOS
or PowerShell with WinForms on Windows. Commands run without a shell, and their
bounded JSON output is parsed into either cancellation or an absolute native
path before existing canonicalization and access checks. Startup creates a
process-only launch
token and prints it in the URL fragment. `/api/auth/bootstrap` consumes that
token once and returns an HttpOnly, SameSite=Strict process-session cookie.
Product APIs and WebSockets require the cookie and exact Host/Origin policy;
mutations additionally require `X-Pi-Web-Request: 1`.

Production serves `apps/web/dist` from the same Fastify origin. Development uses
the loopback Vite server at `PI_WEB_DEV_PORT` (default `5173`) and proxies
relative `/api` HTTP and WebSocket traffic. The root `.env.local` file can retain
local backend, frontend, and state-directory settings.

## Persistence and project organization

`apps/server/src/db/schema.ts` owns the Drizzle relational schema. The committed
`apps/server/migrations/0001_initial.sql` migration creates projects, threads,
runs, command receipts, ownership constraints, and the partial one-running-run
index. `MetadataStore` opens `metadata.sqlite` under `PI_WEB_STATE_DIR` or
`~/.pi/web-workspace`, enables foreign keys and WAL, parses every selected row,
and interrupts unfinished runs during restart reconciliation.

Projects retain a canonical path only in server storage. Removal is a soft
metadata operation and never deletes workspace or Pi files. Threads point to an
opaque Pi session UUID; full transcripts stay in native Pi JSONL.

## Runtime and live data flow

`WorkspaceService` resolves project/thread ownership and owns open runtime
instances. `@pi-web/pi-adapter` resolves stored session UUIDs through a fresh Pi
listing for the canonical project before opening private native paths. Prompt
preflight acceptance precedes atomic run/receipt creation. A project-level
in-process lease and SQLite partial unique index prevent simultaneous runs.

HTTP snapshots reconstructed from native history plus run metadata are
authoritative. `LiveBroker` adds process-epoch, monotonic sequence events and a
bounded replay ring for authenticated WebSocket subscribers. Browser queries
invalidate and replace snapshots after events or replay gaps; browser stream
state is never durable truth.

## Inspector and terminal boundaries

File APIs accept project IDs and strict project-relative paths. Existing targets
are resolved with `realpath` and checked against the canonical root before
opening. Tree/search and preview output is bounded and `.git` is excluded.

Git is spawned directly without a shell and status is parsed from porcelain v2
NUL records. Diffs are bounded and identified as current project-wide state.

`ProjectTerminalManager` lazily owns one node-pty process per active project and
a bounded replay buffer. The separate terminal WebSocket parses all attach,
input, resize, restart, and terminate frames. PTYs are process-local and are
disposed at shutdown.

## Browser composition

The route is the selected-thread authority:

- `/`
- `/projects/:projectId`
- `/projects/:projectId/threads/:threadId`

TanStack Query owns parsed server state. The project sidebar uses one Browse
control backed by an authenticated browse-and-register mutation; selected
canonical paths never enter browser state or wire responses. The workspace
renders a nested project and thread sidebar, Markdown transcript and activity,
explicit steer/wait/stop
controls, direct-execution disclosure, Files/Changes/Terminal inspector, and
responsive drawers. Local storage is limited to unsent per-thread drafts.

Every HTTP response and WebSocket frame is parsed with contracts. Raw Markdown
HTML and images are disabled; terminal escape handling is confined to xterm.
