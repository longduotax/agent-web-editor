# Isolated worktree review environment

**Status:** Completed

**Plan version:** 1

**Technical approval:** Approved by the user on 2026-08-16 for plan version 1

**Subsystem:** Repository development workflow and Pi project skill

**Affected paths or contracts:** `.pi/skills/start-env/**`, `scripts/review-env*.mjs`, `package.json`, `docs/development/workflows.md`

**Governing specification:** Technical working specification `REVIEW-ENV-01` through `REVIEW-ENV-04` in this plan

**Related documents or issue:** [Development workflows](../../development/workflows.md), [Pi web host safety](../../../AGENTS.md)

**Last updated:** 2026-08-16

## Working specification and approval context

Product behavior change: None. The browser and server product contracts remain unchanged.

Preserved behavior invariant: starting a UI-review environment from a linked worktree must not reuse, mutate, restart, or otherwise interfere with the main development server, the hosted application, or any database configured through `.env` files.

### `REVIEW-ENV-01` — Explicit manual invocation

The repository provides a project-local Pi skill named `start-env`. It is hidden from automatic model invocation and is available only when a user explicitly invokes `/skill:start-env`. The default invocation starts the environment; a `cleanup` argument closes it.

### `REVIEW-ENV-02` — One-call isolated startup

A single repository command starts one idempotent review environment for the current linked worktree. It installs frozen-lockfile dependencies only when they are absent, chooses available random loopback ports for the backend and Vite, sets an explicit private state directory, starts the existing development command in a detached supervised process group, waits for direct and proxied readiness, verifies creation of the isolated SQLite database, and prints the browser URL. Repeated startup returns the existing healthy URL.

### `REVIEW-ENV-03` — Main and configured-state protection

Startup refuses the repository's main worktree with no override. It does not load a configured state path as its effective `PI_WEB_STATE_DIR`; the launched process receives an explicit generated state directory. It binds only to loopback and does not use the hosted application's port or state.

### `REVIEW-ENV-04` — Exact cleanup

A single repository command parses the current worktree's recorded environment manifest, proves that the recorded supervisor belongs to that environment, terminates only its process group, waits for shutdown with a bounded forced-termination fallback, and removes the environment's SQLite database, logs, and metadata. Cleanup is idempotent when no environment exists and refuses to terminate a process when ownership cannot be established.

**Product approval:** Approved by the user on 2026-08-16 for the no-product-change invariant and working specification `REVIEW-ENV-01` through `REVIEW-ENV-04`.

## Purpose and user-visible outcome

A developer can ask Pi to create a disposable browser-review instance from a feature worktree without hand-selecting ports or risking the already-running main development environment. Pi only needs to call the checked-in start or close command and report the resulting URL or cleanup result.

## Requirement traceability

| Working requirement | Technical consequence                                                                                                                                                         | Verification                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `REVIEW-ENV-01`     | Add `.pi/skills/start-env/SKILL.md` with `disable-model-invocation: true` and minimal command instructions.                                                                   | Load the skill with Pi's skill loader; assert no diagnostics, command discovery, and exclusion from the model prompt.             |
| `REVIEW-ENV-02`     | Add start orchestration, worktree-keyed private runtime storage, random port allocation, dependency bootstrap, detached supervision, readiness polling, and idempotent reuse. | Unit tests for parsers and path derivation; linked-worktree smoke test for start, readiness, SQLite creation, and repeated start. |
| `REVIEW-ENV-03`     | Detect the main worktree, hard-refuse it, and override state and port environment values for the child process.                                                               | Main-worktree refusal test; inspect the smoke-test manifest, listeners, process working directories, and open SQLite path.        |
| `REVIEW-ENV-04`     | Add manifest parsing, process identity checks, process-group termination, stale-state handling, and recursive private-state cleanup.                                          | Parser boundary tests plus linked-worktree cleanup smoke test proving listeners, processes, and files are gone.                   |

## Current behavior and affected invariants

The repository exposes `pnpm dev`, which uses configured or default ports and the normal state-directory resolution. Agents must currently select ports and a state directory manually, supervise the process themselves, and remember how to clean it up. A second main development process can collide with existing listeners or accidentally target configured state.

The existing `pnpm dev` and `pnpm start` behavior must remain unchanged. The hosted application safety rule remains authoritative; this workflow is only for disposable linked-worktree review instances and must never become a host update path.

## Scope, non-goals, assumptions, and unresolved technical decisions

### Scope

