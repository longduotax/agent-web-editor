# Codex agent runtime implementation plan

**Status:** Active

**Plan version:** 1

**Technical approval:** Approved for plan version 1 on 2026-08-22 by the user (longduotax), together with Agent backends specification version 1. The two open product questions were resolved at approval time; AGB-02's Settings control is folded into Tasks 8 and 11 below.

**Subsystem:** Agent execution — a second `AgentRuntime` implementation over the Codex app-server protocol, a per-thread runtime discriminator in persistence and contracts, a server-side runtime registry, and the composer's backend choice

**Affected paths or contracts:** new `packages/codex-adapter/**`; `packages/contracts/src/index.ts` (public transport contract); `apps/server/src/config.ts`, `apps/server/src/app.ts`, `apps/server/src/domain/workspace.ts`, `apps/server/src/db/schema.ts`, `apps/server/src/db/store.ts`, new `apps/server/migrations/0008_thread_runtime.sql`; `apps/web/src/features/workspace/NewChatPane.tsx` and `PaneHeader.tsx`; `apps/web/src/features/settings/**` (new backend preference store and Settings control); `scripts/check_docs.py`; `.env.example`; focused Vitest and Playwright tests; architecture and component documentation

**Governing specification:** [Agent backends](../../product-specs/agent-backends.md) — this plan implements AGB-01 through AGB-09

