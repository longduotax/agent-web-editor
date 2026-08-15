# Server application

Loopback-only Fastify process for the local agent workspace.

## Ownership

The server owns parsed startup configuration, credential-free loopback request
policy, Drizzle/SQLite metadata and migrations, project/thread/run
coordination, Pi adapter composition, live WebSockets, bounded file and Git
inspection, project PTYs, and the macOS/Windows native project-directory
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
- Metadata migrations v1-v2 are committed under `migrations/`; v2 permits one running run per thread, including concurrent threads in one project.

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
