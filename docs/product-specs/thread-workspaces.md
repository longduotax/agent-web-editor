# Thread workspaces

**Current version:** 2

**Proposed version:** 4

**Proposal status:** Approved

**Implementation status:** In progress

**Product approval:** Approved by the user on 2026-08-29 for specification version 4

**Subsystem:** New-chat creation, thread execution locations, and Git worktrees

**Last verified:** 2026-08-16

**Related ExecPlans:** [Thread workspace and worktree support](../exec-plans/completed/2026-08-16-thread-workspaces.md),
[Same-worktree new-chat command](../exec-plans/active/2026-08-29-same-worktree-new-chat-command.md)

**Related documents:** [Initial agent workspace](initial-workspace.md),
[architecture overview](../architecture/overview.md),
[inspector and terminal boundaries](../design/inspector-and-terminal.md), and
[interactive continuation-flow prototype](../design/worktree-chat-continuation-flow.html)

## Purpose

Thread workspaces let a user choose whether a new coding-agent chat works in the
registered project checkout or in a clean, isolated Git worktree. The capability
protects the user's existing checkout from incidental agent changes while still
allowing the user to deliberately carry current local work into an isolated
thread.

The new-chat experience uses a compact Codex-style configuration bar directly
above the first-message composer. Safety-significant choices remain visible at
the point of submission instead of being hidden in settings or a modal. The
first prompt also supplies one concise generated title for the thread and its
isolated-worktree name, replacing the generic `New thread` label.

## Current contract

### Terminology

- The **source checkout** is the canonical directory registered as a project.
- A **shared thread** executes directly in the source checkout.
- An **isolated thread** executes in an application-managed Git worktree created
  for that thread.
- The **base** is the local branch and exact commit from which an isolated
  worktree is created.
- **Local changes** are staged changes, unstaged changes, deletions, renames,
  and non-ignored untracked files present in the source checkout. Ignored files
  are not local changes for transfer purposes.
- A thread's **execution root** is the directory used as Pi's working directory
  and by that thread's Files, Changes, and Terminal views.

### TW-01 — Inline new-chat configuration

Selecting New chat opens a new-chat composer with one compact configuration bar
above it. The bar follows the supplied Codex interaction pattern and contains,
in order:

1. execution location (`New worktree` or `Local checkout`);
2. starting state (`Clean start`, `Include local changes`, or the read-only
   `Current local files` state); and
3. base/current branch.

The composer carries no project control. It always opens inside a workspace
surface whose project is already settled — a split pane inherits the pane it
came from, and the sidebar's New thread action carries the project it was
invoked on — so the composer names that project rather than asking for it.
Choosing or switching projects belongs to the sidebar.

There is no environment control while the product has no environment capability.
The first-message composer and all applicable choices are usable without opening
a separate modal. Existing threads show compact read-only project, execution
location, and branch context rather than editable creation controls.

### TW-02 — Execution-location choice is per thread

A new chat offers these execution locations:

- `New worktree` creates a distinct application-managed worktree and is the
  recommended default whenever the project supports it.
- `Local checkout` executes directly in the source checkout and clearly states
  that Pi sees the checkout's current files and local changes.

The application never silently falls back from a requested worktree to the
source checkout. Worktree creation is unavailable with a visible reason when
the selected project is not a Git working tree, has no committed `HEAD`, or
cannot otherwise provide a safe base. The user may then deliberately select
`Local checkout`.

The chosen execution location is immutable after thread creation. Existing
threads and imported native sessions remain shared threads; version 2 does not
move an existing conversation between execution locations.

### TW-03 — Clean start is the safe default

Every new isolated chat starts with `Clean start`, including after a prior chat
used local-change transfer. The application does not remember
`Include local changes` as a default. Changing the base resets the starting
state to `Clean start`.

A clean worktree is created from the exact committed object resolved for the
selected local base branch. Staged, unstaged, untracked, and ignored source files
are not copied or applied. The source checkout may be dirty; its state does not
prevent a clean worktree from being created.

The UI identifies the selected base branch and resulting worktree branch without
exposing absolute server paths. The application creates a unique namespaced
branch for the thread so commits remain reachable independently of the source
checkout's checked-out branch.

