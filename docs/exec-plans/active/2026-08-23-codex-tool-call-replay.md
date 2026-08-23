# Codex tool-call replay

**Status:** Ready

**Plan version:** 1

**Technical approval:** Approved for plan version 1 on 2026-08-23 by the user (longduotax), together with Agent backends specification version 2, in the same message that approved the four drafting choices recorded in the decision log

**Subsystem:** Codex transcript reconstruction — a bounded reverse reader over Codex's own session files, its parse boundary, and snapshot composition inside `packages/codex-adapter`

**Affected paths or contracts:** new `packages/codex-adapter/src/rollout/**`; `packages/codex-adapter/src/index.ts` (snapshot composition) and `src/mapping.ts` (one shared shell-command normalisation); `apps/server/src/config.ts` (`PI_WEB_CODEX_HOME`, `PI_WEB_CODEX_REPLAY_TOOLS`); `.env.example`; `README.md`; `packages/codex-adapter/README.md`; `docs/architecture/overview.md`; focused Vitest suites and fixtures. **No transport contract, database schema, migration, HTTP route, or browser change.**

**Governing specification:** [Agent backends](../../product-specs/agent-backends.md) proposed version 2 — this plan implements AGB-10, AGB-11, and AGB-12 and changes nothing in AGB-01 through AGB-09