- Add a manually invocable project-local skill.
- Add executable Node.js start and close scripts plus shared parsing/process helpers.
- Add `pnpm dev:review` and `pnpm dev:review:close` entry points.
- Store one environment per canonical worktree under a mode-0700 directory rooted in the operating system's temporary directory.
- Use a generated identity token and a detached supervisor process whose command line can be matched before cleanup.
- Add automated boundary tests and documented smoke verification.

### Non-goals

- Starting from the main worktree.
- Updating, restarting, or testing the hosted deployment on port 3002.
- Replacing the ordinary `pnpm dev` workflow.
- Preserving review databases after cleanup.
- Supporting multiple simultaneous review environments for one worktree.
- Supporting Windows process supervision.
- Registering projects or creating threads automatically.

### Assumptions

- Node.js 22.19+, pnpm 11.1.2, Git, and a POSIX process model are available, matching repository prerequisites.
- The backend continues to create and migrate `metadata.sqlite` under an explicit `PI_WEB_STATE_DIR`.
- Random-port selection has a small close-before-bind race; startup fails safely and cleans up if either strict listener cannot bind.

### Unresolved technical decisions

None. The user approved the brainstormed behavior in principle; exact versioned approval is pending for this plan and working specification.

## Implementation milestones

1. Add a shared review-environment module that canonicalizes the worktree, derives a private worktree key, allocates loopback ports, constructs and parses a versioned manifest, recognizes main worktrees, polls readiness, and verifies supervisor identity.
2. Add the start executable. It checks or installs dependencies, handles an existing environment, creates private runtime/state directories, launches its own supervisor mode with explicit environment values, records metadata atomically, waits for readiness and SQLite creation, and reports the URL. Every partial-start failure terminates the owned process and cleans generated state.
3. Add the close executable. It parses metadata, handles absent/dead instances, proves live-process ownership, terminates the exact process group, and removes generated state.
4. Add package commands and the hidden project-local skill whose only actions are calling those commands and reporting results.
5. Add boundary/unit tests and update the development workflow documentation.
6. Run static checks and a linked-worktree start/reuse/cleanup smoke test, then complete and archive this plan.

## Untrusted-data-boundary analysis

| Source and raw representation                         | Entry/read point                              | Runtime parser                                                                                                                                        | Trusted output and guarantees                                                | Failure behavior                                                                                                       | Boundary tests                                                                              |
| ----------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Current directory and Git command output strings      | Start/close process entry                     | Canonical worktree parser plus exact `git rev-parse`/`git worktree list --porcelain` parser                                                           | Existing canonical `pi-web-app` linked-worktree root and canonical main root | Refuse startup/cleanup with a specific error                                                                           | Non-repository path, wrong package, main worktree, linked worktree, paths containing spaces |
| `package.json` JSON and dependency-directory presence | Startup prerequisite check                    | JSON parse plus object/name narrowing                                                                                                                 | Repository identity and whether frozen install is required                   | Refuse malformed/wrong package; run frozen install only when absent                                                    | Malformed/missing package and expected package fixtures                                     |
| OS-assigned socket addresses                          | Random-port allocator                         | Node `net.AddressInfo` narrowing and valid-port construction                                                                                          | Distinct loopback ports in 1–65535 that were available at selection          | Close sockets and fail; child strict-bind failure triggers cleanup                                                     | Non-address result seam and distinct valid allocation test                                  |
| Persisted environment manifest JSON                   | Start reuse and close entry                   | `parseReviewEnvironmentManifest` constructs a versioned trusted manifest with canonical root, positive PID, valid ports, token, paths, and timestamps | Downstream process cleanup and URL rendering use complete bounded fields     | Refuse live-process action; stale malformed metadata is surfaced for manual inspection rather than sourced or executed | Valid, malformed JSON, missing fields, wrong version, invalid PID/ports/path/token          |
| `ps` output for PID, process group, and command line  | Existing-instance and cleanup ownership check | Exact PID/PGID integer parsing plus expected absolute supervisor path and token match                                                                 | Recorded PID is the expected process-group leader for this environment       | Refuse termination and preserve evidence                                                                               | Missing process, reused PID simulation, wrong PGID, wrong script, wrong token               |
| HTTP responses from direct backend and Vite proxy     | Startup readiness loop                        | HTTP status checks with bounded timeout                                                                                                               | Both listeners are serving the expected ready route and frontend origin      | Terminate owned group, show bounded log tail, and clean state                                                          | Ready, timeout, early supervisor exit                                                       |

No application transport contract or production database boundary changes.

## Touched-legacy-code analysis

