# Inspector and terminal boundaries

**Status:** Approved

**Subsystem:** Project files, Git changes, diffs, and interactive PTYs

**Last verified:** 2026-08-22

**Related documents:** [Initial agent workspace](../product-specs/initial-workspace.md), [initial workspace execution plan](../exec-plans/active/2026-08-15-initial-agent-workspace.md), [Workspace panel](../product-specs/workspace-panel.md), [workspace panel implementation plan](../exec-plans/active/2026-08-22-workspace-panel.md), [local-client security](local-client-security.md), and [Parse, Don't Validate](../architecture/data-boundaries.md)

> The browser surface these boundaries feed is the **workspace panel**; the
> `Changes | Files | Terminal` inspector it replaces is retired. This document
> keeps its path because several documents link it, and keeps the name
> "inspector" only for the server-side file, Git, and diff boundary it has
> always described. Nothing here is per-tab: a panel tab is a browser-side
> addressing concept over the same server routes.

## Decision summary

Thread-view inspector endpoints accept opaque project/thread IDs and a normalized
workspace-relative path only. The server resolves the trusted thread execution
root from metadata, resolves the requested target to a canonical target,
verifies containment, and performs reads against that target. Git is invoked
without a shell and parsed from machine-oriented output. Files and diffs are
bounded. Managed worktree creation is a separate server-owned Git boundary:
clean mode checks out only the selected commit, while explicit transfer applies
separate staged/unstaged binary patches and non-ignored untracked files after a
stable source fingerprint. It never stashes, resets, or cleans the source
checkout.

Use `node-pty` behind a server-owned adapter for on-demand terminal processes and `@xterm/xterm` in the browser. Terminals are owned by terminal identity, not by execution scope: an execution scope may hold up to eight concurrent PTYs, each addressed by its own `TerminalId`, each with its own spawn directory inside that scope's execution root. Terminal attachment uses a separate credential-free WebSocket with exact Host and browser Origin checks. The terminal is an unrestricted user shell with the user's permissions, not an agent tool or sandbox, and any same-machine process can access it while the server runs.

A terminal's live working directory is observed, not assumed, through a bounded platform probe, and is reduced to a workspace-relative path before it reaches the browser. Where the platform cannot answer, the browser is told so rather than shown a stale directory as if it were current.

The browser tab that embeds a web page does not proxy it. The server offers one narrow primitive — a headers-only probe that reports whether a target refuses framing — and the page itself is loaded by the browser into a sandboxed frame that is denied top-level navigation. The workspace refuses to frame its own origin, which is the only case where the frame's own origin would be a hazard.

## File path and read policy

- Wire paths use `/` separators, are relative, and reject empty segments, `.`, `..`, absolute/drive/UNC forms, NUL, backslashes, and encoded traversal before filesystem access.
- The canonical project root comes only from the parsed database project record and is rechecked for availability.
- For an existing target, resolve `realpath`, verify it equals the root or is under `root + separator`, then open/list the canonical resolved target rather than the original symlinked spelling. This prevents a later symlink retarget from redirecting the actual open.
- Symlinks may be displayed. Directory traversal does not follow symlinked directories by default. A symlinked file preview is allowed only when its canonical target remains inside the project.
- Copy-path returns the normalized project-relative display path. Absolute server paths never appear in browser DTOs.
- File previews are read-only, at most 2 MiB, and explicitly report binary, truncated, missing, or inaccessible states. Invalid UTF-8 is not silently decoded as trusted text.
- Tree traversal excludes `.git`, does not imply Git ownership, caps results at 20,000 entries, and supports bounded server-side search with at most 500 matches. Ignore behavior is explicit and can later incorporate parsed ignore files.

Read-only filesystem races cannot be eliminated portably without an OS sandbox. Opening the already resolved canonical target narrows the symlink race. Any remaining replacement/disappearance becomes a scoped read error, never a fallback to the browser path.

## Git process and parsing policy

- Spawn `git` directly with an argument array, cwd set from the authorized canonical project, a minimal inherited environment, no pager/color, a 10-second default timeout, and a 5 MiB combined-output limit.
- Detect repository availability with a bounded command and represent non-Git projects explicitly.
- Status uses `git status --porcelain=v2 -z --untracked-files=all`; parse NUL records and all supported ordinary/rename/unmerged/untracked forms.
- Diffs are fetched for one selected status path at a time. Staged and unstaged sections are requested separately with fixed arguments and returned as labeled bounded unified text. Untracked files use an application-generated `/dev/null`-style unified preview from bounded file content rather than shell redirection.
- The browser may render unified or derived split views, but the server does not claim a stable working tree between status and diff calls.
- Malformed output, timeout, disappearing files, unsupported states, and nonzero exit map to scoped typed failures. Command lines and stderr are redacted before client display.

The Changes view is always labeled as current project-wide working-tree state, never thread-attributed output.

## PTY lifecycle and protocol

- `node-pty` is isolated behind `PtyFactory`/`ProjectTerminalManager` interfaces so tests use a fake process.
- A terminal is created only on explicit user action.

**Superseded 2026-08-22.** The original rule — "Exactly one PTY exists per active
execution scope" — is replaced by N-per-scope with a cap. It was never a safety
property; it was an addressing shortcut, because owners were keyed by `scopeId`
and a terminal could therefore be found by looking up its scope. A user working
in one worktree legitimately wants a dev server and a shell at the same time,
and the one-per-scope rule made that unrepresentable rather than merely
unavailable.

- **Ownership is keyed by `TerminalId`.** `ProjectTerminalManager` holds
  `Map<TerminalId, TerminalOwner>` plus a `scopeId -> Set<TerminalId>` index for
  scope-wide operations. Resolving a terminal looks it up by id and then
  requires its `projectId` **and** its `scopeId` to equal the request's, so a
  live id from another thread's worktree or another project is rejected rather
  than reachable. The scope key alone no longer proves anything.
- **A per-scope cap of eight** bounds the resource. Shared threads count against
  their project scope, isolated threads against their worktree scope. Reaching
  the cap is a typed rejection carrying a `terminal_limit_reached` code, not a
  silent failure and not an untyped error string.
- **`create` and re-attach are distinct.** The `create` client frame makes a new
  terminal. The `attach` frame carries an optional `terminalId`; with one it
  re-attaches to that existing terminal, without one it attaches to a new one.
  A reloaded browser therefore reclaims its own shells by identity instead of
  by luck of a scope key.
- **A terminals-listing route,**
  `GET /api/projects/:projectId/threads/:threadId/terminals`, returns the live
  terminals of the request's execution scope as `{ id, cwd }`. It exists so a
  reloaded browser can re-attach rather than orphan PTYs it has forgotten the
  ids of. It is a read and needs only the exact Host.
- **Spawn directory.** `attach` and `create` accept an optional workspace-relative
  `cwd`, parsed by the same relative-path schema and containment resolution the
  file routes use. Anything that does not resolve inside the execution root is
  rejected before a process is spawned; the default remains the execution root.
- Shell selection parses an absolute `$SHELL` that exists and is executable, with a platform fallback such as `/bin/sh`.
- The environment is the server user's normal shell environment with application secrets and agent-specific session variables removed where practical. The terminal still has the user's ordinary permissions.
- The terminal WebSocket checks exact Host and Origin headers during upgrade, requires no credential, and parses versioned `attach`, `create`, `input`, `resize`, `restart`, and `terminate` frames. Input is capped at 64 KiB per frame; dimensions are integers within 2–500 columns and 2–200 rows.
- PTY output is opaque terminal data carried in bounded server frames. A 1 MiB per-terminal replay ring supports a newly attached tab; overflow drops oldest output and emits a reset/truncation marker.
- Disconnecting a browser does not terminate the PTY. Explicit terminate, restart, project removal, child exit, or server shutdown cleans up the process tree, listeners, buffers, and attachments. Restart disposes the process and creates a replacement, so the terminal id changes; the client adopts the id from the new `ready` frame and re-supplies its recorded working directory as the replacement's spawn directory.
- PTYs do not survive server restart. A client with a stale terminal ID receives a gone state and may explicitly create another.

The UI shows a persistent warning that Terminal is a direct local shell, is not sandboxed, and is separate from agent execution. The warning belongs to each terminal, not to the panel that hosts them.

## Terminal working-directory probe

A shell's working directory is state inside a process the server does not
control, so it is observed rather than tracked. `probeCwd(pid)` reads
`/proc/<pid>/cwd` on Linux and runs a bounded `lsof -a -p <pid> -d cwd -Fn` on
macOS — argument array, no shell, a two-second timeout, and a small output
buffer — and returns `null` on every other platform.

- It is polled at most once per second, and only while a client is attached. An
  unobserved terminal costs nothing.
- The absolute path it returns is reduced against the terminal's execution root
  before it leaves the server: the root becomes the empty relative path, a
  descendant becomes its relative path, and anything else — including a shell
  that has `cd`'d out of the worktree — becomes `null`. Absolute server paths
  never appear in a browser DTO, here as everywhere else.
- The reduced value is pushed as a `cwd` server frame. Where it is `null`, the
  browser shows the directory the terminal was **started** in and labels it as
  such. It never presents a spawn directory as a live one.
- Observing the directory requires the process id, which the `PtyProcess`
  adapter interface must now expose. The test fake returns `null`, which
  exercises the unobservable path by default.

## Browser embedding

The workspace embeds a web page — normally a local development server started
from a terminal in the same worktree — in a tab. Three things make that safe
enough to ship without becoming a browser.

- **The frame is sandboxed as
  `allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin`,
  and the omissions carry the weight.** Neither `allow-top-navigation` nor
  `allow-top-navigation-by-user-activation` is granted: that is what stops an
  embedded page navigating the workspace away from itself, and the browser
  enforces it independently of anything the frame does to its own attribute.
  `allow-same-origin` is present because withholding it does not do what it
  appears to. For a cross-origin target — and `http://localhost:3000` is
  cross-origin to `http://127.0.0.1:3001`, a different port being a different
  origin — the token grants the frame **its own** real origin, never ours; it
  cannot touch our DOM or our storage, and is exactly as privileged as that page
  is in an ordinary browser tab. Withholding it instead imposes an **opaque**
  origin — no cookies, no `localStorage`, no IndexedDB — on every framed page,
  which breaks or subtly misbehaves any development application with a session,
  a persisted store, or an auth token: a large share of exactly what this tab
  exists to display.
- **The workspace refuses to frame its own origin.** That is the one real
  hazard: a same-origin frame could reach `window.parent` and this origin's
  `localStorage`. It is closed by address rather than by sandbox — an address
  whose origin equals the workspace's own is rejected at parse time, on the
  server and again in the client, before an `iframe` element exists, and the tab
  renders an explicit named state instead. A precise refusal for the actual hole
  is preferable to a broad restriction that taxes every legitimate page.
  Recorded plainly rather than glossed: `allow-scripts` together with
  `allow-same-origin` lets a frame clear its own `sandbox` attribute. For
  cross-origin content that changes nothing real, because such content already
  has full ordinary page powers and the top-navigation restriction does not
  depend on the attribute surviving.
- **The production CSP gains `frame-src http: https:`**, without which
  `default-src 'self'` blocks the frame outright. `frame-ancestors 'none'` and
  `X-Frame-Options: DENY` on our own responses are unchanged — they govern who
  may frame us, which this must not relax.

Because many sites refuse embedding and a refusal is invisible to the embedding
page, the server offers `POST /api/browser/probe`: it fetches the target's
headers only, over `http` or `https` only, following at most three redirects
with a five-second deadline, and reports just whether an `X-Frame-Options`
header or a CSP `frame-ancestors` directive blocks framing. The response body is
discarded unread and never returned. This is the one place in the application
where the server fetches a URL the user typed; its bounds are specified in
[local-client security](local-client-security.md).

### Alternatives considered for embedding

- **A local header-stripping proxy** that fetches the page and removes
  `X-Frame-Options` and `frame-ancestors` so anything embeds: rejected. It is a
  large subsystem with permanent breakage — URL rewriting, cookies, redirects,
  WebSockets, streaming, and every site that checks its own origin — and it
  turns a loopback-only local tool into an open forward proxy that any
  same-machine process could drive. The product non-goal is explicit: the tab
  embeds pages that permit embedding and does not strip the protections of
  those that do not.
- **A pure client-side load-event heuristic** — embed and infer refusal from a
  missing `load`, a zero-height document, or a thrown cross-origin access:
  rejected as unreliable. A blocked cross-origin frame is indistinguishable from
  a slow one, `load` fires for error documents, and any probe of the frame's
  contents is exactly what the sandbox forbids. It would produce the blank frame
  the spec prohibits, some of the time, with no way to tell which time.
- **Rendering a screenshot instead of a live frame:** rejected. The primary use
  is watching a dev server react to a change; a still image is not that.

## Alternatives considered

- **Trust normalized string prefix alone:** rejected because symlinks and path separator tricks escape lexical containment.
- **Follow all in-project symlink directories:** deferred because it complicates loops, duplicate traversal, and races.
- **Shell out with interpolated Git commands:** rejected because paths become command injection input.
- **Parse human Git output:** rejected because localization and quoting are unstable.
- **Use ordinary child-process pipes as a terminal:** rejected because interactive terminal applications require PTY semantics.
- **Share the agent command channel:** rejected because the terminal is explicitly user-controlled and has an independent lifecycle.
- **Persist terminal processes:** rejected by the product non-goals.
- **Keep one PTY per execution scope:** superseded. It bounded resources by accident and prevented a legitimate workflow on purpose; an explicit per-scope cap bounds resources deliberately and keeps the workflow.
- **Have the browser tell the server its terminal's directory:** rejected. The browser cannot know it — the directory changes inside the shell, not through the protocol — and trusting a client-supplied "current" directory would make a display value into an unverified input. The client supplies only a **spawn** directory, which is validated for containment like any other path.
- **Track the working directory by parsing shell output or injecting a prompt hook:** rejected. Parsing opaque terminal data for state is unreliable and escape-sequence-sensitive, and injecting into the user's shell configuration is a side effect a viewer must not have.

## Failure and recovery

Filesystem/Git failures affect only the view that requested them. Missing project roots retain metadata and show recovery guidance. PTY creation failure leaves no half-registered terminal, and a rejected spawn directory fails before any process exists. Child exit is visible with exit/signal data; restart creates a fresh process with a new id. Server shutdown best-effort terminates all PTYs and does not persist terminal IDs as live. A browser that has forgotten its terminal ids recovers them from the terminals-listing route; a browser holding an id the server no longer has receives a gone state with an explicit restart action. A working-directory probe that fails, times out, or answers with a directory outside the execution root degrades to `null` and never to a guess.

## Required tests

- Relative-path valid cases and absolute, dot segment, separator, NUL, encoded traversal, symlink inside/outside/loop/retarget, disappearing, inaccessible, binary, invalid UTF-8, and oversized files.
- Tree/search result limits, `.git` exclusion, copy-path redaction, and no absolute fixture root in responses.
- Git clean/all status kinds/unusual filenames/rename/unmerged/non-Git/no-HEAD/malformed/timeout/output-limit/concurrent-change fixtures.
- Fake PTY lazy creation, several terminals in one execution scope, the per-scope cap reported as a typed rejection, re-attach by terminal ID, multi-attach, replay/truncation, input/resize bounds, restart/terminate, exit, remove, shutdown, stale ID, cross-project and **cross-scope** ID access, disposal clearing both the id map and the scope index, and leaked-handle checks.
- Spawn-directory cases: the execution root, a nested directory, and rejection of absolute, dot-segment, encoded-traversal, NUL, backslash, and symlink-escaping values before any process is spawned.
- Working-directory probe: the Linux branch, the macOS branch, an unsupported platform, a non-zero exit, a timeout, non-UTF-8 output, a path containing a newline, a directory outside the execution root reducing to `null`, and an assertion that no shell is invoked.
- Terminals-listing route: only the requesting scope's terminals, relative directories only, and no absolute fixture root in the response.
- Browser probe: each rejected scheme, a credentialed authority, the workspace's own origin rejected before any request is issued, a differing port accepted, three redirects accepted and four rejected, a redirect loop, an unreachable and a hanging host, `X-Frame-Options` present and absent, a CSP `frame-ancestors` directive, a `HEAD`-refusing target, and an assertion that the target's body bytes are never read or returned.
- Frame sandboxing: the rendered `sandbox` attribute contains `allow-same-origin` and contains neither top-navigation token; a self-origin address, typed or restored, renders the named refusal state and mounts no `iframe`.
- Production headers: the CSP contains `frame-src http: https:` and still contains `frame-ancestors 'none'`, and `X-Frame-Options: DENY` is still sent.
- Real `node-pty` smoke only in a generated temporary project; no commands against user projects.
