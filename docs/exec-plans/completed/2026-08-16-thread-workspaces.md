# Thread workspace and worktree support

**Status:** Completed

**Plan version:** 2

**Technical approval:** Approved by the user on 2026-08-16 for plan version 2; plan version 1 was approved earlier that day and superseded before implementation after the current per-thread concurrency baseline was discovered

**Subsystem:** New-chat UI, prompt-derived naming, thread execution-root ownership, Git worktree provisioning, persistence, inspector, and terminal

**Affected paths or contracts:** `packages/contracts/src/**`, `packages/agent-runtime/src/**`, `packages/pi-adapter/src/**`, `apps/server/migrations/**`, `apps/server/src/config*`, `apps/server/src/db/**`, `apps/server/src/domain/**`, new `apps/server/src/worktrees/**`, `apps/server/src/inspector/**`, `apps/server/src/terminal/**`, `apps/server/src/app.ts`, `apps/web/src/api/**`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, package manifests and environment examples, tests under `apps/**` and `e2e/**`, component guides, architecture, and durable design documents

**Governing specification:** [Thread workspaces proposed version 2](../../product-specs/thread-workspaces.md)

**Related documents or issue:** [Initial agent workspace proposed version 2](../../product-specs/initial-workspace.md), [initial workspace active plan](../active/2026-08-15-initial-agent-workspace.md), [Parse, Don't Validate](../../architecture/data-boundaries.md), [application persistence](../../design/application-persistence.md), [runtime and Pi adapter](../../design/runtime-and-pi-adapter.md), [inspector and terminal boundaries](../../design/inspector-and-terminal.md), and [web workspace composition](../../design/web-workspace-composition.md)

**Last updated:** 2026-08-16

## Working specification and approval context

This plan implements [thread workspaces proposed version 2](../../product-specs/thread-workspaces.md). On 2026-08-16, the user explicitly approved product specification version 1 and technical plan version 1. Before production implementation began, the feature work was transferred to a dedicated worktree based on the current `main`, where investigation showed that the separately approved concurrent-thread slice had already replaced the project run lease with one-running-run-per-thread behavior. Specification and plan version 2 preserve that current baseline. The user explicitly approved both version 2 documents on 2026-08-16, and production implementation is active in the dedicated `feat/thread-workspaces` worktree.

The initial-workspace capability remains the Current implementation baseline even though its first specification is still marked in progress. This plan extends that baseline rather than silently adding worktree orchestration to the active initial-workspace plan, whose approved scope explicitly excludes Git writes and worktree orchestration. Existing threads, imported Pi sessions, one-run-per-thread coordination with concurrent distinct threads, loopback request policy, direct Pi execution, and path redaction remain compatible invariants.

## Purpose and user-visible outcome

A user starts a chat from a Codex-style inline composer, chooses a clean worktree or the current checkout, optionally and explicitly snapshots transferable local changes, and sends the first prompt. A bounded lightweight-model call summarizes that prompt once for the initial thread title and isolated-worktree slug, with a deterministic local fallback. A clean worktree never inherits source changes. An opted-in transfer reproduces supported staged, unstaged, and non-ignored untracked state without mutating the source checkout. Pi, Files, Changes, and Terminal then consistently use the thread's immutable execution root.

## Requirement traceability

| Spec requirement                                                                                      | Technical consequence                                                                                                                                                                                                                  | Verification                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [TW-01](../../product-specs/thread-workspaces.md#tw-01--inline-new-chat-configuration)                | Add a route-owned new-chat surface and parsed preflight client with four inline controls, no environment slot, accessible popovers, and read-only context on existing threads.                                                         | Web component tests and Playwright keyboard, narrow-screen, and visual-structure assertions.                              |
| [TW-02](../../product-specs/thread-workspaces.md#tw-02--execution-location-choice-is-per-thread)      | Add a nullable immutable worktree association to threads, capability preflight, no-fallback service rules, and a single execution-context resolver.                                                                                    | Contract, migration, service, non-Git/unborn-repository, and immutability tests.                                          |
| [TW-03](../../product-specs/thread-workspaces.md#tw-03--clean-start-is-the-safe-default)              | Resolve a server-listed branch to an immutable commit; create a unique branch/worktree outside the source tree; verify identity, commit, and clean status; reset browser choice on every new chat/project/base change.                 | Dirty-source byte/status preservation tests, command-recorder assertions, UI default/reset tests, and restart tests.      |
| [TW-04](../../product-specs/thread-workspaces.md#tw-04--explicit-local-change-transfer)               | Build a read-only, fingerprinted source snapshot containing separate staged/unstaged binary patches and contained non-ignored untracked entries; reject unsupported/raced state; apply and verify classification in the new worktree.  | Table-driven transfer fixtures for text/binary/add/delete/rename/untracked/ignored/conflict/submodule/race/failure cases. |
| [TW-05](../../product-specs/thread-workspaces.md#tw-05--one-visible-submission-flow)                  | Add a durable provisioning state machine, deterministic idempotency ownership, bounded progress, safe compensation, and create-then-prompt coordination that preserves the draft and makes failures recoverable.                       | Concurrent/retried/crash-point service tests and browser failure/retry E2E.                                               |
| [TW-06](../../product-specs/thread-workspaces.md#tw-06--thread-scoped-runtime-inspector-and-terminal) | Route all thread operations through a trusted execution context; make inspector endpoints thread-scoped and terminal ownership execution-scope-scoped while retaining per-thread run leases.                                           | Cross-root runtime/file/Git/PTY authorization tests and per-thread lease/concurrency regression tests.                    |
| [TW-07](../../product-specs/thread-workspaces.md#tw-07--worktree-retention-and-unavailable-state)     | Persist private identity, reconcile without broad mutation, retain ready worktrees on shutdown/removal, and surface missing/mismatched or failed-provision records.                                                                    | Restart, project removal/re-add, manual move/removal, repository mismatch, and byte-preservation tests.                   |
| [TW-08](../../product-specs/thread-workspaces.md#tw-08--safe-git-and-path-behavior)                   | Centralize direct-spawn Git execution, parse machine output, serialize mutations by canonical common directory, generate paths/branches server-side, preserve registered subpaths, and avoid force/prune behavior for ready worktrees. | Process-argv, hostile-path, spaces, nested-project, source-worktree, lock/collision, and concurrent-operation tests.      |
| [TW-09](../../product-specs/thread-workspaces.md#tw-09--prompt-derived-thread-and-worktree-names)     | Add an SDK-neutral naming service backed by one tool-free `ModelRuntime.completeSimple()` call to a configured lightweight model, strict output parsing, deterministic fallback, slug construction, and stable retry persistence.      | Fake-model, timeout/auth/error/malformed-output, sanitization, collision, retry, provider-selection, and rename tests.    |

## Current behavior and affected invariants

The implemented baseline has one canonical path on each project and no execution-location abstraction:

- `WorkspaceService.createThread()` creates a Pi session with the project's canonical root and then inserts thread metadata.
- `WorkspaceService.openRuntime()` always opens a session with `requireProjectRoot(projectId)`.
- Files, Git status/diff, and terminal routes accept only a project ID and resolve that same project root.
- `ProjectTerminalManager` owns one process per project ID.
- The project sidebar `+` immediately creates an empty thread titled `New thread`; there is no new-chat route, first-message creation surface, or prompt-derived naming service.
- `threads` already stores a mutable display title but has no worktree relationship; migration version 2 is current after the thread-run lease migration, and receipts represent only completed accepted commands.
- `apps/server/src/inspector/git.ts` has a private bounded read-only Git runner and porcelain-v2 status parser; no component owns Git mutations or repository/worktree identity.
- Pi session discovery/opening deliberately verifies the supplied cwd, so changing a thread's execution root after session creation would make native history ownership invalid.

The following existing invariants must survive:

- Browser contracts use opaque IDs and never expose or accept authoritative absolute project, worktree, Git-common-directory, or native Pi-session paths.
- Runtime types stay SDK-neutral; only `packages/pi-adapter` owns Pi SDK objects.
- Every database row, HTTP payload/response, Git output, and filesystem value is parsed at its read/entry boundary.
- Project removal is metadata-only and never deletes source files or native Pi history.
- The one-running-run-per-thread database and in-process lease, including concurrent runs in distinct threads of one project, remains unchanged.
- Git and filesystem processes are spawned without a shell; file containment is canonical rather than lexical.
- Tests write only to generated temporary databases, repositories, worktrees, state directories, and Pi fixtures. They never write through `.env` or `.env.*` database/state configuration.

## Scope, non-goals, assumptions, and unresolved technical decisions

### Scope

- Executable shared contracts for workspace choices, repository/base preflight, local-change summaries/fingerprints, thread workspace DTOs, provisioning/start responses, and thread-scoped terminal frames.
- Metadata migration v3 and runtime parsers for app-managed worktrees, provisioning lifecycle, thread association, and creation idempotency/recovery.
- A reusable process runner plus a narrowly owned Git worktree manager, repository parser, source-snapshot builder, and execution-context resolver.
- Clean worktree creation from a selected server-listed local branch and exact commit.
- Explicit source snapshot and transfer for staged, unstaged, binary, deletion/rename, and non-ignored untracked state, with ignored and unsupported state rejection rules.
- One new-chat UI action that generates a stable title/worktree slug, provisions a location, and submits the first prompt with stable idempotency and visible progress/failure recovery.
- A bounded prompt-naming service using a configured lightweight Pi model from the default provider, plus a deterministic no-model fallback and strict title/slug construction.
- Thread-root adoption by Pi runtime, Files, Changes, Git diff, and Terminal.
- Restart reconciliation, source/worktree identity checks, project removal retention, and failed-provision recovery diagnostics.
- Unit, integration, browser, E2E, migration, race, and source-preservation coverage plus implemented architecture/design/component documentation.

### Non-goals

The complete product non-goals in the governing specification apply. Technically, this plan also excludes:

- A generic job queue or distributed worktree coordinator; one local server process and SQLite are the ownership boundary.
- Replacing Pi persistence or copying Pi JSONL between cwd namespaces.
- General arbitrary-ref checkout, remote-branch fetching, network Git operations, merge/rebase/cherry-pick/publish, or source-update automation.
- Selective transfer, ignored-file transfer, dirty-submodule replication, or conflict resolution.
- Destructive cleanup UI for ready worktrees/branches and broad `git worktree prune`.
- A naming-model selector in the new-chat toolbar, naming from project/workspace contents, or model-generated raw Git refs/paths.
- Renaming/moving worktrees when a user later renames a thread.
- A new frontend state framework or global new-chat selection state; route and TanStack Query ownership remain.
- Changes to the current per-thread run lease or distinct-thread concurrency policy; worktree execution contexts do not redefine run ownership.

### Assumptions

- The installed Git supports `git worktree`, porcelain-v2 NUL status, and the direct commands proven by startup/preflight. Unsupported Git versions disable isolated mode visibly.
- A managed worktree path can be created under `<stateDirectory>/worktrees/<projectId>/<worktreeId>` with user-only state-directory permissions.
- Local branch names are displayable but still parsed and resolved server-side; they are never concatenated into a shell command.
- Source patches and untracked snapshots are staged under an app-owned temporary provisioning directory and removed after success/failure. Patch generation and application stream through bounded process adapters rather than loading unrestricted output into browser memory.
- Git filters and normal checkout behavior may materialize committed content. Post-creation status and identity, rather than byte equality with Git objects, define a valid clean checkout.
- `PI_WEB_NAMING_MODEL`, when configured, is parsed as an explicit `provider/model` override. Without it, automatic selection considers only authenticated models from Pi's configured default provider and chooses a lower-cost model than the default; it never crosses providers silently.
- Naming uses no AgentSession, persistent session, tools, ResourceLoader, extensions, skills, project files, or network catalog refresh. It is one `ModelRuntime.completeSimple()` request with reasoning off, a small output-token limit, no cache retention, and an application deadline.
- If no suitable lower-cost model is available, or the bounded call fails, deterministic local prompt summarization is the normal fallback and thread creation continues.
- The first prompt can fail after a ready thread exists. That failure is represented as a scoped thread/run error; location provisioning itself must finish before Pi starts.

### Unresolved technical decisions

None. Material discoveries that require changing the schema, provisioning state machine, source-transfer semantics, API orchestration, or recovery policy will increment the plan version and require renewed technical approval; product-impacting changes will also return the specification to Draft.

## Technical approach

### Execution-context ownership

Add a server-only `ThreadExecutionContextResolver` as the single authority for thread cwd selection. It parses project/thread/worktree rows, verifies ownership and current availability, canonicalizes the stored root, and constructs a trusted context containing project/thread IDs, `shared` or `isolated_worktree` mode, execution-scope ID, execution root, optional worktree root, Git common directory, base commit, and generated branch.

A shared context derives its execution root from the project record and uses a project-scoped terminal key. An isolated context derives it from its worktree record and uses a worktree-scoped terminal key. No runtime, inspector, or terminal caller branches directly on nullable database fields or consumes raw stored paths.

### Persistence and migration v3

Add a `thread_creation_operations` table for both shared and isolated first-message flows with:

- opaque operation ID, owning project ID, unique idempotency key, and canonical request hash;
- requested location/base/source-change mode in parsed columns;
- `naming`, `provisioning`, `session_created`, `thread_created`, `prompt_accepted`, or `failed` lifecycle state;
- generated/fallback title and sanitized slug once naming settles;
- deterministic prompt command ID and nullable worktree, runtime-session, thread, and run result references;
- timestamps and bounded failure category/message.

Add a `worktrees` table with:

- opaque ID, owning project ID, and creating-operation relationship;
- `provisioning`, `ready`, or `failed` lifecycle state;
- private execution-root, worktree-root, and Git-common-directory paths;
- repository-relative project subpath;
- selected base-ref display name and exact base commit;
- generated branch name;
- timestamps and bounded failure category/message.

Add nullable `threads.worktree_id` with a foreign key and a unique index so an isolated worktree belongs to at most one thread. Existing rows remain null and therefore shared. The creation-operation row makes a generated title and downstream IDs stable before any external Pi/Git side effect in either mode; final command receipts continue serving completed replay responses. Row schemas enforce lifecycle-dependent nullability after raw SQL selection; static Drizzle inference is not trusted.

Migration v3 uses the existing user-version/backup policy, upgrades only test-owned fixtures during tests, and does not inspect or alter any Git repository. Code rollback against schema v3 fails with newer-schema recovery guidance rather than down-migrating.

### Git process and repository boundary

Extract the current Git spawn mechanics into an injectable `GitProcessRunner` with per-command timeout/output policy, minimal noninteractive environment (`GIT_TERMINAL_PROMPT=0`, no pager/color, stable locale), no shell, and bounded stderr diagnostics. Read-only inspector commands and mutating worktree commands use purpose-specific wrappers over the runner rather than sharing unparsed `ProcessResult` values.

`GitWorktreeManager` parses:

- working-tree availability;
- top-level and canonical Git common directory;
- repository-relative project subpath;
- local branches/current branch and exact commit OIDs;
- porcelain-v2 NUL status including submodule/conflict metadata; and
- worktree registration/identity output.

The manager serializes app-initiated mutation sections by canonical Git common directory. It derives an ASCII slug from the trusted generated/fallback thread title, appends a short opaque-ID suffix, and creates a deterministic managed directory plus unique `pi/<title-slug>-<short-id>` branch with `git worktree add --no-track -b ... <exact-oid>`, never `--force`. It verifies the generated path, common directory, `HEAD`, branch, execution subpath, and expected status before returning a trusted ready value.

The source checkout is observed before and after provisioning in integration tests and is never the cwd of a state-mutating checkout/stash/reset/clean command. Worktree registration and generated branch refs necessarily update common Git metadata; that bounded effect is recorded explicitly.

### Preflight and local-change snapshot

A parsed preflight endpoint returns only safe repository capability, server-listed local branch names/current selection, short commit display, transferable-status counts/file labels, unsupported reasons, and an opaque source-state token. It returns no absolute paths, raw patch bytes, or unrestricted refs.

For `sourceChanges: none`, the coordinator captures the selected branch's exact OID, provisions the worktree, and requires clean porcelain status.

For `sourceChanges: tracked_and_untracked`, the selected base must still equal source `HEAD` and the supplied token must match a fresh preflight. Under the repository mutex, the snapshot builder:

1. verifies no unmerged index or dirty submodule state;
2. captures the exact base OID and parsed porcelain-v2 status;
3. streams a full-index binary staged patch relative to `HEAD` into app-owned temporary storage;
4. streams a separate full-index binary unstaged patch relative to the index;
5. snapshots each non-ignored untracked entry using strict repository-relative paths, no-follow handling, metadata parsing, and symlink-target copying rather than following an external target;
6. repeats the source fingerprint and rejects a race instead of guessing; and
7. emits a trusted manifest whose contents and digests correspond to the reviewed token.

After creating the clean target, apply the staged patch with index preservation, apply the unstaged patch without staging it, materialize untracked manifest entries, and compare parsed destination status/classification to the manifest. Any mismatch fails provisioning. Ignored entries are never enumerated for transfer.

A provisioning target is not exposed to Pi, a terminal, or browser filesystem APIs until all checks pass. Compensation may remove only an unexposed path/registration and generated ref whose exact stored identity still matches the operation. Compare-and-delete is used for a generated ref. If identity cannot be proved or cleanup fails, persist `failed` and surface recovery; never broaden cleanup to a ready worktree or source checkout.

### Prompt-derived naming

Add an SDK-neutral `ThreadNamingService` contract beside the agent-runtime interfaces and implement it in the Pi adapter. The implementation creates/restores `ModelRuntime` and Pi settings without creating an AgentSession or loading project resources. A parsed optional `PI_WEB_NAMING_MODEL=provider/model` selects an explicit available model. Automatic mode reads Pi's configured default provider/model and ranks authenticated models only within that provider by declared cost, requiring the selected candidate to be cheaper than the default. Stable ID ordering breaks equal-cost ties. It performs no model-catalog network refresh.

The request context contains only a fixed system instruction and the bounded first prompt, has no tools, disables reasoning and prompt caching, caps output at 32 tokens, and uses a five-second application abort deadline. The returned Pi AI assistant message is untrusted: require a successful stop, exactly one non-empty text result, no tool calls, one line, normalized whitespace, and a title of at most 60 characters. Strip surrounding quote/markdown punctuation only through explicit normalization; reject rather than guess on any other shape.

A server-owned deterministic fallback extracts and normalizes a short title from the prompt without model access. Both model and fallback output pass through the same `ThreadTitle` constructor. A separate `WorktreeSlug` constructor transliterates/normalizes to lowercase ASCII `[a-z0-9-]`, collapses separators, supplies a fixed fallback token when needed, truncates before a mandatory short ID suffix, and is the only value used in managed paths/refs. The idempotent creation operation persists/returns the chosen thread title and derived branch/path identity so retries never make another naming request or produce another name. Manual thread rename updates only `threads.title`.

### Creation and idempotency coordinator

Introduce `ThreadCreationCoordinator` rather than embedding filesystem state transitions in Fastify routes or continuing to grow `WorkspaceService.createThread()`.

The coordinator uses the request idempotency key and hash as durable provisioning ownership. A retry with the same key/hash resumes or returns the same worktree/thread/run result; conflicting reuse returns the existing idempotency conflict. State is persisted before the first Git mutation. Worktree path, branch, base, and IDs are deterministic from the stored operation.

The visible Send action performs these ordered stages:

1. verify preflight and preserve the browser draft;
2. generate or deterministically derive the title once and persist it with the creation operation;
3. provision or resolve the shared execution context using the derived worktree slug when applicable;
4. create and durably record the Pi session for the trusted execution root and generated title;
5. atomically insert the titled thread association and complete the creation receipt;
6. submit the first prompt with its own deterministic idempotency key through the existing prompt acceptance/run transaction; and
7. navigate to the thread and clear the draft only after accepted outcomes are known.

A Pi rejection after step 4 leaves one ready thread with a scoped error and permits a deliberate retry; it does not recreate the worktree/session/thread. Crash-point tests cover every persisted transition. Startup reconciliation parses provisioning rows and current Git state but performs no broad automatic mutation; same-command retry or an explicit recovery path completes safe work.

### API, runtime, inspector, and terminal

Add parsed endpoints for new-chat preflight and creation/start. Thread summaries/snapshots gain a safe workspace summary. Existing create-thread callers are migrated to the new contract; session import explicitly creates shared thread metadata.

Thread-view file and Git endpoints become project-and-thread scoped and resolve `ThreadExecutionContext`. Project-only legacy inspector endpoints may remain temporarily for a project with no selected thread only if characterized and documented; they cannot be used by an isolated thread. Browser query keys include thread identity.

`WorkspaceService.createThread/openRuntime/snapshot` receives trusted execution roots from the resolver/coordinator. The runtime session `create` operation accepts the parsed generated title so native Pi session info no longer says `New thread`. A separate SDK-neutral naming interface is added to `packages/agent-runtime`; `packages/pi-adapter` alone owns `ModelRuntime`, Pi settings/model resolution, Pi AI response narrowing, and provider credentials. No SDK model or message type crosses packages.

Terminal frames add thread ownership or an opaque execution-scope identifier tied to project/thread lookup. `ProjectTerminalManager` becomes execution-scope keyed: shared threads in one project resolve to the same key, while each isolated worktree resolves to its own key. A terminal cannot attach until the context is ready and currently valid.

### Browser composition

Add `/projects/:projectId/new` as the route-owned new-chat screen. The project sidebar `+` navigates there instead of immediately creating a thread. The center renders the agreed compact toolbar:

```text
[Project] [New worktree | Local checkout] [Clean start | Include local changes | Current local files] [Branch]
[First-message composer]
```

The starting-state popover displays parsed counts and a reviewable relative file list, explains ignored-file exclusion, and uses a non-color cue plus accessible label. `Clean start` is component state initialized on each new route and reset on project/base changes; `Include local changes` is never persisted as a preference. Local checkout makes starting state read-only. Non-Git/unborn/unsupported states disable worktree mode with a reason and never auto-select local checkout after the user requested isolation.

Submitting shows naming/provisioning stages, disables duplicate actions while preserving the text draft, handles stale-preflight refresh, and navigates only to the returned titled thread. Naming has no toolbar control. Existing thread headers render the generated or user-renamed title plus read-only mode/branch context; later thread rename never changes worktree identity. Responsive and keyboard behavior follows the current drawers/focus design without a new global store.

## Implementation milestones

### Milestone 1 — contracts, characterization, and migration

- Add failing contract tests for all workspace choices, strict discriminated requests, preflight/summary/start responses, safe branch/commit labels, source-state tokens, and updated terminal frames.
- Characterize existing `New thread` naming, thread rename, native Pi session naming, thread creation, Pi cwd, project inspector roots, terminal sharing, idempotency, project removal, and per-thread run leases/concurrency before changing them.
- Add migration-v3 tests for empty-to-v3 and v2-to-v3 upgrade, repeated startup, backup, newer-version refusal, null existing-thread associations, creation-operation/worktree lifecycle row parsing, relationship corruption, and unique idempotency/worktree ownership.
- Implement schema/store changes and parsed repository methods only after tests fail correctly.

### Milestone 2 — Git runner, repository parser, and clean worktrees

- Extract/inject the process runner while keeping inspector behavior green.
- Add generated-repository fixtures for dirty source trees, local branches, detached/source-worktree cases, nested project roots, no `HEAD`, spaces/unusual names, branch/path/common-dir conflicts, locks, timeouts, malformed/truncated output, and concurrent requests.
- Implement repository/base preflight, title-slug plus opaque-suffix managed path/branch construction, per-common-directory mutex, clean creation, postcondition verification, and identity-limited compensation.
- Assert exact argv contains no shell, stash, reset, clean, source checkout, force, prune, network, or user-supplied path interpolation.

### Milestone 3 — source snapshot and explicit transfer

- Add fixtures for staged-only, unstaged-only, both states on one file, additions, deletions, renames, copies as represented by Git, executable bits, symlinks, binary content, non-ignored untracked files, ignored files, empty directories, conflicts, dirty submodules, disappearing/retargeted files, and source changes during capture.
- Implement fingerprinted preflight and temporary manifest/patch construction without source mutation.
- Apply staged then unstaged patches and contained untracked entries; compare destination parsed status and content digests to the trusted manifest.
- Prove failure starts no runtime, source bytes/status remain unchanged, temporary data is removed, and uncertain cleanup becomes a parsed failed record.

### Milestone 4 — naming, execution resolver, creation coordinator, and runtime adoption

- Add fake-model naming tests for explicit model resolution, automatic same-provider lower-cost selection, no cross-provider fallback, no network refresh, bounded tool-free context, timeout/abort, auth/provider error, malformed/multi-block/tool-call output, deterministic fallback, Unicode/punctuation/long prompt normalization, slug collision resistance, and no prompt/file leakage.
- Add resolver tests for shared/isolated, project/thread mismatch, malformed rows, unavailable/moved/symlinked/repository-mismatched worktrees, project subpaths, and removed projects.
- Add durable coordinator tests for duplicate/concurrent keys, one naming call, stable fallback/name on retry, hash conflict, every crash transition, Git failure, runtime-create failure, prompt reject/fail/accept, and retry after ready-thread creation.
- Route titled Pi create/open/snapshot through trusted contexts while retaining shared imports, manual thread rename, stable worktree identity, and the per-thread run lease/concurrent distinct-thread behavior.
- Add restart tests proving blank and prompted Pi sessions reopen only with their original worktree cwd/name and missing worktrees remain thread-scoped diagnostics.

### Milestone 5 — thread-scoped inspector and terminal

- Add API ownership tests proving isolated file/Git requests cannot read the source or another worktree and shared requests retain existing behavior.
- Change thread-view routes and browser clients/query keys to include project/thread ownership.
- Rekey PTYs by trusted execution scope and test shared-project reuse, isolated separation, cross-thread rejection, unavailable contexts, project removal retention/termination semantics, and server shutdown.
- Update Changes labels and terminal warnings without attributing changes exclusively to a thread or claiming sandboxing.

### Milestone 6 — Codex-style new-chat UI

- Add role/name-driven component tests for toolbar ordering, omitted environment control, default/reset behavior, local-checkout read-only state, branch availability, summaries/file review, ignored warning, unsupported reasons, stale preflight, naming/provisioning progress, generated-title rendering, preserved draft, duplicate-send prevention, and read-only existing-thread context.
- Implement the route, query/mutation clients, inline controls/popovers, composer, responsive styles, focus behavior, and navigation.
- Add accessibility checks for keyboard operation, focus restoration, expanded state, status text independent of color, progress announcements, and narrow-screen behavior.

### Milestone 7 — recovery, E2E, and durable documentation

- Add restart/re-add/missing-worktree/failed-provision E2E using only temporary state and repositories.
- Exercise clean and transferred creation through the browser and assert runtime, Files, Changes, and Terminal observe the intended root.
- Verify source status and cryptographic file fixture hashes before and after all successful/failing scenarios.
- Update architecture, persistence/runtime/inspector/web designs, component READMEs, migration documentation, and current specification only after behavior is implemented and verified.
- Run the full verification matrix, record omitted platform/Git-version checks and residual risk, promote the specification, and archive this plan.

## Untrusted-data-boundary analysis

| Source and raw representation                                              | Entry/read point                                        | Runtime parser                                                                                                                    | Trusted output and guarantees                                                       | Failure behavior                                                                     | Boundary tests                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| New-chat project/location/start/base/token/prompt JSON                     | preflight/start Fastify routes                          | strict shared Zod request schemas plus project ownership lookup                                                                   | known product option, bounded prompt, opaque IDs, and selected project relationship | stable 400/404/409; no path/Git leakage or fallback                                  | valid modes, extra/missing/wrong fields, malformed IDs/token/ref, cross-project, oversized prompt                              |
| Preflight/start HTTP responses                                             | browser API client                                      | shared response schemas                                                                                                           | bounded safe labels/counts/relative paths and thread/run result                     | scoped protocol error; preserve draft                                                | valid, malformed, missing discriminator, oversized arrays/labels, leaked-path fixture assertion                                |
| Browser route and transient selection                                      | `/projects/:projectId/new` and component state          | branded route parser and closed UI enums                                                                                          | selected project and nonpersisted clean/include choice                              | not-found/reset clean; never infer local checkout                                    | malformed route, removed project, navigation/project/base reset, refresh                                                       |
| Thread-creation operation and worktree database rows                       | every store/coordinator/resolver/reconciler read        | table-specific Zod row schemas plus lifecycle constructors                                                                        | relationship-consistent idempotency/title/result and worktree lifecycle records     | scoped corrupt/failed record; no model/Git/Pi mutation                               | valid each state, null/wrong enum/path/OID/ref/title/time, dangling relationships, lifecycle mismatch                          |
| Stored absolute worktree/common/execution paths                            | resolver and worktree manager                           | absolute-path constructor, lstat/realpath, containment and repository identity parser                                             | canonical app-owned managed root and expected Git relationship                      | unavailable/mismatch diagnostic; no alternate-path guess                             | missing/moved/symlink/retarget/outside state/wrong repo/subpath missing                                                        |
| Git version/repository/ref/common-dir stdout                               | repository preflight                                    | command-specific strict text/NUL parsers and OID/ref constructors                                                                 | supported repository identity and exact local base                                  | isolated mode unavailable or command failure                                         | non-Git, unborn, detached, SHA-1/SHA-256-shaped OID, malformed/multiple/truncated output, spaces/newlines                      |
| Git porcelain-v2 NUL status                                                | preflight/snapshot/postcondition                        | exhaustive record parser including XY/submodule/unmerged/untracked forms                                                          | normalized relative entries and transfer support classification                     | reject malformed/unsupported; no partial transfer                                    | every record type, rename extra record, odd filenames, ignored omission, conflict/submodule/malformed UTF-8 policy             |
| Git worktree-list/add/apply process result                                 | worktree manager                                        | operation-specific exit/stdout/stderr parser plus filesystem postcondition                                                        | exact registration, branch, commit, and target state                                | bounded safe error; identity-limited compensation or failed recovery row             | success, nonzero, signal, timeout, output cap, hooks/filter dirtiness, collision/lock/concurrent external change               |
| Generated staged/unstaged patch bytes                                      | app-owned temporary snapshot and `git apply` stdin/file | snapshot manifest digest/size constructor and Git apply postcondition                                                             | immutable bytes tied to base/fingerprint; never browser content                     | abort and remove temp; no runtime; uncertain target retained as failed               | empty/text/binary/large/split output, corrupt patch, apply failure, digest mismatch                                            |
| Untracked source path and filesystem entry                                 | snapshot builder                                        | Git-relative path parser, canonical source containment, lstat/type parser, no-follow copy and digest                              | contained non-ignored regular file or symlink snapshot                              | reject escape/race/unsupported type; no guessed omission                             | spaces/newlines, symlink in/out, FIFO/socket/device, disappear/change, directory, permission, binary/large                     |
| Source-state token returned by browser                                     | start coordinator                                       | bounded opaque token parser plus recomputed fingerprint equality                                                                  | user reviewed the exact current transferable state                                  | 409 stale-source response with refreshed preflight                                   | same, changed HEAD/index/worktree/untracked, forged/malformed/old-project token                                                |
| Thread/worktree/project IDs on inspector/terminal                          | HTTP routes and terminal frames                         | branded IDs, relationship lookup, `ThreadExecutionContextResolver`                                                                | one ready execution scope and currently valid root                                  | 404/409/error frame; no source/other-thread fallback                                 | shared/isolated, cross-project/thread, missing/failed/removed/malformed records                                                |
| Filesystem and Git data under execution root                               | existing inspector boundaries after resolver            | existing relative path/file/Git parsers against trusted root                                                                      | bounded contained thread-workspace DTO                                              | existing scoped file/Git errors                                                      | source-versus-worktree sentinel files, traversal/symlink races, malformed Git output                                           |
| Pi SDK session listing/open behavior for worktree cwd                      | Pi adapter create/open/discover                         | existing adapter parsers and cwd ownership checks                                                                                 | session belongs to exact execution root                                             | thread-scoped unavailable/malformed error                                            | create/restart/open, wrong source/worktree cwd, missing session, source import compatibility                                   |
| Naming-model configuration string                                          | parsed server startup configuration                     | optional strict `provider/model` constructor                                                                                      | explicit model selector or automatic same-provider policy                           | startup error for malformed explicit value; no credential logging                    | absent/valid/malformed/unknown provider/model and unavailable-auth cases                                                       |
| Pi settings, model catalog, auth availability, and assistant naming result | Pi adapter naming boundary                              | `SettingsManager` getters, `ModelRuntime` availability/model lookup, assistant stop/content parser, and `ThreadTitle` constructor | one bounded title from an allowed lightweight model, or typed fallback cause        | deterministic local fallback; never expose model error/credentials or block creation | same/different provider, lower/equal cost, no default, timeout/auth/error/abort, text/thinking/tool/multiple/empty/long output |
| Derived worktree slug                                                      | server naming/worktree boundary                         | `WorktreeSlug` constructor plus opaque suffix constructor                                                                         | bounded ASCII path/ref component not equal to raw model text                        | fixed safe fallback slug; no direct Git use of malformed text                        | Unicode, punctuation, traversal/ref metacharacters, empty, reserved, long, duplicate titles                                    |
| Provisioning progress/failure payload                                      | service-to-route/browser response                       | closed internal state mapper then shared DTO parser                                                                               | safe naming/provisioning stage and categorized message with no native paths/stderr  | generic scoped failure/recovery item                                                 | each stage/failure, malformed stored message, absolute path/stderr redaction                                                   |

Authorization remains separate from parsing. A syntactically valid branch, token,
relative path, or opaque ID is rejected unless it belongs to the selected project,
current source state, and requested thread/worktree relationship.

## Touched-legacy-code analysis

- **Thread creation and naming:** Existing callers expect an immediately created empty thread titled `New thread`, and `PiAgentRuntime.create()` writes the same native session-info name. Characterize current idempotency/session materialization and rename behavior first. The new sidebar flow moves to a first-message action that generates one parsed title before location/session creation; session import retains its descriptor-derived shared-thread title. Keep a narrow server helper only if tests or compatibility require programmatic empty shared-thread creation.
- **Project-root resolution:** `WorkspaceService.requireProjectRoot()` currently serves runtime, inspector, and terminal. Preserve it for project registration/preflight and shared resolution, but prohibit direct use for an isolated thread through focused tests and code ownership. New thread operations consume only `ThreadExecutionContext`.
- **Pi sessions:** The adapter's cwd-list/open verification is deliberate and remains unchanged. Add worktree fixtures rather than relaxing ownership or moving JSONL.
- **Inspector Git runner/parser:** Preserve existing status/diff output and limits while extracting process ownership. Add characterization tests before changing visibility or parser fields; do not make mutating methods available from inspector modules.
- **File routes:** Existing project-scoped endpoints are public application contracts. Migrate thread-view clients to thread-scoped routes and either retain documented project-only behavior or remove it in the same approved version with tests; never let an isolated UI accidentally call the legacy route.
- **Terminal manager:** Existing one-per-project behavior remains for shared contexts. Change its internal key to a branded execution-scope value and prove all shared threads map to the original project key.
- **Database migration:** Existing v2 projects/threads/runs/receipts and parsed read behavior remain. New creation-operation rows exist only for new first-message flows, and the nullable worktree association avoids inventing worktrees for old rows. Update migration runner/version tests instead of rewriting migration 1.
- **Run lease:** `activeThreads`, preflight ownership, and the partial unique index remain thread-scoped. Worktree IDs do not enter run uniqueness in version 2, and distinct threads in one project remain concurrently runnable.
- **Browser drafts/routes:** Existing per-thread drafts remain. The new-chat draft uses project/new-route-scoped local state with an explicit parser if persisted; risky include selection is never persisted. Existing project/thread routes and independent-tab behavior remain.

Unrelated restructuring of the large `App.tsx` or `WorkspaceService` is out of scope except extraction needed to establish these ownership boundaries. Refactors must be behavior-covered and incremental.

## Verification

Focused commands during implementation:

```sh
pnpm vitest run packages/contracts
pnpm vitest run packages/agent-runtime
pnpm vitest run packages/pi-adapter
pnpm vitest run apps/server/src/db/store.test.ts
pnpm vitest run apps/server/src/worktrees
pnpm vitest run apps/server/src/domain
pnpm vitest run apps/server/src/inspector
pnpm vitest run apps/server/src/terminal
pnpm vitest run apps/server/src/app.test.ts
pnpm vitest run apps/web/src/App.test.tsx
pnpm vitest run apps/web/src/features
```

Package and integration gates:

```sh
pnpm --filter @pi-web/contracts typecheck
pnpm --filter @pi-web/server typecheck
pnpm --filter @pi-web/web typecheck
pnpm test:integration
pnpm test:e2e
pnpm docs:check
pnpm check
```

Recorded runtime checks use only generated temporary repositories and app state:

1. Create a source repository with committed files plus staged, unstaged, binary,
   renamed/deleted, non-ignored untracked, and ignored fixtures; record status,
   hashes, branch, index tree, and `HEAD`.
2. Through the browser create a clean thread and prove its generated prompt-summary
   title, sanitized/suffixed directory and branch, branch/commit/status, runtime
   cwd, Files, Changes, and Terminal root while the source observations remain
   unchanged. Repeat with model success, model failure, and duplicate submission.
3. Create a transferred thread and prove destination content/status
   classification, ignored exclusion, and unchanged source observations.
4. Restart browser/server over the same temporary state and native Pi fixtures;
   reopen both threads and repeat root/identity assertions.
5. Exercise stale preflight, conflict, dirty submodule, Git lock/collision,
   transfer failure, duplicate submission, and injected crash points; prove no
   duplicate worktree/branch/thread/prompt/run and no hidden partial ready state.
6. Remove and re-add the temporary project; prove ready worktrees and branches
   remain and unavailable/failed records are scoped.

No check uses a real user project, configured database, configured state directory,
or writable native Pi session. A manual smoke against an explicitly disposable
repository may occur only with separate user permission and is reported
separately.

## Compatibility, deployment, migration, recovery, and rollback

- Migration v3 adds empty thread-creation-operation/worktree tables, backs up a
  non-empty v2 database before applying, preserves every existing thread as
  shared (`worktree_id = NULL`), and parses all new rows on read. It never calls
  a model or creates, scans, or mutates Git worktrees during migration.
- An older binary seeing schema v3 refuses startup with existing newer-version
  recovery guidance. Rollback is code plus restoration of the pre-v2 database
  backup; it does not delete managed worktree directories or branches.
- API changes are application-local but still parsed public contracts. Browser
  and server deploy together; stale browser responses receive a scoped protocol
  error and refresh rather than path fallback.
- Production defaults create managed paths only under the existing secure state
  directory. Naming may make one bounded provider request using existing Pi
  credentials; `PI_WEB_NAMING_MODEL` can select an explicit model, automatic mode
  stays with the configured default provider, and deterministic fallback requires
  no provider. No new network listener, credential store, cloud dependency, model
  catalog refresh, or remote Git access is introduced.
- Startup reconciliation is read-mostly: parse records and inspect exact expected
  paths/registrations. It does not run broad prune, force removal, reset, clean,
  merge, or source repair.
- A failed provisioning operation is retryable by the same command when identity
  remains provable. Uncertain resources stay recorded for recovery. A ready
  worktree is never automatically deleted by rollback, shutdown, or project
  removal.
- If source branches advance after creation, existing worktrees remain anchored
  to their recorded branch/commit and continue normally. No automatic rebase or
  update occurs.
- Worktree availability does not imply sandboxing; existing direct-execution and
  terminal warnings remain visible.

## Progress

- [x] Investigated the current product specification, architecture, persistence,
      runtime, inspector/terminal and web-composition designs, active plan, contracts,
      migration, store, workspace service, Git inspector, API client, UI, and tests.
- [x] Agreed the Codex-style inline toolbar, omitted environment control, clean
      default, explicit local-change transfer, ignored-file exclusion, and local
      checkout disclosure with the user.
- [x] Added prompt-derived initial thread/worktree naming using one configured
      lightweight model call, same-provider automatic selection, strict parsing,
      stable sanitized slugs, and deterministic fallback to Draft versions 1.
- [x] Created and indexed Draft thread-workspaces specification version 1 and
      Draft ExecPlan version 1.
- [x] Received explicit user approval on 2026-08-16 for product specification
      version 1 and technical plan version 1.
- [x] Transferred the approved planning work unchanged to dedicated worktree
      `/Users/long/Documents/code_projects/pi-web-app-thread-workspaces` on branch
      `feat/thread-workspaces`, leaving the source checkout unchanged.
- [x] Discovered the merged per-thread concurrency baseline before production
      edits; revised product specification and technical plan to version 2 and
      returned both to Draft.
- [x] Received explicit user approval on 2026-08-16 for product specification
      version 2 and technical plan version 2; recorded both approvals.
- [x] Marked plan version 2 Active when production implementation began in the
      dedicated worktree.
- [x] Milestone 1 — contracts, characterization, and migration v3.
- [x] Milestone 2 — Git runner, repository parser, and clean worktrees.
- [x] Milestone 3 — source snapshot and explicit transfer.
- [x] Milestone 4 — naming, execution resolver, creation coordinator, and runtime adoption.
- [x] Milestone 5 — thread-scoped inspector and execution-scope terminal.
- [x] Milestone 6 — Codex-style new-chat UI.
- [x] Milestone 7 — recovery diagnostics, E2E, and durable documentation.
- [x] Verified and promoted specification version 2 to Current; archived this plan
      and updated indexes.

## Discoveries and blockers

- The overlapping initial-workspace plan remains Active and explicitly excludes
  worktree orchestration. This separate plan must preserve its current contracts
  and coordinate edits to `WorkspaceService`, inspector, terminal, contracts,
  migrations, and `App.tsx` rather than changing its approved scope silently.
- Pi native sessions are cwd-owned. This confirms that execution location must be
  chosen before session creation and remain immutable; imported existing sessions
  stay shared.
- Pi SDK 0.84.2 exposes `ModelRuntime.getAvailable()` and one-shot
  `completeSimple()` calls with model selection, cancellation, output limits,
  reasoning controls, and no required AgentSession. `SettingsManager` exposes the
  configured default provider/model. The naming path can therefore avoid loading
  project tools/extensions/resources or creating another persistent session.
- The current Git process helper is private to read-only inspector code. Mutating
  worktree support needs a separately owned parser/runner boundary, but extraction
  must preserve current inspector behavior.
- Faithful local-change transfer is not equivalent to one
  `git diff HEAD | git apply`: staged and unstaged patches must remain separate,
  binary/full-index forms are needed, and non-ignored untracked files require a
  contained snapshot.
- Git worktree creation updates common repository metadata even when the source
  checkout's files and index remain untouched. Product wording and tests distinguish
  that necessary bounded effect from bringing over or rewriting local changes.
- Product specification version 1 and technical plan version 1 were explicitly
  approved by the user on 2026-08-16, but current `main` already contained the
  separately approved and implemented per-thread concurrency revision. Preserving
  that baseline required a material product/technical correction. The user
  approved both version 2 documents on 2026-08-16; no approval blocker remains.

## Decision and revision log

- 2026-08-16: Created product specification version 1 and plan version 1 as a
  separate durable capability because worktree orchestration has an independent
  lifecycle and is an explicit non-goal of the active initial-workspace scope.
- 2026-08-16: Model execution location as an immutable per-thread association and
  centralize all cwd access in `ThreadExecutionContextResolver`.
- 2026-08-16: Supersede the version 1 project-lease assumption before production
  edits. Current `main` already permits one run per thread and concurrent distinct
  threads; version 2 preserves that behavior across shared and isolated roots.
- 2026-08-16: Use an app-managed unique branch rather than detached `HEAD` so
  commits remain reachable; retain ready branches/worktrees automatically.
- 2026-08-16: Default every isolated chat to clean, never persist the include-local
  choice, and permit transfer only from the source checkout's current `HEAD`.
- 2026-08-16: Transfer staged, unstaged, binary, deletion/rename, and non-ignored
  untracked state through a fingerprinted temporary snapshot; exclude ignored,
  conflicted, and dirty-submodule state rather than guessing.
- 2026-08-16: Use the vacant Codex toolbar slot for visible starting state and
  omit the environment control until an environment capability exists.
- 2026-08-16: Never automatically prune, force-remove, reset, clean, or delete a
  ready worktree/branch; compensation is limited to exact unexposed provisioning
  resources with proven identity.
- 2026-08-16: Generate one concise initial title from the first prompt and derive
  the worktree directory/branch slug from that parsed title plus a unique suffix;
  later thread rename does not move Git or Pi resources.
- 2026-08-16: Implement naming as one bounded, tool-free Pi `ModelRuntime` call.
  An explicit `PI_WEB_NAMING_MODEL` may override automatic selection; automatic
  selection stays within the configured default provider and requires a cheaper
  authenticated model. Any unavailable, failed, timed-out, or malformed result
  uses deterministic local naming and never blocks creation.

## Final outcomes

Completed. Migration v3 now preserves existing shared threads while adding
durable creation/worktree records. New chat uses the approved inline toolbar,
clean worktrees by default, explicit fingerprinted local-change transfer, and
one prompt-derived title for thread and worktree names with deterministic
fallback. Pi runtime, Files, Changes, and Terminal resolve the same immutable
thread execution root; existing per-thread run concurrency remains intact.

Verification completed in the dedicated worktree with `NODE_ENV=test pnpm
check` (118 Vitest tests, typecheck, lint, production builds, documentation tests
and navigation), `NODE_ENV=test pnpm test:e2e` (one production-build Playwright
scenario), focused generated-repository clean/transfer tests, and `git diff
--check`. No configured database, user project, real provider prompt, or writable
native Pi session was used. The only recorded warning is Vite's existing large
bundle-size advisory; the jsdom suite also reports its existing unimplemented
canvas notice without a test failure.
