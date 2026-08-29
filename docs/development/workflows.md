# Development workflows

**Status:** Current

**Last verified:** 2026-08-15

The repository is a pnpm workspace with centralized tooling and package-local
application/build commands.

## Prerequisites

- Node.js 22.19 or later (required by the Pi SDK)
- pnpm 11.1.2 through Corepack or an equivalent installation
- Python 3 for `scripts/check_docs.py`

Do not print `.env` files or secrets. Treat every database configured in `.env`
or `.env.*` as production unless the user identifies a disposable,
non-production target. Without explicit permission, database access is read-only.

## Install dependencies

From the repository root:

```sh
pnpm install
```

Use the committed `pnpm-lock.yaml`. `pnpm-workspace.yaml` explicitly allows the
lifecycle scripts required by `esbuild`, `protobufjs`, and `@google/genai`;
review any new lifecycle-script request rather than approving all dependency
builds. Add dependencies to the package that owns them instead of the workspace
root unless they are repository-wide tools:

```sh
pnpm --filter @pi-web/server add package-name
pnpm --filter @pi-web/web add -D package-name
```

## Static verification

Run the full static gate:

```sh
pnpm check
```

Or run checks separately:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:docs
pnpm docs:check
```

Build and typecheck are intentionally separate. Vite transforms TypeScript, but
`apps/web` runs `tsc --noEmit` before its build. Vitest includes contract,
configuration, request-policy, temporary SQLite, HTTP, run-coordination,
filesystem, and browser rendering tests. The root test
command first builds shared package entry points so Node tests exercise the same
public runtime exports as the applications. `test:docs` exercises lifecycle
metadata rules with standard-library Python tests, while `docs:check` validates
the current documentation tree.

Generated `dist/`, coverage, and TypeScript build-info files are ignored.

## Development processes

The root command builds the internal runtime packages, starts both applications,
and stays attached:

```sh
pnpm dev
```

Focused alternatives are:

```sh
pnpm --filter @pi-web/web dev
pnpm --filter @pi-web/server dev
```

The web process listens on `127.0.0.1` at `PI_WEB_DEV_PORT` or default `5173`;
the server listens on `127.0.0.1` at `--port`, `PI_WEB_PORT`, or default `3001`.
Vite proxies relative API and WebSocket traffic to the backend port. Copy
`.env.example` to the ignored repository-root `.env.local` to store both values.
Startup prints a plain URL using the configured development port; opening it
loads the workspace without authentication.
Do not start either process unless the current task requires runtime work or
verification.

### Isolated linked-worktree UI review

A linked worktree can run one disposable review environment without sharing the
main development server's ports or state:

```sh
pnpm dev:review
```

The command installs frozen-lockfile dependencies when `node_modules/` is
missing, refuses the main worktree, chooses random loopback ports, creates a
private temporary `PI_WEB_STATE_DIR`, starts the normal development processes,
waits for direct and proxied readiness, and prints the browser URL. Running it
again returns the healthy existing environment for that worktree.

Stop it and remove its SQLite database, logs, and process metadata with:

```sh
pnpm dev:review:close
```

Cleanup proves ownership before terminating the recorded process group and is
safe to repeat. The project-local, manual-only Pi command `/skill:start-env`
wraps these two commands; use `/skill:start-env cleanup` to close the instance.
Neither path updates or restarts the hosted application.

Build and run the loopback production server, including the built web
application, with:

```sh
pnpm start
```

The root command forces production mode and loads `PI_WEB_PORT` and
`PI_WEB_STATE_DIR` from the same ignored `.env.local` file used for local
development. Use `.env.local` for machine-specific settings in this local-first
application; `.env.prod` is not loaded. The package-level backend command
remains available after a build when the caller sets `NODE_ENV=production`
explicitly:

```sh
NODE_ENV=production pnpm --filter @pi-web/server start
```

## Focused package checks

```sh
pnpm --filter @pi-web/contracts typecheck
pnpm --filter @pi-web/agent-runtime build
pnpm --filter @pi-web/pi-adapter build
pnpm --filter @pi-web/server typecheck
pnpm --filter @pi-web/web build
```

Run one future Vitest file from the root with:

```sh
pnpm test:vitest -- path/to/example.test.ts
```

## Configuration and data stores

`--port` overrides `PI_WEB_PORT`; values must be integers from 1 through 65535.
`PI_WEB_STATE_DIR`, when set, must be absolute. Its default is
`~/.pi/web-workspace/`, containing `metadata.sqlite` and bounded pre-migration
backups. The process rejects a symlink state directory or permissions available
to other users.

The server applies only committed migrations under `apps/server/migrations` and
refuses newer schema versions. SQLite uses foreign keys, WAL, a busy timeout,
and explicit shutdown checkpointing. There is no generation or down-migration
at startup.

All writable tests make their own mode-0700 temporary state directory and never
read or write a database from `.env` or `.env.*`. Focused commands are:

```sh
pnpm test
pnpm test:integration
pnpm test:e2e
```

The end-to-end command requires installed Playwright browser binaries. Runtime
unit/integration tests use deterministic fakes; do not run a real provider or
write native user sessions without explicit approval.

## Completion workflow

1. Inspect all changed files (and `git diff` when the directory is under Git).
2. Run focused checks while iterating, then `pnpm check` for repository-wide
   changes.
3. Update architecture only for implemented structure, specifications for
   durable behavior, and designs for consequential decisions.
4. Run `pnpm docs:check` after documentation links, indexes, or plans change.
5. Report omitted checks and why. Never use service startup, database access, or
   deployment as an incidental verification step.
