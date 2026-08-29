# Same-worktree new-chat command

**Status:** Active

**Plan version:** 2

**Technical approval:** Approved by the user on 2026-08-29 for plan version 2

**Subsystem:** Thread workspaces, continuation recovery, managed-worktree run leases, tiled pane state, routing, and first-prompt creation

**Affected paths or contracts:** `packages/contracts/src/index.ts`, `apps/server/migrations/**`, `apps/server/src/db/**`, `apps/server/src/domain/**`, `apps/server/src/app.ts`, `apps/web/src/api/**`, `apps/web/src/features/workspace/**`, thread continuation wire contracts, device-local workspace-layout schema, and persisted continuation operations

**Governing specification:** [Thread workspaces proposed version 4, TW-10 through TW-14](../../product-specs/thread-workspaces.md#proposed-revision-v4--deferred-same-worktree-new-chat)

**Related documents or issue:** [Interactive flow prototype](../../design/worktree-chat-continuation-flow.html), [runtime and Pi adapter](../../design/runtime-and-pi-adapter.md), [application persistence](../../design/application-persistence.md), [tiling workspace surface](../../product-specs/tiling-workspace-surface.md), and [workspace panel](../../product-specs/workspace-panel.md)

**Last updated:** 2026-08-29

## Working specification and approval context

[Thread workspaces](../../product-specs/thread-workspaces.md) version 2 remains
Current. The user approved proposed version 3 and plan version 1 on 2026-08-29,
and that implementation now creates a durable blank thread and Pi session when
`/new` is submitted. Subsequent discussion selected a materially different
outcome: exact `/new` should create only a pending pane, while the first real
prompt creates the server-side conversation. That decision invalidated both
prior approvals. The user explicitly approved proposed specification version 4
and this plan version 2 on 2026-08-29; implementation is active under those
exact versions.

## Purpose and user-visible outcome

Exact `/new` should feel like the existing split/new-chat flow while retaining
the current managed worktree. An unused command leaves no empty thread or native
session. The old chat remains intact, a device-local pending composer may survive
a reload, and the first real task creates the new durable thread, blank Pi
session, initial title, prompt, and run through one recovery-safe operation.

## Requirement traceability

| Spec requirement                                                                                               | Technical consequence                                                                                                                                                                                                                       | Verification                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TW-10](../../product-specs/thread-workspaces.md#tw-10--exact-new-application-command)                         | Retain exact-command parsing and suggestion, but replace the mutating continuation call with a read-only server preflight followed by a pending-pane transition.                                                                            | Component/API tests prove exact interception, no Pi prompt/steer call, no persistence mutation, argument-bearing slash passthrough, and scoped preflight failures.                                       |
| [TW-11](../../product-specs/thread-workspaces.md#tw-11--pending-chat-first-durable-chat-on-first-prompt)       | Add a discriminated pending-continuation pane assignment and versioned layout-storage migration; create no server conversation until its composer submits.                                                                                  | Layout/storage, route, reload, close, replacement, draft, sidebar, store, and fake-runtime tests prove pending restoration and zero thread/session/run allocation before a prompt.                       |
| [TW-12](../../product-specs/thread-workspaces.md#tw-12--files-are-continuity-conversation-context-is-not)      | First-prompt continuation resolves the source worktree directly, invokes no Git/worktree manager operation, and sends only the explicit first task to a newly created session.                                                              | Generated-repository test compares status/hashes before `/new` and after first dispatch; runtime fixture proves one empty session create followed by only the submitted task and no source context.      |
| [TW-13](../../product-specs/thread-workspaces.md#tw-13--one-active-agent-per-reused-managed-worktree)          | Keep the v8 managed-worktree lease/index and acquire one lease token across title/session/thread creation and first-prompt preflight; recheck availability at both command preflight and first submission.                                  | Barrier tests cover command and first-prompt races against source/sibling preflight and runs, lease release on every failure/settlement path, and unchanged distinct-worktree/shared concurrency.        |
| [TW-14](../../product-specs/thread-workspaces.md#tw-14--first-prompt-creation-naming-idempotency-and-recovery) | Change continuation input/output to prompt plus creation identity and thread-plus-run; extend the durable operation through title, session, thread, prompt dispatch, and run attachment; stop creating new pending-title continuation rows. | Migration and failure-injection tests cover each operation boundary, duplicate/restart recovery, one title/session/thread/accepted prompt/run, rejection behavior, and compatibility with v8 blank rows. |

## Current behavior and affected invariants

- The in-progress v3 implementation intercepts exact `/new`, immediately calls
  `POST /api/projects/:projectId/threads/:threadId/continue`, creates a blank Pi
  session and thread titled `New chat`, and replaces the pane with that thread.
- Migration v8 changes managed-worktree ownership to one-to-many, adds durable
  continuation operations and `threads.initial_title_pending`, and adds the
  persisted one-running-run-per-managed-worktree constraint. Those ownership,
  scope, and lease changes remain required by version 4.
- `WorkspaceService.continueThread` currently ends after session/thread creation.
  The normal `startThread` operation already demonstrates recovery-safe title,
  session, thread, initial-prompt dispatch, and run attachment, but provisions a
  new/shared workspace rather than reusing an existing one.
- `ThreadPane` owns exact-command interception. `TilingSurface` receives a new
  thread ID immediately, and `WorkspaceView` assigns it to the invoking pane and
  navigates to the thread route.
- The tiled layout and its version 2 browser record represent each pane only as
  `threadId | null`; a null pane means configurable ordinary New chat and cannot
  safely encode a same-worktree continuation source.
- Ordinary split/new-chat panes already defer thread/session creation until the
  first prompt, preserve drafts during provisioning, echo a submitted first
  message, and replace the pane with the returned thread.
- Real `WorktreeId` panel scope, one-to-many thread/worktree ownership, legacy
  panel-context recognition, and managed-worktree run exclusion are implemented
  independently of immediate versus deferred continuation and must remain.

Preserved invariants:

- The browser never carries an absolute execution or native session path.
- Worktree readiness and repository identity are authoritative server checks,
  repeated at the first prompt rather than trusted from pending browser state.
- The source thread/session/transcript is neither modified nor copied.
- One native Pi session belongs to one durable application thread; only the
  verified execution root is shared.
- No Git, worktree provisioning, handoff, summary, hidden prompt, confirmation,
  or automatic trigger is introduced.
- Closing/replacing a pane remains a layout operation and never archives or
  deletes a durable thread.

## Scope, non-goals, assumptions, and unresolved technical decisions

### In scope

- A non-mutating continuation-preflight API that checks source ownership,
  managed-worktree readiness/identity, and current workspace-busy state.
- A first-prompt continuation API with strict prompt/idempotency input and a
  parsed thread-plus-run response.
- Durable continuation recovery through title generation, native session
  creation, thread insertion, prompt dispatch recovery, and run attachment.
- One managed-worktree lease owner spanning first-prompt creation and runtime
  preflight without a self-conflict when the generic prompt path is reused.
- A discriminated pane assignment for ordinary new chat, durable thread, and
  pending same-worktree continuation; device-local layout migration and pending
  route behavior.
- Pending composer/draft lifecycle, first-message echo, retry, focus,
  same-pane replacement, source reopening, sidebar invisibility, and no-artifact
  assertions.
- Compatibility for databases and browser layouts produced by the in-progress
  v3 implementation.

### Non-goals

The proposed specification's non-goals are authoritative. This refactor also
does not reverse one-to-many worktree ownership, real worktree panel scope, or
the managed-worktree run lease. It does not merge the ordinary worktree
provisioning operation with continuation creation, add a server-side pending
chat/token, or garbage-collect already-created v8 blank threads/sessions.

### Assumptions

- Device-local layout persistence is sufficient for an unsent pending chat;
  cross-device/server thread navigation begins only after first-prompt creation.
- The source thread ID is the pending pane's authorization/reference handle. The
  browser does not need the worktree ID to request creation, and the server does
  not trust a browser-supplied worktree identity.
- Existing Pi creation IDs and `recoverPrompt` provide the same external-effect
  recovery primitives used by normal first-thread creation.
- Migration v8 may already have been applied to a retained local database even
  though this branch has not been deployed. Plan v2 therefore adds migration v9
  rather than rewriting v8 or assuming any configured database is disposable.

### Unresolved technical decisions

None. The selected route for a pending continuation is
`/projects/:projectId/threads/:sourceThreadId/new`; it names the source binding
without claiming a new durable thread exists and allows refresh/back/navigation
to reconstruct or cancel the pending pane consistently.

## Implementation milestones

### Milestone 1 — Revised contracts and forward-compatible persistence

1. Add strict continuation-preflight response and first-prompt continuation
   request/response schemas. The creation request contains only `prompt` and
   `idempotencyKey`; its response contains the created thread and run. No path or
   browser-selected worktree ID is added.
2. Add migration v9 and matching Drizzle/store parsers. Extend continuation
   operations with bounded title, prompt-command/dispatch identity, and run
   attachment fields plus lifecycle constraints needed for recovery. Do not
   rewrite migration v8 or delete its existing rows.
3. Retain `initial_title_pending` as a compatibility field for v8-created blank
   threads, but make every v4 continuation-created thread non-pending and titled
   from its submitted first prompt.
4. Parse legacy completed v8 operations separately from v9 first-prompt
   operations. Reject malformed mixed states rather than inferring missing
   prompt/run ownership.
5. Add empty-to-v9, v8-to-v9, repeated-startup, backup/newer-version refusal,
   valid legacy row, malformed lifecycle, and relationship/uniqueness tests.

### Milestone 2 — Read-only command preflight

1. Add a parsed read route for continuation preflight under the source thread.
   Resolve project/thread ownership and `ThreadExecutionContextResolver`; require
   a ready managed worktree and consult in-process plus persisted workspace-busy
   state.
2. Return only a bounded availability/result contract. The operation writes no
   receipt, continuation row, thread, session, run, or browser path.
3. Preserve exact `/new` client parsing. On preflight success, clear only the
   command and transition the invoking pane to pending state; on failure retain
   the original thread/draft and show the scoped reason.
4. Add service/API/store-spy tests proving command preflight performs no
   persistent or runtime creation effect, including retries and response loss.

### Milestone 3 — Recovery-safe first-prompt continuation

1. Change the continuation mutation so its canonical request hash includes
   project, source thread, exact prompt, and idempotency identity. Re-resolve the
   source and verified worktree on every new operation/recovery entry.
2. Reserve or recover one v9 operation, derive and persist TW-09's bounded title,
   create/recover a native session at the verified execution root with the
   operation creation ID, and insert one thread linked to the source worktree.
3. Reserve a stable prompt command and dispatch identity. Reuse/extract the
   normal `startThread` recovery sequence: discover whether the native prompt or
   run receipt already exists, dispatch only when absent, attach exactly one
   run, and return the parsed thread-plus-run response.
4. Invoke no worktree-manager or Git operation and provide no source transcript
   data to title generation or the new runtime.
5. Add failure injection before/after title, session create/attach, thread
   insert, dispatch reservation, native acceptance, run receipt, response loss,
   and server reopen. Every retry converges on one title/session/thread/prompt/
   run.

### Milestone 4 — Lease ownership across creation and prompt

1. Refactor managed-worktree preflight ownership into an explicit internal lease
   token (or equivalent single-owner helper) that can span continuation title/
   session/thread work and then be adopted by prompt preflight without treating
   itself as a competing sibling.
2. Acquire the lease before any external runtime effect. Keep it through native
   prompt acceptance and, on success, through run settlement under the existing
   active-worktree bookkeeping.
3. Release exactly once on rejection, title/runtime failure, prompt recovery
   failure, stop, settlement, project removal, and shutdown. The v8 persisted
   partial unique run index remains the cross-process/race backstop.
4. Add simultaneous barrier tests for pending first prompt versus source/sibling
   prompt, two pending siblings, retry/recovery, distinct worktrees, and shared
   Local checkout threads.

### Milestone 5 — Pending pane, route, and layout migration

1. Replace `{ threadId: ThreadId | null }` with a discriminated pane assignment:
   durable thread, ordinary configurable new chat, or pending continuation with
   `sourceThreadId`. Keep tree geometry and pane IDs unchanged.
2. Add workspace-layout storage version 3. Parse v3 strictly and migrate valid v1
   and v2 `{threadId}` records deterministically to thread/new assignments;
   malformed pending source IDs reset through the existing safe fallback.
3. Add a controller operation that converts only the invoking thread pane to a
   pending continuation. Render a focused same-worktree pending composer rather
   than ordinary worktree/shared creation controls.
4. Route the transition to
   `/projects/:projectId/threads/:sourceThreadId/new` when the invoking pane is
   route-addressed. Reload reconstructs/focuses that pending assignment; opening
   the source thread, another thread, or generic `/new` cancels/replaces it
   according to existing pane-selection rules.
5. Persist the pending draft per pane. Closing or replacing the pane removes that
   draft and assignment without any archive/delete API. The pending pane never
   appears in server workspace summaries or the sidebar.
6. Submit the first prompt with one stable creation key, immediate local echo,
   disabled duplicate submission, and byte-for-byte draft restoration on
   failure. On success assign the returned thread, invalidate workspace/
   snapshot queries, focus the live pane, and navigate to its thread route.

### Milestone 6 — Compatibility, regression cleanup, and documentation

1. Remove the immediate continuation mutation from `ThreadPane` and all new-code
   reliance on `initial_title_pending`; retain legacy v8 blank-thread first-title
   behavior so existing retained rows are not renamed incorrectly or stranded.
2. Keep real `WorktreeId` panel scope and its legacy browser-context fallback.
   Prove panel tabs/terminals remain in one execution scope while the chat pane
   moves source → pending → durable continuation.
3. Characterize ordinary split/new-chat behavior and ensure its configuration,
   draft, route, and provisioning paths remain unchanged by the new pane union.
4. Update the interactive prototype and durable architecture/design documents
   after implementation. Run focused/full gates and the disposable-repository
   browser pass; promote specification v4 only after every acceptance criterion
   has evidence.

## Untrusted-data-boundary analysis

| Source and raw representation                   | Entry/read point                                   | Runtime parser                                                    | Trusted output and guarantees                                                                    | Failure behavior                                                                                  | Boundary tests                                                                                          |
| ----------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Composer text                                   | Source and pending composer submit handlers        | Exact-command parser; strict prompt request schema                | Exact `/new` command or bounded non-empty first prompt, never guessed from a near match          | Near matches remain Pi input; malformed/empty first prompt is not submitted                       | exact/whitespace/case/arguments/composition; empty/max/unknown request fields                           |
| Source IDs in route and API                     | Pending route, preflight route, first-prompt route | `ProjectIdSchema` and `ThreadIdSchema`                            | Parsed opaque IDs; no path or browser-selected execution scope                                   | Invalid route fallback or 400; cross-project/archived/shared/unavailable source gets scoped error | malformed, missing, cross-project, archived, removed, shared, missing worktree                          |
| Device-local workspace layout JSON              | `layoutStorage.readLayout`                         | Versioned Zod v1/v2/v3 schemas and explicit migration             | Valid tree plus discriminated thread/new/pending pane assignments                                | Remove malformed record and construct safe initial layout; never invent a source/worktree         | valid migrations, unknown version, invalid union, dangling pane, malformed source UUID, storage failure |
| Continuation-preflight service result           | Browser API client                                 | Shared strict response schema                                     | Bounded availability/reason with no path and no promise that remains true until first submission | Protocol error is scoped; first prompt always rechecks                                            | available/busy/shared/unavailable, malformed/missing/unknown response fields                            |
| v8/v9 continuation-operation SQLite rows        | Every store read/recovery branch                   | Separate lifecycle Zod schemas/constructors                       | Legacy blank completion or v9 first-prompt operation with relationship-consistent identities     | Scoped corruption/startup diagnostic; no guessed dispatch/session/run                             | each valid state, null/mismatched IDs, legacy row, impossible mixed state, dangling relationship        |
| Pi create/discovery and prompt recovery results | Runtime adapter create/open/recover boundaries     | Existing session, cwd, dispatch, and recovery result parsers      | One native session at verified cwd and one accepted dispatch identity                            | Recover/retry or typed failure; never allocate/dispatch blindly                                   | wrong cwd, malformed descriptor, create response loss, accepted/missing/rejected recovery outcomes      |
| Lease/preflight callbacks                       | Workspace runtime coordinator                      | Explicit internal lease owner/token plus existing event narrowing | One owner for a managed worktree across creation, preflight, and persisted run                   | Reject competing operation and release owner exactly once on every terminal path                  | race matrix, throws, reject, settle-before-return, stop/remove/shutdown                                 |
| Thread/run response                             | Browser first-prompt mutation                      | Strict shared continuation response schema                        | Owned durable thread and run; isolated summary carries opaque worktree ID but no absolute path   | Protocol error retains pending draft and stable retry key                                         | malformed/missing thread/run, wrong IDs/workspace shape, duplicate response                             |

No new filesystem/Git input exists. The server reuses the existing execution
context resolver and Pi adapter boundaries; pending browser state is never
promoted into a trusted path or worktree identity.

## Touched-legacy-code analysis

- **Immediate v3 continuation:** Replace its command-time mutation, not the
  one-to-many schema or worktree scope. Characterization tests first prove the
  old thread remains untouched and exact slash parsing remains narrow.
- **Migration v8 and retained databases:** Never edit an already-applied schema
  in place. Migration v9 extends operations. Existing blank threads/sessions and
  completed operations remain readable, reopenable, and subject to pending-title
  compatibility; there is no automatic cleanup.
- **Normal first-thread creation:** Extract or reuse only prompt-dispatch recovery
  mechanics behind tests. Do not route continuation through new-worktree
  planning or alter shared/worktree creation semantics.
- **Layout storage:** v1 and v2 are uncontrolled persisted input. Migrate their
  exact shapes to the new discriminated union and retain the existing reset-on-
  malformed policy. Do not cast old nulls to pending continuation.
- **Route authority:** Add the pending route without changing generic `/new` or
  durable thread deep links. Opening a source thread must cancel/focus rather
  than duplicate it behind an invisible pending assignment.
- **Draft cleanup:** Existing per-pane ordinary-new-chat drafts and thread-keyed
  drafts remain. Pending continuation uses the per-pane key but explicitly
  removes it when assignment is replaced, closing the storage leak that would
  otherwise survive a canceled pending pane.
- **Run lease:** Preserve same-thread behavior, settlement, stop, and shared/
  distinct-worktree concurrency. The refactor changes ownership plumbing only
  so one continuation operation can hold the existing managed-worktree lease
  through its own prompt acceptance.
- **Panel/terminal scope:** Retain authoritative `WorktreeId` identity and
  thread-ID request authorization. Pending state must not retarget or restart a
  tab/terminal.

## Verification

Focused automated checks during implementation:

```sh
pnpm vitest run packages/contracts/src/index.test.ts
pnpm vitest run apps/server/src/db/store.test.ts apps/server/src/domain/workspace.test.ts apps/server/src/app.test.ts
pnpm vitest run packages/pi-adapter/src/index.test.ts packages/pi-adapter/src/persistence.test.ts
pnpm vitest run apps/web/src/api/client.test.ts apps/web/src/features/workspace/layoutTree.test.ts apps/web/src/features/workspace/layoutStorage.test.ts
pnpm vitest run apps/web/src/features/workspace/ThreadPane.test.tsx apps/web/src/features/workspace/NewChatPane.test.tsx apps/web/src/features/workspace/TilingSurface.test.tsx apps/web/src/features/workspace/WorkspaceView.test.tsx
pnpm vitest run apps/web/src/features/panel/tabContext.test.ts apps/web/src/features/panel/panelStorage.test.ts
```

Final static/runtime gate:

```sh
NODE_ENV=test pnpm check
```

Recorded manual browser verification uses only a generated disposable repository,
an explicit temporary `PI_WEB_STATE_DIR`, and a linked-worktree review
environment:

1. Record thread/session/run counts, type `/new`, and verify the invoking pane
   becomes pending while all counts and the sidebar remain unchanged.
2. Reload the browser and verify the pending pane/draft restores device-locally;
   close it and verify the draft disappears and the source thread reopens intact.
3. Repeat `/new`, submit one first task, and verify exactly one new titled thread,
   session, accepted prompt, and run at the same branch/files/execution root.
4. Repeat with staged, unstaged, untracked, and ignored sentinels; compare Git
   status and hashes before command and after first dispatch.
5. Verify `/new anything` and another real Pi slash input stay on the Pi path and
   exact `/new` is absent from source native history.
6. Hold a sibling run/preflight across both command preflight and pending first
   submission; verify scoped busy behavior and draft retention. Verify distinct
   worktree and shared Local checkout concurrency remains.
7. Keep terminal and Files/Changes tabs open through source → pending → durable
   continuation and verify process/tab identity, label, and sentinel access.
8. Inject interruption at every v9 operation boundary and restart; verify one
   title/session/thread/prompt/run. Reopen a retained v8 blank thread and verify
   its compatibility naming behavior.

No configured `.env` database, user project, provider credential, or hosted
application is read or mutated by verification.

## Compatibility, deployment, migration, recovery, and rollback

- Migration v9 is forward-only and runs under backup-before-migration. It adds
  continuation recovery metadata only; it invokes neither Pi nor Git and creates
  no conversation.
- Existing v8 databases remain valid. Already-created blank continuation threads
  and native sessions are retained exactly as user data; they are not hidden,
  archived, renamed, or garbage-collected automatically. Their first-prompt
  pending-title behavior remains supported.
- Layout storage v3 explicitly migrates v1/v2 records. Pending assignments are
  device-local and can be discarded safely only by the specified close/replace
  actions or existing malformed-storage fallback.
- Browser and server deploy together. An old browser's command-time continuation
  request lacks the newly required prompt and is rejected rather than creating a
  malformed operation; a new browser parses the new preflight and thread-plus-run
  contracts.
- A v9 first-prompt operation reserved before failure remains retryable by the
  same source/prompt/idempotency hash and native creation/dispatch identities.
  Source/worktree availability is rechecked without changing its selected root.
- Rollback restores the pre-v9 database backup and prior code together. Code-only
  rollback against schema v9 is unsupported under the existing newer-version
  refusal. Rollback never deletes worktrees, branches, threads, sessions, or
  source files.

## Progress

- [x] Investigated the immediate v3 implementation, normal deferred split/new-
      chat creation, continuation persistence, prompt recovery, managed-worktree
      lease, pane state, layout storage, routes, drafts, panel scope, and current
      migration compatibility.
- [x] Recorded the user's decision to prefer first-prompt creation so abandoned
      `/new` commands produce no empty server thread/session.
- [x] Drafted Thread Workspaces proposed version 4 and plan version 2.
- [x] Received explicit product approval for specification version 4 from the
      user on 2026-08-29.
- [x] Received explicit technical approval for plan version 2 from the user on
      2026-08-29.
- [x] Implemented milestones 1–6: read-only command preflight, layout-v3
      pending assignments/routes, persisted pending draft/creation identity,
      v9 first-prompt recovery, managed-worktree lease adoption, compatibility,
      and durable documentation.
- [x] Completed focused tests and the full static/runtime gate.
- [ ] Complete recorded hands-on browser verification.
- [ ] Promote specification v4, complete/archive the plan, and update indexes.

## Discoveries and blockers

- The normal `NewChatPane` already has the desired delayed-allocation, stable-key,
  first-message echo, and draft-on-failure behavior. Continuation can mirror that
  lifecycle without exposing its editable workspace controls.
- Layout is already persisted device-locally, so a pending continuation can
  survive reload without creating a server thread. Its source ID must be a
  distinct parsed pane variant; overloading `threadId: null` would cause generic
  New chat to lose or silently change execution location.
- Immediate v3 code and migration v8 may have produced retained blank rows in a
  non-disposable database. Forward migration and compatibility are safer than
  rewriting v8 or auto-cleaning data.
- First-prompt continuation cannot simply call the public `prompt` method while
  already holding the worktree lease: it would reject itself as busy. Lease
  ownership must be made explicit or the prompt recovery core extracted.
- A command-time preflight is advisory by nature. Version 4 therefore requires
  authoritative revalidation at first submission and preserves the pending
  draft when state changed in between.
- The pending first-prompt idempotency key must persist beside the draft. Without
  that device-local key, response loss followed by reload would recover the
  text but mint a second server operation. Both are now pruned with their pane.
- `NODE_ENV=test pnpm check` passed after the v4 refactor on 2026-08-29: 63
  Vitest files and 1,337 tests, 12 Node tests, builds, formatting, lint, type
  checks, documentation tests, and documentation navigation.
- Both version 4 approvals were granted on 2026-08-29; production refactoring
  may proceed with tests written before each behavior change.

## Decision and revision log

- 2026-08-29: Created plan version 1 for immediate durable blank continuation;
  user approved specification v3 and plan v1, and implementation began.
- 2026-08-29: Full automated gate passed for the immediate implementation, but
  hands-on verification and specification promotion remained outstanding.
- 2026-08-29: User identified abandoned empty-thread risk and selected deferred
  first-prompt creation as the preferable behavior. This materially changed
  product behavior and architecture; specification advanced to Draft v4, plan
  advanced to Draft v2, and both prior approvals were invalidated.
- 2026-08-29: Plan v2 selected device-local discriminated pending panes, a
  read-only command preflight, forward migration v9, and a recovery-safe
  first-prompt continuation operation while retaining v8 worktree ownership,
  leases, and panel scope.
- 2026-08-29: User said the reload behavior looked good and asked to implement
  it with TDD, explicitly approving Thread Workspaces v4 and plan v2; the plan
  moved to Active.

## Final outcomes

Not completed.
