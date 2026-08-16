# Inspector and terminal boundaries

**Status:** Approved

**Subsystem:** Project files, Git changes, diffs, and interactive PTYs

**Last verified:** 2026-08-15

**Related documents:** [Initial agent workspace](../product-specs/initial-workspace.md), [initial workspace execution plan](../exec-plans/active/2026-08-15-initial-agent-workspace.md), [local-client security](local-client-security.md), and [Parse, Don't Validate](../architecture/data-boundaries.md)

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

Use `node-pty` behind a server-owned adapter for one on-demand terminal process per project and `@xterm/xterm` in the browser. Terminal attachment uses a separate credential-free WebSocket with exact Host and browser Origin checks. The terminal is an unrestricted user shell with the user's permissions, not an agent tool or sandbox, and any same-machine process can access it while the server runs.

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
- A terminal is created only on explicit user action. Exactly one PTY exists per
  active execution scope: shared threads use their project scope and isolated
  threads use their worktree scope. Multiple permitted tabs may attach.
- Shell selection parses an absolute `$SHELL` that exists and is executable, with a platform fallback such as `/bin/sh`. The initial cwd is the project's current canonical root.
- The environment is the server user's normal shell environment with application secrets and agent-specific session variables removed where practical. The terminal still has the user's ordinary permissions.
- The terminal WebSocket checks exact Host and Origin headers during upgrade, requires no credential, and parses versioned `attach`, `input`, `resize`, `restart`, and `terminate` frames. Input is capped at 64 KiB per frame; dimensions are integers within 2–500 columns and 2–200 rows.
- PTY output is opaque terminal data carried in bounded server frames. A 1 MiB per-project replay ring supports a newly attached tab; overflow drops oldest output and emits a reset/truncation marker.
- Disconnecting a browser does not terminate the PTY. Explicit terminate, restart, project removal, child exit, or server shutdown cleans up the process tree, listeners, buffers, and attachments.
- PTYs do not survive server restart. A client with a stale terminal ID receives a gone state and may explicitly create another.

The UI shows a persistent warning that Terminal is a direct local shell, is not sandboxed, and is separate from agent execution.

## Alternatives considered

- **Trust normalized string prefix alone:** rejected because symlinks and path separator tricks escape lexical containment.
- **Follow all in-project symlink directories:** deferred because it complicates loops, duplicate traversal, and races.
- **Shell out with interpolated Git commands:** rejected because paths become command injection input.
- **Parse human Git output:** rejected because localization and quoting are unstable.
- **Use ordinary child-process pipes as a terminal:** rejected because interactive terminal applications require PTY semantics.
- **Share the agent command channel:** rejected because the terminal is explicitly user-controlled and has an independent lifecycle.
- **Persist terminal processes:** rejected by the product non-goals.

## Failure and recovery

Filesystem/Git failures affect only the selected inspector view. Missing project roots retain metadata and show recovery guidance. PTY creation failure leaves no half-registered terminal. Child exit is visible with exit/signal data; restart creates a fresh process. Server shutdown best-effort terminates all PTYs and does not persist terminal IDs as live.

## Required tests

- Relative-path valid cases and absolute, dot segment, separator, NUL, encoded traversal, symlink inside/outside/loop/retarget, disappearing, inaccessible, binary, invalid UTF-8, and oversized files.
- Tree/search result limits, `.git` exclusion, copy-path redaction, and no absolute fixture root in responses.
- Git clean/all status kinds/unusual filenames/rename/unmerged/non-Git/no-HEAD/malformed/timeout/output-limit/concurrent-change fixtures.
- Fake PTY lazy creation, one-per-project, multi-attach, replay/truncation, input/resize bounds, restart/terminate, exit, remove, shutdown, stale ID, cross-project access, and leaked-handle checks.
- Real `node-pty` smoke only in a generated temporary project; no commands against user projects.