### TW-04 — Explicit local-change transfer

For an isolated chat based on the source checkout's current `HEAD`, the user may
explicitly choose `Include local changes`. This option is unavailable for a
different base because version 2 does not attempt to transplant local changes
onto a potentially conflicting commit.

Before submission, the starting-state control shows a status summary including
counts for staged, modified, deleted or renamed, and untracked items, and offers
a file-list review. The selected state remains visibly distinct in the toolbar.
If no transferable changes exist, the option is disabled with an explanation.

Transfer includes all of the following as one source snapshot:

- staged tracked changes, remaining staged in the worktree;
- unstaged tracked changes, remaining unstaged in the worktree;
- tracked additions, deletions, renames, and binary changes; and
- non-ignored untracked files, remaining untracked in the worktree.

Ignored files are always excluded in version 2. Empty untracked directories are
not transferred because Git does not represent directories independently.
Conflicted indexes, dirty submodule contents, unsafe filesystem entries, or
other states that cannot be reproduced without guessing block transfer with a
visible explanation; the application does not silently omit them.

If the source `HEAD` or transferable state changes after the displayed preflight,
submission fails safely and refreshes the summary instead of transferring an
unreviewed state. Transfer never stashes, resets, cleans, checks out, or otherwise
rewrites the source checkout. Failure never starts Pi in a partially prepared
worktree.

### TW-05 — One visible submission flow

Submitting the first message is one user action. The application provisions and
verifies the selected execution location before creating a durable usable thread
or starting Pi. The UI shows bounded progress while this occurs and preserves
the draft on failure.

A provisioning failure leaves the source checkout unchanged and produces a
safe, actionable error. If a worktree was created but cannot be cleaned up after
failure, the application records and surfaces a recovery item rather than
hiding or guessing about Git state. If location provisioning succeeds but the
first agent run is rejected or fails, the ready thread remains available with a
scoped run error and the user's accepted message is not duplicated on retry.

### TW-06 — Thread-scoped runtime, inspector, and terminal

For an isolated thread, Pi session creation/opening, Files, Changes, Git diffs,
and Terminal all use that thread's execution root. For a shared thread they all
use the source checkout. A browser cannot select or supply either absolute root.

Changes is labeled as the current thread workspace state, not as changes caused
exclusively by the thread. An isolated thread has its own terminal lifecycle. All
shared threads in one project retain the existing shared project terminal.

The existing one-running-run-per-thread rule remains unchanged in version 2.
Distinct threads in one project may continue running concurrently, whether they
use shared or isolated execution roots. This capability does not change that
lease policy or claim that concurrent shared-checkout runs are file-isolated.

### TW-07 — Worktree retention and unavailable state

The application stores enough private metadata to reopen an isolated Pi session
at the same execution root after browser and server restarts. It does not move a
ready worktree because native Pi history is bound to its working directory.

Server shutdown, project removal, and ordinary navigation never remove, prune,
reset, or clean a worktree or delete its branch. Removing a project from
navigation retains its worktrees alongside the retained thread metadata. If a
worktree is manually moved, removed, belongs to a different repository, or no
longer matches its stored identity, its thread becomes visibly unavailable and
other projects remain usable.

Version 2 does not provide destructive worktree or branch cleanup. Failed
provisioning may clean up only resources created by that unexposed provisioning
operation and only after proving their expected identity. Otherwise it retains
a visible recovery record.

### TW-08 — Safe Git and path behavior

The server chooses worktree paths and generated branch names. Browser requests
may choose only parsed product options and server-listed local base branches;
they never provide an absolute path or an unrestricted Git command.

Managed worktrees live outside the source checkout under application-owned
state. Registering a project subdirectory inside a larger repository preserves
that relative subdirectory as the isolated thread's execution root. A project
whose source checkout is itself a Git worktree is supported when its repository
identity and committed base can be established safely.

Application worktree operations invoke Git directly without a shell and do not
force through lock, branch, path, repository-identity, or concurrent-operation
conflicts. App-initiated worktree mutations are serialized per Git common
directory. Errors remain scoped and do not trigger broad automatic
`git worktree prune` or source-checkout repair.

