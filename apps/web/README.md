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
disclosures, and responsive drawers. The inspector uses a reduced-motion-aware slide to close
and reopen and can be resized with a pointer or keyboard; its open state,
selected tab, and width are restored from a versioned, parsed device-local
preference. Selection and registration are
combined on the server, so the native selected path never enters browser state.

A project route renders a terminal-style **tiling workspace** as its center:
one or more resizable thread panes plus a bottom **dock** for panes the user
has set aside. The project/thread sidebar is unchanged and still lists every
thread; the tiling surface replaces only the single selected-thread center.

- **Panes**: each pane is either a threaded pane (transcript, composer, run
  status) or a threadless "New chat" pane. Panes can be split, resized with a
  pointer or keyboard, focused, and closed; closing a threaded pane archives
  its thread.
- **Splitting and pane keybindings** (Cmd on macOS, Alt elsewhere for the
  Shift-modified group; Cmd+Alt on macOS, Ctrl+Alt elsewhere for focus/bind):
  - Split right: `Shift+Cmd+=` / `Shift+Alt+=`
  - Split down: `Shift+Cmd+-` / `Shift+Alt+-`
  - Collapse focused pane to the dock: `Shift+Cmd+Down` / `Shift+Alt+Down`
  - Restore most-recently-docked pane: `Shift+Cmd+Up` / `Shift+Alt+Up`
  - Close focused pane: `Shift+Cmd+Backspace` / `Shift+Alt+Backspace`
  - Move focus between panes: `Cmd+Alt+Arrow` / `Ctrl+Alt+Arrow`
  - Bind the focused pane to the right panel: `Cmd+Alt+Enter` / `Ctrl+Alt+Enter`
- **Dock**: collapsing a pane moves it into a bottom dock row of chips, each
  showing the pane's title and, when a docked thread has settled (finished
  running) with unread output, a blue attention dot. Clicking a chip restores
  that pane to the tiling surface.
- **Layout persistence**: the tiled/docked pane arrangement, sizes, and focus
  are persisted per project in device-local storage (not synced through the
  server), so a project's layout survives a reload but is local to that
  browser.

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
