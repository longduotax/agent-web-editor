# Initial agent workspace

**Status:** Active

**Plan version:** 1

**Technical approval:** Approved by the user on 2026-08-15 for plan version 1

**Phase:** No-authentication security revision approved; implementation active

**Subsystem:** Projects, threads, agent runs, live events, workspace UI, inspector, and terminal

**Affected paths or contracts:** `apps/web/src/**`, `apps/server/src/**`, `packages/contracts/src/**`, `packages/agent-runtime/src/**`, `packages/pi-adapter/src/**`, package manifests and test configuration, `docs/design/**`, `docs/architecture/**`, and `docs/development/workflows.md`

**Governing specification:** [Initial agent workspace proposed version 1](../../product-specs/initial-workspace.md)

**Related documents or issue:** [Architecture overview](../../architecture/overview.md), [Parse, Don't Validate](../../architecture/data-boundaries.md), and the user's 2026-08-15 request for a TDD implementation plan

**Last updated:** 2026-08-16

## Approved specification and approval context

The canonical [initial agent workspace specification](../../product-specs/initial-workspace.md) is approved. On 2026-08-15 the user approved removing launch-token and browser-session authentication so starting the server and opening its plain loopback URL loads the workspace immediately. The approved revision deliberately allows any same-machine process to access the server while retaining loopback-only binding, exact Host checks, browser Origin/CSRF protections, resource ownership checks, and filesystem containment. The prior choices of a configurable port, Drizzle with SQLite, Pi direct execution, and separately designed future reviewer-agent work remain unchanged.

This plan and the approved technical designs reflect that revision. A renewed specification approval is required if implementation would materially change behavior, acceptance criteria, scope, non-goals, compatibility, or boundaries.

## Purpose and user-visible outcome

Replace the static scaffold with a loopback-only browser workspace where a user can register local projects, create or import persistent Pi-backed threads, run and steer one agent at a time per project, review durable completion state, inspect files and Git changes, and use one project terminal. Routes, application metadata, native Pi history, unread completions, and reconnection behavior must survive the restarts promised by the product specification.

Implementation follows strict red-green-refactor cycles. Every behavior starts with a failing test at the narrowest useful layer, adds only enough production code to pass, and is refactored while that test remains green. Cross-layer acceptance tests are added before a vertical slice is considered complete.

## Measurable acceptance criteria

The implementation is complete only when all eleven product-specification acceptance criteria pass and the following evidence exists:

1. Restart tests prove two registered projects remain present, canonical duplicate paths are rejected, and removal/re-addition restores retained metadata without touching workspace or Pi files.
2. Persistence and route tests prove every thread belongs to exactly one project, has one opaque runtime-session reference, restores history, and can be selected independently in two browser contexts.
3. API security tests prove the browser never supplies or receives an authoritative project path or native session path after registration.
4. Run state-machine tests prove accepted prompts, steering, stop, direct Pi tool execution, failure, interruption, and the one-running-run-per-project constraint.
5. Restart and UI tests prove unread completion indicators aggregate by project and clear only when the relevant completed result is viewed.
6. Snapshot/live-event tests prove reconnecting during and after a run produces one authoritative transcript with no duplicate accepted prompt, run, message, or completion.
7. Inspector tests prove Git unavailable/status/diff behavior, searchable file browsing and safe previews, and one project-scoped PTY with permitted browser Origin checks and resize/restart/terminate behavior.
8. Boundary tests cover every source in the boundary inventory below with valid, malformed, missing, unauthorized, and relevant legacy/corrupt cases.
9. Accessibility tests prove every run state has text or an icon label in addition to color, the direct-execution warning is visible, and narrow-screen sidebar/inspector drawers are operable.
10. The deterministic fake-runtime end-to-end suite passes without provider credentials or access to a real user database; a real Pi adapter smoke test uses only controlled session fixtures unless the user explicitly opts into a credentialed runtime test.
11. `pnpm check` and the dedicated integration and end-to-end commands documented during implementation pass.
12. Startup prints a plain loopback URL and credential-free HTTP/WebSocket tests prove the workspace works without tokens or cookies while Host, browser Origin/CSRF, ownership, and containment checks remain enforced.

## Current behavior and affected components

Implementation is now underway across every target component:

- `apps/web/src/App.tsx` composes route-owned project/thread selection, parsed Query clients, transcript/run controls, responsive navigation, and Files/Changes/Terminal inspector views.
- `apps/server/src/app.ts` composes parsed configuration, credential-free loopback request policy, SQLite metadata, project/thread/run routes, live and terminal WebSockets, filesystem/Git boundaries, and injected Pi/fake runtimes.
- Shared contracts, the SDK-neutral runtime interface, and the Pi adapter have concrete public APIs. Migration v1 is committed under `apps/server/migrations/`.
- Vitest and Playwright cover contracts, configuration, request policy, persistence/restart, HTTP path redaction, run idempotency and project leases, file containment, safe Markdown, routes, and direct-execution disclosure.
- The Pi SDK remains pinned to `0.84.2`; real-provider and writable native-session verification remains intentionally omitted without explicit approval.

The existing dependency direction remains invariant:

```text
apps/web -> packages/contracts
apps/server -> packages/contracts + packages/agent-runtime + packages/pi-adapter
packages/pi-adapter -> packages/agent-runtime + packages/contracts + Pi SDK
packages/agent-runtime -> packages/contracts
packages/contracts -> no workspace package
```

Browser code must never import server, runtime, adapter, SDK, Node filesystem, Git, database, or PTY modules. SDK types and raw SDK values stop at `packages/pi-adapter`.

## Scope

- Shared parsed HTTP, live-event, inspector, and terminal wire contracts.
- User-selected loopback port, plain launch URL, and credential-free request policy with retained Host, browser Origin/CSRF, resource ownership, and containment checks.
- Drizzle/SQLite application metadata storage, migrations, repositories, removal retention, recovery, and restart reconciliation.
- Project registration/removal/re-addition and Pi-session discovery/import.
- Thread creation/rename/navigation, snapshots, and native transcript translation.
- Run lifecycle, project-level mutual exclusion, prompt idempotency, steering, stop, Pi-compatible direct tool execution, interruption, completion, and unread state.
- Reconnectable live events with authoritative snapshots.
- Git status/diffs, safe file tree/search/preview, and one project-scoped PTY.
- Dark responsive three-region React workspace with drawers, Markdown/code rendering, collapsible activity, and accessible state indicators.
- Unit, contract, integration, component, end-to-end, restart, recovery, and security tests.
- Current architecture, component guides, technical designs, and development workflow updates.

## Explicit non-goals

The product specification's non-goals remain unchanged: archival or permanent history deletion, browser editing, Git write operations, multiple concurrent runs in one project, sub-agents, manual or reviewer-agent command approval, cloud/multi-user behavior, OS/browser notifications, terminal persistence over server restarts, and any claim of OS-level sandboxing.

Also excluded from this plan:

- Reading provider credentials in browser code or inventing a web credential-management UI.
- Copying complete Pi transcripts into the application database.
- Treating working-tree changes as owned by a thread.
- Building a generic remote-agent protocol or supporting SDKs other than the pinned Pi adapter.
- Running tests against any database from `.env` or `.env.*`; all writable test storage must be created in a test-owned temporary directory.

## Assumptions and implementation invariants

- The server remains bound to `127.0.0.1` on a parsed user-selected port and intentionally has no client authentication; any same-machine process can access it.
- The browser uses opaque application IDs. A server repository lookup, not a browser path, resolves project roots and native sessions.
- Application metadata is relational and transactional; native Pi JSONL remains the full transcript source of truth.
- Removal is soft deletion. Re-addition is matched by canonical path and restores retained metadata.
- Run state uses `running`, `completed`, `failed`, and `interrupted` with explicit timestamps/references, never a single `active` boolean.
- A database constraint and an in-process coordinator both enforce at most one `running` run per project.
- Live events are transient projections. A snapshot reconstructed from parsed persistence/runtime state is authoritative after gaps or reconnects.
- Agent tools follow Pi's native trust and direct-execution behavior with no application approval layer; the terminal remains a separate user-controlled process.
- All rendered Markdown and command/file output is treated as untrusted display content; raw HTML is disabled or sanitized under a documented allowlist.
- Tests inject clocks, ID generators, runtime adapters, process runners, filesystem roots, and PTY factories to remain deterministic.

## Approved technical designs

The implementation gate is satisfied by the indexed designs under `docs/design/`:

1. No client authentication, a plain launch URL, exact Host/browser-Origin request policy, and CLI/environment/default port precedence.
2. Drizzle ORM with `better-sqlite3`, committed migrations, runtime row parsers, transactions, backups, and soft deletion.
3. SDK-neutral Pi session/runtime translation using Pi's native resources, project trust, and direct tool execution with an explicit no-sandbox warning.
4. Idempotent HTTP commands plus bounded sequenced WebSocket snapshots/replay.
5. Canonically contained file access, machine-parsed Git, and one Origin-restricted browser PTY per project that remains accessible to same-machine processes.
6. React Router, TanStack Query, parsed browser boundaries, safe Markdown, xterm, responsive layout, and accessibility behavior.

Future reviewer-agent command approval is not part of this implementation. It requires a new approved specification/design and forward migrations rather than speculative initial contracts.

## Target contracts and component structure

Exact filenames may be refined by the approved designs, but ownership should converge on these locations rather than a single large entry point:

- `packages/contracts/src/`: branded opaque IDs; timestamp and error schemas; project/thread/run DTOs; snapshot and sequenced-event envelopes; HTTP command schemas; Git/file DTOs; terminal client/server frame schemas. Public types are inferred from runtime schemas.
- `packages/agent-runtime/src/`: SDK-neutral session discovery/open/create, snapshot, prompt acceptance, steering, stop, event, capability, and typed failure interfaces. A deterministic fake belongs in tests, not the public production adapter.
- `packages/pi-adapter/src/`: Pi session discovery/locator, native-session parser/translator, `AgentSession` ownership, resource/trust integration, SDK-event narrowing, prompt preflight/event buffering, and error mapping. Only this package imports the Pi SDK.
- `apps/server/src/config`, `request-policy`, `db`, `domain`, `routes`, `live`, `inspector`, and `terminal`: composition and boundary adapters. Fastify route handlers parse then call services; services do not receive raw requests, rows, SDK events, paths, or process output.
- `apps/web/src/app`, `api`, `features/projects`, `features/threads`, `features/runs`, `features/inspector`, and `components`: route-owned selection, parsed API/live clients, feature state, and accessible views.
- `apps/**/__tests__`, colocated `*.test.ts(x)`, package tests, `test/fixtures`, and `e2e/`: tests at their narrowest owner, with shared fixtures containing no secrets or user paths.

## TDD working agreement

For every checklist item below:

1. Write a test that fails for the intended reason and record the focused command in the progress log.
2. Implement the smallest behavior that makes it pass; do not pre-build later layers.
3. Refactor names, duplication, and component boundaries only while focused tests stay green.
4. Add the next boundary/integration test before wiring another external source.
5. Run affected-package typecheck and tests after each green slice, then the repository static gate at each milestone.
6. Never make a test pass by weakening a parser, adding an unchecked cast, sleeping for timing, sharing mutable global fixtures, or accepting a broader origin/path/identifier.

Tests use temporary directories and databases, ephemeral ports, deterministic fake runtimes, fake process/PTTY adapters, and controlled Pi JSONL/event fixtures. Wall-clock time, UUIDs, and event ordering are injected. Writable tests must assert that their paths are under the test temp root before opening storage.

## Implementation milestones

### Milestone 0 — establish the test harness and efficient dependency baseline

**Red:** Add harness self-tests that demonstrate browser component rendering, Fastify injection, temporary persistence, fake runtime events, fake process/PTY adapters, and multi-page end-to-end startup. Add an import-boundary test or lint rule that fails on forbidden dependency directions.

**Green:**

- Keep the six approved design documents indexed and update this plan's decision log as discoveries arise.
- Add package-local runtime dependencies only where owned, including Drizzle/`better-sqlite3`, and test dependencies/scripts for Vitest projects/environments, React Testing Library and user-event, accessibility checks, Fastify integration, and Playwright.
- Make `passWithNoTests` unnecessary once the first behavior tests exist.
- Add factories for temporary project directories, a temporary application state directory, deterministic IDs/clocks, a fake agent runtime, fake Git/process output, and fake PTY sessions.
- Add root commands that clearly separate unit/contract, integration, and end-to-end checks.

**Refactor/gate:** Run harness tests twice to detect leaked handles or shared state. No provider call, user project scan, configured database access, or production service startup occurs in this milestone.

### Milestone 1 — contracts, configuration, and local-client request security

**Red:** Start with schema tests for every opaque ID, command body, response, event envelope, and terminal frame. Add startup tests for missing/malformed configuration and Fastify tests for credential-free access, wrong Host/Origin, CSRF attempts, malformed JSON, oversized payloads, and rejected WebSocket upgrades.

**Green:**

- Implement schema-first exports in `packages/contracts`, deriving all wire types from Zod.
- Parse state-directory, port, host, and limits exactly once at startup; fail safely without logging secrets.
- Remove launch tokens, sessions, cookies, bootstrap/logout routes, browser auth state, and their contracts/dependency; print a plain loopback launch URL.
- Retain exact Host checks for HTTP, exact Host/Origin checks for WebSockets, and Origin plus `X-Pi-Web-Request` checks for unsafe HTTP methods.
- Add a non-sensitive readiness endpoint and stable error envelope, without exposing paths, credentials, stack traces, or adapter internals.
- Configure development proxying and production static hosting according to the design.

**Refactor/gate:** Centralize request parsing and error mapping without hiding resource ownership checks. Run contract tests in both browser and Node build contexts and credential-free request-policy integration tests over HTTP and WebSocket.

### Milestone 2 — metadata schema and project vertical slice

**Red:** Write migration/repository tests against a new temp database: empty-to-v1 migration, repeated startup, malformed/unsupported schema, parsed-row failures, canonical-path uniqueness, soft removal, re-add restoration, two-project persistence, unavailable directory, non-Git directory, and migration rollback/backup behavior. Then add project-service and Fastify injection tests, followed by sidebar component tests.

**Green:**

- Implement the approved embedded store, migration runner, row schemas, transactions, and repositories for projects, threads, runs, command receipts, and durable UI metadata.
- Implement server-side realpath/canonicalization and authorization by opaque project ID.
- Add/list/remove/re-add project APIs. Never return canonical paths unless the approved UI contract explicitly defines a redacted display form; never accept a path on project-scoped follow-up calls.
- Preserve workspace and Pi files on removal; expose unavailable and non-Git states without deleting metadata.
- Build the dark responsive shell and project sidebar with expand/collapse, add, confirmation-based remove, loading, empty, unavailable, and error states.

**Refactor/gate:** Restart the server fixture over the same temp state directory and prove two projects and expansion state survive. Assert file hashes under removed test workspaces are unchanged.

### Milestone 3 — threads, routes, native session discovery/import, and history

**Red:** Add repository/service tests for exact project ownership, title/activity ordering, last-opened thread, rename, and removed-project behavior. Add Pi adapter fixture tests for session list/open, v1-v3/compacted/branched JSONL, malformed header/entry/message/tool data, mismatched cwd, missing file, and SDK exceptions. Add API authorization tests and browser route/component tests, including two independent history objects.

**Green:**

- Define the SDK-neutral session locator and transcript snapshot contract.
- Implement new persistent Pi session creation, discovery of existing sessions for the canonical project, import metadata without rewriting JSONL, and safe open/translation through the adapter.
- Implement create/list/get/rename/import thread APIs and project-only route fallback to the project's last-opened thread.
- Implement `/projects/:projectId/threads/:threadId` selection, indented activity ordering, narrow-screen sidebar drawer, Markdown/code transcript rendering, and scoped unavailable/corrupt states.
- Update last-opened thread as convenience metadata without making it global browser selection.

**Refactor/gate:** Compare native session fixture bytes before and after discovery/import. Run a two-browser-context route test showing one tab's selection does not replace the other tab's route or transcript.

### Milestone 4 — run state machine, direct Pi execution, steering, and stop

**Red:** Model run transitions as table-driven tests. Cover accepted/rejected prompt preflight, duplicated idempotency keys, two concurrent submissions in one project, runs in different projects, steering attached to the current run, wait-draft behavior, abort, provider/tool error, server shutdown, and illegal transitions. Start service tests with the fake runtime, then adapter tests with exhaustive controlled Pi events and native resource/trust fixtures.

**Green:**

- Implement the SDK-neutral runtime interface and a per-thread runtime owner in the server.
- Acquire the project execution lease transactionally before prompt acceptance. Buffer adapter events until Pi preflight confirms acceptance, then atomically persist command receipt/run state before publishing; discard/reconcile rejected preflight without a phantom run.
- Translate narrowed Pi messages, text deltas, tool calls/results, command cwd/output/exit state, retry/compaction, and terminal errors into application events without leaking SDK objects.
- Implement explicit steer, wait-draft semantics, and stop commands with idempotency and ownership checks.
- Use Pi's native resources/project trust and direct tool behavior without an application blocking hook; show the direct-execution/no-sandbox disclosure before tools are enabled.
- Reconcile unfinished runs to `interrupted` on restart unless the adapter proves a reconnectable live runtime.
- Render the composer, active-send choice, stop action, collapsible tool/command activity, trust warning, and accessible running/failure/interruption cues.

**Refactor/gate:** Run transition tests under randomized event interleavings with fake timers. Ensure a thread can remain readable while another thread in its project owns the run lease. Any unrecognized SDK event fails at the adapter boundary or maps to an explicitly designed unsupported-event diagnostic; it is never cast through.

### Milestone 5 — authoritative snapshots, live reconnection, and unread completions

**Red:** Write broker tests for subscribe/snapshot race, monotonic sequence, duplicate frames, out-of-order frames, ring-buffer gap, slow consumer, reconnect before/after completion, and runtime replacement. Add database/service tests for last-completed versus last-viewed semantics and project aggregation. Add component tests for already-viewing-at-completion and opening an unread result.

**Green:**

- Implement credential-free live subscriptions using the approved Host/Origin policy, bounded buffers, heartbeat/dead-client cleanup, and parsed sequence/cursor frames.
- Construct authoritative thread snapshots from parsed Pi history plus application run metadata. Atomically register a subscriber around snapshot capture so no event is lost between snapshot and live delivery.
- On unknown/expired cursor or malformed client state, send a reset instruction and a fresh snapshot rather than guessing or replaying duplicates.
- Persist completion and viewed markers transactionally; derive project unread state from retained thread/run metadata.
- Render streaming text/activity and durable thread/project unread indicators. Mark viewed only when the completed result is actually open; if it is already open, render a brief completion state without durable unread.

**Refactor/gate:** Use event IDs/message IDs as render keys and prove applying a snapshot plus replay twice is idempotent. Restart over the same temp database/session fixtures and verify unread markers survive and clear correctly.

### Milestone 6 — safe Files and Changes inspector views

**Red:** Add path parser/resolver tests for empty, absolute, `..`, separator variants, NUL, encoded traversal, symlink-to-outside, symlink loops, replacement races where practical, missing/inaccessible files, binary/oversized content, and project mismatch. Add Git parser fixtures for clean, added/modified/deleted/renamed/untracked paths, spaces/newlines, non-repository, command failure, malformed output, large diff, and concurrent working-tree changes. Add inspector component tests first.

**Green:**

- Implement project-ID-based file tree/search/preview endpoints with approved canonical containment checks, limits, ignore policy, and copy-safe relative display paths.
- Invoke Git without a shell, set cwd from the authorized project record, parse machine-readable status output, and expose bounded unified/split diff data with explicit truncation/unavailable states.
- Build collapsible/resizable inspector behavior, Changes and Files tabs, changed-file navigation, search, read-only syntax-highlighted preview, copy path/content, responsive drawer mode, and scoped errors.
- Clearly label Changes as project-wide current working-tree state.

**Refactor/gate:** Run all filesystem/Git tests only in generated temp fixtures. Assert no endpoint can name or read a file outside the authorized canonical root and no response contains the server's absolute fixture root.

### Milestone 7 — project terminal

**Red:** Write terminal-manager tests against a fake PTY for lazy creation, exactly one session per project, two clients attaching, project ownership, input/resize bounds, replay buffer policy, restart, terminate, socket disconnect, child exit, project removal, and server shutdown. Add malformed binary/text frame, unpermitted-origin, credential-free, and cross-project attachment tests. Write terminal UI tests before mounting the emulator.

**Green:**

- Implement the approved PTY adapter and project terminal manager behind an injectable interface.
- Start the parsed user shell in the canonical project directory only on demand; keep it alive while the server PTY lives; bound output buffering and dimensions.
- Parse every attach/input/resize/restart/terminate frame and reject unpermitted browser origins or invalid/cross-project IDs; no client credential is required.
- Mount the approved browser terminal renderer, fit/resize it, expose restart/terminate controls and trust warning, and integrate it into the inspector drawer/panel.
- Dispose process trees, listeners, buffers, and sockets deterministically. On server restart, report the prior terminal as gone and permit clean recreation.

**Refactor/gate:** Leak tests must leave no child processes, sockets, timers, or listeners. Terminal input/lifecycle must remain separate from agent runtime commands.

### Milestone 8 — acceptance hardening, recovery, accessibility, and documentation

**Red:** Encode each product acceptance criterion as an end-to-end scenario before final polish. Add adversarial suites for malformed database rows, malformed Pi fixtures/events, unavailable directories/session files, hostile Markdown, deep-link refresh, server restart during a run, stream loss, duplicate command submission, and unrelated-project isolation.

**Green:**

- Complete compact dark styling, resizers, drawers, focus restoration, keyboard behavior, accessible names/live regions, non-color status cues, and minimal animation/reduced-motion behavior.
- Add scoped recovery guidance for corrupt/unavailable project, thread, session, Git, terminal, and run state.
- Add deterministic end-to-end process fixtures that restart the server against temp metadata and native session directories and use a fake runtime for agent outcomes.
- Update `docs/architecture/overview.md`, component READMEs, and `docs/development/workflows.md` to describe only implemented behavior, data flow, migrations, test isolation, and commands.
- Reconcile all design documents with final decisions and archive this plan after final review.

**Refactor/gate:** Run the full verification matrix below, inspect the final diff, and record any omitted real-provider/manual checks and residual risk.

## Untrusted-data-boundary analysis

Every row below needs a concrete parser name and test path in the approved designs or implementation. Persistence and internal transport are untrusted again on read.

| Source and raw representation                     | Entry/read point                      | Constructing runtime parser                                                          | Trusted output and guarantees                                        | Failure behavior                                                       | Required boundary tests                                                                                      |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Environment/CLI strings                           | server startup                        | configuration schema plus path/port/limit constructors                               | complete immutable startup config; loopback host only                | fail startup with non-secret diagnostic                                | valid, missing default/required, wrong type/range, unknown or insecure host                                  |
| Host, Origin, CSRF headers                        | Fastify hook and WebSocket upgrade    | exact Host/Origin membership and mutation-header checks                              | request satisfies configured routing/browser-integrity policy        | 403 or close socket; no CORS reflection                                | absent, hostile website, forged Host, credential-free access, selected-port dev/prod origins                 |
| HTTP params/query/body and content type           | each route                            | exported Zod wire schema followed by ownership lookup                                | normalized command/ID scoped to authorized records                   | stable 400/404/409 without path or secret leakage                      | valid, malformed, missing, oversized, unknown ID, cross-project ID                                           |
| Browser command idempotency key                   | prompt/steer/stop and metadata routes | branded key parser plus receipt repository                                           | one principal/action/payload identity                                | return prior result or conflict; never execute twice                   | retries, same key/different payload, concurrent duplicates, restart                                          |
| Browser live-event cursor and socket frames       | live connection                       | event command/frame schemas                                                          | bounded known subscription/control command                           | reject/reset/close according to protocol                               | malformed JSON/binary, stale/future cursor, duplicate/out-of-order, oversized                                |
| Browser terminal frames                           | terminal socket                       | discriminated terminal frame schemas and numeric limits                              | authorized input/resize/lifecycle operation for one project terminal | reject frame or close; never coerce dimensions/IDs                     | malformed UTF-8/JSON, huge input, invalid dimensions, cross-project attach                                   |
| Database metadata/schema version                  | store open and migration              | schema-version parser/migration preconditions                                        | supported transactional schema                                       | refuse open or recover from backup; never guess/down-migrate           | empty DB, current, older supported, newer unsupported, interrupted migration                                 |
| Database rows and serialized fields               | every repository read                 | table-specific row schemas and JSON parsers                                          | domain records with opaque IDs, dates, enums, nullable relationships | scoped corrupt-record error/quarantine; unrelated records continue     | valid, null/missing/wrong type, bad enum/date/JSON, dangling relation                                        |
| User-supplied registration path                   | add-project service                   | non-empty path parser then server realpath/stat/access checks                        | canonical accessible directory                                       | safe registration error; no partial record                             | relative/absolute policy, missing, file not dir, inaccessible, symlink alias, duplicate canonical path       |
| Stored canonical project path/filesystem metadata | each filesystem/runtime use           | row parser then realpath/stat availability check                                     | currently available authorized root                                  | scoped unavailable state; retain metadata                              | removed/moved/inaccessible root, symlink retarget, permission change                                         |
| Project-relative file selector                    | file endpoints                        | strict relative-path constructor plus containment/open policy                        | file handle/path proven within project under approved race model     | reject traversal/escape or report unavailable                          | dot segments, absolute, separators, encoding, NUL, symlink escape/loop/race                                  |
| Directory entries and file bytes                  | tree/search/preview read              | `Dirent`/stat narrowing, UTF-8/binary/size parser                                    | bounded safe preview/tree DTO                                        | skip/surface scoped entry error or explicit binary/truncated state     | malformed names, disappearing file, binary, huge, unreadable, invalid UTF-8                                  |
| Git stdout/stderr/exit                            | process adapter                       | parser for selected `-z`/bounded diff formats and exit mapping                       | typed status/diff/unavailable result                                 | scoped malformed/failed/unavailable response; no shell fallback        | clean and all statuses, unusual paths, non-Git, malformed/truncated, timeout/nonzero                         |
| Native Pi session listing metadata                | Pi adapter discovery                  | adapter-owned exhaustive parser/narrowing plus cwd match                             | discoverable opaque session descriptors for one project              | omit with diagnostic or scoped import error; never expose path         | valid, malformed, mismatched cwd, duplicate ID, unavailable file                                             |
| Native Pi JSONL/session-manager output            | adapter open/snapshot                 | versioned adapter parsers for headers, entries, messages, content, usage, tool data  | SDK-neutral transcript snapshot preserving supported history         | scoped corrupt/unavailable thread; do not rewrite/delete               | v1-v3, branches, compaction, custom entries, malformed/truncated/unknown forms                               |
| Pi SDK events/callback payloads                   | session subscription                  | discriminated exhaustive narrowing and field parsers                                 | SDK-neutral ordered runtime event/failure                            | typed adapter failure/diagnostic; never cast through or leak internals | each supported event, wrong field type, unknown type, partial update, SDK throw                              |
| Pi prompt preflight and promise settlement        | adapter command controller            | explicit accepted/rejected/settled state machine                                     | one accepted prompt correlated to one app command/run                | discard rejected buffer; fail/reconcile accepted run once              | reject before acceptance, event-before-callback, resolve/reject after acceptance, duplicate callback defense |
| Agent tool name/input/result                      | Pi tool events                        | adapter-owned tool/result parsers and bounded display mapper                         | displayable direct-execution activity without raw SDK values         | scoped adapter diagnostic; Pi owns execution behavior                  | built-in and extension tools, malformed args/results, bounded command/path/output display                    |
| PTY output, exit, and errors                      | PTY adapter callback                  | byte/string normalization, bounded buffering, exit schema                            | terminal output/exit frames with no assumed text safety              | truncate/drop per protocol and surface exit/error                      | split UTF-8, binary/control sequences, huge bursts, exit/signal/error                                        |
| Markdown/code/tool/command strings                | web render boundary                   | contract parser plus Markdown renderer configured without raw HTML or with sanitizer | DOM content that cannot execute attacker HTML/URLs                   | render escaped text or safe error                                      | script/event handlers, dangerous URLs, raw HTML, huge code/output                                            |
| Browser route and persisted UI values             | router/startup                        | route schemas and explicit UI-storage parser                                         | per-tab selection and supported durable UI settings                  | canonical fallback/not-found; clear only invalid UI cache              | malformed/deleted IDs, project-only fallback, two tabs, stale UI version                                     |

Resource ownership follows parsing: a well-formed ID/path/command is still rejected if it does not belong to the requested project/thread/run/terminal relationship. This scoping does not authenticate the caller.

## Touched-legacy-code analysis

There is no legacy product behavior or persisted application format. The touched paths are scaffold code with these current invariants to preserve:

- `buildServer()` is injectable and importing `main.ts` is the only operation that binds a port. Preserve this separation and add characterization tests before composition grows.
- Server and Vite development listeners are loopback-only. Preserve this in configuration/startup tests.
- Strict TypeScript options, ESM output, package public entry points, and one-way workspace dependency ownership remain in force.
- The browser's missing-`#root` failure remains explicit; routing/providers wrap `App` without hiding startup failure.
- Existing static shell text and styling have no compatibility promise and are intentionally replaced, but baseline 320px support and dark appearance are retained.
- Pi SDK `0.84.2` is the only concrete external runtime. Adapter fixture tests characterize the exact used surface so a later SDK upgrade has a visible compatibility gate.

No old API callers, database rows, migrations, or browser storage formats need compatibility shims. Do not introduce speculative legacy fields. If implementation discovers pre-existing Pi session forms beyond documented v1-v3 behavior, record them in adapter fixtures and decide explicit support rather than weakening parsers.

## Verification matrix

Focused commands will be added to package scripts during Milestone 0. The intended final matrix is:

```sh
# Schema, domain, adapter, and component TDD loops
pnpm vitest run packages/contracts
pnpm vitest run packages/agent-runtime
pnpm vitest run packages/pi-adapter
pnpm vitest run apps/server
pnpm vitest run apps/web

# All deterministic unit/contract tests
pnpm test

# Temp-database, filesystem, Git, PTY-adapter, HTTP, socket, restart tests
pnpm test:integration

# Multi-page browser acceptance tests; starts only test-owned services
pnpm test:e2e

# Package and repository gates
pnpm --filter @pi-web/contracts typecheck
pnpm --filter @pi-web/agent-runtime typecheck
pnpm --filter @pi-web/pi-adapter typecheck
pnpm --filter @pi-web/server typecheck
pnpm --filter @pi-web/web typecheck
pnpm check
```

Final runtime verification uses only generated projects and test-owned state:

1. Start the end-to-end server fixture on an ephemeral loopback port with a temp state directory and fake runtime.
2. Add two temp projects (one Git, one non-Git), create/import threads, exercise deep links in two contexts, complete/fail/interrupt runs, direct tool activity, unread clearing, reconnect, files/diffs, and terminal lifecycle.
3. Restart the test server over the same temp state and native fixtures and rerun persistence/recovery assertions.
4. Optionally perform one real Pi prompt in a disposable project only with explicit user approval and available credentials. Its omission does not get hidden; adapter fixture coverage and fake-runtime E2E results are reported separately.

Do not read or write a database configured by `.env`/`.env.*`, and do not use the user's real Pi sessions or projects as writable fixtures.

## Acceptance traceability

| Product criterion                     | Primary automated evidence                            |
| ------------------------------------- | ----------------------------------------------------- |
| 1. Two durable projects               | Milestone 2 migration/restart E2E                     |
| 2. Nested durable threads/history     | Milestone 3 repository, adapter fixture, restart E2E  |
| 3. No browser authoritative paths     | Milestones 2/3 API shape and authorization tests      |
| 4. Recorded streaming run states      | Milestone 4 state-machine/fake-runtime E2E            |
| 5. Durable unread indicators          | Milestone 5 persistence/UI/restart tests              |
| 6. Route-addressable independent tabs | Milestone 3 two-context E2E                           |
| 7. Changes, Files, Terminal inspector | Milestones 6/7 integration and browser tests          |
| 8. Safe remove/re-add                 | Milestone 2 byte-preservation/restart tests           |
| 9. Pi session import without rewrite  | Milestone 3 before/after fixture-byte tests           |
| 10. Reconnect without duplicates      | Milestone 5 snapshot/replay and E2E disconnect tests  |
| 11. Boundary failures are scoped/safe | Boundary table suites and Milestone 8 adversarial E2E |

## Compatibility, deployment, migration, recovery, and rollback

- This is the first application API and metadata schema; no external wire compatibility exists. Once a slice lands, schema and route changes require explicit version/migration handling.
- Keep Pi-specific compatibility in `packages/pi-adapter`; pin the SDK until adapter fixtures pass against an intentional upgrade.
- Initial metadata setup and every later migration run transactionally in the application state directory. The approved persistence design must define pre-migration backup, fsync/durability expectations, newer-version refusal, and restoration instructions. Tests may migrate only test-owned databases.
- Soft removal is reversible by canonical-path re-add. No rollback or migration may delete project files or native Pi JSONL.
- A corrupt project/thread/session is isolated and visible; unrelated records continue. Recovery never silently edits malformed native history.
- Code rollback must leave a newer database untouched if the old binary cannot parse its schema; fail startup with recovery guidance rather than down-migrating automatically.
- Server restart interrupts non-reconnectable runs and destroys PTYs. Browser reconnect obtains fresh snapshots and may recreate terminals.
- Production exposure beyond loopback is unsupported. Do not add `0.0.0.0`, remote proxy, or multi-user deployment instructions under this plan.

## Progress

- [x] Read the approved product specification, current architecture, data-boundary rules, development/ExecPlan workflows, active-plan index, component guides, source scaffold, package manifests, and test configuration.
- [x] Confirmed there is no overlapping active plan and recorded pre-existing uncommitted specification/history documentation without modifying it.
- [x] Reviewed the pinned Pi SDK session, runtime, steering, event, resource/trust, and session-format APIs needed to make the milestones concrete.
- [x] Created and indexed this living TDD ExecPlan.
- [x] Drafted, revised, approved, and indexed the six technical designs required by the implementation gate.
- [x] Revised the canonical specification for configurable port, Drizzle/SQLite, direct Pi execution, and deferred reviewer-agent approval.
- [x] Received approval for and documented removal of process/browser authentication while retaining loopback and request-integrity boundaries.
- [x] Removed authentication implementation/contracts/UI/dependency and added credential-free HTTP, WebSocket, launch URL, and immediate-rendering regression coverage.
- [x] Verified the no-authentication revision with `pnpm check` and `pnpm test:e2e`.
- [ ] Milestone 0: establish the test harness and efficient dependency baseline (baseline delivered; full fixture/leak gate pending).
- [ ] Milestone 1: contracts, configuration, and local-client security (baseline delivered; adversarial WebSocket matrix pending).
- [ ] Milestone 2: metadata schema and project vertical slice (baseline delivered; migration backup/rollback matrix pending).
- [ ] Milestone 3: threads, routes, Pi discovery/import, and history.
  - [x] Materialize newly created blank Pi sessions atomically so they can be listed and reopened before their first prompt and after a server restart.
  - [x] Present native tool calls and results as compact Pi-style activity rows with readable operation summaries and expandable raw details, without changing the authoritative transcript DTO.
- [ ] Milestone 4: runs, direct Pi execution, steering, and stop.
- [ ] Milestone 5: snapshots, reconnection, and unread completion state.
- [ ] Milestone 6: Files and Changes inspector views.
- [ ] Milestone 7: project terminal.
- [ ] Milestone 8: acceptance hardening, recovery, accessibility, and durable documentation.
- [ ] Complete final review, archive the plan, and update active/completed indexes.

## Discoveries and blockers

- The specification and six designs are approved; no design blocker remains for initial implementation.
- The first implementation pass delivered migration v1, project/thread/run APIs, Pi session ownership, live events, inspector/PTY boundaries, the responsive workspace, deterministic Vitest coverage, and a production-build Playwright route scenario. The initially delivered process authentication has been removed under the approved no-authentication revision. Milestones 3-8 retain hardening work before this plan can be archived.
- Pi `prompt()` resolves only after the full run, while `preflightResult` reports acceptance earlier and synchronously. The adapter/coordinator therefore needs a tested buffer-and-commit handshake so early SDK events cannot precede the durable run record and rejected prompts cannot create phantom runs.
- Pi currently executes enabled tools without application permission popups. The web workspace intentionally matches that behavior and must disclose the lack of approval/sandboxing.
- Pi session history is versioned JSONL with branching and compaction. The adapter should use `SessionManager` for access but still narrow every returned/raw shape at its boundary and keep native paths server-private.
- Pi SDK 0.84.2 does not write a newly created session until an assistant message exists. Recording that in-memory UUID as durable thread metadata made the first prompt fail because a fresh listing could not resolve it. The adapter now narrowly parses and exclusively materializes the new manager's initial JSONL before returning the UUID; temp-directory restart coverage verifies the session can be discovered and opened without a provider call.
- “Wait until it finishes” is resolved as a local draft that can be submitted as a new run after settlement, not Pi follow-up queueing.
- Native history represents a tool call and its result as separate transcript items. Rendering both as bordered raw-JSON cards duplicated every operation and overwhelmed the conversation; the Pi adapter now pairs each pending/result item by native tool-call ID before browser presentation, while preserving the parsed snapshot as authoritative state.
- The existing working tree already contains uncommitted approved-specification and completed-plan files. They are user work and must remain intact.

## Decision log

- 2026-08-15: Classify the work as Plan lane and keep the canonical product specification authoritative.
- 2026-08-15: Use vertical slices with red-green-refactor at contract, service, adapter, UI, and acceptance levels rather than implementing all backend layers before tests/UI.
- 2026-08-15: Require deterministic fake-runtime E2E tests and controlled Pi fixtures; real provider access is optional, explicit, and separately reported.
- 2026-08-15: Supersede the earlier process-local authentication decision: use no client authentication, print a plain loopback URL, accept same-machine process access, and retain Host/browser-Origin/CSRF defenses.
- 2026-08-15: Use Drizzle ORM with `better-sqlite3`, prepared queries, committed migrations, backups, and runtime row parsing.
- 2026-08-15: Match Pi's native trust and direct tool execution; defer manual and reviewer-agent command approval to a future specification.
- 2026-08-15: Retain “wait” prompts locally until the active run settles rather than using Pi follow-up.
- 2026-08-16: Materialize validated blank Pi session JSONL with exclusive creation because SDK 0.84.2 intentionally defers persistence, while the approved product requires unprompted threads to survive server restarts.
- 2026-08-16: Follow Pi's tool-rendering hierarchy in the browser: one compact semantic row per operation by default, status without color dependence, and bounded raw input/output only on explicit expansion.

## Final outcomes

Implementation is active. The current baseline delivers migration version 1,
credential-free loopback access, persistent projects/threads/runs, SDK-neutral
Pi runtime ownership, prompt idempotency and project leases, snapshot/live event
transport, bounded Files/Changes/Terminal boundaries, and the responsive browser
workspace. Current verification passes `pnpm check`, including 97 Vitest tests
and production builds, plus the previously recorded `pnpm test:e2e` run (one
production-build browser scenario).

Before archiving, complete the remaining Milestone 3-8 adversarial adapter,
replay/backpressure, Git/PTY lifecycle, accessibility, multi-context restart,
and full acceptance scenarios. The Vitest suite now includes temp-directory
coverage for reopening an unprompted Pi session after runtime replacement. No
credentialed provider prompt or writable test against existing native Pi
sessions has been run.
