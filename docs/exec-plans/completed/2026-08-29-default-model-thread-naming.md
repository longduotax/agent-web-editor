# Default-model thread and worktree naming

**Status:** Completed

**Plan version:** 1

**Technical approval:** Approved by the user on 2026-08-29 for plan version 1

**Subsystem:** Pi adapter prompt-derived naming and thread-workspace creation

**Affected paths or contracts:** `packages/pi-adapter/src/index.ts`, `packages/pi-adapter/src/index.test.ts`, `docs/product-specs/thread-workspaces.md`, `docs/design/runtime-and-pi-adapter.md`, `docs/architecture/overview.md`, `packages/pi-adapter/README.md`, `apps/server/README.md`

**Governing specification:** [Thread workspaces version 3, TW-09](../../product-specs/thread-workspaces.md#tw-09--prompt-derived-thread-and-worktree-names)

**Related documents or issue:** [Runtime and Pi adapter](../../design/runtime-and-pi-adapter.md), [Architecture overview](../../architecture/overview.md)

**Last updated:** 2026-08-29

## Working specification and approval context

[Thread workspaces](../../product-specs/thread-workspaces.md) version 3 is Current. The user approved product specification version 3 and technical plan version 1 on 2026-08-29 by instructing implementation after both identified drafts were presented. Implementation and verification completed on 2026-08-29.

## Purpose and user-visible outcome

New threads should normally receive a concise model-generated title even when the user's provider has no cheaper authenticated model. An explicit `PI_WEB_NAMING_MODEL` override remains authoritative; without one, naming uses the configured default Pi model that a new Pi thread initially uses. The existing bounded, tool-free request and deterministic fallback remain unchanged.

## Requirement traceability

| Spec requirement                                                                                                             | Technical consequence                                                                                                                                                                            | Verification                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [TW-09 automatic model selection](../../product-specs/thread-workspaces.md#tw-09--prompt-derived-thread-and-worktree-names)  | Replace automatic lower-cost candidate ranking with exact selection of the parsed configured default provider/model from the parsed available-model list. Preserve explicit override precedence. | Pi-adapter tests prove the default model is completed against even when cheaper same-provider and cross-provider models are available.        |
| [TW-09 fallback and compatibility](../../product-specs/thread-workspaces.md#tw-09--prompt-derived-thread-and-worktree-names) | Preserve bounded completion, title parsing, deterministic fallback, persisted idempotent naming, slug construction, and rename behavior.                                                         | Existing adapter and server naming/worktree suites remain green; focused coverage proves missing/malformed defaults do not invoke completion. |

## Current behavior and affected invariants

`PiAgentRuntime.suggestTitle()` parses the available authenticated model descriptors. An explicit `PI_WEB_NAMING_MODEL` selects an exact available descriptor. In automatic mode it parses the project's default provider/model, resolves the default descriptor, computes a weighted cost, and chooses the cheapest authenticated model from the same provider whose weighted cost is strictly lower. If no such model exists, it returns `unavailable`, causing `WorkspaceService` to use deterministic `fallbackTitle()` naming.

The affected invariant is model selection only. These invariants remain unchanged:

- naming receives only the first prompt and fixed formatting instructions;
- completion is tool-free, capped at 32 output tokens, has no cache retention, and uses a five-second signal timeout;
- SDK settings, model catalogs, model handles, and completion responses are parsed before use;
- malformed/unavailable naming results return `unavailable` and never block creation;
- the selected title is persisted once for idempotent creation and is independently sanitized before entering Git refs or paths;
- explicit naming-model configuration takes precedence; and
- later thread rename does not rename the native session, worktree, directory, or branch.

## Scope, non-goals, assumptions, and unresolved technical decisions

### Scope

- In automatic mode, select the exact parsed default provider/model when it appears in the parsed authenticated available-model list.
- Preserve explicit `PI_WEB_NAMING_MODEL` selection.
- Update focused tests and current durable documentation that describes lower-cost automatic selection.

### Non-goals

- Adding a browser naming-model selector or a per-thread model selector.
- Reading model choice from another existing thread or transcript.
- Changing the title prompt, output parser, timeout, token limit, fallback title algorithm, slug algorithm, worktree identity, persistence, or retry behavior.
- Changing Pi's model selection for the coding run itself.
- Refreshing the model catalog over the network.

### Assumptions

- Before a new session exists, “the current model the user is using” means the default provider/model resolved by Pi settings for the selected project, which is the model a new thread initially inherits.
- `ModelRuntime.getAvailable()` remains the authentication/availability authority; a configured default absent from that parsed list is unavailable for naming and triggers the existing fallback.

### Unresolved technical decisions

None.

## Implementation milestones

1. **Selection regression tests:** Change automatic-selection coverage in `packages/pi-adapter/src/index.test.ts` to require the configured default model even when cheaper same-provider and cross-provider candidates are available. Add or retain coverage that an absent or malformed default returns `unavailable` without completion and that explicit selection is unaffected.
2. **Adapter implementation:** In `packages/pi-adapter/src/index.ts`, replace lower-cost candidate computation/ranking with exact lookup of the parsed default selector in the parsed available descriptors. Keep downstream model-handle parsing and identity comparison intact.
3. **Durable documentation:** After implementation verifies, update `docs/design/runtime-and-pi-adapter.md`, `docs/architecture/overview.md`, `packages/pi-adapter/README.md`, and `apps/server/README.md`; fold proposed specification version 3 into Current TW-09.
4. **Verification and completion:** Run focused tests, package type checking, lint/format/document checks, and the full test suite if focused checks expose shared regressions. Record evidence, complete the plan, move it to `docs/exec-plans/completed/`, and update both plan indexes.

## Untrusted-data-boundary analysis

| Source and raw representation                               | Entry/read point                                 | Runtime parser                                                    | Trusted output and guarantees                                                                         | Failure behavior                                             | Boundary tests                                                        |
| ----------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Pi settings getters returning unknown provider/model values | `PiAgentRuntime.suggestTitle()` automatic branch | `namingModelSelectorSchema.safeParse()`                           | Non-empty provider and model strings                                                                  | Return `unavailable`; do not look up or complete             | Existing parameterized malformed-provider/model test                  |
| Pi model-runtime available catalog (`unknown`)              | `ModelRuntime.getAvailable()`                    | `z.array(namingModelDescriptorSchema).parse()`                    | Array of descriptors with non-empty identities and nonnegative costs                                  | Catch and return `unavailable`                               | Existing malformed-catalog coverage plus exact-default selection test |
| Pi model handle (`unknown`)                                 | `ModelRuntime.getModel()`                        | `parseNamingModelHandle()` and identity comparison                | Fresh plain handle with required bounded runtime fields matching the selected descriptor              | Return `unavailable`; do not complete                        | Existing malformed-handle and identity tests                          |
| Pi completion response (`unknown`)                          | `ModelRuntime.completeSimple()`                  | `namingCompletionSchema.safeParse()` then `parseGeneratedTitle()` | Exactly one stopped text block yielding one plain, non-empty, one-line title of at most 60 characters | Return `unavailable`, allowing deterministic server fallback | Existing malformed/multi-block/title tests                            |

No new external or persisted representation is introduced. The change selects a different already-parsed descriptor and does not weaken any parser.

## Touched-legacy-code analysis

The modified path is the existing `suggestTitle()` automatic branch. Its current lower-cost policy is deliberate version-2 behavior and has focused characterization coverage. Version 3 intentionally replaces only that policy. Explicit selection callers, server fallback handling, persisted creation rows, native-session naming, and worktree slug callers retain their current forms and compatibility. No stored model selector or generated identity is migrated; already-created threads and worktrees remain unchanged.

Unrelated model-catalog parsing, cost fields, title parsing, fallback formatting, and worktree cleanup are outside scope.

## Verification

Planned commands:

```sh
pnpm vitest run packages/pi-adapter/src/index.test.ts
pnpm --filter @pi-web/pi-adapter typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm docs:check
```

Focused assertions must show:

- automatic mode invokes `completeSimple()` with the configured default model;
- cheaper models from the same or another provider are ignored;
- an explicit configured naming model still wins;
- malformed or unavailable defaults do not invoke completion and return `unavailable`; and
- existing completion/title boundary failures remain non-blocking.

No manual UI check is required because the browser contract and rendering do not change. The server-level naming/worktree tests in the full suite provide regression evidence for fallback, persistence, slugging, and identity stability.

## Compatibility, deployment, migration, recovery, and rollback

This is an in-process selection-policy change with no API, schema, migration, state-directory, Git identity, or deployment-sequencing change. Existing threads, sessions, worktrees, and branches retain their stored names. New automatic naming calls may use a more expensive model than before, but remain bounded to 32 output tokens and five seconds. Operators can still pin a distinct model with `PI_WEB_NAMING_MODEL`.

Recovery remains deterministic fallback on any naming failure. Rollback is a code/document revert; no persisted state repair is needed because generated titles and worktree identities are valid under either policy and immutable after creation.

## Progress

- [x] Investigated the governing specification, architecture, design, adapter implementation, and focused tests.
- [x] Drafted proposed product specification version 3 and ExecPlan version 1.
- [x] Obtained explicit product approval for specification version 3 and technical approval for plan version 1 from the user on 2026-08-29.
- [x] Implemented and verified the approved change.
- [x] Promoted specification version 3 to Current and completed the plan.

## Discoveries and blockers

- Automatic mode currently refuses to use the configured default model itself; it requires another same-provider model with a strictly lower weighted cost. This explains frequent deterministic fallback naming when a provider exposes only the default model.
- The existing completion request is already bounded and tool-free, so this change needed no transport, persistence, or trust-boundary expansion.
- The harness exported `NODE_ENV=production`, which makes React's production build unavailable to Testing Library and caused the first bare `pnpm test` attempt to fail in unrelated browser suites with `React.act is not a function`. Running the repository suite with `NODE_ENV=test`, as required for its test runtime, passed all 1,325 Vitest tests and all 12 Node script tests.
- No blockers remain.

## Decision and revision log

- 2026-08-29: Created plan version 1. The proposed approach interprets the model used by a not-yet-created thread as the project-resolved Pi default, preserves an explicit naming override, and otherwise preserves existing fallback and safety boundaries.
- 2026-08-29: The user approved product specification version 3 and technical plan version 1 by replying “please implement this” to the explicit approval request. The plan moved through Ready to Active and implementation began.
- 2026-08-29: Implemented exact default-model selection, preserved explicit override and fallback behavior, verified the repository, promoted thread-workspaces specification version 3 to Current, and completed the plan.

## Final outcomes

Completed on 2026-08-29.

- Automatic prompt-derived naming now selects the exact configured default Pi provider/model from the parsed authenticated available-model list. It no longer ranks or substitutes a cheaper model.
- Explicit `PI_WEB_NAMING_MODEL` selection, model-handle and completion parsing, five-second/32-token request bounds, deterministic fallback, title persistence, slugging, and rename stability are unchanged.
- Focused adapter verification passed 48 tests, including default selection in the presence of cheaper same-provider and cross-provider models and fallback when the default is unavailable.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `NODE_ENV=test pnpm test` (1,325 Vitest tests and 12 Node script tests), `pnpm build`, `pnpm test:docs`, `pnpm docs:check`, and `git diff --check` passed. The initial bare `pnpm test` failure was isolated to the harness's inherited production React runtime and is recorded above.
- Current architecture, design, component documentation, and thread-workspaces specification version 3 describe the implemented policy. No migration, API change, or manual UI verification was required.
