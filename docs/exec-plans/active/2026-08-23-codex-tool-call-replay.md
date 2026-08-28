# Codex tool-call replay

**Status:** Active

**Plan version:** 2

**Technical approval:** Approved for plan version 2 on 2026-08-23 by the user (longduotax), together with Agent backends specification version 3, by explicitly asking to implement the drafted bounded progressive history approach. Plan version 1 was approved earlier that day and was superseded before implementation.

**Subsystem:** Codex transcript reconstruction — a bounded resumable reverse reader over Codex's own session files, its parse boundary, and page composition inside `packages/codex-adapter`

**Affected paths or contracts:** new `packages/codex-adapter/src/rollout/**`; `packages/codex-adapter/src/index.ts` (paged history composition) and `src/mapping.ts` (one shared shell-command normalisation); the provider-neutral page contracts, runtime methods, server routes, and bounded browser transcript window owned by the [Scalable conversation history plan](2026-08-16-scalable-conversation-history.md); `apps/server/src/config.ts` (`PI_WEB_CODEX_HOME`, `PI_WEB_CODEX_REPLAY_TOOLS`); `.env.example`; `README.md`; `packages/codex-adapter/README.md`; `docs/architecture/overview.md`; focused Vitest and Playwright suites and fixtures. No database schema or migration.

**Governing specification:** [Agent backends](../../product-specs/agent-backends.md) proposed version 3 — this plan implements AGB-10 through AGB-13 and changes nothing in AGB-01 through AGB-09