**Related documents or issue:** [Codex agent runtime implementation plan](2026-08-22-codex-agent-runtime.md) (version 1, whose known limitation this plan answers), [Scalable conversation history implementation plan](2026-08-16-scalable-conversation-history.md) (whose bounded pages and cursors this plan must compose with rather than fight), [Parse, Don't Validate](../../architecture/data-boundaries.md), [Architecture overview](../../architecture/overview.md), the [`AgentRuntime` interface](../../../packages/agent-runtime/src/index.ts), and the [Codex adapter README](../../../packages/codex-adapter/README.md)

**Implementation worktree:** `/Users/long/Documents/code_projects/pi-web-codex-runtime` on `feat/codex-agent-runtime`

**Last updated:** 2026-08-23

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Working specification and approval context

Product behavior change: **Yes.** The governing proposal is
[Agent backends](../../product-specs/agent-backends.md) specification
version **2**, **Approved** on 2026-08-23. This plan version 1 received
technical approval from the same user message on the same date, satisfying both
gates in the
[agent implementation workflow](../../development/agent-implementation-workflow.md).
Implementation may begin at Task 1; this plan moves to Active when the first
production edit lands.

Version 1 of the specification is approved, implemented, and unpromoted; this
plan does not touch it. Preserved invariants:

- Pi chats are unaffected end to end. This plan adds no code on a Pi path.
- The transport contract, the persisted schema, the HTTP surface, and the
  browser are unchanged. Replay produces the same `TranscriptItem` values the
  workspace already renders.
- `recoverPrompt` keeps `thread/read` as its **only** source of prompt-arrival
  evidence. Nothing in this plan may make crash recovery depend on a file.
- A chat opens, prompts, steers, stops, and streams whether or not replay
  succeeds (AGB-12).

## Purpose and user-visible outcome

A reopened Codex chat shows the shell commands and file changes it showed while
running, in place, instead of messages alone. Complete product rules live in the
governing specification and are not restated here.

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

| Spec requirement                                                                                                       | Technical consequence                                                                                                                                                                                                                                                                                                      | Verification                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [AGB-10](../../product-specs/agent-backends.md#agb-10--a-reopened-codex-chat-shows-the-tool-calls-it-showed-live)      | A `rollout/` reader in `packages/codex-adapter` that locates the file from `thread.path`, reads it backwards, projects tool entries in **both** stored dialects onto `TranscriptItem`, and splices them into the turns `thread/read` returns; messages continue to come from `thread/read` only                            | Tasks 1–6 unit suites over fixtures captured from real files; manual checks 1, 2, 3, and 5                                        |
| [AGB-11](../../product-specs/agent-backends.md#agb-11--replay-covers-the-history-the-chat-shows-and-is-read-on-demand) | Reverse chunked reading whose extent is set by the turn set the caller asks for — today the whole transcript, one bounded page once history is paged; a per-line cap and a safety byte ceiling well above the largest real file, with a `diagnostic` transcript item at the boundary only when that ceiling stops the read | Task 2 and Task 7 suites, including a synthetic file past the ceiling and a cost measurement over the real corpus; manual check 4 |
| [AGB-12](../../product-specs/agent-backends.md#agb-12--unreadable-tool-history-degrades-to-messages-never-to-failure)  | Every replay failure is caught inside the adapter and converted to today's message-only transcript plus one `info` diagnostic item; `PI_WEB_CODEX_REPLAY_TOOLS=off` disables replay wholesale                                                                                                                              | Task 6 suite driving missing file, unreadable file, unknown dialect, and reader exception; Task 8 config tests; manual check 6    |

Acceptance criterion 20 — a chat never reads stored history it is not
displaying — cannot be observed end to end until conversation history is paged.
Until then it is verified structurally, by Task 7's assertion that the reader
covers exactly the turn set it is handed and stops there.

Acceptance criterion 23 — a Pi chat's reopened transcript is unchanged — is
verified by the existing `packages/pi-adapter` and server suites passing
untouched. This plan adds no code on a Pi path, which is the strongest evidence
available for it.

## Current behavior and affected invariants

`CodexOpenSession.snapshot()` (`packages/codex-adapter/src/index.ts:214`) issues
`thread/read` with `includeTurns: true`, parses the envelope, and calls
`transcriptFromThread` (`src/mapping.ts:373`), which flattens
`thread.turns[].items[]` through `mapThreadItem`. For a Codex chat those items
are only `userMessage` and `agentMessage`, so the reopened transcript is
messages only. Live runs are unaffected: `item/started` and `item/completed`
notifications carry the full item set and already map to tool entries.

Invariants that must survive:

- `snapshot()` returns a `RuntimeSnapshot` whose `transcript` satisfies
  `TranscriptItemSchema`, including its length caps.
- `snapshot()` throws `RuntimeFailure("malformed")` **only** when `thread/read`
  itself is unreadable. Replay never introduces a new throwing path.
- Item ids stay stable within a snapshot and unique across it.
- `recoverPrompt` (`src/index.ts:296`) is untouched.
- `mapThreadItem` keeps its current live behaviour; the one change to it
  (shell-command normalisation, Task 4) applies identically to both paths.

## Scope, non-goals, assumptions, and unresolved technical decisions

**In scope:** the `rollout/` reader and its parse boundary; snapshot
composition; one shared shell-command normalisation; two configuration values;
adapter, README, and architecture documentation.

**Non-goals:** replaying reasoning; any transport, schema, route, or browser
change; a second source for `recoverPrompt`; writing to or managing Codex's
storage; changing Pi; implementing the paging in
[Scalable conversation history](2026-08-16-scalable-conversation-history.md).

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
5. **Replay is complete for the history on display; extent is the caller's, not
   the reader's.** `readToolItems` reads back until it has covered every turn in
   the turn set it was handed — today the whole transcript, one page once history
   is paged — rather than stopping at a depth of its own choosing. There is no
   turn or item cap. What remains are two safety limits: a single line longer
   than **4 MB** is skipped and counted rather than materialised, and a read that
   passes **32 MB** stops and marks the boundary. 32 MB is roughly 3.5× the
   largest file in a 413-file, 305 MB corpus, so the ceiling is a guard against a
   pathological file, not a product-visible depth.

   The honest cost of completeness is **payload, not read time**. Reading is
   cheap and measured: median 3 ms, p90 10 ms, 76 ms for the largest file, and
   385 ms / 36 MB of heap for the ten largest read concurrently. What is not
   cheap is shipping every replayed command's output to the browser on open — a
   chat with hundreds of commands sends a correspondingly large snapshot. That is
   the same cost a Pi chat's full history already pays today, it is a property of
   the unpaged snapshot rather than of replay, and
   [Scalable conversation history](2026-08-16-scalable-conversation-history.md)
   is the fix for both backends at once. This plan must therefore not make the
   unpaged snapshot materially worse than Pi's, and Task 7 measures it.

6. **A kill switch ships with the feature.** `PI_WEB_CODEX_REPLAY_TOOLS=off`
   disables replay without a downgrade. AGB-12 covers a format change that fails
   to parse; the switch covers a format change that parses into _wrong_ content,
   which no schema can catch.

### Alignment with scalable conversation history

AGB-11 makes on-demand reading a product requirement, not merely a
future-proofing courtesy, so the composition matters. That plan (version 3,
Draft) replaces whole-transcript snapshots with bounded latest pages and opaque
cursors. This plan is built to drop into it rather than be rewritten by it:

- The reader's entry point is `readToolItems({ path, turns, budget })`, where
  `turns` is the bounded set of turns being rendered — not "the chat". It never
  assumes it sees the whole conversation.
- Reading backwards with early stop is exactly the access pattern a latest page
  needs; an older page asks for its own turns and pays for its own bytes.
- Replay adds no state the browser or a cursor must carry. When paging lands,
  the Codex adapter's page assembly calls the same function with a different
  turn set.

## Implementation milestones

Every task is TDD: write the failing test, watch it fail, implement, watch it
pass, commit. Fixtures are captured from real rollout files with absolute paths
and any personal content redacted, and live in
`packages/codex-adapter/src/rollout/__fixtures__/`.

- [ ] **Task 1 — Locate and confine the session file.** Add `path` to the
      `thread/read` envelope parse and a `locateRollout(rawPath, home)` that
      resolves symlinks and accepts the result **only** when it is an absolute
      path to a regular file with a `.jsonl` suffix inside the resolved Codex
      sessions root (`PI_WEB_CODEX_HOME`, else `CODEX_HOME`, else `~/.codex`).
      Anything else is a typed `unavailable` reason, never an exception. Tests:
      traversal (`../../etc/passwd`), a symlink pointing outside the root, wrong
      suffix, a directory, a relative path, a missing file, an absent `path`
      field, and the happy path.

- [ ] **Task 2 — Bounded reverse line reader.** A streaming reader that yields
      complete lines from the end of a file backwards, over an injected file
      handle so tests need no real Codex. Enforces the decision-5 limits: the
      per-line maximum (skipped and counted, never materialised) and the safety
      byte ceiling, plus an early-stop predicate supplied by the caller — which is
      how the reader stops as soon as the requested turn set is covered instead of
      running to the top of the file. Tests: no trailing newline, a
      line spanning several chunks, a line exactly on a chunk boundary, an empty
      file, a file smaller than one chunk, a line over the cap between two valid
      lines, early stop firing mid-file, and a byte budget exhausted before the
      file starts.

- [ ] **Task 3 — Entry schemas and dialect selection.** Parse each line into a
      narrow union — message-bearing, tool-call, tool-output, structured item,
      turn marker, or ignored — with unparseable lines counted, not thrown.
      Select the dialect from the scanned window (any `item_completed` present ⇒
      structured; `response_item` entries in that window are ignored). Tests over
      fixtures of both dialects, a window containing both kinds of entry, a
      window with neither, malformed JSON, an entry whose `payload` is not an
      object, and a fixture asserting that no `response_item` `message` entry —
      including the `role: "user"` plugin catalogue — can ever reach the output.

- [ ] **Task 4 — Tool projection, including the `exec_command` unwrap.** Pure
      functions from a parsed entry to `TranscriptItem`. For the app-server
      dialect: pair `custom_tool_call` with `custom_tool_call_output` by
      `call_id`; extract `cmd` and `workdir` from the snippet by locating the
      argument object and parsing it as JSON — bounded scanning, **never `eval`
      or a `Function` constructor**; read `exit_code` and `output` from the
      output blob. For the structured dialect: project `CommandExecution`,
      `FileChange`, `WebSearch`/`Extension`, and unknown types the way
      `mapThreadItem` already does. Resolve decision 2 here and apply the shared
      normalisation. Tests: happy path both dialects, a non-`exec` tool name, a
      malformed snippet (falls back to the raw text as input), an output with no
      JSON blob, an output part that is not text, an unpaired call in a settled
      turn (replayed `failed`), an unpaired call in the running turn (left to the
      live stream), an output with no call in the window (dropped and counted),
      an argv array with an embedded quote, and truncation at each contract cap. This task carries the densest coverage in the plan.

- [ ] **Task 5 — Splice tool items into their turns.** Group replayed items by
      turn, then insert each into the `thread/read` turn it belongs to at the
      position implied by how many agent messages preceded it in the file, so a
      command that ran between two assistant messages renders between them.
      Resolve decision 1 here; implement the positional fallback either way.
      Tests: a tool before the first agent message, between two, after the last,
      several turns interleaved, a turn present in the file but absent from
      `thread/read`, an item naming an unknown turn (dropped and counted), and a
      turn with no tool items (unchanged output).

- [ ] **Task 6 — Compose the snapshot, degrade honestly.** `snapshot()` calls
      the reader inside a boundary that cannot throw: any failure — locate,
      read, parse, or an unexpected exception — yields today's message-only
      transcript plus one `info` diagnostic item stating that earlier tool
      activity could not be restored, naming no path or format (AGB-12). When the
      safety ceiling stopped the scan before the oldest displayed turn, emit the
      boundary marker at that point instead (AGB-11). Both markers never appear twice, and
      neither appears when replay is clean. Tests: missing file, unreadable file,
      unknown dialect, reader throwing, ceiling reached, replay disabled, and
      the clean path asserting **no** diagnostic.

- [ ] **Task 7 — Cost guard.** Two things, since completeness moves the cost
      from read time to payload. First, a test over a synthetic fixture past the
      32 MB ceiling asserting the read stops, the boundary marker is emitted, and
      memory stays flat. Second, a test asserting the reader covers exactly the
      turn set it is handed and stops there — the property that makes paging drop
      in later. Record, in Progress, measured open times over the real corpus and
      the resulting snapshot payload size for the largest chat, against the same
      figure for a comparable Pi chat; a replayed Codex snapshot must not be
      materially heavier than Pi's full history for the same conversation.

- [ ] **Task 8 — Configuration.** `parseConfig` gains `codexHome`
      (`PI_WEB_CODEX_HOME`, optional) and `codexReplayTools`
      (`PI_WEB_CODEX_REPLAY_TOOLS`, `on` | `off`, default `on`), both parsed with
      the existing named-failure posture. Threaded to the adapter through the
      existing registry construction. Tests: default, explicit values, and an
      invalid value naming the variable.

- [ ] **Task 9 — Documentation.** A "Replaying stored history" section in
      `packages/codex-adapter/README.md` covering both dialects, the confinement
      rule, the caps, and the exit criterion; the two variables in `README.md`
      and `.env.example`; the reader recorded in
      `docs/architecture/overview.md`. `python3 scripts/check_docs.py` stays
      green.

## Untrusted-data-boundary analysis

Per [Parse, Don't Validate](../../architecture/data-boundaries.md). Codex's
session file is **external, private, unversioned, and written by a program we do
not control**, which makes it the least trusted source in the repository.

| Source and raw representation                                               | Entry/read point                     | Runtime parser                                                                                         | Trusted output and guarantees                                          | Failure behavior                                                                                   | Boundary tests                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `thread.path` from `thread/read` (a string chosen by the app-server)        | `CodexOpenSession.snapshot` (Task 1) | `rolloutPathSchema` plus `locateRollout` — realpath, suffix, regular file, root confinement            | An absolute path proven to lie inside the Codex sessions root          | Typed `unavailable` reason → AGB-12 degrade; never an exception, never an unconfined open          | Task 1: traversal, escaping symlink, wrong suffix, directory, relative, missing |
| Rollout file bytes (up to 9 MB, single lines up to 5.6 MB observed)         | `reverseLines` (Task 2)              | Chunked reverse reader with a line-length cap, a safety byte ceiling, and a caller-supplied early stop | Complete UTF-8 lines, newest first, covering the requested turns       | Over-long line skipped and counted; reaching the ceiling ends the scan and marks the boundary      | Task 2: chunk boundaries, no trailing newline, oversized line, ceiling          |
| One JSONL line (arbitrary JSON of unknown schema version)                   | `parseRolloutEntry` (Task 3)         | `rolloutEntrySchema` discriminated union; everything unrecognised is ignored                           | A narrow entry union with a known `type` and payload shape             | Unparseable or unknown line is counted and dropped; a window of only unknowns is "unknown dialect" | Task 3: malformed JSON, non-object payload, unknown types, both dialects        |
| `custom_tool_call.input` — a JavaScript snippet embedding a JSON object     | `parseExecInput` (Task 4)            | Bounded brace-matched extraction, then `JSON.parse`, then a Zod shape                                  | `{ command, cwd }`, or an explicit "not understood" result             | Falls back to the raw snippet as the tool input; the entry is still shown                          | Task 4: malformed snippet, other tool names, nested braces, oversized input     |
| `custom_tool_call_output.output` — an array of text parts, last a JSON blob | `parseExecOutput` (Task 4)           | Part schema, then a permissive blob shape                                                              | `{ output, exitCode }` with `exitCode` nullable                        | Missing or unparseable blob yields the joined text and a null exit code                            | Task 4: no blob, non-text part, huge output, absent output                      |
| `item_completed.item` — structured items in the terminal client's dialect   | `mapStoredItem` (Task 4)             | PascalCase item schemas mirroring the live camelCase ones                                              | `TranscriptItem` values satisfying `TranscriptItemSchema` and its caps | Unknown item type becomes an `info` diagnostic naming the type, as the live path does              | Task 4: each known type, an unknown type, missing optional fields               |
| `PI_WEB_CODEX_HOME`, `PI_WEB_CODEX_REPLAY_TOOLS`                            | `parseConfig` (Task 8)               | Non-empty string / `z.enum(["on","off"])`                                                              | A resolved root path and a boolean                                     | Startup throws naming the variable, matching existing config behaviour                             | Task 8 config tests                                                             |

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
- `CodexOpenSession.snapshot` gains one composition step and one failure
  boundary. Its existing `thread/read` parse, its `RuntimeFailure("malformed")`
  path, and `transcriptFromThread` keep their current behaviour, which the
  existing tests already pin.
- `packages/codex-adapter/src/index.test.ts` drives a scripted app-server. Replay
  is injected as a function so those tests keep passing untouched with a no-op
  reader, and the replay suites drive fixtures directly.

## Verification

Focused, per task, from the repository root (Vitest is configured once at the
root; a `--filter … exec vitest` invocation finds no test files):

```sh
pnpm exec vitest run packages/codex-adapter
pnpm exec vitest run apps/server/src/config.test.ts
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
4. Open the longest real Codex chat available and confirm its **oldest** tool
   calls replay, not only its recent ones; record the time to first paint and the
   snapshot payload size against a short chat (AGB-11, acceptance 19 and 21).
5. Reload the page **while a Codex run is streaming** and confirm the turn in
   flight shows each command exactly once — neither duplicated by replay nor
   missing until the run ends (decision 3).
6. Point `PI_WEB_CODEX_HOME` at an empty directory, reopen a Codex chat, and
   confirm messages still render, prompting still works, and exactly one line
   says tool activity could not be restored (AGB-12, acceptance 22). Repeat with
   `PI_WEB_CODEX_REPLAY_TOOLS=off` and confirm today's behaviour returns with no
   marker at all.

## Compatibility, deployment, migration, recovery, and rollback

- **Migration:** none. No schema, no persisted format, no stored transcript.
- **Deployment:** no required configuration. Absent variables give the default
  Codex home and replay enabled.
- **Rollback:** `PI_WEB_CODEX_REPLAY_TOOLS=off` restores today's behaviour
  without a redeploy or a downgrade. Because nothing is persisted, turning replay
  off and on again is lossless.
- **Recovery:** replay is recomputed on every open and holds no state. A crash,
  a restart, or a partially written file (a run in flight) affects only the
  current open, and the in-progress turn is excluded from replay by decision 3.
- **Interaction with a Codex upgrade:** an upgraded Codex writing a new format
  degrades to AGB-12 for chats written after the upgrade, while chats written
  before it keep replaying, because the reader decides dialect per file.

### External dependency risk and exit

This reader depends on a private, unversioned format. That is accepted
deliberately, with a stated exit: **if `codex app-server` ever serves tool items
for past turns over the protocol, the reader is deleted rather than maintained**,
and `thread/read` becomes the only source again. Task 6's composition seam is
designed so that is a single function swap. Until then, the format is re-verified
whenever the pinned Codex version moves, and the manual checks above are the
verification.

## Progress

- 2026-08-23: Product specification version 2 and this plan version 1 approved
  together by the user (longduotax). Implementation not yet started; the plan
  becomes Active with the first production edit.

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

No blockers.

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
  plan version 1 in one message. The approved text is the revised text — the four
  drafting choices above were folded in before the approval was stamped, so no
  post-approval change is outstanding. Status moves Draft → Ready.

## Final outcomes

Not completed.
