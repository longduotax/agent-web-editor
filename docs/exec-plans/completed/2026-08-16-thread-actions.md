# Codex-style thread actions and archival

**Status:** Completed

**Plan version:** 1

**Technical approval:** Approved by the user on 2026-08-16 for plan version 1

**Subsystem:** Thread sidebar interactions, archive persistence/API, navigation, and status presentation

**Affected paths or contracts:** `packages/contracts/src/**`, `apps/server/migrations/**`, `apps/server/src/db/**`, `apps/server/src/domain/**`, `apps/server/src/app.ts`, `apps/web/src/api/**`, `apps/web/src/App.tsx`, `apps/web/src/components/Status.tsx`, `apps/web/src/styles.css`, tests under `apps/**`, and current architecture/persistence/web documentation

**Governing specification:** [Thread management current version 2](../../product-specs/thread-management.md)

**Related documents or issue:** [Initial agent workspace](../../product-specs/initial-workspace.md), [initial workspace active plan](../active/2026-08-15-initial-agent-workspace.md), [Parse, Don't Validate](../../architecture/data-boundaries.md), [application persistence](../../design/application-persistence.md), and the user's 2026-08-16 request for Codex-style right-click rename/archive and inline status signals

**Last updated:** 2026-08-16

## Working specification and approval context

This plan implemented [thread management current version 2](../../product-specs/thread-management.md). The user approved product specification version 2 and technical plan version 1 on 2026-08-16; implementation and verification completed in the dedicated worktree.

The approved initial-workspace plan remains the baseline. Its archive non-goal means archival is not silently added to that plan; this separately approved capability owns the forward migration and behavior. Existing project removal, native Pi history, run leases, unread completion markers, and opaque-ID boundaries remain compatible invariants.

## Purpose and user-visible outcome

A user can right-click a thread, or use an accessible keyboard equivalent, to rename or archive it in a compact Codex-style menu. Hovering or focusing a row also reveals a direct Archive icon at its right edge. Archival removes inactive threads from normal navigation without deleting history. Running and unread-completion signals move beside the title and no longer consume a second line.

## Requirement traceability

| Spec requirement                                                                         | Technical consequence                                                                                                                                                                 | Verification                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [TM-01](../../product-specs/thread-management.md#tm-01--codex-style-thread-action-menu)  | Replace the permanent pencil control with a row context menu, keyboard invocation, and a hover/focus-revealed direct Archive icon while retaining the inline rename mutation/editor.  | React tests for contextmenu, keyboard invocation, direct Archive visibility/action, dismissal, focus, submit/cancel, and error retention. |
| [TM-02](../../product-specs/thread-management.md#tm-02--non-destructive-thread-archival) | Add nullable `archived_at`, active-only queries/routes, atomic last-opened fallback and unread exclusion, an idempotent archive command, and server-side running/preflight rejection. | Contract, migration, store, domain race/replay, HTTP, restart, and selected-navigation tests.                                             |
| [TM-03](../../product-specs/thread-management.md#tm-03--inline-compact-thread-status)    | Render icon-only labelled status signals in the title flex row and preserve viewed-completion behavior.                                                                               | Component accessibility/DOM tests and focused CSS/manual narrow-sidebar verification.                                                     |

## Current behavior and affected invariants

- Rename persistence, idempotent PATCH handling, and inline editing already exist. The sidebar exposes rename through a permanent pencil button.
- Thread links use a grid, so `Status` renders icon plus visible text below the title.
- Threads have no archived field. Every thread under an active project is listed, routable, counted for unread aggregation, and considered imported.
- `projects.last_opened_thread_id` can identify any owned thread; project routing falls back to the first listed thread when it is missing.
- Prompt preflight ownership is held in process before a persisted running run exists, so archive authorization must inspect both in-process preflight state and the SQLite run lease.
- Pi JSONL is authoritative conversation history. Archive must only change application metadata and must never remove a session or project file.
- Browser requests continue to carry opaque project/thread IDs and parsed command payloads. No native paths or session paths enter the new contract.

## Scope, non-goals, assumptions, and unresolved technical decisions

### Scope

- Shared strict archive request and response schemas.
- Migration v3 adding nullable `threads.archived_at` without rewriting existing rows; startup backup/version handling and Drizzle schema updates.
- Parsed thread-row support for the nullable timestamp, active-only list/get behavior, explicit include-archived reads for internal duplicate-session checks, unread exclusion, and transactional archival/last-opened fallback.
- An idempotent `POST /api/projects/:projectId/threads/:threadId/archive` command. The service rejects active/preflight work, executes the synchronous metadata transition without an interleaving await, then disposes any inactive opened runtime.
- A browser client mutation, a sidebar menu usable by right-click and keyboard, and a trailing direct Archive icon revealed by row hover/focus. Rename reuses the current editor.
- Inline icon-only spinner/unread/failure/interruption status presentation with accessible labels.
- Focused contract, migration/store, domain/API, and React regression tests plus current docs.

### Non-goals

The specification non-goals apply. In particular, no transcript/session deletion, archive browser, unarchive endpoint/UI, bulk action, new settings area, or running-work cancellation is added. Project soft removal remains separate.

### Assumptions

- `archived_at IS NULL` is the only active-thread representation. Existing rows migrate to active because SQLite adds the nullable column as `NULL`.
- The archive command returns `{ archived: true }` rather than a `ThreadSummary`, because an archived thread is intentionally outside the active summary/read contract.
- Archive does not update `last_activity_at`; activity ordering continues to describe conversation/run activity rather than management actions.
- If the archived thread was last opened, the transaction selects the most recent unarchived sibling by `last_activity_at DESC, id` and stores that ID or `NULL`.
- A session represented by an archived thread remains imported, preventing accidental duplicate import metadata.

### Unresolved technical decisions

None. Exact component extraction is an implementation detail as long as menu focus/dismissal and row ownership remain testable and the approved behavior is unchanged.

## Implementation milestones

1. Add failing contract and persistence tests for the strict archive command, migration v2-to-v3, parsed `archived_at`, active filtering, imported-session retention, unread exclusion, archive idempotence, and last-opened fallback.
2. Implement migration v3, schema/store parsing and transactions, then run the focused database suite.
3. Add failing service/API tests for active/preflight rejection, receipt replay/conflict, active-route exclusion, and non-destructive archival; implement the domain command and route.
4. Add failing React tests for mouse/keyboard menu access, hover/focus direct Archive action, rename, archive navigation/errors, running disablement, dismissal, and inline icon-only status; implement the client and sidebar/status/CSS changes.
5. Run focused and repository checks, perform a narrow/desktop manual interaction check if practical, update architecture/design/component docs, and complete traceability evidence.

## Untrusted-data-boundary analysis

| Source and raw representation                | Entry/read point                         | Runtime parser                                                       | Trusted output and guarantees                                                             | Failure behavior                                                         | Boundary tests                                                                         |
| -------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Archive HTTP JSON body and route params      | Fastify archive route                    | `threadParamsSchema` plus strict shared `ArchiveThreadRequestSchema` | Owned-shape UUID IDs and one idempotency key; service still authorizes ownership/state    | Stable 400/404/409 response without sensitive details                    | Valid, missing, wrong type, extra field, malformed ID, wrong project, running conflict |
| Archive HTTP response in browser             | `archiveThread()` fetch completion       | shared `ArchiveThreadResponseSchema` through `request()`             | Literal successful archive acknowledgement                                                | Browser surfaces malformed response as `invalid_response`                | Valid and malformed client response tests where practical                              |
| SQLite `threads.archived_at`                 | Every thread row read in `MetadataStore` | `threadRowSchema` with `TimestampSchema.nullable()`                  | Trusted null-or-offset timestamp archive state                                            | Scoped corrupt record; list omits only malformed record with diagnostic  | null, valid timestamp, malformed timestamp, migrated legacy row                        |
| Existing schema version and migration state  | `MetadataStore.open()`                   | bounded integer schema-version parser plus ordered v3 migration      | Database is exactly a supported migrated schema                                           | Newer schema fails startup; migration failure leaves prior DB and backup | empty-to-v3, populated-v2-to-v3, repeated startup, newer refusal                       |
| Browser context-menu pointer/keyboard events | Sidebar row and actions trigger          | React event APIs plus state constructed from a known `ThreadSummary` | Menu targets an already parsed active workspace thread; coordinates are presentation-only | Dismiss menu; no command is sent without explicit item activation        | right-click, button, keyboard, Escape/outside dismissal                                |

## Touched-legacy-code analysis

- **Thread row parsing/queries:** Existing rows lack archive state only before migration. Migration v3 constructs the invariant; every post-migration read parses `archived_at`. Active APIs must not accidentally use include-archived helpers.
- **Rename flow:** Preserve the title contract, idempotency, inline draft, and error behavior. Change only how editing is entered and add Escape semantics; keep focused regression coverage.
- **Unread aggregation:** Preserve marker comparison exactly for active threads and add one SQL archive predicate. Archived history and markers remain intact for future restoration.
- **Project fallback:** Preserve route-owned selection. Strengthen persistence so `last_opened_thread_id` cannot continue pointing at a newly archived thread; retain existing browser fallback for unavailable/corrupt legacy references.
- **Run coordination:** Preserve one-running-run-per-thread and direct steering/stop. Archive checks the in-memory preflight/active set and persisted lease and does not stop or settle work.
- **Session discovery/import:** Continue treating every retained thread, including archived metadata, as an existing import so archive cannot duplicate a `(project_id, runtime_session_id)` relationship.
- **Status accessibility:** Replace visible words only in the compact sidebar signal. Keep `aria-label` names and distinct symbols/spinner; activity/transcript and selected-thread header statuses are unaffected unless they reuse this sidebar-only component.

Unrelated sidebar extraction, design-system work, thread search, and persistence cleanup stay out of scope.

## Verification

Focused commands:

```sh
pnpm vitest run packages/contracts/src/index.test.ts
pnpm vitest run apps/server/src/db/store.test.ts
pnpm vitest run apps/server/src/domain/workspace.test.ts apps/server/src/app.test.ts
pnpm vitest run apps/web/src/App.test.tsx
pnpm --filter @pi-web/server typecheck
pnpm --filter @pi-web/web typecheck
```

Final commands:

```sh
pnpm check
pnpm vitest run apps/server apps/web packages/contracts
pnpm --filter @pi-web/server build
pnpm --filter @pi-web/web build
```

Manual verification, if a disposable test-owned state/runtime is available, will cover right-click placement, keyboard focus, outside/Escape dismissal, title truncation, spinner motion, blue unread alignment, archiving selected/nonselected threads, and narrow sidebar layout. No configured `.env` database will be written.

## Compatibility, deployment, migration, recovery, and rollback

Migration v3 is forward-only and creates a timestamped backup before altering a populated v2 database. Existing threads become active (`archived_at = NULL`). A newer database remains rejected. Rollback restores the pre-v3 backup with the old binary; automatic down-migration is forbidden.

Archival retains thread, run, receipt, project, and native Pi records. A future restore feature can clear `archived_at` through another approved command. If a post-archive browser refresh fails, the durable server list remains authoritative and project routing uses the transactionally updated fallback.

Deployment requires only the normal application build/restart process; it does not require Pi Web host deployment unless separately requested. Tests use temporary state directories and fake runtimes only.

## Progress

- [x] Investigated current specification, architecture, persistence design, active plan, sidebar/status code, API/domain/store paths, migrations, and focused tests.
- [x] Drafted and indexed thread management specification version 2 and plan version 1 in the dedicated `feat/thread-actions` worktree.
- [x] Obtained explicit user approval for product version 2 and technical plan version 1 on 2026-08-16.
- [x] Implemented and verified the contract/persistence slice with migration v3.
- [x] Implemented and verified the domain/API slice, including running and preflight rejection.
- [x] Implemented and verified the browser context menu, direct hover/focus Archive action, rename flow, navigation, and compact status signals.
- [x] Updated current docs, promoted specification version 2, and completed/moved the plan.

## Discoveries and blockers

- Rename is already durable end to end; the requested right-click behavior is primarily an interaction-entry change.
- Archive is a persistence/public-contract change and therefore requires Plan-lane approval and migration v3.
- The source development worktree contains unrelated user changes; all planning and future implementation is isolated in `/Users/long/Documents/code_projects/pi-web-thread-actions` on `feat/thread-actions`.
- The user approved both Draft versions on 2026-08-16; no implementation blocker remained.
- Active-list queries must parse archive timestamps before filtering, otherwise a malformed non-null timestamp is silently mistaken for a valid archived thread. Store boundary tests now preserve diagnostics for that case.
- The harness exports `NODE_ENV=production`; React component verification was run with `NODE_ENV=test` so React's test `act()` implementation is available. Production builds still passed in the final check.

## Decision and revision log

- 2026-08-16: Created plan version 1. Chose a distinct thread-management capability because archival and sidebar lifecycle have an independent durable lifecycle while the broader initial-workspace proposal remains active.
- 2026-08-16: Archive is non-destructive, active-only, excludes unread aggregation, updates selected fallback atomically, and deliberately defers restore UI.
- 2026-08-16: Preserve existing unread meaning; only presentation moves inline. A blue dot is not a permanent completed-state marker after the result is viewed.
- 2026-08-16: Clarified the Draft versions before approval: row hover or focus reveals a direct Archive icon on the right; the right-click/keyboard menu contains both Archive and Rename, and no trailing more-actions button is required.
- 2026-08-16: The user explicitly approved thread management specification version 2 and technical plan version 1 and requested TDD implementation; plan status moved to Active.

## Final outcomes

Completed on 2026-08-16 with TDD coverage across contracts, SQLite migration/store behavior, domain coordination, HTTP parsing, and React interaction/accessibility.

- Migration v3 adds parsed nullable archive timestamps and preserves all existing threads as active. Archive is idempotent, excludes active navigation and unread aggregation, updates project fallback atomically, retains imported-session ownership, and never deletes Pi or run history.
- Running or preflight threads are rejected without cancellation. Normal snapshot, prompt, steering, rename, and viewed routes cannot resolve archived threads.
- Right-click and Shift+F10 expose Rename and Archive. Hover/focus reveals the direct Archive icon, rename retains the inline editor, and selected archival returns to project fallback navigation.
- Running spinners and blue unread signals are icon-only, inline with thread titles, and retain accessible labels.
- `NODE_ENV=test pnpm check` passed: formatting, lint, all typechecks, 118 tests across 13 files, all package/application builds, documentation tests, and documentation navigation. The existing Vite bundle-size warning and jsdom canvas notice remain unrelated. Manual provider/runtime testing and host deployment were not performed because this feature is fully covered by temporary-state fake-runtime tests and the user did not request deployment.
