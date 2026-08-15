# Initial agent workspace

**Current version:** None

**Proposed version:** 2

**Proposal status:** Approved

**Implementation status:** In progress

**Product approval:** Approved by the user on 2026-08-16 for specification version 2

**Subsystem:** Projects, threads, agent runs, and workspace UI

**Last verified:** 2026-08-16

**Related ExecPlans:** [Initial agent workspace implementation](../exec-plans/active/2026-08-15-initial-agent-workspace.md)

**Related documents:** [Product specification index](index.md),
[architecture overview](../architecture/overview.md), and
[Parse, Don't Validate](../architecture/data-boundaries.md)

## Purpose

Pi Web Workspace provides a fast, local-first browser interface for steering a
coding agent inside saved engineering projects. The initial product centers on
persistent projects, long-lived agent threads, completion notifications, and a
review workspace. It is an agent-first tool rather than a full browser IDE.

The primary user flow is:

1. Add a local project once.
2. Create or resume a thread within that project.
3. Prompt and steer the agent while observing its work.
4. Review commands and file changes.
5. Use project files, diffs, and a terminal without leaving the workspace.
6. Return later to the same project and thread history.

The server listens only on `127.0.0.1`. At startup the user may choose its port
through a command-line option or environment variable; otherwise it uses port
`3001`. The application presents the resulting plain launch URL, and opening it loads
the workspace immediately without a token, login, or browser session. An
unavailable or invalid selected port fails visibly rather than silently choosing
another. The loopback server intentionally has no client-authentication layer,
so any process running as a local user can access its APIs and terminal while the
server is running.

## Terminology

- A **project** is a persistent saved workspace rooted at a local directory.
- A **thread** is a long-lived conversation within exactly one project and maps
  to one persistent agent-runtime session.
- A **run** is one period of agent execution inside a thread, beginning when an
  accepted prompt starts agent work and ending when that work completes, fails,
  or is interrupted.
- The **selected thread** is the thread displayed by one browser tab. Selection
  is navigation state, not a property that deactivates other threads.
- An **unread completion** is a completed run whose result the user has not yet
  viewed.

A steering message accepted while an agent is already working remains part of
that run. A prompt accepted after the agent has stopped starts another run.

## Workspace layout

The desktop layout has three regions:

```text
┌────────────────────┬───────────────────────────────┬──────────────────────┐
│ Projects/Threads   │ Selected thread               │ Inspector            │
│                    │                               │                      │
│ ▾ Project A        │ User and agent messages       │ Changes | Files |   │
│   ● Thread 1       │ Tool and command activity     │ Terminal             │
│     Thread 2       │                               │                      │
│                    │ Composer                      │                      │
└────────────────────┴───────────────────────────────┴──────────────────────┘
```

The left sidebar and selected thread are visible by default. The inspector is
collapsible and resizable, opens when the user selects a file, diff, command, or
terminal, and may expand for review work. On narrow screens, the sidebar and
inspector become drawers. The initial visual design favors a dark theme,
compact spacing, restrained color, and minimal animation.

### Project and thread sidebar

- Projects are top-level sidebar items and threads are visibly indented beneath
  their project.
- A project can be expanded or collapsed without removing it.
- Threads are ordered by most recent activity within their project.
- Project controls allow creating a thread in that project.
- A thread can be renamed. Thread archival is deferred.
- The sidebar communicates running, failed, interrupted, and unread-completion
  states without relying on color alone.

### Selected thread

The selected thread contains the primary user and agent conversation,
streaming agent output, tool and command activity, errors, and a composer fixed
near the bottom. It supports Markdown and syntax-highlighted code blocks. Tool
and command details are collapsible.

The user can stop an active run. The initial steering interaction is explicit:
when sending while work is active, the user chooses to steer the current run or
wait until it finishes. Automatic sub-agent delegation is not part of this
specification.

### Inspector

The inspector has three initial views:

- **Changes:** project working-tree status, added/modified/deleted files, and a
  unified or split diff with changed-file navigation.
- **Files:** a searchable project file tree and read-only, syntax-highlighted
  file preview with copy-path and copy-content actions.
- **Terminal:** one on-demand interactive terminal session per project, starting
  in the project directory. It can be resized, restarted, or terminated and
  remains alive while its server PTY remains alive.

Changes are project-wide working-tree state, not claimed to have been produced
exclusively by the selected thread. A full manual code editor and line-level
patch acceptance are deferred.

The terminal is an explicit user-controlled local shell, not an agent tool and
not a sandbox. It may exercise the user's normal shell permissions and does not
survive a server restart. It is reachable by local processes because the
loopback server intentionally has no client authentication, but browser
WebSocket upgrades must come from an explicitly permitted origin.

## Project behavior

### Adding projects

The user can add a directory visible to the local server. On macOS and Windows,
the project sidebar presents a single Browse control rather than a path text
field. Activating it opens the server host's native directory chooser; selecting
a directory registers it immediately, while canceling leaves the workspace
unchanged. The browser neither supplies nor receives the selected native path.
If the chooser cannot be opened, the application shows a safe, visible error.

The server resolves and records the selected directory's canonical path and
rejects a missing, inaccessible, or already registered project. A project may
be usable without Git, but Git-dependent inspector features then show a clear
unavailable state.

A successfully added project remains in the sidebar across browser refreshes,
browser restarts, and server restarts until the user explicitly removes it.
The application remembers its display name, canonical path, creation time,
sidebar expansion state, most recently opened thread, and unread-completion
summary.

If persistent Pi sessions already exist for the project directory, the user is
offered an import choice. Import creates application thread metadata pointing
to the existing sessions; it does not copy or rewrite their history.

### Removing projects

Removing a project requires confirmation. It removes the project and its
threads from normal navigation but never deletes or modifies the local
workspace, Git repository, or native agent session files. Re-adding the same
canonical path restores retained application thread metadata when available.
Permanent conversation-history deletion is a separate future operation.

If a saved project directory or agent session file later becomes unavailable,
the application shows an unavailable state and recovery guidance rather than
silently deleting its metadata.

## Thread and run behavior

Every thread belongs to exactly one project and references exactly one
persistent runtime session. A thread cannot move between projects in the
initial release.

A thread records application metadata including its project, display title,
runtime-session reference, creation and activity times, last completed run,
and last viewed completed run. It does not use a single ambiguous `active`
flag.

Run states are:

- `running`
- `completed`
- `failed`
- `interrupted`

### IAW-RUN-01 — Concurrent runs across threads

Each thread may have at most one running run. Distinct threads in the same
project may run concurrently, with each run remaining independently steerable
and stoppable through its owning thread. Concurrent runs share the project's
working directory, so project-wide files, Git state, and inspector output may
change because of any running thread; the application does not attribute those
changes to one thread or prevent conflicting edits.

A second prompt in a running thread is not a separate concurrent run. The user
may steer that thread's current run or retain a draft until it settles. A server
restart marks every unfinished run as interrupted unless the runtime can prove
that it is still executing and reconnectable.

The selected thread is represented by the browser route. Each project also
remembers its last-opened thread as a convenience when the user opens the
project without a thread-specific route. Separate browser tabs may select
separate threads without overwriting each other's current view.

## Completion notifications

When a run completes and its final result has not been viewed:

- its thread displays a solid blue unread indicator;
- its parent project displays an aggregate blue indicator; and
- both indicators survive browser and server restarts.

Opening the completed result marks that completion as viewed. The project
indicator clears only when all unread completed runs beneath it have been
viewed. If the user is already viewing the result when it completes, the UI
shows a brief completed state without leaving it unread.

Running uses an animated progress indicator, and failure uses a red warning
icon. Every state also has a non-color cue and accessible label. Browser or
operating-system notifications are deferred.

## Agent interaction and trust

The selected thread supports:

- sending a multiline prompt;
- streaming agent text and activity;
- stopping active work;
- steering an active run explicitly;
- displaying command input, working directory, output, exit state, and errors;
  and
- recovering the authoritative thread snapshot after a browser reconnection.

The initial release follows Pi's current direct-execution model. It does not
interpose application approval cards or a command policy: enabled agent tools
and commands execute with the user's normal permissions. Pi's native project
trust behavior governs project-local resources. The UI must clearly disclose
that agent execution is not sandboxed and may read, modify, or execute outside
the selected project when the underlying tool permits it.

Per-command manual and automatic approval are deferred. A future automatic
approval feature may place a dedicated reviewer agent in front of main-agent
tool and command requests. That reviewer would receive a structured proposed
operation and relevant context, then approve or reject it before execution.
Its policy, failure behavior, audit history, context limits, and relationship to
main and reviewer runs require a separate approved specification and technical
design; no reviewer agent or approval state is implemented initially.

## Persistence responsibilities

The application uses two complementary persistence layers.

### Native runtime history

Pi's persistent session JSONL is the source of truth for agent conversation
history, including messages, tool calls and results, model changes, compaction,
branching, usage, and session naming. The Pi adapter opens and translates these
sessions through the Pi SDK. Browser code never reads a native session file
or receives an unrestricted filesystem path for one.

### Application metadata

A local application database is the source of truth for project registration,
project removal state, project-to-thread organization, thread titles and
ordering, runtime-session references, runs, unread completions, and durable UI
metadata. The application does not duplicate the complete native transcript in
this database.

While a run is live, the server owns its runtime instance and transient event
stream. Reconnecting clients receive an authoritative snapshot plus live events
without treating browser state as durable truth. Final conversation history is
reconstructed from the runtime session; application run records retain only the
operational state needed for status, recovery, and notifications.

## Security and data boundaries

The initial deployment is local-first. Filesystem, Git, terminal, persistence,
and agent SDK access remain in the loopback-only server; the browser accesses
them through explicit parsed contracts.

The implementation must:

- reject browser-supplied project, thread, run, file, and session identifiers
  that do not resolve to authorized application records;
- canonicalize project paths server-side and prevent file-inspector path
  traversal or symlink escapes beyond the permitted project boundary;
- parse application-database rows, native session data, filesystem metadata,
  Git output, terminal messages, HTTP input, streaming frames, and Pi SDK events
  at their read or entry boundaries;
- keep provider credentials and unrestricted native session paths out of
  browser responses and logs;
- restrict browser terminal attachment and input to an explicitly permitted
  origin and the requested project terminal session; and
- surface malformed or unavailable persisted state without silently guessing or
  deleting it.

The selected project is the agent's working directory, but the initial release
does not promise an OS-level agent sandbox or per-command approval. The product
must make that limitation explicit before executable agent tools are enabled.

## Persistence and recovery guarantees

- Projects, thread metadata, native thread history, and unread completions
  survive browser and server restarts.
- Refreshing or reconnecting does not duplicate accepted prompts, runs, or
  completed messages.
- A missing or corrupt application record or session file produces a scoped,
  visible error and does not make unrelated projects unavailable.
- Active browser selection is restored from the route; a project-only route
  falls back to that project's last-opened thread.
- Interactive terminal process state is not durable across server restarts.

## Acceptance criteria

1. On macOS and Windows, a user can add two projects through the native Browse
   chooser without typing a path, reload the browser and server, and find both
   projects still present until explicitly removed; canceling the chooser adds
   nothing.
2. Threads appear indented under exactly one project and remain available with
   their history after a restart.
3. Opening a project or thread never depends on a browser-provided filesystem or
   native-session path.
4. A prompt starts a recorded run, streams visible activity, and reaches a
   completed, failed, or interrupted state.
5. Two distinct threads in one project can run simultaneously and can each be
   steered or stopped without affecting the other's run; a second independent
   run cannot start in a thread that is already running.
6. Concurrent threads may modify the same project working tree, and Changes,
   Files, Git, and terminal views continue to represent shared project-wide
   state rather than attributing changes to a thread.
7. A completed run produces a durable blue unread indicator on its thread and
   project, and viewing the completed result clears the appropriate indicator.
8. The selected thread is route-addressable, and two browser tabs can view
   different threads without a global selection conflict.
9. The inspector can show current Git changes and diffs, browse and preview
   permitted project files, and host one interactive terminal per project.
10. Removing a project changes application navigation only; it does not delete
    workspace files or native Pi history, and re-adding the path restores retained
    metadata.
11. Existing Pi sessions can be discovered and imported without rewriting their
    native history.
12. Browser refresh or stream reconnection reconstructs an authoritative thread
    view without duplicating accepted work.
13. Invalid identifiers, malformed persisted data, unavailable paths, and
    malformed adapter output fail at their boundaries with safe, visible errors.
14. Starting the server prints a plain loopback URL; opening it, refreshing it,
    or opening it in another tab loads the workspace without a launch token,
    cookie, login, or re-authentication step.

## Initial non-goals

- Thread archival or permanent history deletion
- Full browser code editing
- Git commits, pushes, pull requests, or worktree orchestration
- Multiple simultaneous runs in one thread or runtime session
- Automatic conflict prevention or per-thread attribution for shared working-tree changes
- User-created or automatically orchestrated sub-agents
- Parent/child agent views and sub-agent chat panels
- Selecting and packaging context for a delegated sub-agent
- Cloud-hosted workspaces or multi-user collaboration
- Native project-directory pickers on platforms other than macOS and Windows
- Browser or operating-system completion notifications
- Persistent terminal processes across server restarts
- Per-command manual approval or automatic approval by a reviewer agent
- Approval cards, approval policy configuration, or approval audit history
- A claim of OS-level sandboxing

Future sub-agent work may add parent/child runs and explicit context bundles
containing selected messages, files, diffs, and instructions. Future command
review may add a specialized reviewer-agent relationship for proposed tool and
command operations. The initial data model should remain migratable to those
features, but it must not add speculative approval or sub-agent behavior now.

## Proposed-version status

Specification version 2 changes the approved version 1 run lease from
project-scoped to thread-scoped through `IAW-RUN-01` and acceptance criteria
5-6. All other version 1 behavior remains proposed without change. There are no
open product questions. The user approved version 2 on 2026-08-16.

## Remaining design work before implementation

The durable behavior above was approved as version 2. The implementation
designs use
a client-unauthenticated, loopback-only server with exact Host checks and browser
Origin/CSRF protections, a user-selected loopback port, Drizzle with SQLite for
application metadata, Pi's direct tool-execution and native project-trust
behavior, a reconnectable live event protocol, and bounded inspector and PTY
lifecycles. Those designs may refine internal mechanisms but must not change
this product contract without renewed approval.