**Related documents or issue:** [Multi-agent tiling workspace design](../../design/multi-agent-tiling-workspace.md) section 4 (approved design intent), [Runtime and Pi adapter](../../design/runtime-and-pi-adapter.md), [Parse, Don't Validate](../../architecture/data-boundaries.md), [Architecture overview](../../architecture/overview.md), the [`AgentRuntime` interface](../../../packages/agent-runtime/src/index.ts), and the [transport contracts](../../../packages/contracts/src/index.ts)

**Last updated:** 2026-08-22

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Working specification and approval context

Product behavior change: **Yes.** The governing proposal is
[Agent backends](../../product-specs/agent-backends.md) specification version 1,
**Approved** on 2026-08-22. Plan version 1 received technical approval from the
same user message on the same date, satisfying both gates in the
[agent implementation workflow](../../development/agent-implementation-workflow.md).
Implementation may begin; this plan moves to Active when the first production
edit lands.

Preserved invariants that this plan must not disturb:

- Pi-backed threads keep their exact current behavior end to end (AGB-01).
- Run orchestration, the thread-scoped run lease, unread signals, archival, and
  worktree provisioning are unchanged; only _which adapter_ executes a thread
  becomes variable (AGB-05).
- Every external and persisted value is parsed into a trusted shape at its
  boundary, never cast.

## Purpose and user-visible outcome

Add Codex as a second agent backend beside Pi, selectable per chat and default
for new chats, with the backend recorded durably and shown wherever the chat
appears. Complete product rules live in the governing specification and are not
restated here.

## Requirement traceability

| Spec requirement                                                                                                           | Technical consequence                                                                                                                                                                                                                                                                                                                                                            | Verification                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [AGB-01](../../product-specs/agent-backends.md#agb-01--every-chat-has-one-durable-immutable-backend)                       | `threads.runtime` and `thread_creation_operations.runtime` columns; migration `0008` backfills existing rows to `'pi'`; the `(project_id, runtime_session_id)` unique index becomes `(project_id, runtime, runtime_session_id)`; `getThreadByRuntimeSession` takes a runtime                                                                                                     | Task 2 store tests including a 0007→0008 upgrade-with-existing-rows test, plus a Task 10 test asserting the thread composer renders no backend control |
| [AGB-02](../../product-specs/agent-backends.md#agb-02--codex-is-the-default-backend-for-new-chats)                         | `PI_WEB_DEFAULT_RUNTIME` config value defaulting to `codex`, reported to the browser; a device-local `backendPreferences.ts` store (`follow-machine` \| `pi` \| `codex`, default `follow-machine`) mirroring `themePreferences.ts`; the composer resolves device preference → machine default → `codex`; the server resolves an omitted request `runtime` to the machine default | Task 8 config tests; Task 9 route test asserting an omitted `runtime` yields the machine default; Task 11 precedence tests                             |
| [AGB-03](../../product-specs/agent-backends.md#agb-03--the-user-chooses-the-backend-when-starting-a-chat)                  | Optional `runtime` on `StartThreadRequest`/`CreateThreadRequest`; a backend `<select>` in `NewChatPane`, preselected to the resolved effective default, non-sticky, with unavailable backends rendered disabled and carrying their reason                                                                                                                                        | Task 10 Vitest, Task 11 preference tests, Task 12 Playwright                                                                                           |
| [AGB-04](../../product-specs/agent-backends.md#agb-04--a-chats-backend-is-visible-wherever-the-chat-is)                    | `runtime` on `ThreadSummary`; a textual badge in `PaneHeader` and the thread/Archived lists                                                                                                                                                                                                                                                                                      | Task 10 Vitest with an accessible-name assertion                                                                                                       |
| [AGB-05](../../product-specs/agent-backends.md#agb-05--a-codex-chat-behaves-like-any-other-chat)                           | Codex events map onto the existing `RuntimeEvent`/`TranscriptItem` union; no new contract kinds                                                                                                                                                                                                                                                                                  | Tasks 4, 6, 7 adapter tests; Task 12 end-to-end parity spec                                                                                            |
| [AGB-06](../../product-specs/agent-backends.md#agb-06--a-codex-chats-file-and-network-boundary-is-explicit-and-honest)     | `PI_WEB_CODEX_SANDBOX` defaulting to `workspace-write`; `cwd` pinned to the thread's execution root; sandbox refusals map to a failed `tool` transcript item and a settled run                                                                                                                                                                                                   | Task 5/7 adapter tests; Task 13 README and `.env.example`                                                                                              |
| [AGB-07](../../product-specs/agent-backends.md#agb-07--a-codex-chat-never-waits-for-an-approval-the-workspace-cannot-give) | `approvalPolicy: "never"` pinned, non-configurable; any inbound approval `ServerRequest` is answered `denied` and surfaced as a diagnostic rather than left pending                                                                                                                                                                                                              | Task 7 test driving an approval request through the fake transport                                                                                     |
| [AGB-08](../../product-specs/agent-backends.md#agb-08--a-missing-or-unusable-codex-installation-degrades-honestly)         | Spawn/handshake failure raises `RuntimeFailure("unavailable")`; creation is transactional so no thread row survives; `runtimeAvailable` on `ThreadSummary` already carries the open-time signal                                                                                                                                                                                  | Task 3 supervisor tests; Task 9 route test asserting no orphan thread                                                                                  |
| [AGB-09](../../product-specs/agent-backends.md#agb-09--existing-codex-sessions-in-a-folder-can-be-imported)                | `discover` per backend via `thread/list` filtered by `cwd`; `runtime` added to `ImportThreadRequest` and the session descriptor listing                                                                                                                                                                                                                                          | Task 5 adapter tests; Task 9 route test                                                                                                                |

## Current behavior and affected invariants

`WorkspaceService` holds **one** `AgentRuntime`, injected at
`apps/server/src/app.ts:272` as `new PiAgentRuntime(...)`, and calls it from
eight sites in `apps/server/src/domain/workspace.ts` (`suggestTitle` at 281,
`create` at 400/765/785, `discover` at 822/850/869, `open` at 1054). Threads
store only `runtime_session_id`; the unique index
`threads_project_runtime_unique` assumes one backend per project namespace.

`PiAgentRuntime` talks to Pi **in process** through
`@earendil-works/pi-coding-agent`. The Codex adapter cannot follow that shape:
Codex is an external program. This is the one structural difference between the
two adapters, and it is confined inside `packages/codex-adapter`.

Invariants that must survive:

- One running run per thread (`runs_one_running_per_thread`), and the
  accepted-command idempotency receipts around prompt acceptance.
- `PromptAcceptance`'s buffer-until-accepted contract: events produced before
  acceptance is known must be replayable or discardable by the caller.
- `recoverPrompt` must be able to answer, after a crash, whether a specific
  caller-owned dispatch id reached the agent.

## Scope, non-goals, assumptions, and unresolved technical decisions

**In scope:** the `codex-adapter` package, the runtime discriminator through
persistence and contracts, the server registry and config, the composer choice
and backend badge, and the accompanying documentation.

**Non-goals:** a Claude adapter; an approval UI; streaming-delta rendering
changes; per-chat model or effort selection; changes to Pi's permission posture;
any change to run orchestration or the lease.

**Assumptions:**

- Codex CLI is `0.149.0` or compatible, and `codex app-server` speaks the
  protocol probed on 2026-08-22 (`thread/start`, `thread/resume`, `thread/read`,
  `thread/list`, `thread/name/set`, `turn/start`, `turn/steer`,
  `turn/interrupt`, and the `item/*`, `turn/*`, `error` notifications).
- Codex thread identifiers are UUIDv7 (verified against
  `~/.codex/sessions/**/rollout-*.jsonl`), so the existing `SessionIdSchema`
  (`z.uuid()`) accepts them with no contract widening.
- `turn/start` accepts a `clientUserMessageId`, and `thread/read` returns
  `userMessage` items carrying `clientId`. This is the recovery identity
  `recoverPrompt` needs.

**Unresolved technical decisions:**

1. **Process topology.** One shared `codex app-server` child for the whole
   server (threads multiplexed by `threadId`) versus one child per open thread.
   This plan takes **one shared child**: it matches the protocol's
   thread-addressed design, keeps memory flat as pane count grows — a
   first-class constraint in the governing design — and makes the crash story
   one supervisor instead of N. The cost is a single failure domain; Task 3
   mitigates it with supervised restart plus per-thread reopen.
2. **Whether to vendor the generated protocol types.**
   `codex app-server generate-ts --out <dir>` emits the full typed protocol, but
   wiring it into the build would make `pnpm check` require Codex installed.
   This plan **hand-writes narrow Zod schemas** for only the messages used,
   matching `pi-adapter`'s existing parse-at-the-boundary posture, and treats
   the generated output as a development-time reference only. Reconsider if the
   message set grows past roughly a dozen.
3. **Fork inherits, never chooses.** The governing design's later
   "fork of a running chat" start state is created through the _same_ new-chat
   composer this plan adds a backend picker to. A fork resumes the parent's
   native agent session, so it cannot cross backends. When that phase lands, the
   picker must render the inherited backend read-only rather than offered. No
   code in this plan implements forking; this is recorded so the phase that does
   inherits the constraint instead of rediscovering it as a bug.
4. **`suggestTitle` for Codex.** Left unimplemented in v1. The interface member
   is optional and `workspace.ts:281` already falls back to the deterministic
   product title, so a Codex chat gets the fallback name. Not a spec
   requirement; noted so it is a deliberate gap rather than an oversight.

## Untrusted-data-boundary analysis

Per [Parse, Don't Validate](../../architecture/data-boundaries.md). The Codex
app-server is an **external program**, so everything it emits is untrusted.

| Source and raw representation                                                | Entry/read point                                      | Runtime parser                                                                             | Trusted output and guarantees                                  | Failure behavior                                                                                   | Boundary tests                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex app-server stdout: newline-delimited JSON-RPC frames                   | `CodexProcess` stdout reader (Task 3)                 | `jsonRpcFrameSchema` — a discriminated parse into response / notification / server-request | A frame with a known shape and a correlatable `id` or `method` | Unparseable frame is dropped and counted; a frame storm past the cap fails the session `malformed` | Task 3: truncated line, non-JSON line, unknown `method`, missing `id`, oversized frame |
| `thread/list` result                                                         | `CodexAgentRuntime.discover` (Task 5)                 | `threadListResultSchema`                                                                   | `RuntimeSessionDescriptor[]` with UUID ids and ISO timestamps  | Malformed entries are skipped and reported as `diagnostics`, never thrown away silently            | Task 5: missing name, non-UUID id, unparseable timestamp, empty page, cursor loop      |
| `thread/read` items                                                          | `CodexOpenSession.snapshot` (Task 6)                  | `threadItemSchema` union                                                                   | `TranscriptItem[]` satisfying `TranscriptItemSchema`           | Unknown item type becomes an `info` diagnostic item; the snapshot still returns                    | Task 6: unknown type, oversized text truncation, missing optional fields               |
| `item/*`, `turn/*`, `error` notifications                                    | `CodexOpenSession` notification dispatch (Tasks 6, 7) | same `threadItemSchema` plus `turnLifecycleSchema`                                         | `RuntimeEvent` values                                          | Unknown notification is ignored; a malformed one becomes an `error` diagnostic                     | Tasks 6, 7                                                                             |
| Codex approval `ServerRequest` (`applyPatchApproval`, `execCommandApproval`) | `CodexProcess` server-request dispatch (Task 7)       | `approvalRequestSchema`                                                                    | An immediate `denied` response                                 | Never left pending — AGB-07                                                                        | Task 7: an approval request mid-turn settles the run rather than hanging               |
| `codex --version` / initialize handshake                                     | `CodexProcess.start` (Task 3)                         | `initializeResultSchema`                                                                   | A usable session, or a typed failure                           | `RuntimeFailure("unavailable")` naming Codex                                                       | Task 3: binary missing, non-zero exit, handshake timeout, incompatible version         |
| `PI_WEB_DEFAULT_RUNTIME`, `PI_WEB_CODEX_SANDBOX`, `PI_WEB_CODEX_BIN`         | `parseConfig` (Task 8)                                | Zod enums / non-empty string                                                               | `RuntimeKind`, `SandboxMode`, a command string                 | Startup throws with the variable named, matching `PI_WEB_NAMING_MODEL`                             | Task 8 config tests                                                                    |
| `threads.runtime` read from SQLite                                           | `MetadataStore` row mapping (Task 2)                  | `RuntimeKindSchema`                                                                        | `RuntimeKind`                                                  | An unknown persisted value fails the read loudly rather than defaulting                            | Task 2 store test writing an unknown value directly                                    |
| `runtime` on inbound HTTP requests                                           | route body parse (Task 9)                             | `RuntimeKindSchema` inside the existing strict request schemas                             | `RuntimeKind`                                                  | 400 via the existing error contract                                                                | Task 9 route tests                                                                     |

## Touched-legacy-code analysis

- `apps/server/src/domain/workspace.ts` is 1432 lines and already large. This
  plan **does not refactor it**. It replaces the single `this.runtime` field
  with a `resolveRuntime(kind)` lookup at the eight existing call sites and adds
  nothing else. Any broader decomposition is out of scope.
- `threads_project_runtime_unique` is a deliberate compatibility change, not a
  cleanup: leaving it as `(project_id, runtime_session_id)` would let a Pi and a
  Codex session with the same UUID collide. The migration drops and recreates it
  inside the same transaction that adds the column.
- Existing `app.test.ts` and `workspace.test.ts` inject a fake runtime through
  `BuildServerOptions.runtime`. That seam is **kept working**: the option
  continues to accept a single runtime and registers it as the default kind, so
  existing tests need no rewrite.

## Implementation milestones

Tasks are ordered so each is independently verifiable. Every task is TDD: write
the failing test, watch it fail, implement, watch it pass, commit.

- [x] **Task 1 — Runtime kind in the transport contract.** Add
      `RuntimeKindSchema = z.enum(["pi", "codex"])` and `RuntimeKind` to
      `packages/contracts/src/index.ts`; add required `runtime` to `ThreadSummary`;
      add optional `runtime` to `StartThreadRequest`, `CreateThreadRequest`, and
      `ImportThreadRequest`; add `runtime` to `SessionDescriptor`. Tests in
      `packages/contracts/src/index.test.ts` cover accept/reject and the optionality.
      Verify: `pnpm --filter @pi-web/contracts exec vitest run`.

- [x] **Task 2 — Persist the discriminator.** Add `runtime` to the `threads` and
      `thread_creation_operations` tables in `apps/server/src/db/schema.ts`; write
      `apps/server/migrations/0008_thread_runtime.sql` adding both columns with
      `DEFAULT 'pi' NOT NULL`, backfilling existing rows to `'pi'`, and replacing
      `threads_project_runtime_unique` with
      `(project_id, runtime, runtime_session_id)`; extend the migration ladder in
      `store.ts` following the existing `backupBefore(8)` pattern; thread `runtime`
      through create/import/read; give `getThreadByRuntimeSession` a runtime
      parameter. Tests must include a **0007-shaped database with existing rows**
      upgrading cleanly to `'pi'`, and a same-session-id-across-backends case.
      Verify: `pnpm --filter @pi-web/server exec vitest run src/db/store.test.ts`.

- [x] **Task 3 — `codex-adapter` package and supervised app-server process.**
      Scaffold `packages/codex-adapter` mirroring `pi-adapter`'s `package.json` and
      `tsconfig.json`. Implement `CodexProcess`: spawn `PI_WEB_CODEX_BIN`
      (default `codex`) with `app-server`, newline-framed JSON-RPC over stdio,
      request/response correlation, notification and server-request dispatch,
      `initialize` handshake, supervised restart with backoff, and typed
      `RuntimeFailure` on spawn or handshake failure. The transport is **injected**
      so tests drive a scripted in-memory duplex — no real Codex process, no
      network. Verify: `pnpm --filter @pi-web/codex-adapter exec vitest run`.

- [x] **Task 4 — Protocol schemas and the transcript mapping.** Hand-written Zod
      schemas for the message set in the assumptions, plus pure
      `mapThreadItem(item): TranscriptItem | null` and
      `mapNotification(n): RuntimeEvent | null`. Mapping: `agentMessage` and
      `userMessage` → `message`; `reasoning` → `message` with role `assistant`;
      `commandExecution`, `fileChange`, `mcpToolCall`, `webSearch` → `tool` with
      `status`, `cwd`, and `exitCode` where the source provides them; `error` →
      `diagnostic`. Every mapped value must satisfy `TranscriptItemSchema`,
      including its length caps. This task is pure functions and should carry the
      densest test coverage in the plan.

- [ ] **Task 5 — `CodexAgentRuntime.discover` and `create`.** `discover` pages
      `thread/list` filtered by `cwd` (skipping malformed entries into
      `diagnostics`); `create` issues `thread/start` with the execution root as
      `cwd`, `approvalPolicy: "never"` (AGB-07), and the configured `sandbox`
      (AGB-06), then `thread/name/set` when a title is supplied.

- [ ] **Task 6 — `CodexOpenSession` open, snapshot, subscribe.**
      `thread/resume` to attach, `thread/read` for the snapshot, notification stream
      mapped to `RuntimeEvent` and fanned out to subscribers, `dispose` unsubscribing
      via `thread/unsubscribe` without killing the shared process.

- [ ] **Task 7 — `prompt`, `recoverPrompt`, `steer`, `stop`.** `turn/start`
      carrying `dispatch.id` as `clientUserMessageId`; acceptance resolves on the
      `turn/start` response, settlement on `turn/completed` (`completed`), `error`
      (`failed`), or interrupt (`interrupted`); events buffered until acceptance is
      known, matching `PiOpenSession`'s `releaseEvents`/`discardEvents` contract.
      `recoverPrompt` reads `thread/read` and looks for a `userMessage` whose
      `clientId` equals the dispatch id. `steer` → `turn/steer` with the active
      `expectedTurnId`; `stop` → `turn/interrupt`. Approval `ServerRequest`s are
      answered `denied` immediately and reported as a diagnostic.

- [ ] **Task 8 — Server runtime registry and config.** `parseConfig` gains
      `defaultRuntime` (`PI_WEB_DEFAULT_RUNTIME`, default `codex`), `codexSandbox`
      (`PI_WEB_CODEX_SANDBOX`, default `workspace-write`), and `codexBin`
      (`PI_WEB_CODEX_BIN`). `BuildServerOptions` gains a `runtimes` map while
      keeping the existing single-`runtime` seam working. The machine default must be **readable by the browser** — extend the existing workspace/settings response with `defaultRuntime` and the per-backend availability the composer needs for AGB-03. `WorkspaceService` takes a
      resolver and picks the adapter from `thread.runtime` at all eight call sites.

- [ ] **Task 9 — Routes and creation flow carry the backend.** Requests resolve
      an omitted `runtime` to the configured default; the creation operation records
      it before any session is created, so recovery reopens on the right backend;
      `ThreadSummary` DTOs report it; session discovery reports per-backend
      descriptors. A creation failure on an unusable backend must leave **no** thread
      row (AGB-08). `runtime` is **write-once**: no route, store method, or DTO path
      may update it on an existing thread, and the store exposes no setter for it
      (AGB-01). Add a store test asserting no path mutates a persisted `runtime`.

- [ ] **Task 10 — Composer choice and backend badge.** A backend `<select>` in
      `NewChatPane` beside the existing workspace-mode controls, preselected to the
      server-reported default and non-sticky; unavailable backends rendered disabled
      with a reason. A textual badge in `PaneHeader` and the thread/Archived lists.
      Tests assert accessible names, not colour. Also assert the **absence** of any
      backend or provider control in `ThreadPane`'s composer (AGB-01) — a
      regression here is silent, so it needs a standing test rather than review
      attention.

- [ ] **Task 11 — Device backend preference and its Settings control.** Add
      `apps/web/src/features/settings/backendPreferences.ts` following
      `themePreferences.ts` **exactly** — same storage guard, JSON guard, `safeParse`,
      and remove-on-malformed behaviour — with
      `z.object({ version: z.literal(1), choice: z.enum(["follow-machine","pi","codex"]) })`,
      key `pi-workspace:default-backend`, and default `follow-machine`. Add a
      "Default agent" section to `SettingsPage` beside Theme. `NewChatPane` resolves
      device preference → machine default → `codex` (AGB-02). Tests cover each
      precedence rung, a malformed stored value, and storage being unavailable.
      Verify: `pnpm --filter @pi-web/web exec vitest run src/features/settings`.

- [ ] **Task 12 — End-to-end coverage.** A Playwright spec creating a Codex chat
      and a Pi chat in one project against the fake-runtime harness, asserting the
      badge, the default, and transcript parity.

- [ ] **Task 13 — Documentation.** `packages/codex-adapter/README.md`; add it to
      `REQUIRED_COMPONENT_DOCS` in `scripts/check_docs.py` and link it from
      `docs/README.md`; record the implemented structure in
      `docs/architecture/overview.md`; document the three new variables and the
      AGB-06 boundary in `README.md` and `.env.example`, beside the existing Pi
      permission statement.

## Verification

Focused, per task:

Vitest is configured once at the repository root (`vitest.config.ts` includes
`apps/**` and `packages/**`), so a `--filter … exec vitest` invocation finds no
test files. Run focused suites from the root by path:

```sh
pnpm exec vitest run packages/contracts
pnpm exec vitest run packages/codex-adapter
pnpm exec vitest run apps/server/src/db/store.test.ts
pnpm exec vitest run apps/server/src/app.test.ts apps/server/src/config.test.ts
pnpm exec vitest run apps/web/src/features/workspace
pnpm exec vitest run apps/web/src/features/settings
```

Final, before completion:

```sh
pnpm check
pnpm test:e2e
```

Manual/runtime checks that automation does not cover, to be recorded with their
output in Progress:

1. With Codex installed and signed in, start a Codex chat in a real project,
   prompt it, watch commands stream, steer mid-run, then stop it.
2. Ask a Codex chat to write above its execution root and confirm a visible
   failed command and a settled run (AGB-06).
3. Run the server with `PI_WEB_CODEX_BIN=/nonexistent` and confirm Codex chat
   creation fails by name, leaves no thread, and Pi chats still work (AGB-08).
4. Upgrade a **real pre-migration** metadata database and confirm existing chats
   read `pi` and still open (AGB-01).

## Compatibility, deployment, migration, recovery, and rollback

- **Migration:** forward-only, `user_version` 7 → 8, inside one transaction,
  with the existing pre-migration backup step. Existing rows become `'pi'`.
- **Rollback:** the repository has no downgrade path; recovery is restoring the
  pre-migration backup that `store.ts` writes. An older server binary against an
  8-versioned database is **not** supported, and the extra column alone would not
  make it safe — do not treat "SQLite ignores unknown columns" as a rollback story.
- **Deployment:** no new required environment variable. Absent config yields
  `codex` + `workspace-write` per AGB-02 and AGB-06.
- **Recovery:** an app-server crash mid-run is observed as a settled `failed`
  run through the existing lease and settlement path; the supervisor restarts
  the child and the next open re-attaches with `thread/resume`.
- **External dependency risk:** `codex app-server` is marked `[experimental]`.
  Parsing every frame means a protocol change surfaces as a typed
  `RuntimeFailure` and a visible diagnostic rather than corrupt transcript data,
  but it remains a live maintenance surface pinned to CLI 0.149.0.

## Progress

Both approvals granted 2026-08-22. Implementation in progress; see the task
checkboxes above for the current position.

- 2026-08-22: `pnpm install` in the worktree, then `pnpm check` green as a
  pre-change baseline.
- 2026-08-22: Tasks 1 and 2 complete. `pnpm check` green (364 unit tests).
- 2026-08-22: Task 3 complete. `CodexClient` (framing, id correlation,
  handshake, server-request answering, supervised reconnect) and
  `spawnCodexTransport` land with 14 tests: the client against a scripted
  in-memory transport, the spawn path against a real `node` child so line
  fragmentation and exit reporting are exercised without needing Codex.
- 2026-08-22: Task 4 complete. Pure protocol schemas and mapping with 21
  tests; every mapped value is asserted against `TranscriptItemSchema`
  itself rather than merely resembling it.

## Discoveries and blockers

Discovered during investigation on 2026-08-22, before drafting:

- Codex CLI 0.149.0 is installed locally; `codex app-server` exposes every
  operation `AgentRuntime` requires, so no capability gap blocks this work.
- `turn/start`'s `clientUserMessageId` and `thread/read`'s `userMessage.clientId`
  give `recoverPrompt` a native basis, which is stronger than the custom history
  entry the Pi adapter has to append.
- Codex thread ids are UUIDv7, so `SessionIdSchema` needs no change.
- `suggestTitle` is optional at `apps/server/src/domain/workspace.ts:281` with a
  deterministic fallback, so the Codex adapter can ship without naming.

Discovered while implementing Tasks 1 and 2:

- **The per-package verify commands in this plan were wrong.** Vitest is
  configured once at the repository root, so `pnpm --filter <pkg> exec vitest`
  reports "No test files found". Corrected in Verification above.
- **`threads_project_runtime_unique` was never a named index.** It is the table
  constraint `UNIQUE(project_id, runtime_session_id)` from `0001_initial.sql`,
  backed by an autoindex SQLite refuses to drop ("index associated with UNIQUE
  or PRIMARY KEY constraint cannot be dropped"). Widening the key therefore
  needs the documented rebuild-and-rename procedure, with foreign keys disabled
  around it — SQLite only permits that pragma outside a transaction — and a
  `foreign_key_check` _inside_ the transaction so a violation rolls the rebuild
  back instead of committing a damaged schema. The plan's stated outcome is
  unchanged, so this is mechanism, not a material migration change. Verified
  against a seeded copy of the real schema before writing the migration:
  references from `runs(thread_id, project_id)` survive the rename intact.
- **Tasks 1 and 2 cannot land separately.** Making `runtime` required on
  `ThreadSummary` breaks 30 server tests until persistence supplies it, because
  `threadDto` parses through `ThreadSummarySchema` at runtime. They were
  committed together to keep the branch green.
- **`threadDto` is not statically typed against its schema.** It parses an
  object literal through `ThreadSummarySchema.parse`, so `tsc` did not flag the
  missing field — only the tests did. Task 9 should not rely on typecheck to
  catch DTO drift.
- **Adding a schema version invalidates hard-coded fixtures.** Three existing
  migration tests asserted `user_version` 7 or used 8 as "a newer schema";
  two also downgrade by dropping columns, which SQLite refuses once `runtime`
  participates in a constraint. All were updated to rebuild instead.

- **Reasoning has no home of its own in the transcript contract.** The
  contract's three kinds are message, tool, and diagnostic, so Codex reasoning
  is rendered as an assistant message from its `summary` (what Codex itself
  surfaces; raw `content` is dropped), and empty reasoning is skipped entirely.
  A Codex chat therefore shows reasoning and final answers in the same visual
  register, which Codex's own UI distinguishes. Accepted for v1; a distinct
  transcript kind would be a contract change well beyond this plan.
- **Codex timestamps are Unix milliseconds, not ISO strings**, so every mapped
  timestamp is converted and an unparseable one becomes `null` rather than
  failing the item.

No blockers.

## Decision and revision log

- 2026-08-22: Created plan version 1 from the approved section 4 intent of the
  multi-agent tiling workspace design, after probing the local Codex app-server
  protocol. Recorded three technical decisions: one shared supervised
  app-server child; hand-written Zod schemas rather than build-time generated
  types; no `suggestTitle` in v1.
- 2026-08-22: Clarified, at the user's prompting and before any approval, that
  continuing a chat offers no backend or provider control and that a derived
  chat inherits its parent's backend. AGB-01 already made the backend immutable;
  this makes the continue and fork surfaces explicit and adds standing tests, so
  the constraint is enforced rather than assumed. No change to scope or
  approach; the plan remains version 1.
- 2026-08-22: The user approved Agent backends specification version 1 and this
  plan version 1 in one message, resolving both open product questions. The
  default backend gains a Settings control layered over the machine default,
  which adds Task 11 and extends Task 8 with a browser-readable default. This
  was folded into the documents **before** the approval was stamped, so the
  approved text is the revised text. Unavailable backends are shown disabled
  with a reason, as AGB-03 already specified — no change.

## Final outcomes

Not completed.