### TW-09 — Prompt-derived thread and worktree names

The application generates one concise title from the user's first prompt and
uses it as the initial thread title. For an isolated thread, a sanitized slug of
the same title forms the human-readable portion of the generated worktree
directory and branch names. A server-generated unique suffix prevents collisions.
The model's text is never used directly as a path, ref, command, or identifier.

Naming uses one bounded, tool-free request to a configured lightweight Pi model.
In automatic mode, the application stays with the user's configured default Pi
provider and selects a lower-cost authenticated model from that provider; it
does not silently send the prompt to a different provider. A user may configure
an explicit naming model. The request receives only the first prompt and concise
formatting instructions, not project files, Git state, Pi history, tools,
extensions, skills, or workspace context.

A generated title is plain text, at most 60 characters, and normally three to
seven words. Model unavailability, timeout, malformed output, or absence of a
suitable smaller model never blocks thread creation: the server derives a safe,
deterministic short title from the prompt instead. The resulting title and
worktree name are stable across idempotent retries.

The user may rename the thread with the existing rename control. Renaming a
thread does not rename or move its worktree, directory, branch, or native Pi
session because those identities must remain stable after provisioning.

## Acceptance criteria

1. The New chat screen matches the agreed inline toolbar structure with
   execution location, starting state, and branch controls, no project or
   environment control, and a first-message composer.
2. A dirty Git project can create a clean isolated chat whose source checkout is
   byte-for-byte/status unchanged, whose worktree starts at the selected commit,
   and whose worktree status is clean.
3. `Clean start` is selected for every new isolated chat and excludes staged,
   unstaged, untracked, and ignored source state without using stash or another
   source-mutating operation.
4. Explicit transfer from the current `HEAD` reproduces staged, unstaged,
   deleted, renamed, binary, and non-ignored untracked state while excluding
   ignored files and preserving staged versus unstaged classification.
5. A changed preflight, conflicted index, dirty submodule, malformed Git output,
   provisioning failure, or transfer failure produces a visible error, starts no
   run in a partial worktree, and leaves the source checkout unchanged.
6. Selecting `Local checkout` clearly displays `Current local files`, and the
   resulting Pi runtime, inspector, and terminal use the registered source root.
7. Pi runtime, Files, Changes, diffs, and Terminal for an isolated thread all use
   its worktree execution root; no browser response exposes its absolute path.
8. Restarting the browser and server restores an isolated thread against the
   same verified worktree and branch; a missing or mismatched worktree affects
   only that thread.
9. Worktree mode is disabled with a reason for non-Git projects and repositories
   without a commit, with no silent fallback to shared mode.
10. Existing and imported threads remain compatible as shared threads after the
    metadata migration.
11. Removing a project or stopping the server leaves ready worktrees, branches,
    source files, and native Pi history intact.
12. Duplicate or retried first-message submission creates at most one worktree,
    branch, thread, accepted prompt, and run.
13. Paths containing spaces, a registered repository subdirectory, a source
    checkout that is itself a worktree, branch/path collisions, and concurrent
    creation requests all fail or succeed according to the same identity and
    no-force rules.
14. The existing one-running-run-per-thread constraint and concurrent-run
    behavior for distinct threads continue to apply across shared and isolated
    execution roots.
15. A new shared or isolated chat receives a concise initial thread title derived
    from its first prompt instead of `New thread`; an isolated chat uses a
    sanitized form of the same title plus a unique suffix for its worktree path
    and branch.
16. Naming uses only the first prompt and a configured lightweight model from the
    same provider by default; timeout, unavailable auth/model, malformed output,
    and duplicate submission produce the same safe deterministic fallback name
    without delaying or duplicating the thread.
17. Manually renaming a thread updates only its display title and leaves its
    worktree path, branch, and Pi session location unchanged.

## Non-goals

- Environment selection or environment provisioning.
- User-editable worktree names or automatic worktree/path/branch renaming after
  creation.
- Using project files, Git state, transcript history, tools, extensions, or
  skills as naming-model context.