**Related documents or issue:** [Codex agent runtime implementation plan](2026-08-22-codex-agent-runtime.md) (version 1, whose known limitation this plan answers), [Scalable conversation history implementation plan](2026-08-16-scalable-conversation-history.md) (whose bounded pages and cursors this plan must compose with rather than fight), [Parse, Don't Validate](../../architecture/data-boundaries.md), [Architecture overview](../../architecture/overview.md), the [`AgentRuntime` interface](../../../packages/agent-runtime/src/index.ts), and the [Codex adapter README](../../../packages/codex-adapter/README.md)

**Implementation branch:** `feat/codex-agent-runtime`

**Last updated:** 2026-08-23

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Working specification and approval context

Product behavior change: **Yes.** The governing proposal is
[Agent backends](../../product-specs/agent-backends.md) specification version
**3**, **Approved**. This plan version 2 is also approved and Active. Version 2
of the specification and plan version 1 were approved on 2026-08-23, but they
allowed today's complete browser snapshot to remain until later pagination
work. The follow-up requirement makes bounded progressive loading part of replay
itself. The user explicitly approved both revised documents by asking to
implement them under the
[agent implementation workflow](../../development/agent-implementation-workflow.md).

Version 1 of the specification is approved, implemented, and unpromoted; this
plan does not change its backend behavior. Preserved invariants:

- Pi transcript content is unaffected end to end. Shared paging changes its
  transport shape and loading behavior only; existing translated items, order,
  identities, live semantics, and native history remain unchanged.
- Persistence remains unchanged. Replay produces the same `TranscriptItem`
  values the workspace already renders.
- The provider-neutral bounded page contract, HTTP routes, and one bounded
  browser page window come from Scalable conversation history. This plan extends
  that path for Codex; it does not create a parallel Codex-only history stack.
- `recoverPrompt` keeps `thread/read` as its **only** source of prompt-arrival
  evidence. Nothing in this plan may make crash recovery depend on a file.
- A chat opens, prompts, steers, stops, and streams whether or not replay
  succeeds (AGB-12).

## Purpose and user-visible outcome

A reopened Codex chat shows the shell commands and file changes it showed while
running, in place, instead of messages alone. It opens with one bounded latest
page and fetches older messages and tools together only when requested, so total
browser work does not grow with total chat length. Complete product rules live
in the governing specification and are not restated here.

## Reversing version 1's app-server-only posture

Plan version 1 built the Codex adapter entirely on `codex app-server`'s public
protocol and declined to read Codex's own storage. **This plan reverses that.**
The reversal is the single most consequential decision here, so it is stated
before the design rather than buried in it.

A correction first: version 1's known-limitation note attributes the choice to
"decision 2", but decision 2 as recorded there is about vendoring generated
protocol types. The posture being reversed is the plan's architecture — the
adapter talks to the app-server and to nothing else — not a numbered decision.
It was, and remains, the right default.

It is reversed here for four reasons:

1. **The protocol does not serve this data at all.** Verified against real Codex
   0.149.0: `thread/read` with `includeTurns: true` returns `itemsView: "full"`
   and still yields only `userMessage` and `agentMessage`; `thread/resume` and
   the `experimentalApi` capability return the same two. There is no option,
   parameter, or capability that returns a past turn's tool items. The choice is
   therefore not "private file versus public API"; it is "private file versus a
   permanent hole in AGB-05".
2. **The app-server itself hands us the file.** `thread/read` returns the
   session's exact location as `thread.path`. This plan reads the one path Codex
   names, never a directory it discovers by scanning, so the dependency is on a
   value the supported API supplies.
3. **The read is strictly read-only, bounded, and confined.** Nothing in this
   workspace writes to Codex's storage; the reader opens one file, reads
   backwards under hard byte and item caps, and touches nothing else.
4. **Failure is contained by design.** AGB-12 makes a parse failure degrade to
   exactly today's behaviour plus one line. The blast radius of a format change
   is a missing marker, not a broken chat, and the [risk register](#external-dependency-risk-and-exit)
   below defines when the reader is deleted rather than maintained.

## Requirement traceability

| Spec requirement                                                                                                       | Technical consequence                                                                                                                                                                                                                                                                           | Verification                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [AGB-10](../../product-specs/agent-backends.md#agb-10--a-reopened-codex-chat-shows-the-tool-calls-it-showed-live)      | A `rollout/` reader in `packages/codex-adapter` that locates the file from `thread.path`, reads it backwards, projects tool entries in **both** stored dialects onto `TranscriptItem`, and splices them into the turns `thread/read` returns; messages continue to come from `thread/read` only | Tasks 1–7 unit suites over fixtures captured from real files; manual checks 1, 2, 3, and 5                              |
| [AGB-11](../../product-specs/agent-backends.md#agb-11--replay-covers-the-history-the-chat-shows-and-is-read-on-demand) | Reverse chunked reading receives exactly the bounded turn set requested by the shared history-page operation and stops once that page is covered; a per-line cap and safety byte ceiling remain failure guards, not normal page boundaries                                                      | Tasks 2, 6, and 8 prove latest and older requests do not read outside their requested turn range; manual check 4        |
| [AGB-12](../../product-specs/agent-backends.md#agb-12--unreadable-tool-history-degrades-to-messages-never-to-failure)  | Every replay failure is caught inside the adapter and converted to the page's message-only content plus one `info` diagnostic item; `PI_WEB_CODEX_REPLAY_TOOLS=off` disables replay wholesale                                                                                                   | Task 7 drives missing file, unreadable file, unknown dialect, and reader exception; Task 9 config tests; manual check 6 |
| [AGB-13](../../product-specs/agent-backends.md#agb-13--restored-codex-history-is-bounded-and-loaded-progressively)     | Reuse the provider-neutral latest/older page contract and single bounded browser page window from Scalable conversation history. Codex message and tool projection are composed server-side per page; no complete transcript response or second browser cache is permitted                      | Shared-history conformance tests plus Tasks 6–8 and Playwright over a deterministic long Codex fixture                  |

Acceptance criterion 20 — a chat never reads stored history it is not
displaying — is now a shipping criterion rather than future structural
compatibility. It is verified end to end: opening requests the bounded latest
page, requesting older history reads only that page's turn range, and browser
state never owns the complete transcript.

Acceptance criterion 23 — a Pi chat's reopened transcript is unchanged — is
verified by the existing `packages/pi-adapter` transcript fixtures remaining
byte-for-byte equivalent within page boundaries, plus shared paging conformance
tests for both backends. Shared transport changes may touch Pi composition, but
must not change Pi transcript content.

## Current behavior and affected invariants

`CodexOpenSession.snapshot()` (`packages/codex-adapter/src/index.ts:214`) issues
`thread/read` with `includeTurns: true`, parses the envelope, and calls
`transcriptFromThread` (`src/mapping.ts:373`), which flattens the entire returned
conversation through `mapThreadItem`. The server sends that complete array in
one snapshot and the browser parses, caches, and mounts it. For a Codex chat the
reopened items are only `userMessage` and `agentMessage`; live
`item/started`/`item/completed` notifications do include tools.

Plan version 2 replaces the complete browser snapshot with the shared bounded
latest/history-page surface before adding replay. Codex may still need one
`thread/read` response to obtain message/turn boundaries because app-server
0.149.0 exposes no historical page API, but that provider limitation stays
inside the adapter: only the requested bounded page crosses the server/browser
boundary, and rollout tool reads stop at that page.

Invariants that must survive:

- Every latest or history response satisfies `TranscriptPageSchema`, including
  item-count, payload, cursor, and per-item caps.
- A page operation throws `RuntimeFailure("malformed")` **only** when its
  authoritative `thread/read` content is unreadable. Replay never introduces a
  new throwing path.
- Item ids stay stable and unique across adjacent pages.
- `recoverPrompt` (`src/index.ts:296`) is untouched.
- `mapThreadItem` keeps its current live behaviour; the one change to it
  (shell-command normalisation, Task 4) applies identically to both paths.

## Scope, non-goals, assumptions, and unresolved technical decisions

**In scope:** the `rollout/` reader and its parse boundary; Codex conformance to
the provider-neutral latest/older page runtime surface; per-page message/tool
composition; one shared shell-command normalisation; two configuration values;
adapter, README, architecture documentation, and long-history integration tests.

**Dependency and division of responsibility:**
[Scalable conversation history](2026-08-16-scalable-conversation-history.md)
owns the shared page schemas, server routes, explicit history controls, stale
cursor recovery, and single bounded browser page window. This plan owns only the
Codex adapter's implementation of that surface and tool reconstruction. The two
may be implemented in one coordinated branch, but neither may introduce a
second page contract or browser transcript store, and Codex replay does not ship
on the old complete-snapshot route.

**Non-goals:** replaying reasoning; a second source for `recoverPrompt`; writing
to or managing Codex's storage; changing Pi's transcript content; automatic
infinite-scroll loading; a Codex-only pagination route, control, cache, or
virtualizer.

### Assumptions, verified 2026-08-23 against 413 real rollout files (305 MB)

- **The file is JSONL, append-only, and one line is one entry**, each carrying a
  top-level ISO `timestamp` and a `type`.
- **Two dialects exist, and which one a chat has depends on the client that
  wrote it.** Sessions written by `codex app-server` — including this
  workspace's own, which stamp `originator: "pi-web-workspace"` — record
  conversation as `event_msg` entries (`user_message`, `agent_message`) and tool
  calls as `response_item` entries (`custom_tool_call` paired with
  `custom_tool_call_output` by `call_id`; `function_call` likewise). Sessions
  written by the Codex terminal client from 0.147 onwards record everything as
  `event_msg` / `item_completed` entries carrying structured items
  (`CommandExecution` with an argv array and `cwd`, `FileChange`, `Reasoning`,
  `AgentMessage`, `UserMessage`, `WebSearch`, and others).
- **The dialects must be selected between, not merged.** Of 413 files, 92 carry
  `item_completed`; **83 of those also carry `response_item` tool calls for the
  same work**, so reading both would show every command twice. No file mixes
  `item_completed` with `event_msg` messages (0 of 413), so the message source
  is unambiguous either way.
- **Dialect cannot be decided from `session_meta`.** It is the first line of the
  file, and reading it would defeat reading backwards. Dialect is therefore
  decided from the scanned window itself: any `item_completed` entry in the
  window makes the window structured and every `response_item` in it ignored.
- **Sizes:** median file 284 KB, p90 2.0 MB, largest 8.97 MB; the longest single
  line observed is 5.6 MB. Line length, not file size, is the caps risk.
- **The injected boilerplate is real and large.** In a 61 KB session of ours,
  `session_meta` is 18.7 KB, `world_state` 12.8 KB, and four `response_item`
  `message` entries carrying standing instructions and a plugin catalogue —
  **one of them stored with `role: "user"`** — account for 21 KB more. Taking
  messages only from `thread/read` and tool entries only from tool-typed entries
  excludes all of it structurally, not by filtering.
- **`exec` tool input is stored as a JavaScript snippet**, e.g.
  `const r = await tools.exec_command({"cmd":"…","workdir":"…", …}); text(…)`,
  and its output as an array of `input_text` parts whose last part is a JSON
  blob carrying `exit_code`, `wall_time_seconds`, and `output`.

### Unresolved technical decisions

1. **Do `thread/read` turn ids equal the rollout's `turn_id`?** Rollout tool
   entries carry
   `payload.internal_chat_message_metadata_passthrough.turn_id`, and
   `thread/read` turns carry `id`; both are UUIDv7 and are expected to be the
   same value, but this has not been verified. **Resolution, in Task 5:** capture
   both from one real chat and assert equality in a fixture test. If they differ,
   fall back to positional alignment — the *n*th turn of the file is the *n*th
   turn of `thread/read` — which the same task must implement behind the same
   interface. The design does not stall either way.
2. **Which shell-command string do we show?** The live path renders
   `commandExecution.command`; the rollout stores the JS snippet. The _policy_ is
   settled — one normalisation function produces the same string from either
   source, **applied on the live path too**, so live and reopened agree by
   construction rather than by resemblance. That is the only production change in
   this plan outside the reader, and it changes what a running Codex chat renders
   today. What remains open is only the empirical target form. **Resolution, in
   Task 4:** capture a live item and its rollout entry from the same turn, record
   both verbatim in Discoveries, and pin the chosen form in a test that asserts
   both sources produce it.

### Decisions taken

3. **Only a settled tool call is replayed; the live stream owns the rest.** A
   call is replayed when the scanned window holds both its call entry and its
   output entry. An unpaired call in the turn still running is left alone,
   because the live stream will deliver its completion — which removes, by
   construction, the one case where a replayed item and a live item could
   describe the same call and disagree about its id. An unpaired call in a
   **settled** turn is a command that never finished (an interrupt or a crash)
   and is replayed as `failed` with empty output, because dropping it would
   rewrite what happened. An unpaired _output_ means its call fell outside the
   window; it is dropped and counted. The alternative considered and rejected was
   excluding the in-progress turn wholesale, which would blank a running chat's
   earlier commands on reload — precisely when the user is watching.
4. **Messages keep coming from `thread/read`.** The rollout's `event_msg`
   messages carry no ids of their own, and today's message rendering is correct.
   Replay adds tool entries to that skeleton; it does not become a second source
   of conversation.
5. **Replay is complete for the bounded history page on display; extent is the
   caller's, not the reader's.** `readToolItems` receives exactly the turn set
   being returned in one page and reads backward until those turns are covered.
   It never receives "the chat" and never scans older turns merely because the
   chat opened. Normal work is bounded by the shared page limits (100 items and
   a 1 MiB target); two independent corruption guards remain: a line longer than
   **4 MB** is skipped and counted, and a scan passing **32 MB** stops and marks
   the boundary.

   Existing measurements show the reverse reader itself is cheap — median 3 ms,
   p90 10 ms, and 76 ms for the largest observed file. The previous design's
   expensive case, sending every restored command output to the browser at once,
   is no longer permitted. Task 8 measures the latest page, each older page, the
   bounded browser window, and the adapter read extent rather than comparing two
   unbounded snapshots.

6. **A kill switch ships with the feature.** `PI_WEB_CODEX_REPLAY_TOOLS=off`
   disables replay without a downgrade. AGB-12 covers a format change that fails
   to parse; the switch covers a format change that parses into _wrong_ content,
   which no schema can catch.

7. **Older paging does not rescan from end-of-file.** The open Codex runtime
   keeps the validated reverse-reader boundary in a bounded server-side map and
   returns a random 192-bit opaque capability token naming that state. The next
   older request resumes there, so paging through _n_ pages is approximately one
   pass rather than repeatedly scanning newer bytes. No path or raw offset enters
   the token. Tokens are runtime-local, cross-thread or expired values fail
   closed, and at most 2,000 are retained. Because Codex app-server 0.149.0
   cannot page messages, the open runtime keeps one parsed message/turn skeleton
   from `thread/read` and reuses it across page requests; it refreshes on an
   authoritative latest reset and drops it on dispose. This unavoidable
   provider-side full message read is never sent to or cached by the browser.

### Alignment with scalable conversation history

AGB-13 makes shared bounded history a shipping dependency. The Scalable
conversation history plan replaces whole-transcript snapshots with bounded
latest pages, explicit older/newer requests, and one bounded browser page
window. Replay is implemented directly on that surface:

- The reader entry point is `readToolItems({ path, turns, budget })`; `turns` is
  exactly one requested page, never the chat.
- Latest and older page assembly call the same function and pay only for their
  own rollout range.
- Replay adds no browser state and no cursor format. Messages and restored tools
  are returned together in the provider-neutral `TranscriptPage`.
- The old complete-snapshot path is removed rather than retained as a fallback.
  If the shared page foundation is not ready, replay remains disabled.

## Implementation milestones

Every task is TDD: write the failing test, watch it fail, implement, watch it
pass, commit. Fixtures are captured from real rollout files with absolute paths
and any personal content redacted, and live in
`packages/codex-adapter/src/rollout/__fixtures__/`.

- [x] **Task 0 — Land the one shared bounded-history foundation.** Complete the
      provider-neutral contracts, latest/history routes, explicit page controls,
      stale-cursor recovery, and one five-page browser window specified by
      [Scalable conversation history](2026-08-16-scalable-conversation-history.md).
      Fixed server limits are 100 items with a 1 MiB serialized target; a single
      larger schema-bounded item may be returned alone. No complete transcript
      response, duplicate transcript cache, virtualizer, automatic scroll
      sentinel, or provider-specific route is introduced. Add runtime
      conformance tests that both Pi and Codex must pass before replay can be
      enabled.

- [x] **Task 1 — Locate and confine the session file.** Add `path` to the
      `thread/read` envelope parse and a `locateRollout(rawPath, home)` that
      resolves symlinks and accepts the result **only** when it is an absolute
      path to a regular file with a `.jsonl` suffix inside the resolved Codex
      sessions root (`PI_WEB_CODEX_HOME`, else `CODEX_HOME`, else `~/.codex`).
      Anything else is a typed `unavailable` reason, never an exception. Tests:
      traversal (`../../etc/passwd`), a symlink pointing outside the root, wrong
      suffix, a directory, a relative path, a missing file, an absent `path`
      field, and the happy path.

- [x] **Task 2 — Bounded resumable reverse line reader.** A streaming reader
      yields complete lines backward from EOF and retains its validated byte
      boundary in the open runtime for the next older request. It enforces the
      4 MiB line and 32 MiB per-read guards, stops at the requested turn marker,
      and emits an incomplete boundary result rather than throwing when the
      budget stops first. Focused tests cover app-server and structured files,
      unknown dialect, and an injected small budget; real local rollouts were
      read without mutation during verification.

- [x] **Task 3 — Entry schemas and dialect selection.** Parse each line into a
      narrow union — message-bearing, tool-call, tool-output, structured item,
      turn marker, or ignored — with unparseable lines counted, not thrown.
      Select the dialect from the scanned window (any `item_completed` present ⇒
      structured; `response_item` entries in that window are ignored). Tests over
      fixtures of both dialects, a window containing both kinds of entry, a
      window with neither, malformed JSON, an entry whose `payload` is not an
      object, and a fixture asserting that no `response_item` `message` entry —
      including the `role: "user"` plugin catalogue — can ever reach the output.

- [x] **Task 4 — Tool projection, including the `exec_command` unwrap.** Pure
      functions pair app-server calls/outputs, extract the bounded JSON argument
      object without `eval`, and project command, output, cwd, exit code, and
      failure. Structured `CommandExecution`, `FileChange`, and `WebSearch`
      items map directly; other agent-produced structured item types become a
      diagnostic. Every result is parsed through `TranscriptItemSchema` and its
      caps. Focused fixtures cover both dialects, duplicate-dialect selection,
      command extraction, output pairing, and file/tool mapping.

- [x] **Task 5 — Splice tool items into bounded turns.** Group replayed entries
      by stored turn id and order them by file position. Message text still comes
      only from matching `thread/read` item ids; rollout message entries are
      positioning markers only. The integration fixture proves a user message,
      command, and assistant message reopen in their original order without
      exposing stored injected text.

- [x] **Task 6 — Implement Codex latest and older pages.** Adapt Codex to
      the shared runtime paging interface from Task 0. Build stable chronological
      message pages from `thread/read`, then invoke replay with exactly that
      page's turns and pack messages plus restored tools under the shared
      100-item/1 MiB limits. A bounded runtime-local map retains the validated
      rollout continuation and page item boundary behind a random opaque token;
      the token contains no path or offset. Cache the parsed `thread/read`
      message/turn skeleton only for the lifetime of the open runtime because
      Codex cannot page that API. Tests traverse latest and older pages with no
      gaps or duplicates, reject unknown/stale continuations, prove older
      requests do not rescan newer rollout bytes, and prove only one bounded page
      is returned from each call.

- [x] **Task 7 — Compose each page and degrade honestly.** Every page operation
      calls replay inside a boundary that cannot throw. Locate, read, parse, or
      unexpected failure returns that page's messages plus one `info` diagnostic
      stating that earlier tool activity could not be restored. A safety-ceiling
      stop emits the boundary marker at the affected page. Neither marker
      appears twice or on a clean page. Tests cover missing/unreadable files,
      unknown dialect, reader exception, ceiling, disabled replay, and clean
      latest and older pages.

- [x] **Task 8 — Bounded-cost and browser integration guard.** A deterministic
      10,000-item runtime test traverses all retained history in 100 bounded
      pages. A 700-item Playwright history proves initial latest-only loading,
      explicit older requests, a five-page/500-row DOM ceiling, latest-page
      eviction, and Jump to latest. Reader tests prove continuation and the
      safety-budget boundary; page and rollout cursors never expose native paths
      or offsets.

- [x] **Task 9 — Configuration.** `parseConfig` gains `codexHome`
      (`PI_WEB_CODEX_HOME`, optional) and `codexReplayTools`
      (`PI_WEB_CODEX_REPLAY_TOOLS`, `on` | `off`, default `on`), both parsed with
      the existing named-failure posture. Threaded to the adapter through the
      existing registry construction. Tests: default, explicit values, and an
      invalid value naming the variable.

- [x] **Task 10 — Documentation.** A "Replaying stored history" section in
      `packages/codex-adapter/README.md` covering both dialects, confinement,
      page-demand behavior, caps, and the exit criterion; the two variables in
      `README.md` and `.env.example`; the reader and shared bounded page path in
      `docs/architecture/overview.md`. `python3 scripts/check_docs.py` stays
      green.

## Untrusted-data-boundary analysis

Per [Parse, Don't Validate](../../architecture/data-boundaries.md). Codex's
session file is **external, private, unversioned, and written by a program we do
not control**, which makes it the least trusted source in the repository.

| Source and raw representation                                               | Entry/read point                               | Runtime parser                                                                                                        | Trusted output and guarantees                                                                                | Failure behavior                                                                                                             | Boundary tests                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `thread.path` from `thread/read` (a string chosen by the app-server)        | Codex latest/history page composition (Task 1) | `rolloutPathSchema` plus `locateRollout` — realpath, suffix, regular file, root confinement                           | An absolute path proven to lie inside the Codex sessions root                                                | Typed `unavailable` reason → AGB-12 degrade; never an exception, never an unconfined open                                    | Task 1: traversal, escaping symlink, wrong suffix, directory, relative, missing                |
| Opaque Codex page cursor returned by the browser                            | Codex older-page method (Task 6)               | Shared syntax parse followed by exact lookup of a random 192-bit token in the open session's bounded continuation map | A continuation created by this runtime for this chat, with validated file/page state held only on the server | Unknown, cross-thread, expired, or stale values return a scoped stale-history result; no browser value becomes a seek offset | Task 6: valid continuation, unknown token, wrong chat/runtime, expiry, append, and replacement |
| Rollout file bytes (up to 9 MB, single lines up to 5.6 MB observed)         | `reverseLines` (Task 2)                        | Chunked reverse reader with a line-length cap, a safety byte ceiling, and a caller-supplied early stop                | Complete UTF-8 lines, newest first, covering the requested turns                                             | Over-long line skipped and counted; reaching the ceiling ends the scan and marks the boundary                                | Task 2: chunk boundaries, no trailing newline, oversized line, ceiling                         |
| One JSONL line (arbitrary JSON of unknown schema version)                   | `parseRolloutEntry` (Task 3)                   | `rolloutEntrySchema` discriminated union; everything unrecognised is ignored                                          | A narrow entry union with a known `type` and payload shape                                                   | Unparseable or unknown line is counted and dropped; a window of only unknowns is "unknown dialect"                           | Task 3: malformed JSON, non-object payload, unknown types, both dialects                       |
| `custom_tool_call.input` — a JavaScript snippet embedding a JSON object     | `parseExecInput` (Task 4)                      | Bounded brace-matched extraction, then `JSON.parse`, then a Zod shape                                                 | `{ command, cwd }`, or an explicit "not understood" result                                                   | Falls back to the raw snippet as the tool input; the entry is still shown                                                    | Task 4: malformed snippet, other tool names, nested braces, oversized input                    |
| `custom_tool_call_output.output` — an array of text parts, last a JSON blob | `parseExecOutput` (Task 4)                     | Part schema, then a permissive blob shape                                                                             | `{ output, exitCode }` with `exitCode` nullable                                                              | Missing or unparseable blob yields the joined text and a null exit code                                                      | Task 4: no blob, non-text part, huge output, absent output                                     |
| `item_completed.item` — structured items in the terminal client's dialect   | `mapStoredItem` (Task 4)                       | PascalCase item schemas mirroring the live camelCase ones                                                             | `TranscriptItem` values satisfying `TranscriptItemSchema` and its caps                                       | Unknown item type becomes an `info` diagnostic naming the type, as the live path does                                        | Task 4: each known type, an unknown type, missing optional fields                              |
| `PI_WEB_CODEX_HOME`, `PI_WEB_CODEX_REPLAY_TOOLS`                            | `parseConfig` (Task 9)                         | Non-empty string / `z.enum(["on","off"])`                                                                             | A resolved root path and a boolean                                                                           | Startup throws naming the variable, matching existing config behaviour                                                       | Task 9 config tests                                                                            |

Two structural guarantees, stated because they are the point rather than a
detail: conversation text is taken **only** from `thread/read`, so no stored
`message` entry — including the `role: "user"` plugin catalogue — has a path to
the transcript; and replayed items are constructed as `TranscriptItem` values
and asserted against `TranscriptItemSchema` in tests, not merely shaped to
resemble it.

## Touched-legacy-code analysis

- `packages/codex-adapter/src/mapping.ts` is 415 lines and already carries the
  live projection. The reader gets its **own** directory (`src/rollout/`) rather
  than growing that file into a grab bag. The single change to `mapping.ts` is
  the shared shell-command normalisation from Task 4, and only if decision 2
  resolves that way.
- `CodexOpenSession.snapshot` currently means complete history. Task 0 replaces
  that runtime shape repository-wide; Codex implements the same latest/page
  methods as Pi rather than retaining a compatibility path that can accidentally
  send a full transcript.
- `packages/codex-adapter/src/index.test.ts` drives a scripted app-server. Replay
  is injected as a page-scoped function so tests can assert the exact turn range
  and byte/item limits without real Codex or user history.

## Verification

Focused, per task, from the repository root (Vitest is configured once at the
root; a `--filter … exec vitest` invocation finds no test files):

```sh
pnpm exec vitest run packages/contracts packages/agent-runtime
pnpm exec vitest run packages/codex-adapter
pnpm exec vitest run apps/server/src/config.test.ts apps/server/src/app.test.ts
pnpm exec vitest run apps/web/src/features/workspace
```

Final, before completion:

```sh
pnpm check
pnpm test:e2e
python3 scripts/check_docs.py
```

Manual and runtime checks that automation cannot cover, each recorded with its
output in Progress:

1. With real Codex, run a chat that executes several shell commands and edits a
   file, note what the live transcript shows, reload the page, and confirm the
   reopened transcript shows the same tool entries in the same positions
   (AGB-10, acceptance 15 and 16).
2. Capture, from that same chat, one live `commandExecution` item and its rollout
   entry, and record both verbatim — this is the evidence for decision 2 and for
   the turn-id question in decision 1.
3. Import a Codex session created by the Codex desktop app or terminal client
   into a project and confirm its tool calls replay (AGB-10, acceptance 17), and
   that no injected instruction or catalogue text appears anywhere in it
   (acceptance 18).
4. Open the longest real Codex chat available and confirm only one bounded
   latest page crosses into the browser. Page repeatedly to its oldest history
   and confirm each page restores its tools; record initial and per-page payload
   size, read extent, and time to paint (AGB-11, AGB-13, acceptance 19 and
   24–27).
5. Reload the page **while a Codex run is streaming** and confirm the turn in
   flight shows each command exactly once — neither duplicated by replay nor
   missing until the run ends (decision 3).
6. Point `PI_WEB_CODEX_HOME` at an empty directory, reopen a Codex chat, and
   confirm messages still render in bounded pages, prompting still works, and
   exactly one line says tool activity could not be restored (AGB-12,
   acceptance 22). Repeat with `PI_WEB_CODEX_REPLAY_TOOLS=off` and confirm
   bounded message-only history returns with no marker.

## Compatibility, deployment, migration, recovery, and rollback

- **Migration:** none. No schema, no persisted format, no stored transcript.
- **Deployment:** no required configuration. Absent variables give the default
  Codex home and replay enabled.
- **Rollback:** `PI_WEB_CODEX_REPLAY_TOOLS=off` restores bounded message-only
  Codex history without a redeploy or downgrade. It does not restore the old
  unbounded browser snapshot. Because nothing is persisted, turning replay off
  and on again is lossless.
- **Recovery:** replay is recomputed for each requested page and holds no durable
  state. A crash, restart, or partially written file affects only that page, and
  the in-progress turn is excluded from replay by decision 3.
- **Interaction with a Codex upgrade:** an upgraded Codex writing a new format
  degrades to AGB-12 for chats written after the upgrade, while chats written
  before it keep replaying, because the reader decides dialect per file.

### External dependency risk and exit

This reader depends on a private, unversioned format. That is accepted
deliberately, with a stated exit: **if `codex app-server` ever serves tool items
for past turns over the protocol, the reader is deleted rather than maintained**,
and `thread/read` becomes the only source again. Task 7's composition seam is
designed so that is a single function swap. Until then, the format is re-verified
whenever the pinned Codex version moves, and the manual checks above are the
verification.

## Progress

- 2026-08-23: Product specification version 2 and this plan version 1 approved
  together by the user (longduotax). Implementation did not start.
- 2026-08-23: Follow-up review required bounded progressive frontend loading to
  ship with replay. Drafted Agent backends specification version 3 and this plan
  version 2.
- 2026-08-23: The user explicitly asked to implement the revised documents,
  approving specification version 3 and plan version 2. Implementation moved to
  Active.
- 2026-08-23: Implemented snapshot v2 with fixed-limit latest/older pages,
  authenticated Pi cursors, bounded runtime-local Codex continuation tokens, the
  confined resumable rollout reader, both stored dialects, message-only degrade,
  replay configuration, explicit browser paging, stale reset, a five-page
  browser window, and durable documentation.
- 2026-08-23: Automated verification covers strict contracts, a deterministic
  10,000-item traversal, rollout confinement/parsing/composition, server routes,
  browser paging, and a 700-item Playwright DOM/window test. Full repository
  unit and six-spec Playwright suites are green.

## Discoveries and blockers

Discovered on 2026-08-23 while investigating, before drafting:

- **The stored format has two dialects, and the richer one belongs to the client
  we do not use.** 92 of 413 local rollout files carry `event_msg` /
  `item_completed` entries with fully structured items — a `CommandExecution`
  holding the real argv array and `cwd`, `FileChange`, `Reasoning` — while
  sessions written by `codex app-server` (this workspace's own included) carry
  none of them and record tool calls as `response_item` pairs instead. Since
  AGB-09 lets a user import a session the desktop or terminal client wrote,
  covering only our own dialect would have made imported chats a second-class
  case. Both are in scope.
- **The dialects overlap in a way that forbids merging them.** 83 of those 92
  files carry `response_item` tool calls _as well as_ `item_completed` items for
  the same work; a reader that took both would show every command twice. No file
  mixes `item_completed` with `event_msg` messages, so message sourcing is
  unambiguous. Hence dialect selection rather than a union.
- **Dialect cannot be read from `session_meta`.** It names the writing client in
  the file's first line, which is precisely the line a backwards reader must not
  need. Selection therefore happens on the scanned window.
- **The injected boilerplate is larger than the brief suggested.** In one 61 KB
  session of ours it is roughly 52 KB — `session_meta` 18.7 KB, `world_state`
  12.8 KB, and four `response_item` `message` entries totalling 21 KB, one of
  them a plugin catalogue stored with `role: "user"` that no human typed. Taking
  conversation only from `thread/read` excludes it structurally.
- **A single line can be 5.6 MB.** The largest file is 9.0 MB, but the caps risk
  is line length, not file size, so the reader caps both.
- **Version 1's known-limitation note misattributes the choice it cites.** It
  says reading the file was declined by "decision 2", whose recorded subject is
  vendoring generated protocol types. The posture is real and is what this plan
  reverses; the citation is not. Noted so a later reader does not go looking for
  a decision that says something else.

No implementation blocker is known. Automated implementation is complete; the
real-provider manual checks remain before the proposal is promoted to Current
and this plan is archived.

## Decision and revision log

- 2026-08-23: Created plan version 1 against Agent backends proposed version 2,
  after probing 413 real rollout files. Recorded the reversal of version 1's
  app-server-only posture with its justification and exit criterion; recorded
  four decisions taken (no replay of an in-progress turn; messages stay sourced
  from `thread/read`; a replay depth; a kill switch) and two unresolved
  technical questions with the task and fallback that resolves each (turn-id
  correspondence, canonical shell-command form).
- 2026-08-23: Scope confirmed with the user before drafting: tool calls only —
  reasoning replay, a live/reopened identity rule, and a wider Codex-desktop
  parity audit are out; both stored dialects are in, because AGB-09 already
  imports sessions written by the other clients; and an unreadable history says
  so once, quietly, without naming the cause in user-facing text.

- 2026-08-23: The user resolved the four open choices put to them. **Replay is
  complete rather than depth-limited**, read on demand as history is displayed —
  which reframed AGB-11 from a fixed budget with a truncation marker into
  caller-driven extent with a safety ceiling, and made the composition with
  scalable conversation history a requirement rather than a courtesy. The
  live-path shell-command normalisation is approved in principle, leaving only
  the empirical target form. An unfinished command in a settled turn replays as
  `failed`, and replay ships enabled by default. Recorded before either approval,
  so the versions put forward for approval are the revised ones.

- 2026-08-23: The user approved Agent backends specification version 2 and this
  plan version 1 in one message. The approved text was the revised text — the
  four drafting choices above were folded in before approval. Status moved Draft
  → Ready.
- 2026-08-23: Follow-up review rejected shipping replay through the complete
  browser snapshot. Created plan version 2 and Agent backends version 3 in
  Draft. The simple path is one shared fixed-limit page contract, explicit page
  controls, and one bounded browser window; Codex adds only page-scoped rollout
  reconstruction. No second Codex history API, cache, automatic loader, or
  virtualizer. This materially invalidated the prior product and technical
  approvals for replay.
- 2026-08-23: The user explicitly approved Agent backends specification version
  3 and plan version 2 by asking to implement the drafted revision. Status moved
  Draft → Active when production edits began.
- 2026-08-23: Implementation simplified the planned signed Codex byte-offset
  cursor to a random 192-bit runtime-local capability token backed by a bounded
  server continuation map. This exposes neither path nor offset, fails closed
  across runtime/thread boundaries, avoids decoding browser-controlled seek
  positions, and preserves linear sequential reads. Pi's provider-neutral pager
  remains stateless with authenticated append-stable cursors.

## Final outcomes

Production implementation and automated verification are complete. Real Codex
manual checks 1–6 remain, so the plan stays Active and Agent backends version 3
stays Approved rather than Current.
