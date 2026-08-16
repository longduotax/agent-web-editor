# Application persistence

**Status:** Approved

**Subsystem:** Project, thread, run, idempotency, and durable UI metadata

**Last verified:** 2026-08-16

**Related documents:** [Initial agent workspace](../product-specs/initial-workspace.md), [initial workspace execution plan](../exec-plans/active/2026-08-15-initial-agent-workspace.md), and [Parse, Don't Validate](../architecture/data-boundaries.md)

## Decision summary

Use `drizzle-orm` with `better-sqlite3`, owned by the server. Drizzle provides a thin typed query/schema layer and committed migrations without hiding SQL or transaction behavior. SQLite remains the storage engine and Pi JSONL remains the transcript source of truth. Every raw database row is parsed at read time; Drizzle's static types are not treated as runtime validation.

The combination is efficient for small local metadata: synchronous in-process access, prepared statements, short transactions, WAL mode, and no database service or network round trip.

## Store location and configuration

- `PI_WEB_STATE_DIR`, when present, is parsed as an absolute state directory.
- The default is `~/.pi/web-workspace/`.
- The directory contains `metadata.sqlite` and bounded migration backups. There is no client-authentication state.
- Startup creates state with user-only permissions and rejects malformed, symlink-escaped, or insecure locations.
- SQLite enables foreign keys, WAL, a bounded busy timeout, and explicit close/checkpoint behavior.

All writable tests create a new temporary state directory and assert ownership before opening it. No test writes to a database configured in `.env` or `.env.*`.

## Drizzle ownership

- `apps/server/src/db/schema.ts` is the relational source used by Drizzle queries.
- `drizzle-kit` generates SQL migration files during development; generated SQL is reviewed and committed.
- Runtime uses Drizzle's `better-sqlite3` adapter and migrator. The server does not run schema generation at startup.
- Repositories use prepared queries where repeated and explicit transactions for multi-record invariants.
- Repository read points pass raw selected values through Zod/domain parsers before returning trusted records. ORM inference only helps author queries.

## Schema v2

Opaque application IDs are server-generated UUIDv4 strings. Times are UTC ISO-8601 strings from an injected clock.

### `projects`

- `id` primary key
- `canonical_path` unique and server-private
- `display_name`, `created_at`, nullable `removed_at`
- `sidebar_expanded` boolean integer
- nullable `last_opened_thread_id`

### `threads`

- `id` primary key
- `project_id` foreign key
- `title`, `runtime_session_id`
- `created_at`, `last_activity_at`
- nullable `last_completed_run_id`, `last_viewed_completed_run_id`
- unique `(project_id, runtime_session_id)` and `(id, project_id)`

### `runs`

- `id` primary key
- `thread_id` and denormalized `project_id` with composite ownership foreign key
- `state` constrained to `running`, `completed`, `failed`, or `interrupted`
- `started_at`, nullable `ended_at`
- unique `accepted_command_id`
- safe categorized failure/interruption metadata only
- partial unique index on `thread_id` while state is `running`, allowing independent threads in one project to run concurrently

### `command_receipts`

- application scope, idempotency key, operation, canonical request hash
- accepted result reference and timestamps
- unique scope/key so retries return one outcome and conflicting reuse fails

No approval table or speculative reviewer-agent schema is added. A future approved automatic-review feature uses forward migrations and explicit new contracts.

## Schema v3: thread workspaces

Migration v3 adds `worktrees`, durable `thread_creation_operations`, and nullable
`threads.worktree_id`. Null preserves every existing/imported thread as a shared
checkout. Worktree rows retain private execution/common-directory paths, base
commit/branch, generated branch, lifecycle, and scoped failure metadata.
Creation-operation rows make naming, provisioning, Pi session creation, thread
insertion, and first-prompt acceptance idempotent across HTTP retries. Migration
itself performs no Git or model operation.

## Repository and transaction rules

- Route handlers never consume Drizzle rows directly.
- A malformed row produces a scoped corrupt-record result. Lists can retain healthy records with explicit diagnostics; they never silently repair or delete data.
- Project registration canonicalizes before transaction. Re-adding a removed canonical path restores retained metadata.
- Removal sets `removed_at` and never cascades into workspace or Pi files.
- Run acceptance writes the receipt/run and acquires the partial unique thread lease atomically. Distinct threads may acquire independent leases even when they share a project.
- Completion updates run state, activity, and last-completed marker atomically. Viewing uses compare-and-set against the displayed completion.
- Project unread state is derived from child thread markers, not an independently mutable boolean.

## Migrations and backups

- Schema v1 used a partial running-run index on `project_id`. Migration v2 preserves all records while replacing it with the `thread_id` partial index.
- Migration SQL and Drizzle's migration journal are committed and versioned.
- Before applying pending migrations to a non-empty database, use SQLite's backup API to create a timestamped sibling backup.
- Migration application is transactional where SQLite permits. Failure leaves the prior database authoritative.
- A database with unsupported newer migrations fails startup with recovery guidance. Automatic down-migration is forbidden.
- Backups have a small documented retention count and never include native Pi files.

## Alternatives considered

- **Raw `better-sqlite3` only:** viable and slightly smaller, but Drizzle reduces repetitive query/schema code while staying close to SQL.
- **Heavy ORM/entity lifecycle:** rejected because metadata is relational and small; hidden lazy loading or implicit writes would hurt predictability.
- **Node built-in SQLite:** deferred until the Node 22 compatibility and packaging story is less risky.
- **JSON metadata files:** rejected because uniqueness, concurrency, idempotency, and restart transitions require transactions.
- **Full transcript in SQLite:** rejected because Pi JSONL is authoritative.

## Failure and recovery

Missing directories or native sessions produce record-scoped unavailable states. Corrupt records do not take down unrelated projects. Database corruption or migration mismatch fails startup without guessing or deleting state. Recovery restores an explicit backup or fixes the source record; native Pi history is untouched.

## Required tests

- Drizzle schema/query integration and real row-parser execution.
- Empty-to-v2 and populated-v1-to-v2 migration, repeated startup, pending-migration backup, rollback, interrupted migration, and newer-version refusal.
- Every table parser with valid, null, missing, wrong-type, enum/time/JSON, and relationship failures.
- Canonical duplicate, soft remove/re-add, unavailable path, two-project restart, and workspace/Pi fixture byte preservation.
- Thread/project ownership, concurrent distinct-thread runs, one-running-run-per-thread enforcement, receipt retry/conflict, and completion/viewed transactions.
- Query plans or focused benchmarks for project/thread ordering and active-run lookup if fixture volume exposes regressions; avoid speculative caching first.