- Copying ignored files, including ignored dependency/build trees or secrets.
- Selecting only some local changes for transfer.
- Applying source changes to a base other than the source checkout's current
  `HEAD`.
- Automatically merging, rebasing, cherry-picking, publishing, or copying an
  isolated thread's results back to the source checkout.
- Automatically deleting, pruning, moving, force-removing, or garbage-collecting
  ready worktrees or their branches.
- Moving an existing/imported Pi session between the source checkout and a
  worktree.
- Changing the existing per-thread run lease or concurrent-run policy.
- Claiming that a Git worktree is an OS security sandbox or prevents Pi tools
  from accessing paths outside the execution root.

## Open product questions

- None for the Current version 2 contract.

## Proposed revision v4 — Deferred same-worktree new chat

Version 4 keeps version 3's explicit context-reset workflow but changes when the
new durable conversation comes into existence. Exact `/new` moves the invoking
pane into a pending same-worktree composer. The application creates the thread,
native Pi session, and first run only after the user submits a real task prompt,
matching the ordinary split/new-chat lifecycle and avoiding abandoned empty
threads. The Current version 2 behavior above remains authoritative until this
proposal is approved, implemented, and verified.

### TW-10 — Exact `/new` application command

In an idle isolated-thread composer, entering exactly `/new` after surrounding
whitespace is trimmed and submitting it invokes an application command. The
application consumes the command; it never sends `/new` to Pi, records it in the
old native transcript, or treats it as a prompt, skill, extension command, or
prompt template.

Typing a slash exposes a compact command suggestion that identifies `/new` as
“New chat in this worktree.” The command has no arguments in version 4:
`/new anything` remains an ordinary Pi input rather than silently discarding or
moving the additional text. No equivalent header, sidebar, or confirmation
button is added.

The application verifies that the source has an available managed worktree and
no active sibling agent before leaving the source chat. When that check fails,
the user stays in the original chat, the command remains available to retry, and
a scoped explanation is shown. Every other composer submission, including every
other slash-prefixed value, retains Current Pi behavior.

### TW-11 — Pending chat first; durable chat on first prompt

A successful `/new` replaces the source chat in the invoking pane with a blank,
focused, pending same-worktree composer titled `New chat`. At command time the
application creates no thread, native Pi session, transcript, run, sidebar row,
or unread state. If the user never submits a task, no server-side conversation
artifact exists.

The pending pane retains only the source thread's opaque identity, first-prompt
creation identity, and its own unsent draft in parsed device-local browser
storage. It never retains or receives an
absolute path. Reloading the same browser may restore that pending pane, but it
is not a server-backed conversation and does not appear in thread navigation.
Closing the pane or replacing it with another thread discards the pending state
and its draft without archiving or deleting any server object.

The source thread, native session, transcript, runs, title, and unread state
remain untouched and reopenable through normal thread navigation. Submitting the
first ordinary prompt re-resolves the source's managed worktree server-side and
creates exactly one new persistent application thread and one new native Pi
session whose working directory is that same verified execution root.

`/new` is unavailable in a Local checkout/shared thread in version 4. The
application consumes the exact command there too, but returns a visible
“managed worktree required” explanation rather than passing it to Pi or silently
creating a different kind of chat.

### TW-12 — Files are continuity; conversation context is not

Entering the pending chat and submitting its first prompt perform no Git
checkout, branch, commit, stash, reset, clean, patch, copy, or file transfer. The
managed worktree, branch, index, tracked files, untracked files, and ignored
files stay byte-for-byte/status unchanged. A dirty worktree is allowed without
confirmation because the flow reuses those exact files rather than transferring
an inferred snapshot.

The new native session contains no messages, summary, generated handoff,
selected transcript excerpts, or hidden prompt from the source chat. Its only
initial conversation input is the task the user explicitly submits in the
pending composer. The user may ask the old agent to write a handoff and paste it
themselves, but the application does not generate or attach one.

### TW-13 — One active agent per reused managed worktree

The application refuses `/new` while the source thread or any sibling thread in
the same managed worktree has a running or prompt-preflight agent operation. It
checks the same condition again when the pending composer submits its first
prompt, because work may have started after the pane became pending. A busy,
missing, moved, non-ready, or repository-mismatched worktree leaves the pending
prompt retryable and creates no second run or fallback chat.

