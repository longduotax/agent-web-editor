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
one or more resizable thread panes, with no minimized or docked tier — every
thread on the surface is a full pane. The project/thread sidebar is unchanged
and still lists every thread; the tiling surface replaces only the single
selected-thread center.

- **Panes**: each pane is either a threaded pane (transcript, composer, run
  status) or a threadless "New chat" pane. Panes can be split, resized with a
  pointer or keyboard, focused, and closed. The only pane actions are
  **Split** and **Close**. Close is immediate — the pane disappears right
  away and the thread's archive is briefly deferred behind an "Archived —
  Undo" toast, so clicking Undo restores the pane (with its splits intact)
  before anything is actually archived; letting the toast time out commits
  the archive. A new-chat pane closes with no toast and archives nothing.
  Clicking anywhere in a non-focused pane focuses it, and the focused pane
  shows a visible focus ring.
- **Splitting and pane keybindings** (Cmd on macOS, Alt elsewhere for the
  Shift-modified group; Cmd+Alt on macOS, Ctrl+Alt elsewhere for focus/bind):
  - Split right: `Shift+Cmd+=` / `Shift+Alt+=`
  - Split down: `Shift+Cmd+-` / `Shift+Alt+-`
  - Close focused pane: `Shift+Cmd+Backspace` / `Shift+Alt+Backspace`
  - Move focus between panes: `Cmd+Alt+Arrow` / `Ctrl+Alt+Arrow`
  - Bind the focused pane to the right panel: `Cmd+Alt+Enter` / `Ctrl+Alt+Enter`
- **Run status**: each threaded pane's header shows a labeled, color-plus-text
  run-status indicator — Working (with an elapsed timer), Needs approval,
  Done, or Failed — so a user monitoring several panes can tell which one
  needs them from the headers alone; the same statuses appear against each
  thread in the sidebar run list. A status change never steals focus.
- **Environment panel**: a single, shared, focus-following right-hand column
  that reflects the focused pane's run environment — changes summary,
  worktree, branch, and sources (e.g. GitHub) — and updates whenever focus
  moves between panes. Its visibility is a device-local preference: open by
  default while the surface is a single pane, hidden once it tiles, and
  remembered per device after the user toggles it.
- **Themes**: the app ships complete light and dark themes plus a System
  default that follows the OS `prefers-color-scheme` and updates live; the
  choice is applied before first paint (no flash) and is set from the
  **Settings** page (a "Settings" link in the sidebar footer), which is
  structured to hold further device-local preferences later.
- **Layout persistence**: the tiled pane arrangement, sizes, and focus are
  persisted per project in device-local storage (not synced through the
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
