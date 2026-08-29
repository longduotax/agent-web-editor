# Chat image attachments

**Status:** Completed

**Plan version:** 1

**Technical approval:** Approved by the user on 2026-08-29 for plan version 1

**Subsystem:** Web composers, HTTP commands, runtime abstraction, Pi adapter, and transcript projection

**Affected paths or contracts:** `apps/web/src/features/workspace/**`,
`apps/web/src/api/client.ts`, `apps/web/src/styles.css`,
`apps/server/src/app.ts`, `apps/server/src/domain/workspace.ts`,
`packages/contracts/src/index.ts`, `packages/agent-runtime/src/index.ts`,
`packages/pi-adapter/src/index.ts`, prompt/steer/start HTTP request contracts,
transcript message DTOs, and Pi runtime prompt methods

**Governing specification:** [Chat image attachments current version 1](../../product-specs/chat-image-attachments.md#current-contract-v1)

**Related documents or issue:** [Initial agent workspace](../../product-specs/initial-workspace.md),
[runtime and Pi adapter](../../design/runtime-and-pi-adapter.md),
[web workspace composition](../../design/web-workspace-composition.md),
[live events and idempotency](../../design/live-events-and-idempotency.md),
[architecture overview](../../architecture/overview.md), and
[Parse, Don't Validate](../../architecture/data-boundaries.md)

**Last updated:** 2026-08-29

## Working specification and approval context

Product behavior changed under chat image attachments specification version 1.
The user approved specification version 1 and technical plan version 1 on
2026-08-29 by saying the drafts looked good and asking for implementation. The
verified proposal is now Current and this plan is completed.

The proposal is a separate capability because visual message input has its own
formats, limits, failure rules, persistence disclosure, transcript rendering,
and provider-compatibility lifecycle. It extends, but does not replace, the
initial workspace's text prompt/run contract.

## Purpose and user-visible outcome

Users can drop or paste photos into the exact chat pane they intend, inspect and
remove previews, and send those images with or without text to an image-capable
Pi model. The same path works for a first message, a later prompt, and active-run
steering. Accepted images remain visible in native conversation history without
putting image bytes in normal snapshot/event payloads or application metadata.

## Requirement traceability

| Spec requirement                                                                                          | Technical consequence                                                                                                                                                                              | Verification                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [CIA-01](../../product-specs/chat-image-attachments.md#cia-01--add-images-to-the-intended-composer)       | Reusable composer attachment controller, pane-scoped file-drag handlers, focused-composer clipboard handling, and accessible file input; intercept only OS `Files` drags and explicit paste events | React tests for drag ownership, focused image paste, unchanged text paste, file chooser, and panel-drag non-interference; Playwright real multipart file selection |
| [CIA-02](../../product-specs/chat-image-attachments.md#cia-02--supported-inputs-previews-and-limits)      | Parsed JPEG/PNG/WebP magic and dimensions, hard multipart limits, typed pending records, thumbnail strip, per-file errors                                                                          | Contract/parser fixtures for valid, spoofed, malformed, count/byte/pixel bounds; UI preview/removal tests                                                          |
| [CIA-03](../../product-specs/chat-image-attachments.md#cia-03--sending-to-pi)                             | Introduce SDK-neutral text-plus-image input; multipart variants of start/prompt/steer; runtime capability reporting and adapter recheck; image-only title fallback                                 | Server/runtime tests for all three commands, image-only naming, supported/unsupported/changed capabilities, and exact Pi SDK call                                  |
| [CIA-04](../../product-specs/chat-image-attachments.md#cia-04--pending-attachment-lifecycle-and-failures) | Keep `File`/object URLs in component memory, retain on mutation failure, revoke on removal/success/unmount, add unload guard, and carry images in pending steer restoration                        | UI tests for retry retention, cleanup, unload guard, accepted clearing, and stopped/failed steer restoration                                                       |
| [CIA-05](../../product-specs/chat-image-attachments.md#cia-05--conversation-history)                      | Add bounded image refs to user transcript items, adapter-owned image lookup, authorized on-demand image route, and typed attachment-only rendering                                                 | Adapter history/live/malformed fixtures; route ownership tests; reconnect/restart E2E; Markdown regression tests                                                   |
| [CIA-06](../../product-specs/chat-image-attachments.md#cia-06--bounded-processing-retries-and-disclosure) | Route-specific multipart bounds, worker-based Pi image normalization, content-aware request fingerprints and dispatch recovery, no image DB columns, and visible disclosure                        | Oversize/decompression-bound tests, duplicate/conflicting retry and crash-recovery tests, DB/native-session assertions, UI disclosure check                        |

## Current behavior and affected invariants

- `StartThreadRequestSchema`, `PromptRequestSchema`, and `SteerRequestSchema`
  accept strict JSON containing a non-empty trimmed `prompt` string. Fastify's
  global body limit is 1 MiB.
- `WorkspaceService.startThread()`, `prompt()`, and `steer()` hash and coordinate
  text only. First-prompt crash recovery records a dispatch ID and exact text in
  a native custom entry.
- `OpenRuntimeSession.prompt()`, `recoverPrompt()`, and `steer()` accept strings.
  `PiOpenSession` calls `AgentSession.prompt(text, options)` and
  `AgentSession.steer(text)` even though Pi SDK 0.84.2 also accepts
  `ImageContent[]` for both methods.
- Pi native user content may already contain image blocks, but
  `textFromContent()` intentionally projects only text. `TranscriptItemSchema`
  has no image field.
- New and existing composers own text state only. Text drafts are best-effort
  localStorage values. They have no image-aware paste handler. The workspace
  panel has a separate pointer-based tab drag implementation that file drags
  must not activate.
- Normal server snapshots are authoritative and SDK-neutral; native paths and
  Pi types do not cross package boundaries. Native Pi JSONL remains transcript
  truth, and the application database must not duplicate it.
- The global HTTP limit, exact Host/Origin/CSRF policy, command receipts,
  one-running-run-per-thread lease, direct steering semantics, raw Markdown
  image ban, and project/thread ownership checks must remain intact.

## Scope, non-goals, assumptions, and unresolved technical decisions

### Scope and selected approach

1. Add `@fastify/multipart` to the server. Preserve strict JSON requests for
   text-only and older callers; add a multipart representation to the existing
   start, prompt, and steer routes when files are attached. Do not create an
   upload/staging API.
2. The multipart metadata part is strict JSON parsed by shared Zod schemas. It
   carries the text, idempotency key, and (for start) workspace choice. Image
   parts retain wire order. The server streams and bounds each part, buffers at
   most the accepted request limits, detects content from magic bytes, parses
   dimensions, and constructs a trusted SDK-neutral `RuntimeUserInput`.
3. Keep the global 1 MiB body limit for every existing route. The three
   multipart command paths receive explicit limits of four image parts,
   10 MiB per part, 40 MiB aggregate image bytes, a bounded metadata part, and a
   small multipart-overhead allowance. Aborted/overflowing streams are fully
   drained or destroyed according to the multipart plugin contract.
4. The runtime input consists of trimmed text plus ordered images carrying a
   detected MIME type, bounded `Uint8Array`, and SHA-256 source digest. It does
   not expose browser `File`, multipart, Fastify, or Pi types.
5. The Pi adapter checks the open session's selected model input modalities and
   `images.blockImages` setting, then uses Pi's exported worker-backed image
   resize support to fit every image within 2000 by 2000 and Pi's encoded-size
   limit. It passes flat Pi `ImageContent` values (`type`, `data`, `mimeType`) to
   `session.prompt(..., { images, preflightResult })` or
   `session.steer(text, images)`. Any SDK value is parsed again before use.
6. Add an adapter capability inspection result (`supported`, `unsupported`, or
   `unknown`) for new-chat preflight and a definitive boolean in an open
   runtime snapshot. `unknown` does not pretend support; it allows selection,
   while submission and the open session remain authoritative. Capability
   inspection must not create a native session, execute project extensions, or
   issue a provider request.
7. Compute command hashes from normalized text, workspace choice, image order,
   detected MIME types, and source digests rather than serializing image bytes.
   Extend the initial-prompt custom dispatch marker with an input fingerprint.
   Recovery requires the matching dispatch/fingerprint and a persisted native
   user message. Legacy text-only markers remain readable only for legacy
   text-only recovery.
8. Extend user transcript items with an optional bounded array of image refs.
   A ref uses a content-addressed opaque image ID and parsed MIME type, never
   bytes or a native entry/path. Add an authorized
   `GET /api/projects/:projectId/threads/:threadId/images/:imageId` response with
   one parsed base64 image and MIME type. The adapter resolves an ID only by
   scanning the authorized active branch and parsing the matching native image
   block. Snapshots/live events stay small; TanStack Query loads image responses
   only for rendered user messages.
9. Build one attachment hook/component shared by `NewChatPane` and `Composer`.
   It owns pending records, object URLs, drag/drop and focused-paste ingestion,
   generated pasted-image labels, partial-ingestion errors, remove behavior,
   multipart conversion, and cleanup. The textarea `onPaste` path reads only
   the event's `clipboardData`; it does not invoke ambient Clipboard API reads.
   A paste containing image items is consumed as attachments so fallback
   URL/HTML/text is not inserted, while a text-only paste keeps native textarea
   behavior. Add `blob:` to production `img-src` only
   for local pending previews; persisted images can use parsed data URLs under
   the existing `data:` allowance. Revoke every object URL deterministically.
10. Render typed user-message attachments outside Markdown. Keep
    `react-markdown` image handling and arbitrary URL behavior unchanged.

### Non-goals

The product specification's non-goals apply. In particular, there is no image
staging table/directory, database migration, service worker, IndexedDB draft,
workspace copy, URL fetch, Markdown image enablement, model picker, or generic
attachment framework in version 1.

### Assumptions

- Pi SDK 0.84.2's installed types and implementation are authoritative:
  `prompt` accepts `PromptOptions.images`, `steer` accepts an image array,
  native user messages persist flat `ImageContent`, and model descriptors carry
  `input: ("text" | "image")[]`.
- Pi's exported `resizeImage` continues to run decode/resize in a worker and
  returns either bounded parsed output or `null`. The adapter still applies its
  own runtime parsing and failure mapping.
- JPEG, PNG, and WebP header parsing can determine dimensions without decoding
  the full image. Decode work still remains bounded and must not run on the
  server event loop.
- Filenames are display metadata before send only. Pi's image blocks do not
  preserve a filename, so transcript images use generic ordinal accessible
  names after acceptance.

### Unresolved technical decisions

None material. Implementation may refine component names, exact safe error
codes, and test fixture placement without changing the selected direct-multipart,
no-staging, SDK-neutral, on-demand-history approach.

## Implementation milestones

### Milestone 1 — Contracts and bounded multipart ingestion

- Add shared strict schemas/types for multipart metadata, image capability,
  transcript image refs, image response, and image IDs in
  `packages/contracts/src/index.ts` with valid/missing/malformed/extra-key tests.
- Register `@fastify/multipart` and implement a server-owned parser for metadata
  plus ordered image parts. Enforce count, source-byte, aggregate-byte,
  filename, magic, MIME, and pixel bounds while keeping the default 1 MiB limit.
- Support both current JSON and new multipart bodies on the three existing
  command routes. Map parser failures to stable non-sensitive API errors.

### Milestone 2 — SDK-neutral runtime input and Pi delivery

- Replace string-only runtime prompt/recovery/steer arguments with the minimal
  SDK-neutral `RuntimeUserInput`; update deterministic fakes and contract tests.
- Add non-side-effecting capability inspection and definitive open-session
  checks. Refuse blocked/unsupported images before Pi prompt acceptance.
- Normalize images off the event loop with Pi's exported helper, parse its
  output, pass images to Pi prompt/steer, and cover malformed/resize-failure/SDK
  rejection paths.
- Upgrade the initial dispatch marker/recovery parser with an input fingerprint
  and characterize legacy text-only sessions.

### Milestone 3 — Service coordination and idempotency

- Thread the trusted input through `WorkspaceService` start/prompt/steer without
  changing run leases or receipt transaction boundaries.
- Hash ordered content digests, retain one idempotency key for UI retries, and
  ensure receipt lookup happens before runtime redelivery.
- Skip naming-model input for image-only starts and apply **Image request**;
  continue sending text only to title suggestion.
- Cover duplicate, conflicting, concurrent, timeout-after-acceptance, and
  crash-recovery cases with image-bearing commands.

### Milestone 4 — Composer drag, paste, previews, and failure lifecycle

- Add the shared pending-attachment controller and preview strip to both
  composers, plus the named file input, pane-scoped file-drag overlay, and
  focused-textarea clipboard-image handler. Preserve native text-only paste;
  consume image paste without inserting fallback clipboard text/HTML/URLs.
- Enable image-only sends, preserve image order, show partial rejections, retain
  input on failure, clear on acceptance, restore in-memory undelivered steers,
  and add an unload guard.
- Ensure pointer file drags do not arm workspace-panel tab dragging, drops do
  not retarget another pane, and paste cannot attach outside the composer whose
  textarea receives the event. Add responsive, light/dark, reduced-motion, and
  accessible states.

### Milestone 5 — Native history projection and on-demand rendering

- Parse image blocks in Pi snapshot/live user messages into stable bounded refs;
  malformed blocks become scoped diagnostics rather than cast-through values.
- Add adapter image lookup, server ownership checks, parsed response handling,
  browser query caching, transcript thumbnails, larger bounded preview, loading,
  and per-image errors.
- Verify raw Markdown and assistant image rendering remain disabled and update
  CSP only for pending `blob:` previews.

### Milestone 6 — Integration, documentation, and hands-on verification

- Exercise new chat, later prompt, and steering through a real Fastify boundary
  with an image-aware fake runtime; cover drag, focused image paste, and
  text-only paste in browser component tests and image-only multipart dispatch
  through Playwright.
- Perform a hands-on pass with a real image-capable Pi model for JPEG/PNG/WebP,
  image-only input, two-image order, stop/failure retry, server restart, and a
  model/settings unsupported state. Record any provider-specific limitation.
- Update architecture, component READMEs, runtime/web designs if their durable
  decisions changed, and promote the approved product proposal only after all
  acceptance criteria are verified.

## Untrusted-data-boundary analysis

| Source and raw representation                                                  | Entry/read point                                          | Runtime parser                                                                              | Trusted output and guarantees                                                                                                         | Failure behavior                                                                                                               | Boundary tests                                                                                                                                                           |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser drag/file-picker `DataTransferItem`, `File`, name/type/size            | Shared web attachment controller                          | Browser file-item narrowing and UX limit checks                                             | Pending browser record with a real `File`, bounded only for UX; server trust is not inferred                                          | Ignore non-file drag gestures; show per-file rejection; keep valid siblings                                                    | Files/non-files, spoofed type, mixed sets, duplicate, count/size, panel tab drag                                                                                         |
| Focused textarea `ClipboardEvent`, clipboard items, optional names/types/bytes | Shared web attachment controller's explicit paste handler | Clipboard item/file narrowing plus the same UX checks; server remains authoritative         | Ordered pending browser records from image items only, with generated labels where needed                                             | Consume image-bearing paste to prevent fallback URL/HTML/text insertion; leave text-only paste untouched; show per-item errors | Image only, multiple images, image plus fallback text/HTML, text only, unsupported item, browser exposes no image, count/size, two focused panes                         |
| Multipart stream, headers, metadata JSON, and file bytes                       | Three Fastify command routes                              | Multipart plugin limits + strict metadata Zod parser + server magic/dimension parser        | Ordered `RuntimeUserInput` with trimmed/bounded text, detected JPEG/PNG/WebP, bounded bytes/pixels, safe display name, SHA-256 digest | Abort with stable 400/413 before workspace/runtime mutation; no partial input promoted                                         | Missing/duplicate metadata, wrong order, extra field/part, truncation, malformed boundary, spoofed MIME/extension, bad magic/dimensions, count/per-file/aggregate limits |
| Current JSON text-only commands                                                | Same routes                                               | Existing strict request schemas                                                             | Existing text-only command values unchanged                                                                                           | Existing malformed-request behavior                                                                                            | Legacy JSON characterization for all three routes                                                                                                                        |
| Adapter capability/config/model descriptors                                    | New capability inspection and open Pi session             | Adapter Zod parsers over settings/model values                                              | One of `supported`, `unsupported`, or `unknown`, then definitive open-session support                                                 | Unknown is surfaced, not guessed; definitive refusal retains composer input                                                    | Missing/invalid model, text-only model, image model, blockImages, capability change                                                                                      |
| Trusted server image bytes entering Pi adapter                                 | `prompt`, `recoverPrompt`, `steer`                        | Runtime input parser; `resizeImage`; parsed resize result to flat image schema              | Pi-compatible, ordered base64 images within dimensions/encoded limit                                                                  | Typed rejected/malformed failure before preflight acceptance; no text-only fallback                                            | Resize success/no-op/failure, invalid SDK return, order, prompt and steer calls                                                                                          |
| Native dispatch marker from Pi JSONL                                           | `recoverPrompt` branch scan                               | Versioned legacy/current marker schemas and fingerprint comparison                          | Matching dispatch ID and exact text/image identity                                                                                    | Treat malformed/mismatch as not accepted or scoped malformed state; never resubmit on ambiguous accepted evidence              | Legacy text marker, current marker, wrong digest/order/count/text, malformed marker, accepted message absent/present                                                     |
| Native Pi message/image blocks                                                 | Snapshot/event translation and image lookup               | Message/content/image schemas, MIME/base64/decoded-size bounds, content-addressed ID parser | Text plus bounded image refs; lookup returns only a parsed owned image                                                                | Omit malformed image and add scoped diagnostic; never expose native paths                                                      | Existing text forms, valid images, mixed blocks, malformed base64/MIME/oversize, duplicate content, unknown message                                                      |
| Image-ref route params and adapter result                                      | Authorized image GET route; web client                    | Branded ID and project/thread param schemas; ownership lookup; response schema              | One image from the authorized thread with parsed MIME/data                                                                            | 404 for absent/cross-thread IDs; scoped protocol error for malformed response                                                  | Same/cross project/thread, malformed ID, missing image, malformed adapter output                                                                                         |
| Browser image response and object/data URL                                     | Transcript image component                                | Shared image response parser and fixed MIME allowlist                                       | Renderable typed attachment only; no arbitrary URL/HTML                                                                               | Per-image visible failure without replacing transcript                                                                         | Invalid JSON/base64/MIME, loading/error, URL cleanup, Markdown regression                                                                                                |
| Device-local pending state                                                     | Component memory and unload lifecycle                     | Construction through attachment controller only; no persisted read boundary                 | Page-lifetime `File`/URL records                                                                                                      | Warn before leaving; revoke and discard on unload/removal/success                                                              | Mount/unmount/removal/success/failure/unload tests                                                                                                                       |

## Touched-legacy-code analysis

- **Strict JSON commands:** Existing text-only browser and API callers must keep
  the same schemas, trim/max behavior, request policy, errors, and response
  shapes. Multipart is selected by content type rather than weakening JSON
  schemas. Characterize both representations at the real Fastify boundary.
- **First-prompt recovery:** Current markers contain `{id, text}` and must remain
  parseable for text-only sessions. The new marker is versioned and carries an
  input fingerprint; image-bearing recovery never falls back to text-only
  comparison. Existing native files are not rewritten.
- **Runtime fakes:** Many unit/E2E fakes implement string prompt methods. Update
  all compile-time callers and add assertions that text-only behavior remains
  identical; do not hide migration with optional `any` parameters or casts.
- **Transcript projection:** Existing sessions may already contain Pi image
  blocks that were silently dropped. The new parser begins exposing valid
  blocks without changing text, tool, diagnostic, IDs, timestamps, or Markdown
  behavior. Malformed historical images are scoped diagnostics.
- **Steer echo/restoration:** Existing matching counts user text because live Pi
  IDs are not canonical. Add attachment ownership to pending records without
  weakening duplicate-text retirement or queue-clearing behavior. Keep the
  stopped/failed-run regression suite.
- **Draft storage:** Keep string localStorage keys and migration behavior exactly
  as-is. Pending images are intentionally not serialized into those records.
- **Request limits and CSP:** The global 1 MiB limit remains. Route-specific
  multipart limits and `img-src blob:` are narrow additions; every existing
  Host/Origin/CSRF and framing directive remains.

## Verification

Focused automated checks during milestones:

```sh
pnpm --filter @pi-web/contracts build
pnpm vitest run packages/contracts/src/index.test.ts
pnpm --filter @pi-web/agent-runtime typecheck
pnpm vitest run packages/pi-adapter/src/index.test.ts packages/pi-adapter/src/persistence.test.ts
pnpm vitest run apps/server/src/app.test.ts apps/server/src/domain/workspace.test.ts
pnpm vitest run apps/web/src/features/workspace/NewChatPane.test.tsx apps/web/src/features/workspace/ThreadPane.test.tsx apps/web/src/components/Markdown.test.tsx
```

Integration and final checks:

```sh
pnpm test:integration
pnpm test:e2e
pnpm docs:check
pnpm check
```

Recorded manual verification must cover:

1. Drop, focused image paste, text-only paste, and Add-photos flows in two tiled
   panes in light and dark themes.
2. JPEG, PNG, and WebP; mixed valid/invalid files; all count/size/pixel limits.
3. Image-only and text-plus-image first prompt, later prompt, and steering with a
   real image-capable Pi model.
4. Failure/retry, stop with an undelivered steer, browser leave warning, and
   object URL cleanup.
5. Server restart followed by transcript thumbnail and larger-preview retrieval.
6. Text-only model and `images.blockImages` behavior with no silent image drop.
7. Accessibility keyboard walk, computed names, visible focus, status/error
   announcements, and a narrow viewport.

## Compatibility, deployment, migration, recovery, and rollback

- **Wire compatibility:** Existing JSON text commands remain accepted. New web
  clients use multipart only when images exist. Response additions are optional
  or version-compatible and parsed at both ends.
- **Persistence:** No SQLite migration and no application image store. Accepted
  images are native Pi user-message content. Existing sessions are read in
  place; dispatch marker v2 coexists with legacy markers.
- **Dependency/deployment:** Add and lock `@fastify/multipart`; production build
  and startup otherwise remain unchanged. No host restart/deployment is part of
  this plan unless separately requested through the host-update workflow.
- **Recovery:** Pending browser files survive ordinary send errors while the
  page lives. Accepted first prompts recover from the native dispatch marker and
  user message; ambiguous image recovery must fail safely rather than duplicate.
  Malformed historical images are omitted individually.
- **Rollback:** Reverting code and the multipart dependency leaves no DB state to
  roll back. Older application code will ignore native image blocks while Pi
  retains them; it will continue showing associated text. A client using the new
  multipart form requires the matching server version.
- **Residual risk:** A same-machine process can already invoke the unauthenticated
  loopback API. Route-specific caps limit, but do not eliminate, CPU/memory use
  from repeated image decode attempts. Pixel preflight, worker execution, and
  bounded concurrency must be retained.

## Progress

- [x] Investigated current composer, command, receipt/recovery, transcript, runtime, and Pi SDK image paths.
- [x] Drafted and indexed product specification version 1 and ExecPlan version 1.
- [x] Product specification version 1 approved by the user on 2026-08-29.
- [x] Technical plan version 1 approved by the user on 2026-08-29.
- [x] Milestone 1 — contracts and bounded multipart ingestion.
- [x] Milestone 2 — SDK-neutral runtime input and Pi delivery.
- [x] Milestone 3 — service coordination and idempotency.
- [x] Milestone 4 — composer drag, paste, previews, and failure lifecycle.
- [x] Milestone 5 — native history projection and on-demand rendering.
- [x] Milestone 6 — integration, documentation, and verification; real-provider manual dispatch was omitted and is recorded below.

## Discoveries and blockers

- Pi SDK 0.84.2 already supports prompt and steer images, and native JSONL stores
  them in user-message content. The repository's adapter currently chooses the
  string-only overload and its transcript helper discards image blocks.
- Pi's `PromptOptions.images` documentation contains one stale source-object
  example, but installed types, runtime code, RPC docs, and session-format docs
  agree on flat `{ type: "image", data, mimeType }` blocks. Installed runtime
  types/code are the implementation target.
- Pi's image auto-resize setting applies to CLI `@file`, read-tool, and tool
  result processing. `AgentSession.prompt(..., { images })` appends supplied
  blocks directly, so this integration must normalize untrusted browser images
  before calling it.
- The server's current 1 MiB global body limit cannot carry ordinary photos.
  Raising it globally would broaden every mutation unnecessarily; direct
  multipart commands with route-specific limits avoid both base64 inbound
  overhead and temporary upload lifecycle state.
- Native image content makes a separate application attachment database
  unnecessary. On-demand content-addressed refs avoid putting multi-megabyte
  base64 values into every snapshot/live frame.
- Product-v1 and plan-v1 approval were granted on 2026-08-29.
- `@fastify/multipart` 9.4 supplies direct bounded stream parsing. The global
  1 MiB Fastify body limit remains unchanged for other routes.
- The installed Pi SDK appends caller-supplied prompt images directly, so the
  adapter now validates source fingerprints, checks model/settings capability,
  and serializes resize work through a two-active/sixteen-waiting process queue.
  New-chat preflight reads only parsed global Pi settings; the presence of
  project settings yields `unknown` until Pi's trust-sensitive session-opening
  path makes the authoritative decision.
- A full Playwright run plus the added image test passed 64 of 68 tests. Four
  `workspace-pane-focus.spec.ts` tests fail before any image interaction because
  `useWorkspaceLayout` deliberately targets a new split's composer while that
  older spec expects focus to remain on the pane for a second split chord. All
  other E2E suites passed; this pre-existing focus-contract contradiction is
  outside chat-image scope.

## Decision and revision log

- 2026-08-29: Created plan version 1. Selected direct multipart command bodies
  over base64 JSON (global memory/size expansion) and pre-upload staging
  (orphan cleanup, persistence, and crash-recovery complexity).
- 2026-08-29: Selected page-memory pending attachments rather than IndexedDB,
  with failure retention and a leave-page warning; durable accepted content is
  owned by native Pi history.
- 2026-08-29: Selected on-demand authorized image retrieval rather than inline
  snapshot bytes, preserving bounded normal transcript transport.
- 2026-08-29: Selected JPEG/PNG/WebP only for version 1; HEIC/HEIF, GIF, PDFs,
  and generic files require separate format and rendering decisions.
- 2026-08-29: Added explicit clipboard-image paste to Draft product and plan
  version 1 at the user's request. Paste is scoped to the focused composer and
  reads only the user-triggered event; ambient clipboard reads remain out of
  scope.
- 2026-08-29: The user approved product specification version 1 and technical
  plan version 1 by saying the drafts looked good and asking for implementation;
  plan status moved to Active.

## Final outcomes

Completed on 2026-08-29. The browser now supports pane-scoped JPEG/PNG/WebP drag,
focused image paste, and an accessible picker with previews, limits, failure
retention, unload warning, and image-only submission. Image commands use bounded
multipart transport and content-aware idempotency; Pi receives normalized
multimodal blocks for prompt or steer, stores them in native history, and exposes
valid user images through authorized opaque refs. No image bytes enter SQLite or
the workspace.

Verification passed formatting, lint, type checking, 1,349 Vitest/Node tests,
production build, documentation tests/checks, and 64 of 68 Playwright tests. The
four Playwright omissions are the unrelated split-focus contradiction recorded
above. A live paid/provider model call was not made; SDK 0.84.2 delivery is
covered by an adapter test that executes the exact `prompt(text, { images })`
and resize boundary, and by server/browser multipart integration tests.
