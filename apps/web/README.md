# Web application

React workspace for persistent local projects and Pi-backed threads.

## Composition

React Router owns project/thread selection, TanStack Query owns parsed HTTP
state, and live WebSocket events invalidate authoritative thread snapshots. The
UI provides the nested project sidebar, native Browse-based project
registration, a Codex-style inline new-chat composer with clean-worktree,
local-change-transfer, or local-checkout choices, Codex-style thread context
and hover archival actions, compact inline run indicators, transcript and run
controls, a docked **workspace panel** of durable tabs, direct-execution
disclosures, and responsive drawers. The panel uses a reduced-motion-aware
slide to close and reopen and can be resized with a pointer or keyboard; its
width, its internal tree, every tab group's tab list and active tab, and each
tab's own state are restored from a versioned, parsed device-local
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
  **Split** and **Close**. Split focuses the new pane's first-message field so
  typing can begin immediately. Close is an immediate, pure layout operation:
  the pane disappears, while its thread remains available in the sidebar.
  Clicking anywhere in a non-focused pane focuses it, and the focused pane
  shows a visible focus ring.
- **Splitting and pane keybindings** (Cmd on macOS, Alt elsewhere for the
  Shift-modified group; Cmd+Alt on macOS, Ctrl+Alt elsewhere for focus):
  - Split right: `Shift+Cmd+=` / `Shift+Alt+=`
  - Split down: `Shift+Cmd+-` / `Shift+Alt+-`
  - Close focused pane: `Shift+Cmd+Backspace` / `Shift+Alt+Backspace`
  - Move focus between panes: `Cmd+Alt+Arrow` / `Ctrl+Alt+Arrow`
- **Workspace panel keybindings** (`Shift+Cmd+Alt` on macOS,
  `Shift+Ctrl+Alt` elsewhere). Every key is a navigation or editing key on
  purpose: this group holds Alt, and on macOS Alt composes alternate
  characters, so a letter's `event.key` is not the key on the keycap.
  - Show or hide the panel: `Space`
  - Focus the panel: `Enter`
  - Next / previous tab in the focused group: `PageDown` / `PageUp`
  - Close the focused group's active tab: `Backspace`
  - Move that tab right / left: `End` / `Home`. One place along its own tab
    strip, and into the adjacent group once it is already at that end, so
    both reordering and moving between groups are reachable without a second
    pair of keys this group has none of.
  - Split the focused group and put the active tab in the new half:
    `Arrow` (right, left, down, up). A group holding a single tab cannot be
    split — the tab would leave it empty — and the chord says so rather than
    doing nothing.
- **Run status**: each threaded pane has exactly one header, showing a labeled, color-plus-text
  run-status indicator — Working (with an elapsed timer), Needs approval,
  Done, or Failed — so a user monitoring several panes can tell which one
  needs them from the headers alone; the same statuses appear against each
  thread in the sidebar run list. A status change never steals focus.
- **One right-hand panel**: the **workspace panel** is the only column docked
  right of the pane surface, and it replaces the fixed
  `Changes | Files | Terminal` inspector, which no longer exists. It holds a
  binary tiling tree of **tab groups** with draggable dividers; each group has
  its own tab strip and shows one tab at a time. A tab is durable and carries
  the `(project, thread, execution scope)` it was opened against, so focusing
  a different chat pane never retargets, reorders, or closes one; a tab
  reading a different worktree than the focused pane shows a worktree chip.
  Tab bodies are mounted once per tab and moved between groups, so splitting
  or collapsing a group keeps a running terminal and every scroll position.
  Tabs are also rearranged by **dragging**: while a tab is held, every
  visible group shows five drop targets — its strip, which moves the tab in
  at the drop index, its centre, which moves it in and activates it, and its
  four edges, which split it on the matching axis. The drag is pointer-driven
  (pointer capture, a movement threshold, a lightweight ghost), it is
  narrated in the panel's live region, and `Escape`, a release outside every
  target, and a drop on the tab's own group centre all leave the layout
  untouched.
  The focused thread's worktree mode and branch appear once, on its own pane
  header's quiet detail line; the changes summary appears once, in a Changes
  tab. Neither the panel nor its reopen control ever overlaps pane content —
  when closed it collapses to a docked rail. Its outer docked edge is the one
  place in the surface that carries elevation rather than a hairline; see
  `docs/product-specs/workspace-panel.md`. (The earlier standalone
  "Environment" column is removed; see CWS-06 in
  `docs/product-specs/codex-workspace-surface.md`.)
- **One reading column**: the transcript, the composer, and the new-chat card
  share a single centered measure, `--surface-measure` in `styles.css`. No
  component carries a width of its own.
- **Themes**: the app ships complete light and dark themes plus a System
  default that follows the OS `prefers-color-scheme` and updates live; the
  choice is applied before first paint (no flash) and is set from the
  **Settings** page (a "Settings" link in the sidebar footer), which is
  structured to hold further device-local preferences later.
- **Layout persistence**: the tiled pane arrangement, sizes, and focus are
  persisted per project in device-local storage (not synced through the
  server), so a project's layout survives a reload but is local to that
  browser.

Both new-chat and existing-thread composers accept bounded JPEG, PNG, and WebP
attachments by pane-scoped drag/drop, focused clipboard paste, or an accessible
file picker. Pending files and object-URL previews remain page-memory only;
image-bearing start, prompt, and steer commands use multipart transport, and
failures retain the originating input. Accepted native Pi images render outside
Markdown from authorized, on-demand typed image responses.

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
