# Accept provider metadata in naming completions

**Status:** Completed

**Plan version:** 1

**Technical approval:** Approved by the user on 2026-08-29 for plan version 1

**Subsystem:** Pi adapter prompt-derived naming boundary

**Affected paths or contracts:** `packages/pi-adapter/src/index.ts`, `packages/pi-adapter/src/index.test.ts`

**Governing specification:** [Thread workspaces version 3, TW-09](../../product-specs/thread-workspaces.md#tw-09--prompt-derived-thread-and-worktree-names)

**Related documents or issue:** [Runtime and Pi adapter](../../design/runtime-and-pi-adapter.md), user review-environment report on 2026-08-29

**Last updated:** 2026-08-29

## Working specification and approval context

Product behavior change: None. Preserve Current thread-workspaces specification version 3: a successful bounded response from the selected naming model supplies the title, while genuinely malformed or failed output uses deterministic fallback naming. The user explicitly confirmed this product invariant and approved technical plan version 1 on 2026-08-29.

## Purpose and user-visible outcome

The configured default `openai-codex/gpt-5.6-sol` model successfully returns one text title, but its text block also carries provider metadata (`textSignature`). The adapter currently rejects that otherwise usable response because the text-block schema forbids every field except `type` and `text`, so users still see deterministic prompt-prefix names. The boundary should parse and retain only the fields naming needs while tolerating unrelated provider metadata.

## Requirement traceability

| Spec requirement                                                                                                                     | Technical consequence                                                                                                                                                                                                                  | Verification                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [TW-09 model-generated title and fallback](../../product-specs/thread-workspaces.md#tw-09--prompt-derived-thread-and-worktree-names) | Parse exactly one stopped text block into `{ type, text }`, stripping unrelated SDK/provider metadata rather than treating it as malformed. Continue rejecting missing/wrong required fields, multiple blocks, and non-stop responses. | Focused adapter regression includes a real-shaped text block with `textSignature`; existing malformed response tests remain green. |

## Current behavior and affected invariants

`namingCompletionSchema` uses `z.strictObject()` for its sole content block. The real selected model returned `stopReason: "stop"` and one `{ type: "text", text: "…", textSignature: "…" }` block in 2.5 seconds. Direct completion succeeded, but `PiAgentRuntime.suggestTitle()` returned `unavailable` because strict parsing rejected `textSignature`.

The parser must continue guaranteeing one stopped text block with string text. `parseGeneratedTitle()` must continue enforcing normalization, one line, non-empty text, and the 60-character limit. No raw metadata may cross the adapter boundary.

## Scope, non-goals, assumptions, and unresolved technical decisions

### Scope

- Change only the naming completion block parser from exact-object rejection to a Zod object projection that constructs `{ type, text }` and strips unknown metadata.
- Add regression coverage for `textSignature` and retain malformed/multi-block coverage.
- Re-run the live naming probe and the existing review environment after implementation.

### Non-goals

- Trusting or exposing `textSignature`.
- Relaxing the tuple cardinality, stop reason, text type, title parser, model selection, timeout, token limit, or fallback behavior.
- Changing APIs, persistence, worktree naming, or product documentation.

### Assumptions

Provider metadata fields are semantically unrelated to title extraction. Their presence and shape need not be trusted because the parser strips them and downstream code receives only the required discriminant and text.

### Unresolved technical decisions

None.

## Implementation milestones

1. Add a focused regression fixture with a provider metadata field and prove current parsing falls back.
2. Replace the strict text-block parser with a projecting object parser; run focused adapter tests.
3. Verify a direct `PiAgentRuntime.suggestTitle()` call returns a model-generated title, then let the existing isolated review environment reload for user testing.
4. Run static/full checks, record evidence, and complete this plan.

## Untrusted-data-boundary analysis

| Source and raw representation                        | Entry/read point                | Runtime parser                       | Trusted output and guarantees                                                                              | Failure behavior                                           | Boundary tests                                                                   |
| ---------------------------------------------------- | ------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ModelRuntime.completeSimple()` response (`unknown`) | `PiAgentRuntime.suggestTitle()` | `namingCompletionSchema.safeParse()` | `stopReason === "stop"`; exactly one content block containing only parsed `type: "text"` and string `text` | Return `unavailable` and use deterministic server fallback | Valid text with metadata; missing/wrong text; multiple blocks; wrong stop reason |

This follows Parse, Don't Validate by constructing the smaller trusted value naming actually consumes. It does not cast, pass through, or retain uncontrolled provider metadata.

## Touched-legacy-code analysis

The strict text-block schema was intended to reject malformed SDK output, but it also rejects additive provider metadata that does not affect any downstream invariant. The intended invariant is required-field and cardinality parsing, not exact raw-object identity. Existing callers consume only `content[0].text`; no stored representation or compatibility migration is involved.

## Verification

```sh
pnpm vitest run packages/pi-adapter/src/index.test.ts
pnpm --filter @pi-web/pi-adapter typecheck
NODE_ENV=test pnpm test
pnpm lint
pnpm format:check
pnpm docs:check
```

Runtime probe: call `PiAgentRuntime.suggestTitle()` with a non-sensitive synthetic coding prompt against the already registered review project and confirm `outcome: "available"`. The existing disposable review environment may then be used for the user's manual check.

## Compatibility, deployment, migration, recovery, and rollback

No API, database, migration, Git identity, or deployment sequencing changes. Providers that return only `type` and `text` behave unchanged. Additive unknown text-block metadata is stripped. Malformed required fields still trigger deterministic fallback. Rollback is a code/test revert with no state repair.

## Progress

- [x] Reproduced the user-visible fallback in the disposable review environment.
- [x] Isolated the mismatch to additive `textSignature` metadata on a successful naming completion.
- [x] Drafted technical plan version 1 with no product behavior change.
- [x] Obtained explicit product-invariant confirmation and technical approval from the user on 2026-08-29.
- [x] Implemented, verified, and completed the plan.

## Discoveries and blockers

- The selected model and authentication are available: project settings resolve `openai-codex/gpt-5.6-sol`, and it appears in the authenticated catalog.
- A direct bounded completion returned `Test Login Invalid Session Redirect`; the same call through the adapter returned `unavailable` solely because the content block included `textSignature`.
- Building the adapter caused the existing `tsx watch` review server to detect `packages/pi-adapter/dist/index.js`, restart automatically, and return healthy on the same URL. No manual process or state manipulation was needed.
- No blockers remain.

## Decision and revision log

- 2026-08-29: Created plan version 1. Treat additive provider metadata as outside the trusted projection rather than as a malformed title response.
- 2026-08-29: The user explicitly confirmed the Current product invariant and approved ExecPlan version 1; the plan moved through Ready to Active and implementation began.
- 2026-08-29: Replaced exact raw-object matching with a required-field projection for naming text blocks, verified the real configured model, and completed the plan.

## Final outcomes

Completed on 2026-08-29.

- `namingCompletionSchema` now constructs the required `{ type, text }` block and strips additive provider metadata instead of rejecting the entire successful response.
- The regression fixture includes `textSignature`; all 48 focused adapter tests pass while existing malformed and multi-block response coverage remains intact.
- A live non-sensitive `PiAgentRuntime.suggestTitle()` probe against `openai-codex/gpt-5.6-sol` changed from `unavailable` to `{ outcome: "available", title: "Test Login Invalid Session Redirect" }` in 2.3 seconds.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `NODE_ENV=test pnpm test` (1,325 Vitest tests and 12 Node script tests), and `pnpm docs:check` passed.
- The existing disposable review environment rebuilt the adapter, restarted automatically, and remains available for manual user verification at its existing URL.
