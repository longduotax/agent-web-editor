# Web application

React workspace for persistent local projects and Pi-backed threads.

## Composition

React Router owns project/thread selection, TanStack Query owns parsed HTTP
state, and live WebSocket events invalidate authoritative thread snapshots. The
UI provides the nested project sidebar, native Browse-based project
registration, a Codex-style inline new-chat composer with clean-worktree,
local-change-transfer, or local-checkout choices, Codex-style thread context
and hover archival actions, compact inline run indicators, transcript and run
controls, a thread-scoped Files/Changes/Terminal inspector, direct-execution
disclosures, and responsive drawers. Selection and
registration are combined on the server, so the native selected path never
enters browser state.

All transport values are parsed by `@pi-web/contracts`. The browser never
imports server/runtime/adapter code and never receives canonical project roots
or native session paths. Markdown raw HTML and images are disabled. xterm is
used only for the explicit user-controlled local shell.

Development runs on `127.0.0.1` at `PI_WEB_DEV_PORT` (default `5173`) and
proxies relative `/api` HTTP and WebSocket traffic to `PI_WEB_PORT` (default
`3001`). Both values may be stored in the repository-root `.env.local` file.
Production
assets are served by the backend from the same origin.

## Commands

```sh
pnpm --filter @pi-web/web dev
pnpm --filter @pi-web/web typecheck
pnpm --filter @pi-web/web build
pnpm vitest run apps/web
```
