# Multi-agent tiling workspace — design

**Status:** Draft

**Subsystem:** Browser workspace composition, agent runtimes, worktree lineage, theming

**Last verified:** 2026-08-21

**Related documents:** [Architecture overview](../../architecture/overview.md), [Web workspace composition](../../design/web-workspace-composition.md), [Runtime and Pi adapter](../../design/runtime-and-pi-adapter.md), [Inspector and terminal](../../design/inspector-and-terminal.md)

## Purpose

Reshape a project's browser view from "sidebar plus one selected thread" into a
single **terminal-style tiling surface** that shows every run in the folder at
once, adds **Codex** and **Claude** as agent backends beside **Pi**, binds a
git-and-terminal panel to a chosen pane's worktree, and re-skins the app toward
a Codex desktop feel with a full light theme. Performance under many concurrent
live runs is a first-class constraint, not an afterthought.

This document is the approved design intent. The implementation plan is written
separately (see [Transition to implementation](#transition-to-implementation))
into this repository's `docs/exec-plans/active/` tree with its required plan
metadata.

## Vocabulary

- **Project** — a registered folder. It has exactly one workspace view.
- **Pane** — the visual home of one **thread** (a Pi/Codex/Claude session). A
  pane is the unit that tiles, collapses, and docks.
- **Dock** — a strip at the bottom of the workspace holding collapsed panes.
- **Right panel** — a single git-commits-plus-terminal surface bound to one
  chosen pane's worktree at a time.

The term "chat", "run", and "pane" all refer to the same underlying thread from
different angles: "chat" is the conversation, "run" is an in-flight prompt, and
"pane" is its tile in the layout.

## Design principles

1. **See everything, drown in nothing.** The default is all runs visible and
   tiling; the user, not the app, decides what to collapse. Attention is a
   quiet signal (a blue dot), never a modal interruption.
2. **Reuse the existing spine.** Threads, worktrees, the `AgentRuntime`
   interface, the `LiveBroker`, and the inspector already exist. This work
   re-composes and extends them; it does not replace the server model.
3. **Server owns truth; the browser owns arrangement.** Threads, runs, and
   transcripts remain server-authoritative. Pane geometry, dock membership,
   focus, and the right-panel binding are device-local view preferences.
4. **Cost scales with attention.** A pane the user is watching may stream and
   render fully; a docked pane costs almost nothing until restored.

## 1. Project workspace as a tiling surface

The project route (`/projects/:projectId`) becomes a **tiling pane manager**
rather than a single-thread center. Each pane renders one existing thread with
its transcript, activity, composer, steering, and stop controls — the same
`features/runs` and `features/threads` rendering used today, hosted inside a
tile instead of the full center column.

The current project/thread sidebar is reduced to a compact **project switcher**
(the folder you are in, plus a way to jump to other registered projects). Thread
selection is no longer a sidebar concern: every non-docked thread of the project
is on screen at once. Deep links to `/projects/:projectId/threads/:threadId`
remain valid and resolve by focusing that pane (and restoring it from the dock
if collapsed).

Layout is a **binary tiling tree** (the tmux model): every split divides one
pane into two along an axis, so the arrangement is always a set of
non-overlapping rectangles with draggable dividers. This keeps geometry
predictable and serializable, and avoids free-floating overlap.

## 2. Panes, splitting, collapse, and the dock

### Splitting

A split takes the focused pane, divides it, and opens a **new thread** in the
new half.

- **Split right** — `Shift+Cmd+=` (macOS) / `Shift+Alt+=` (Windows/Linux)
- **Split down** — `Shift+Cmd+-` (macOS) / `Shift+Alt+-` (Windows/Linux)

The new thread's start-state is chosen per [section 3](#3-new-chat-start-state).
The new pane takes focus so the user can type immediately.

### Collapse and the dock

The user collapses any pane to the **bottom dock** to declutter, and restores it
back into the tiling tree later. Collapse and restore are user-driven; the app
never auto-collapses. A restored pane returns to the tiling tree; the exact
re-insertion rule (last position vs. focused-neighbor split) is a plan-level
detail, with "re-split the focused pane" as the working default.

### Attention signal

A docked pane shows a single **blue dot** when its run **needs input or has
completed** since it was last seen — the two states that mean "this one wants
you." The dot clears when the pane is restored and viewed. Running-but-not-
waiting and idle docked panes show no dot. Colour is never the only signal: the
dot pairs with an accessible label and is distinguishable for colour-vision
differences (shape/position, not hue alone), consistent with the existing
"status is never conveyed by colour alone" rule.

### Keybindings

The full set below is approved (2026-08-21). macOS uses `Cmd`; Windows/Linux
replace `Cmd` with `Alt`, matching the split rule.

| Action                           | macOS                 | Windows/Linux         | Notes                                              |
| -------------------------------- | --------------------- | --------------------- | -------------------------------------------------- |
| Split right                      | `Shift+Cmd+=`         | `Shift+Alt+=`         | —                                                  |
| Split down                       | `Shift+Cmd+-`         | `Shift+Alt+-`         | —                                                  |
| Collapse focused pane to dock    | `Shift+Cmd+Down`      | `Shift+Alt+Down`      | —                                                  |
| Restore last-docked / cycle dock | `Shift+Cmd+Up`        | `Shift+Alt+Up`        | Click a dock chip to restore a specific pane       |
| Move focus between panes         | `Cmd+Alt+Arrow`       | `Ctrl+Alt+Arrow`      | —                                                  |
| Close focused pane               | `Shift+Cmd+Backspace` | `Shift+Alt+Backspace` | Closing a pane archives, never deletes, its thread |
| Bind right panel to focused pane | `Cmd+Alt+Enter`       | `Ctrl+Alt+Enter`      | —                                                  |

**Browser-shortcut caveat:** because this stays a browser app, some `Cmd`/`Alt`
combinations overlap browser defaults (zoom on `Cmd+=`/`Cmd+-`, tab and window
management). The workspace captures its shortcuts with `preventDefault` while a
pane surface holds focus, and the plan verifies each binding against Chrome's
reserved set; any unavoidable conflict is resolved during the plan with the user.

## 3. New-chat start-state (per pane)

When a split (or an explicit "new chat") creates a thread, its execution context
follows the existing start-state model with one new source:

1. **Fresh clean worktree** — the default, identical to today's behaviour: a new
   app-namespaced worktree with no source changes transferred.
2. **Current branch (direct checkout)** — run directly in the registered project
   checkout, the existing explicit non-default option.
3. **Fork of a running chat** — _new capability._ Create a new worktree branched
   from another live pane's current worktree state, recording the lineage. This
   extends `GitWorktreeManager` with a "branch from an existing managed
   worktree" path that verifies the source worktree's repository and commit
   identity and applies its reviewed snapshot, mirroring the safety already used
   for clean creation.

The start-state chooser in the new-chat toolbar gains a source picker; when
"fork of a running chat" is selected it lists the project's currently running
threads by name. Fork lineage (`forked_from_thread_id`) is persisted so the
right panel and future tooling can show where a worktree came from.

## 4. Three agent backends

Codex and Claude join Pi as sibling implementations of the existing
[`AgentRuntime`](../../../packages/agent-runtime/src/index.ts) interface, in new
packages `packages/codex-adapter` and `packages/claude-adapter`. The server
selects the adapter per thread; the browser never learns backend internals.

Each adapter must satisfy the same obligations the Pi adapter meets today:

- **Discovery / create / open** of durable sessions for a project execution
  root, returning `RuntimeSessionDescriptor`s and opening an
  `OpenRuntimeSession`.
- **Live streaming** that maps the backend's native event stream onto the shared
  `RuntimeEvent` and [`TranscriptItem`](../../../packages/contracts/src/index.ts)
  contracts, so the browser renders all three backends through one transcript
  model.
- **Prompt, steer, stop, recover** with the same acceptance/settlement and
  recovery-identity semantics the runtime interface already defines.

The thread record gains a `runtime` discriminator (`pi` | `codex` | `claude`),
defaulting to `pi` for existing rows. The new-chat/composer flow chooses the
agent per chat. Where a backend's session history is not natively JSONL like
Pi's, that adapter owns durable persistence and discovery for its own store; the
exact per-backend transcript translation and session-store details are the
adapters' internal concern and are specified in the implementation plan rather
than here.

## 5. Right-hand panel bound to a chosen pane

A single right panel shows, for **one selected pane's worktree**:

- **Git commits** — a bounded, parsed commit log for that worktree (new view;
  the current inspector exposes Changes and Terminal but not a commit history).
- **Terminal** — the existing per-scope PTY for that worktree, reusing
  `ProjectTerminalManager` and the terminal WebSocket.
- Existing **Changes** (and optionally Files) remain available in the same
  panel.

The panel **follows a binding**, not the focused pane, so the user can watch one
pane's git/terminal while typing in another. Binding is set by a control on the
pane title bar or the `Bind right panel` shortcut, and the current binding is
visibly labelled. The panel reuses the resizable inspector shell and its
device-local width/visibility preference. Git commit reads are spawned without a
shell and parsed from bounded, structured output, consistent with existing Git
handling.

## 6. Codex-desktop look and light mode

The app stays a **loopback browser web app** (no Electron/Tauri) restyled toward
the Codex desktop feel: window-like chrome, tighter density, restrained motion
honouring `prefers-reduced-motion`.

A full **light theme** is added beside the existing dark baseline. Both themes
are expressed only through the CSS custom-property tokens already in use, so
components do not branch on theme. A **theme toggle** (light / dark / follow
system) is persisted in the existing versioned device-local preferences, and
malformed or unknown-version values are discarded explicitly, as with other
local UI preferences.

## 7. Efficiency under many live runs

"All runs, live, at once" is the performance-critical path. The design bounds
cost by attention tier:

- **Expanded panes** subscribe to full transcript deltas and render at full
  fidelity, with a **bounded / virtualised** transcript window so a long or
  fast-streaming run does not grow the DOM without limit.
- **Docked (collapsed) panes** drop to a **status-only subscription** — enough
  to know run state and whether attention is needed to light the blue dot — and
  do not render transcript content or mount a terminal.
- **One live connection.** All panes share the single `LiveBroker`
  WebSocket with its epoch/sequence events and bounded replay, multiplexed by
  thread topic. The design does not open a socket per pane. A lightweight
  status projection (run state + attention) is distinguished from full
  transcript events so docked panes can subscribe cheaply; introducing that
  projection is a defined server task in the plan.
- **Idle terminals and inspectors** stay unmounted until their pane is expanded
  or the right panel is bound to them.

These tiers are the primary defence against the sluggishness the user has seen
elsewhere; the plan treats "smooth with N concurrent running panes" as an
explicit acceptance target with N chosen during planning.

## Data and state ownership

- **Server (authoritative):** threads (with new `runtime` discriminator),
  worktrees (with new `forked_from_thread_id` lineage), runs, receipts,
  transcripts. New migration adds the `runtime` column (default `pi`) and the
  fork-lineage column without performing Git operations, following the existing
  additive-migration pattern.
- **Device-local (view preference, versioned localStorage, keyed by project):**
  the tiling tree, dock membership, focus, right-panel binding and selected
  view, and the theme choice. Malformed/unknown-version state is discarded and
  the workspace falls back to a single default pane. Selection, unread, run
  state, and transcripts are never sourced from localStorage.

## Component and package impact

- `packages/agent-runtime` — unchanged interface; it already models what the new
  adapters need. Any gaps found during adapter work are additive.
- `packages/codex-adapter`, `packages/claude-adapter` — new `AgentRuntime`
  implementations plus their session translation.
- `apps/server` — adapter selection per thread; `GitWorktreeManager` fork path;
  git-log read; migration for `runtime` and fork lineage; status projection for
  cheap docked subscriptions.
- `apps/web` — the tiling pane manager and dock (new `features/workspace`), the
  reduced project switcher, per-pane agent selection, the right-panel binding
  and git-commits view, the keybinding layer, and the light theme plus toggle.
  The oversized `App.tsx` is decomposed as part of introducing the tiling
  surface rather than growing it further.

## Testing strategy

Following the existing stack (Vitest + React Testing Library + axe-core for the
browser, Playwright for routes/streaming/terminal, and the Fastify integration
boundary):

- Tiling: split right/down creates threads and panes; divider resize; collapse
  to dock and restore; focus movement; deep-link focuses/restores a pane.
- Dock attention: blue dot appears on completion and on awaiting-input for a
  docked pane, clears on restore-and-view, and carries an accessible label.
- Start-state: default clean worktree; direct checkout; fork-of-running-chat
  creates a lineage-recorded worktree from the source's state.
- Agents: a thread runs under each of `pi`, `codex`, `claude`; per-chat
  selection; all three render through the one transcript model; default `pi`
  for legacy rows.
- Right panel: binding follows the chosen pane independent of focus; git
  commits render bounded and parsed; terminal attaches to the bound worktree.
- Theming: light/dark/system toggle, persistence, malformed-value discard,
  reduced motion.
- Efficiency: docked panes hold a status-only subscription and mount no
  transcript/terminal; a single live socket serves many panes; virtualised
  transcript stays bounded under fast streaming.
- Keybindings: each shortcut fires its action and does not leak to the browser
  default while a pane holds focus.

## Alternatives considered

- **App auto-manages what is expanded vs. collapsed** (attention-aware
  auto-tiling): rejected in favour of user-controlled collapse with a passive
  blue-dot signal — the user wants to decide what stays visible.
- **Focus-plus-rail (one big pane, others as status rows):** rejected because it
  shows only one conversation in full; the user values seeing all at once.
- **Free-floating draggable windows:** rejected for overlap and non-serialisable
  geometry; binary tiling stays predictable.
- **Persist layout server-side:** deferred; layout is treated as a device-local
  view preference to keep server truth clean, matching the existing preference
  model. Revisit if cross-device layout sync is requested.
- **Package as Electron/Tauri now:** rejected per the user's choice to stay a
  browser app styled like a desktop app.
- **Replace Pi with Codex/Claude:** rejected; Pi remains a first-class sibling
  backend.

## Open items resolved during the implementation plan

- Any browser-reserved conflicts for the approved keybinding set, resolved when
  verified against Chrome's reserved combinations.
- Per-backend Codex and Claude session translation and persistence specifics.
- The concrete N for the "smooth with N running panes" acceptance target.
- Dock restore re-insertion rule.

## Transition to implementation

On approval of this design, the implementation plan is produced with the
writing-plans workflow and placed under `docs/exec-plans/active/` with this
repository's required plan metadata (Status, Plan version, Technical approval,
Subsystem, Affected paths or contracts, Governing specification, Related
documents or issue, Last updated), and linked from the active-plans index so
`docs:check` stays green. Durable user-visible behaviour that this introduces is
promoted into `docs/product-specs/` capability documents as it is implemented
and verified, per the existing documentation workflow.
