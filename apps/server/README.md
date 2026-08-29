# Server application

Loopback-only Fastify process for the local agent workspace.

## Ownership

The server owns parsed startup configuration, credential-free loopback request
policy, Drizzle/SQLite metadata and migrations, project/thread/run
coordination, durable thread/worktree provisioning, Pi adapter composition,
live WebSockets, bounded thread-workspace file and Git inspection,
execution-scope PTYs, and the macOS/Windows native project-directory
chooser. The chooser is server-owned and injectable; bounded native JSON output
is parsed before existing project canonicalization, and selected paths are not
returned to the browser. Browser requests identify persisted records with
opaque IDs; project roots and native Pi session paths remain server-private.

`buildServer()` is injectable and does not listen. `src/main.ts` is the only
listener entry point. See [the architecture overview](../../docs/architecture/overview.md)
and approved designs under `docs/design/`.

## State and configuration

- `--port <1-65535>` overrides `PI_WEB_PORT`; default `3001`.
- `PI_WEB_DEV_PORT` selects the Vite listener and development launch URL;
  default `5173`.
- The repository-root `.env.local` stores optional local development values.
- `PI_WEB_STATE_DIR` must be absolute; default `~/.pi/web-workspace/`.
- Production binds only `127.0.0.1`, serves the built SPA, and prints a plain
  launch URL. No token, cookie, or login is required; any same-machine process
  can access the server while it runs.
- Metadata migrations v1-v7 are committed under `migrations/`; v2 permits one
  running run per thread, v3 adds thread archives, v4 adds durable
  thread-creation operations and managed worktrees, v5 adds creation-session
  recovery, v6 adds worktree transfer tokens, and v7 adds recoverable initial-prompt dispatches.
- `PI_WEB_NAMING_MODEL=provider/model` optionally overrides the configured
  default Pi model used to name new threads/worktrees; failure falls back to
  local naming.

Image-bearing start, prompt, and steer commands use direct multipart bodies with
route-specific count, per-file, aggregate-byte, format, and decoded-pixel
bounds; the global 1 MiB body limit remains unchanged for existing routes. The
server detects JPEG/PNG/WebP from bytes, passes ordered SDK-neutral input to the
runtime, and serves accepted native images only through an authorized
project/thread lookup. Image bytes are not staged in SQLite or the workspace.

Tests use newly created temporary state/project directories and injected
runtimes/PTYS. They do not use configured databases or native user sessions.

## Commands

```sh
pnpm --filter @pi-web/server dev
pnpm --filter @pi-web/server typecheck
pnpm --filter @pi-web/server build
pnpm vitest run apps/server
pnpm --filter @pi-web/server start
```