After continuation chats exist, at most one of their agent runs may be in
preflight or running at once. This worktree-scoped lease is limited to threads
that share one managed worktree. Current concurrency remains unchanged for
threads in distinct managed worktrees and for shared Local checkout threads,
which continue to use their existing thread-scoped run leases.

A terminal is not an agent run and does not block `/new` or a later prompt.
Existing terminals and panel tabs remain bound to the same execution scope and
are not restarted, retargeted, or closed by the pending transition or first
prompt.

### TW-14 — First-prompt creation, naming, idempotency, and recovery

The first ordinary prompt is the creation boundary. One submission creates or
recovers the new native session and application thread, derives the initial
title from that prompt under TW-09, accepts the prompt as the first run, and
replaces the pending pane with the resulting durable thread. There is no
server-side placeholder thread to rename before that submission. Naming never
renames or moves the reused worktree, branch, directory, or source native
session.

Duplicate submission, HTTP retry, browser reconnection, or server restart
creates at most one continuation thread, native session, accepted first prompt,
and run for one first-prompt creation identity. If failure occurs after native
session or thread allocation, retry recovers that same operation rather than
allocating another. A thread allocated after an explicit first-prompt attempt
may remain available if native prompt acceptance fails, consistent with TW-05;
the no-empty-thread guarantee applies to abandoning `/new` before any task is
submitted.

### Proposed acceptance criteria

1. In an idle isolated chat, typing exact `/new` and pressing Enter focuses a
   blank pending composer in the same pane and execution scope without creating
   a thread, Pi session, run, transcript, or sidebar row.
2. Closing or replacing an unused pending pane leaves no server-side artifact;
   its device-local pending state and draft are discarded, while a same-browser
   reload may restore them.
3. The exact command is absent from the old Pi transcript and every other slash
   input retains native Pi handling; `/new anything` is not intercepted.
4. The source chat remains reopenable with its complete history after the
   pending pane replaces it and after the continuation thread is eventually
   created.
5. The first ordinary prompt creates one durable thread and distinct native
   session at the source thread's verified execution root, starts the first run,
   and derives the initial title without a placeholder-thread phase.
6. Clean, staged, unstaged, untracked, and ignored worktree state is exactly
   unchanged by both `/new` and the first prompt, with no confirmation or
   transfer operation.
7. The new session receives no copied or generated conversation context; its
   only initial input is the user's first ordinary prompt.
8. `/new` in a shared Local checkout chat, or `/new`/first-prompt creation
   against an unavailable or busy managed worktree, fails visibly, never falls
   back, and preserves the appropriate source or pending composer for retry.
9. Two continuation siblings cannot enter prompt preflight or run concurrently;
   distinct managed worktrees and Local checkout threads retain Current
   concurrency behavior.
10. Existing terminals and panel tabs continue to identify the reused worktree
    as one execution scope across source, pending, and durable continuation
    states and remain alive and correctly labelled.
11. Duplicate/retried first-prompt submissions and interruption between native
    session creation, metadata attachment, prompt dispatch, and run acceptance
    recover to at most one continuation thread, session, accepted prompt, and
    run.

### Proposed non-goals

- Automatic context rollover based on token usage, conversation length, commits,
  or any other heuristic.
- Generated handoffs, transcript summaries, hidden prompts, copied messages, or
  automatic context selection.
- Arguments or an initial task on the `/new` line; the command is exact and
  opens a blank pending composer.
- A new-chat button, confirmation dialog, or workspace picker for this flow.
- A server-backed empty continuation thread before the first task prompt.
- Cross-device pending-pane synchronization or a sidebar entry for pending
  chats.
- Reusing a different thread's worktree, selecting from existing worktrees, or
  attaching an externally managed worktree.
- Running two agents concurrently in one reused managed worktree.
- Committing, cleaning, or otherwise preparing the worktree automatically.
- Same-checkout continuation from a shared Local checkout thread in version 4.

### Proposed open product questions

- None.
