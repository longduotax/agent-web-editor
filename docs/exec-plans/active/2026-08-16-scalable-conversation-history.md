# Scalable conversation history

**Status:** Ready

**Plan version:** 1

**Technical approval:** Approved by the user on 2026-08-16 for plan version 1

**Subsystem:** Shared transcript contracts, Pi history translation, thread snapshots/live refresh, and browser conversation viewport

**Affected paths or contracts:** `packages/contracts/src/**`, `packages/agent-runtime/src/**`, `packages/pi-adapter/src/**`, `apps/server/src/app.ts`, `apps/server/src/domain/**`, `apps/web/src/api/**`, `apps/web/src/components/**`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, focused tests and current component/design documentation

**Governing specification:** [Scalable conversation history proposed version 1](../../product-specs/scalable-conversation-history.md)

**Related documents or issue:** [Initial agent workspace](../../product-specs/initial-workspace.md), [architecture overview](../../architecture/overview.md), [web workspace composition](../../design/web-workspace-composition.md), [live events and idempotency](../../design/live-events-and-idempotency.md), [runtime and Pi adapter](../../design/runtime-and-pi-adapter.md), and [Parse, Don't Validate](../../architecture/data-boundaries.md)

**Implementation worktree:** `/Users/long/Documents/code_projects/pi-web-conversation-history` on `feat/scalable-conversation-history`

**Last updated:** 2026-08-16

## Working specification and approval context

The new capability specification [Scalable conversation history v1](../../product-specs/scalable-conversation-history.md) is Approved with no open product questions. It extends, but does not replace, the initial workspace's persistent-thread and authoritative-native-history contract. It is independently specified because progressive history navigation and bounded viewport behavior have their own lifecycle, acceptance criteria, failure modes, and reader entry point.

The user explicitly approved product specification version 1 and technical plan version 1 on 2026-08-16. Production implementation may begin under those exact versions; material product or technical changes require renewed approval under the repository workflow.

## Purpose and user-visible outcome

A long thread opens at its latest content without sending or rendering its complete history. The user can page backward through all retained active-branch history without viewport jumps, return directly to current work, and continue following live output unless they deliberately scroll away. The conversation scrollbar becomes less visually prominent without being hidden.

The implementation bounds browser wire, query-cache, Markdown, layout, and DOM work. Pi JSONL remains authoritative and unchanged.

## Requirement traceability

| Spec requirement                                                                                                                | Technical consequence                                                                                                                                   | Verification                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`SCH-01`](../../product-specs/scalable-conversation-history.md#sch-01--open-at-the-latest-conversation-edge)                   | Render chronological pages and use a transcript-owned layout effect to position a new thread at its latest edge before paint.                           | Component tests for mount, reload-equivalent remount, same-route thread change, empty history, and DOM order.                            |
| [`SCH-02`](../../product-specs/scalable-conversation-history.md#sch-02--follow-live-work-without-taking-control-from-the-user)  | Track a near-bottom state, auto-follow only while pinned, preserve anchors during page changes, and expose a return-to-latest control.                  | Geometry-controlled component tests for pinned updates, user scroll-away, live updates while reading, return action, and reduced motion. |
| [`SCH-03`](../../product-specs/scalable-conversation-history.md#sch-03--progressive-access-to-complete-retained-history)        | Add opaque bidirectional transcript cursors, bounded page APIs, explicit older/newer controls, stale-cursor reset, and anchor-preserving prepend.       | Contract, adapter, server, component, and E2E paging/recovery tests over multi-page and changed-branch fixtures.                         |
| [`SCH-04`](../../product-specs/scalable-conversation-history.md#sch-04--bound-browser-work-independently-of-total-chat-length)  | Enforce server-owned item/byte page limits and a five-page browser working window; avoid a virtualizer unless structural profiling disproves the bound. | Deterministic 10,000-item tests asserting page, query-window, and DOM-row ceilings plus recorded browser profiling.                      |
| [`SCH-05`](../../product-specs/scalable-conversation-history.md#sch-05--preserve-authoritative-live-and-recovery-semantics)     | Keep pages as transient Pi projections, coalesce latest-page invalidations, deduplicate by stable item ID, and reset incompatible windows.              | Replay/gap/restart tests, append-during-old-page tests, duplicate overlap tests, and native-fixture byte equality.                       |
| [`SCH-06`](../../product-specs/scalable-conversation-history.md#sch-06--use-a-restrained-but-discoverable-transcript-scrollbar) | Scope thin transparent-track scrollbar CSS to `.transcript` with stronger hover/interaction colors and no smooth scrolling dependency.                  | Browser/manual visual checks in Chromium plus CSS scope assertions and narrow-layout smoke coverage.                                     |

## Current behavior and affected invariants

The current thread route requests `ThreadSnapshotSchema` version 1. Its `transcript` field accepts up to 100,000 complete items. `WorkspaceService.snapshot()` opens the runtime and requests a complete `RuntimeSnapshot`; `packages/pi-adapter` calls `SessionManager.getBranch()`, translates the complete active path, and returns one array. The browser executes the complete shared parser, filters blank assistant messages, maps every remaining item to React/Markdown/activity DOM, starts at scroll position zero, invalidates the same snapshot after every recognized live frame, and also polls every 15 seconds.

Existing partial protections are not sufficient for long chats: tool detail bodies mount only when expanded, stable item IDs are React keys, and individual contract fields are bounded, but network, Zod parsing, query memory, Markdown construction, and row count still scale with total transcript length.

The following invariants must remain true:

- Pi native session history is the complete durable transcript source of truth; no full transcript is copied into SQLite or localStorage.
- The displayed transcript is the current active Pi branch in chronological order, including existing tool-call/result pairing and compaction diagnostics.
- Browser routes and opaque application IDs continue to enforce project/thread ownership; no canonical project path or native session path enters browser contracts.
- Snapshot/live state is transient and replaceable after an epoch change, sequence gap, stale cursor, or server restart.
- Markdown remains safe, tool details remain collapsed by default, and status is not conveyed only by color.
- Other scroll surfaces, run coordination, persistence schema, inspector, and terminal behavior are unchanged.

## Scope, non-goals, assumptions, and unresolved technical decisions

### In scope

- A versioned paged transcript wire contract and server-owned page limits.
- An SDK-neutral page request/response contract and Pi-adapter cursor/index ownership.
- A latest transcript page embedded in an authoritative thread snapshot plus a read-only history-page endpoint.
- Append-stable, branch-sensitive opaque cursors and safe stale-cursor recovery.
- A bounded bidirectional TanStack Query page window with older/newer controls.
- Latest-edge initial positioning, polite live following, anchor-preserving prepend, and return-to-latest behavior.
- Coalesced latest snapshot invalidation so event bursts cannot create parallel full-refresh churn.
- Transcript-only scrollbar styling.
- Contract, adapter, domain, component, structural-performance, and E2E regression coverage.

### Non-goals

- Database schema or metadata migration.
- Full-text history search, browser-side indexing, or rendering unloaded pages for browser Find.
- Pi branch navigation, native compaction changes, native session deletion, or history rewriting.
- Persisted scroll positions.
- A custom virtualizer or new virtualization dependency in the first implementation. A bounded page window caps mounted rows without variable-height measurement complexity.
- Eliminating Pi's in-memory `SessionManager` load of its native file. This plan prevents total history from crossing into the browser and avoids repeated unchanged translation; changing Pi's native loading model is outside the adapter's supported API.
- Provider-backed or writable tests against user sessions.

### Assumptions and fixed plan-v1 choices

- Initial and subsequent pages contain at most 100 display items and target at most 1 MiB of serialized UTF-8 item payload. If the next single schema-bounded item exceeds the byte target, it is returned alone so forward progress is guaranteed.
- The browser retains at most five contiguous pages per selected thread. TanStack Query's bidirectional infinite-query support and `maxPages` implement eviction; an evicted direction remains reloadable through the page cursors.
- Page items remain chronological. Cursors are opaque bounded base64url tokens; the browser never constructs or interprets their decoded representation.
- The adapter token contains a version, boundary identity, direction, and active-branch prefix fingerprint plus an HMAC from a runtime-local random key. The key and native session identity are never encoded. Appending to the branch keeps an older cursor valid; changing history at or before its boundary makes it stale, and runtime replacement invalidates prior tokens.
- A stale cursor returns a stable scoped conflict. The browser discards the incompatible page window, gets the latest authoritative snapshot, and announces the reset without guessing.
- Explicit “Load earlier messages” and, when needed, “Load newer messages” controls are preferred over an automatic top sentinel in v1. They are deterministic, accessible, and avoid accidental request loops during anchor correction. “Jump to latest” resets directly to the current latest page.
- “Near latest” uses a small exported/tested pixel threshold rather than exact equality, accommodating fractional layout and browser rounding.
- No material technical question remains open.

## Technical approach

### Shared contracts and HTTP shape

Introduce a bounded `TranscriptCursorSchema` and `TranscriptPageSchema` in `@pi-web/contracts`. A page contains chronological `items`, nullable `olderCursor` and `newerCursor`, and `atLatest`. The client cannot submit a page size or byte limit.

Bump the thread snapshot wire discriminator to version 2 and replace its complete transcript array with a latest `transcriptPage`. Browser and server are one deployable and migrate together; version 1 malformed/stale responses fail at the existing browser parser rather than being guessed into v2.

Add a read-only endpoint under the owned thread resource:

```text
GET /api/projects/:projectId/threads/:threadId/transcript?cursor=<opaque>&direction=older|newer
```

The route parses path IDs, strict query shape, cursor syntax/length, and direction before ownership lookup. It returns only a `TranscriptPageSchema`. Missing cursor/direction, unknown fields, malformed base64url, stale boundaries, unknown resources, and cross-thread tokens receive stable non-sensitive errors. Cursor semantics are parsed again by the adapter that constructed them.

### SDK-neutral runtime and Pi adapter

Replace the complete-snapshot-only runtime surface with bounded transcript operations:

- `snapshot(pageLimits)` returns the latest page plus SDK-neutral diagnostics;
- `transcriptPage(parsedRequest, pageLimits)` returns an older/newer page or a typed stale-cursor failure.

Limits are trusted server configuration values, not browser input. Fakes implement the same contract and must prove they do not return over-limit arrays.

Inside `packages/pi-adapter`, extract transcript translation into an adapter-owned index that preserves existing entry parsing, item IDs, tool-call/result pairing, active-branch order, diagnostics, and source-entry relationships. `SessionManager.getBranch()` remains the supported source. Cache the parsed translated index while the ordered source path is unchanged; incrementally extend it when the current path is a strict append and rebuild it when the branch diverges. Retain pending tool-call state so an appended result can replace its paired activity without duplication. Dispose the cache with the runtime.

Page packing walks the translated index in the requested direction and stops before either the 100-item limit or 1 MiB target, except that one schema-bounded oversized item is allowed alone. A runtime-local cryptographically random key authenticates the cursor's version, direction, boundary identity, and digest of the active source-prefix through that boundary. The adapter performs strict decode/schema parse, timing-safe HMAC verification, boundary lookup, and prefix verification before returning a trusted page. Runtime replacement intentionally invalidates old cursors. No native path, raw entry, session UUID, or signing key is encoded or returned.

### Server snapshots, live events, and refresh pressure

`WorkspaceService.snapshot()` requests only the latest page and combines it with the existing project/thread/run/capability/epoch metadata. A new history method performs the same project/thread authorization, opens the thread-owned runtime, and delegates the trusted page request. It never marks completion viewed and never writes metadata.

Keep the existing live event broker and authoritative snapshot recovery model. In the browser, parse every frame as today, but coalesce transcript/run/completion invalidations so only one latest-snapshot fetch is in flight and one trailing refresh records events that arrived during it. The 15-second fallback may remain, but it refreshes only the bounded latest page. Older page queries are immutable projections and are not refetched on each live event.

When the viewport is not at latest, a live event sets a “new activity” state and refreshes current run metadata/latest data without replacing the visible old page window. `snapshot_required`, epoch replacement, or stale history resets the history query to latest.

### Browser page state and rendering

Extract the conversation transcript from `App.tsx` into a focused feature/component with its own tests. Seed a bidirectional `useInfiniteQuery` from the snapshot latest page, deduplicate overlapping items by stable ID, reject contradictory duplicates, and retain at most five contiguous pages. Page eviction must preserve the cursor needed to reload the dropped direction.

Render no more than the configured five-page/500-item working set plus bounded diagnostics/live projection. Do not add virtualization initially: variable-height Markdown and expandable tool rows make measurement and accessibility more complex, while the page-window ceiling already provides a deterministic DOM bound. Record a decision to revisit only if profiling the bounded fixture still shows unacceptable layout or Markdown cost.

Use `useLayoutEffect` and a transcript element ref for three distinct operations:

1. on first render or thread-ID change, set `scrollTop` to the latest edge before paint;
2. while pinned near latest, keep the latest edge visible after appended/updated content;
3. when prepending an older page, preserve the visible anchor using a stable item element plus pre/post layout offsets, with scroll-height delta as a tested fallback.

A passive scroll handler updates the pinned state. It does not set React state for every pixel; only threshold crossings update visible controls. “Jump to latest” resets the page query to the authoritative latest page, positions the edge, and resumes following. Page loading/error/end controls use buttons and restrained status announcements.

### Scrollbar styling

Apply `scrollbar-width`/`scrollbar-color` and WebKit scrollbar pseudo-elements only to `.transcript`. Use a transparent track, thin rounded low-contrast thumb, and stronger hover/active or focus-within thumb. Do not set `display: none`, do not affect code block/inspector/terminal scrollbars, and do not add smooth scrolling. Existing reduced-motion behavior therefore remains valid.

## Implementation milestones

### Milestone 1 — contracts and bounded runtime page model

1. Add failing shared-schema tests for valid latest/older/newer pages, strict cursor/direction parsing, item and cursor limits, malformed versions, unknown keys, and oversized arrays.
2. Add failing fake-runtime contract tests proving latest and directional pages are bounded and stale cursors are typed failures.
3. Implement snapshot v2, transcript page/cursor schemas, SDK-neutral page types, and fake support.
4. Run contract/runtime typechecks and tests before touching Pi or HTTP composition.

### Milestone 2 — Pi adapter index, paging, and cursors

1. Add controlled v1-v3/branch/compaction/tool fixtures with more than one page.
2. Write red tests for chronological latest pages, older/newer traversal, no gaps/duplicates at page boundaries, item/byte packing, one oversized item, tool pair straddling a source boundary, append-stable cursors, divergent-branch stale cursors, malformed/forged tokens, cache reuse, append extension, rebuild, and disposal.
3. Extract the translator/index without changing existing small-session output, then implement packing and opaque cursor construction/parsing.
4. Verify native fixture bytes are unchanged and no path/session identifier enters returned DTOs or diagnostics.

### Milestone 3 — server snapshot/history API and refresh behavior

1. Add failing domain and Fastify tests for bounded latest snapshots, directional history, ownership, removed/unavailable threads, malformed query/token, stale conflict, safe errors, and no viewed-state mutation.
2. Implement the version-2 snapshot composition and read-only transcript endpoint.
3. Add broker/browser-client tests for one in-flight plus one trailing coalesced refresh and confirm older page keys are not invalidated by token bursts.
4. Run server integration tests using only generated sessions/temp state.

### Milestone 4 — bounded browser history and viewport behavior

1. Extract the transcript component and add geometry-controlled tests before behavior changes.
2. Implement latest-edge mount/thread-switch behavior, near-bottom following, scroll-away protection, and return-to-latest.
3. Add the bidirectional five-page query window, explicit older/newer controls, ID deduplication, stale reset, and anchor-preserving prepend/eviction.
4. Add scoped thin scrollbar CSS and verify other scroll surfaces retain their styles.
5. Cover loading/error/end announcements, keyboard operation, empty threads, reduced motion, and narrow layouts.

### Milestone 5 — structural performance, E2E, and durable documentation

1. Generate a deterministic 10,000-item mixed transcript without provider credentials or user files.
2. Assert latest/history responses stay within page bounds, query state never retains more than five pages, and the transcript mounts no more than 500 item rows plus bounded controls/diagnostics.
3. Exercise open-at-latest, multiple older pages, page eviction/reload, live activity while reading old history, jump-to-latest, reconnect reset, and stale-cursor recovery in Playwright.
4. Record a Chromium performance profile for initial long-chat open and live update; use it diagnostically, not as a hardware-dependent CI threshold.
5. Update architecture, web/runtime/Pi component guides, and the two affected design documents to describe implemented pagination, cursor recovery, bounded browser state, and remaining native SessionManager limits.
6. Promote the approved specification only after all acceptance evidence passes, complete/archive this plan, and update both indexes.

## Untrusted-data-boundary analysis

| Source and raw representation                         | Entry/read point                                | Runtime parser                                                                                                                             | Trusted output and guarantees                                                                          | Failure behavior                                                                                               | Boundary tests                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Route project/thread IDs and transcript query strings | Fastify history route                           | shared branded ID, strict direction, and bounded cursor query schemas                                                                      | known query shape for one syntactically valid owned resource request                                   | 400 for malformed; 404 for unknown/cross-owned resource                                                        | missing, duplicate, unknown keys, bad direction, overlong/non-base64 cursor, unknown and cross-thread IDs                     |
| Opaque cursor text returned later by a browser        | Pi adapter page method after route parsing      | base64url decoder, versioned internal Zod schema, timing-safe runtime-local HMAC verification, boundary lookup, prefix-digest verification | cursor was constructed by this runtime for the direction and a still-compatible active-branch boundary | typed malformed or stale failure; no index guessing                                                            | valid both directions, forged payload/signature, wrong version/runtime/direction, missing boundary, append, branch divergence |
| Native `SessionManager.getBranch()` entries           | Pi adapter index construction/extension         | existing versioned entry/message/tool parsers plus explicit source-index constructors                                                      | chronological translated active-branch items with stable IDs and source relationships                  | omit malformed supported entries with bounded diagnostic or fail scoped session when identity invariants break | v1-v3, compaction, branch, custom, malformed, duplicate IDs, tool result before/after page boundary                           |
| Page limits from server composition                   | runtime/adapter call                            | startup-owned positive integer/byte limit constructors or module constants                                                                 | finite trusted limits unavailable to browser control                                                   | fail startup/test construction; never coerce browser values                                                    | zero, negative, non-integer, excessive config if made configurable; browser cannot override                                   |
| Adapter-generated transcript page                     | server service boundary                         | `TranscriptPageSchema.parse` before response                                                                                               | bounded chronological DTO with parsed cursors and item fields                                          | scoped adapter/protocol failure; do not return partial malformed page                                          | oversized item arrays, contradictory cursors, duplicate IDs, invalid item, byte packing edge                                  |
| HTTP page/snapshot JSON                               | browser API client                              | shared snapshot-v2 and transcript-page schemas                                                                                             | bounded parsed query data owned by TanStack Query                                                      | scoped protocol error and recovery to latest when possible                                                     | valid, v1/unknown version, malformed cursor/item, oversized arrays, missing fields                                            |
| Live WebSocket frames and unknown payload             | browser live client                             | existing envelope parser followed by event-specific handling when consumed                                                                 | known epoch/sequence/event category used only to schedule bounded authoritative refresh                | ignore malformed JSON; close/reset according to existing protocol; never trust payload as history              | burst, duplicate, malformed, gap, reset, close/reconnect, event during refresh                                                |
| Browser scroll geometry                               | transcript DOM read during layout/scroll events | finite-number normalization and near-edge predicate                                                                                        | finite distances used only for viewport behavior                                                       | fall back to latest on new thread; no persisted or wire effect                                                 | zero-height jsdom, fractional values, negative/NaN test doubles, resized viewport, prepended page                             |
| TanStack cached pages                                 | merge/render boundary after parsed HTTP         | page-window reducer keyed by stable item ID and cursor adjacency                                                                           | one contiguous bounded window without contradictory duplicate IDs                                      | discard/reset incompatible window and surface scoped notice                                                    | overlap, duplicate identical item, duplicate ID/different content, missing adjacency, eviction both directions                |

No database row, environment variable, filesystem path, or new durable serialization is introduced. Persisted Pi data remains untrusted on every adapter read.

## Touched-legacy-code analysis

- `ThreadSnapshotSchema` v1 and `OpenRuntimeSession.snapshot()` currently imply a complete transcript. Characterize small-session output before replacing them; migrate every fake, adapter, server, and browser caller in one branch rather than adding an unchecked optional second shape.
- `transcriptFromManager()` currently performs full active-branch translation and tool pairing in one pass. Extract that logic under existing fixture tests first. Preserve output IDs/order/diagnostics exactly for histories that fit one page; page boundaries must not duplicate separate tool call and result rows.
- `useLive()` currently validates only the live envelope and invalidates queries for each frame. Preserve authoritative snapshot recovery and sequence ownership while adding coalescing; do not promote unknown payload to transcript truth.
- `Transcript` currently lives in `App.tsx` and renders chronological items directly. Preserve Markdown safety, activity semantics, empty state, stable keys, and project display-path behavior while extracting it.
- The transcript's `overflow: auto` participates in the center flex layout on desktop and narrow screens. Preserve `min-height: 0`, composer visibility, and drawer behavior; style only its scrollbar.
- No public external client compatibility or independent browser/server deployment is promised. Nonetheless, use a snapshot version bump so stale bundles fail explicitly instead of accepting a partially compatible response.

Unrelated App decomposition, global state changes, generic list frameworks, and inspector/terminal styling remain out of scope.

## Verification

Focused red-green commands:

```sh
pnpm vitest run packages/contracts
pnpm vitest run packages/agent-runtime
pnpm vitest run packages/pi-adapter
pnpm vitest run apps/server/src/domain apps/server/src/app.test.ts
pnpm vitest run apps/web
```

Package and repository gates:

```sh
pnpm --filter @pi-web/contracts typecheck
pnpm --filter @pi-web/agent-runtime typecheck
pnpm --filter @pi-web/pi-adapter typecheck
pnpm --filter @pi-web/server typecheck
pnpm --filter @pi-web/web typecheck
pnpm check
pnpm test:e2e
```

Recorded browser verification uses the deterministic fake runtime and generated 10,000-item history. It checks desktop and narrow viewports, keyboard controls, latest positioning, older/newer paging, live follow/scroll-away, stale reset, DOM row count, and transcript-only scrollbar appearance. No configured `.env` database, user project, native user session, provider credential, or production host is read or written.

## Compatibility, deployment, migration, recovery, and rollback

- Browser/server/contracts deploy together. Snapshot version 2 intentionally rejects a stale version-1 peer with a scoped protocol error; there is no compatibility shim that would restore an unbounded transcript.
- No SQLite migration or native Pi migration occurs. Native JSONL bytes remain unchanged.
- Existing session versions and active-branch semantics remain adapter-owned. Pagination cursors are ephemeral and may be discarded across server restart, runtime replacement, branch divergence, or rollback.
- Cursor failures recover by discarding browser page state and obtaining the latest authoritative snapshot. They never delete or rewrite history.
- Rollback restores the version-1 complete-snapshot behavior in code only; no persisted data needs rollback. Because that behavior is the original performance risk, rollback is operationally safe but not a long-chat optimization.
- Deployment does not require restarting or updating the hosted app during implementation. Any later host update must use the dedicated `update-pi-web-host` skill and explicit host state verification.

## Progress

- [x] Inspected the screenshot and current transcript component/styles.
- [x] Read the repository workflow, architecture, product index, active plan, browser/live/runtime designs, component guides, source, contracts, tests, and current snapshot path.
- [x] Confirmed current long-chat work is unbounded across adapter translation, HTTP/browser parsing, query state, and DOM, with only per-item/schema and collapsed-tool-detail protections.
- [x] Read the pinned Pi 0.84.2 SDK/session documentation and `SessionManager` declarations/implementation relevant to active-branch entries and stable IDs.
- [x] Created the isolated `feat/scalable-conversation-history` worktree branch.
- [x] Drafted and indexed specification version 1 and plan version 1.
- [x] Received explicit user approval for scalable conversation history specification version 1 on 2026-08-16.
- [x] Received explicit user approval for scalable conversation history plan version 1 on 2026-08-16.
- [ ] Implement milestones 1-5 under the approved versions.

## Discoveries and blockers

- Pi `SessionManager` loads and owns the native entry tree and exposes stable entry IDs plus `getBranch()`/`getLeafId()`. The supported SDK does not offer backward page reads from disk. This plan therefore bounds all browser work and caches/reuses adapter translation, but does not claim that opening a native session consumes memory independent of native file length.
- The current browser ignores live payload content and invalidates the complete snapshot for every recognized frame. Once snapshots are bounded, coalescing those invalidations is sufficient for this slice and preserves authoritative recovery without introducing a second transcript reducer.
- Item-count limits alone are insufficient because transcript fields are individually large. Page packing therefore uses count and serialized-byte targets with a one-item progress exception.
- Variable-height virtualization is not required to establish a hard DOM ceiling when the browser retains only five pages. Deferring it avoids dynamic measurement, browser-find, focus, and expanded-tool complexity.
- No implementation blocker or unresolved product/technical decision remains. The approval gate is satisfied.

## Decision and revision log

- 2026-08-16: Classified long-chat scalability as Plan lane because it changes shared wire/runtime contracts and durable user-visible history behavior.
- 2026-08-16: Created a separate scalable-conversation-history capability rather than revising the still-in-progress initial-workspace proposal; the new capability has an independent lifecycle and governs progressive history navigation/performance.
- 2026-08-16: Chose bounded bidirectional pages and a five-page browser window before virtualization.
- 2026-08-16: Chose explicit page controls for v1 to keep loading and scroll anchoring accessible and deterministic.
- 2026-08-16: Chose adapter-owned append-stable, branch-sensitive opaque cursors and no native-history persistence changes.
- 2026-08-16: Created plan version 1 in Draft; product and technical approvals were pending.
- 2026-08-16: The user explicitly approved product specification version 1 and technical plan version 1; the plan moved to Ready.

## Final outcomes

Not completed. Production implementation has not started.