`package.json` gains additive scripts; existing scripts and callers remain unchanged. `docs/development/workflows.md` gains an isolated-review subsection without changing ordinary development or production startup instructions. No application legacy code, database schema, API route, or compatibility path is modified.

## Verification

Automated:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:docs
pnpm docs:check
```

Focused parser/process tests will be included in `pnpm test`.

Manual linked-worktree smoke verification:

1. Run `pnpm dev:review` and confirm it prints a loopback URL on random frontend/backend ports.
2. Confirm direct `/api/ready`, proxied `/api/ready`, and the frontend return HTTP 200.
3. Confirm the supervisor and listeners have working directories under this linked worktree and the backend has the generated `metadata.sqlite` open.
4. Run `pnpm dev:review` again and confirm it returns the same URL without creating another process.
5. Run `pnpm dev:review:close` and confirm both listeners, the process group, SQLite files, manifest, and logs are removed.
6. Run cleanup again and confirm an idempotent success.
7. Invoke startup against the main worktree and confirm hard refusal.
8. Load the project skill and confirm it is discoverable as `/skill:start-env` but absent from automatic model invocation.

## Compatibility, deployment, migration, recovery, and rollback

Compatibility is additive and developer-local. No database migration is added; each review instance uses the server's existing migrations against a fresh disposable database. No deployment action is required, and the workflow must not call the host update skill.

Recovery from interrupted startup or a dead supervisor removes only the worktree-keyed generated runtime directory after proving no recorded live process remains. Ambiguous process identity fails closed and preserves logs/metadata for inspection. Rollback removes the project skill, review scripts, package commands, tests, and documentation; existing development behavior is unaffected.

## Progress

- [x] Investigated current development commands, state configuration, Pi skill behavior, worktree layout, and host-safety constraints.
- [x] Drafted working specification and plan version 1.
- [x] Obtained explicit user approval on 2026-08-16 for the no-product-change invariant, working specification `REVIEW-ENV-01` through `REVIEW-ENV-04`, and plan version 1.
- [x] Implemented scripts, skill, tests, and documentation.
- [x] Verified automated and runtime behavior, including dependency installation in a fresh linked worktree whose path contains spaces.
- [x] Completed and archived the plan.

## Discoveries and blockers

- The prior global skill prototype was removed; repository-local discovery under `.pi/skills/` is the intended scope.
- The UI change PR was merged before this plan, so this workflow will use a separate branch and pull request.
- The user approved the summarized working specification and implementation plan, then explicitly requested implementation.
- The first reuse smoke test exposed an existing-state-directory `EEXIST` error; `createPrivateRuntimeDirectory` now parses an existing state path as a real non-symlink directory before reuse.
- A detached temporary linked worktree at `/tmp/pi web review install test` verified the missing-dependency path, including frozen installation, random-port startup, SQLite creation, idempotent URL reuse, exact cleanup, and paths containing spaces.

## Decision and revision log

- 2026-08-16: Created plan version 1 with a technical-only working specification, hard main-worktree refusal, one environment per worktree, automatic frozen dependency installation when needed, random loopback ports, explicit disposable SQLite state, supervised process ownership, and destructive cleanup of generated state.
- 2026-08-16: The user approved the no-product-change invariant, working specification `REVIEW-ENV-01` through `REVIEW-ENV-04`, and technical plan version 1 after reviewing summaries of both; implementation moved through Ready to Active.
- 2026-08-16: Implemented a project-local manual-only skill, versioned manifest parser, random loopback allocation, detached supervisor, dependency bootstrap, exact cleanup, package commands, tests, and workflow documentation.
- 2026-08-16: Completed plan version 1 after the full static gate and linked-worktree smoke verification passed.

## Final outcomes

Completed. `/skill:start-env` is a repository-local manual command backed by `pnpm dev:review`; `/skill:start-env cleanup` uses `pnpm dev:review:close`. Each linked worktree receives at most one supervised random-port environment and an explicit disposable SQLite state directory. Main-worktree startup fails closed, persisted manifests are parsed before use, live process ownership is proven before termination, and cleanup removes only the derived runtime directory.

Verification completed with `NODE_ENV=test pnpm check` (14 Vitest files and 163 tests, 8 review-environment Node tests, builds, formatting, lint, type checks, documentation tests, and documentation navigation). Manual smoke checks passed for direct/proxied HTTP readiness, SQLite ownership, supervisor identity, healthy reuse, exact cleanup, repeated cleanup, main-worktree refusal, project-skill discovery/manual-only exclusion, and automatic frozen installation in a fresh linked worktree with spaces in its path.
