# Inline thread title editing

**Status:** Completed

**Plan version:** 1

**Technical approval:** Approved by the user for plan version 1 on 2026-08-29

**Subsystem:** Browser thread management and workspace pane headers

**Affected paths or contracts:** `apps/web/src/components/ThreadRenameForm.tsx`, `apps/web/src/components/ThreadRenameForm.test.tsx`, `apps/web/src/features/workspace/PaneHeader.tsx`, `apps/web/src/features/workspace/PaneHeader.test.tsx`, `apps/web/src/features/workspace/ThreadPane.tsx`, `apps/web/src/features/workspace/ThreadPane.test.tsx`, `apps/web/src/App.tsx`, `apps/web/src/App.test.tsx`, and `apps/web/src/styles.css`. The existing HTTP rename contract is consumed unchanged; there are no server, database, or shared-contract changes.

**Governing specification:** [Thread management current version 3, TM-06](../../product-specs/thread-management.md#tm-06--one-row-inline-title-editing)

**Related documents or issue:** [Codex-style workspace surface CWS-03 and CWS-04](../../product-specs/codex-workspace-surface.md#cws-03--one-pane-header-surfaces-run-status-at-a-glance), [web workspace composition](../../design/web-workspace-composition.md), and the overlapping completed implementation slice in [Codex-style workspace surface plan Task 7](../active/2026-08-22-codex-workspace-surface.md#task-7-shared-paneheader-with-run-status-and-splitclose-only-actions)

**Last updated:** 2026-08-29

## Working specification and approval context

Product behavior changes under thread-management proposed version 3, limited to TM-06. The deferred archival candidate is independent and is not approved or changed by approval of version 3.

The user specified the interaction in conversation on 2026-08-29: both the pane-header title and a sidebar thread title enter rename mode on double-click; the editor is inline and exactly one row; loss of focus saves; there is no accept or cancel button; and one Revert control is available to abandon the edit. The user explicitly approved the bounded revision, then identified as revision 2.1, and this inline-title-editing plan version 1 on 2026-08-29. The specification was subsequently renumbered to positive-integer version 3 without a content change to satisfy repository lifecycle metadata; this editorial renumbering does not expand approval to the deferred archival candidate.

## Purpose and user-visible outcome

A thread title can be renamed directly where it is read, in either the sidebar or pane header, without the current multi-row form and Save/Cancel action row. Both surfaces use one compact interaction and the existing durable rename command.

## Requirement traceability

| Spec requirement                                                                      | Technical consequence                                                                                                                                                                                                                                        | Verification                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TM-06](../../product-specs/thread-management.md#tm-06--one-row-inline-title-editing) | Build one shared one-row editor; activate it from sidebar and pane-header title double-click; commit on blur/Enter; revert on Escape/Revert; preserve drafts and show failures; synchronize TanStack Query caches through the existing parsed rename client. | Focused component tests in `ThreadRenameForm.test.tsx`, `PaneHeader.test.tsx`, `ThreadPane.test.tsx`, and `App.test.tsx`; typecheck/build; recorded manual-pass omission and residual risk. |

## Current behavior and affected invariants

The sidebar's Rename menu replaces the entire row with `ThreadRenameForm`, a wrapping textarea plus a second row containing a hint, Save, and Cancel. It does not commit on blur. The pane header renders its title as a non-interactive `<h1>` and has no rename path. `App.tsx` already owns a rename mutation that invalidates both `['workspace']` and the affected thread snapshot; the server endpoint, request parser, 200-character bound, project ownership, idempotency, and persistence are implemented and tested.

The implementation must preserve:

- ordinary single-click sidebar navigation;
- exactly one pane header and its fixed `--header-h` height;
- the pane's persistent actions being Split and Close only — Revert is a transient title-editor control, not a pane action;
- `dir="auto"` behavior for user/model title text;
- non-empty, trimmed, at-most-200-character server titles;
- parsed API responses and server authority over durable titles;
- no duplicate command while a save is pending;
- visible, recoverable rename failures; and
- no change to thread order, run state, worktree identity, routing, or archival.

## Scope, non-goals, assumptions, and unresolved technical decisions

### Scope

- Replace the sidebar rename form's wrapping/multi-row treatment with a shared one-row editor.
- Activate sidebar editing by double-clicking the title while retaining the existing Rename menu.
- Activate pane-header editing by double-clicking the title.
- Share commit, revert, validation, pending, and error behavior across both placements.
- Use the existing rename endpoint and synchronize the workspace and snapshot queries.

### Non-goals

- No server, database, contract, route, title-generation, thread-ordering, archival, or worktree changes.
- No permanent rename icon or accept button.
- No multiline title editing, modal, context menu in the pane header, or new keyboard shortcut beyond Enter and Escape while editing.
- No broad extraction of all thread UI from `App.tsx`.

### Assumptions and resolved technical decisions

- Keep `ThreadRenameForm.tsx` as the shared editor module to minimize churn, but change it to a controlled one-row `<input>` with a placement class rather than retain the wrapping textarea contract.
- The editor shows one trailing Revert icon. It has an accessible `Revert title` name and tooltip; Escape invokes the same path.
- Enter and focus leaving the editor attempt one save. An unchanged trimmed title exits without a request. An empty title is not sent and remains editable with a compact validation message.
- Pointer-down on Revert suppresses the input's blur commit, then restores the original value and exits. This ordering is required because browser blur precedes click.
- A failed async save leaves the editor and draft mounted with a compact visible alert; editing again or retrying clears/replaces that error, and Revert exits it.
- While saving, the field is read-only and Revert is disabled so only one terminal outcome can win.
- In the sidebar, the existing Link remains the single-click navigation target. Its title receives an `onDoubleClick` handler that prevents the double-click activation's default navigation and starts editing. The first click may perform the normal navigation; `WorkspaceLayout` remains mounted across thread routes, so the second activation still replaces that stable row with the editor. Tests will characterize this rather than delay all single-click navigation behind a double-click timer.
- In the pane header, `PaneHeader` receives an optional async `onRename`; omitting it keeps `New chat` non-editable. The editor replaces only the title slot. The project chip and Split/Close remain, subject to existing narrow-pane hiding, and the header never grows.
- `ThreadPane` owns its local `useMutation` because it already has the parsed `projectId` and `threadId`; this avoids rename prop drilling through `WorkspaceView` and `TilingSurface`. On success it patches the matching snapshot's parsed `ThreadSummary` from the parsed mutation response and invalidates `['workspace']`. The sidebar keeps its existing mutation and invalidation behavior.

Unresolved technical decisions: None.

## Implementation milestones

### Milestone 1 — Lock the shared interaction in failing tests

Modify `ThreadRenameForm.test.tsx` to specify a one-row input, selected initial text, blur/Enter commit, Escape/Revert behavior, blur suppression when Revert is pressed, no-op unchanged title, empty-title error, pending duplicate guard, and retained async failure. Extend `PaneHeader.test.tsx` for double-click activation, fixed action/header semantics, and axe coverage. Add focused integration expectations to `App.test.tsx` and `ThreadPane.test.tsx` for the correct IDs/title and synchronized visible title.

### Milestone 2 — Implement the shared editor and sidebar activation

Refactor `ThreadRenameForm.tsx` to own the original title/draft interaction and invoke an async commit callback. Update the sidebar state and mutation adapter in `App.tsx`, add title double-click activation without changing single-click navigation or the menu route, and replace the old multi-row CSS with one-row field/revert/error styling.

### Milestone 3 — Add pane-header activation and cache synchronization

Give `PaneHeader` its optional rename callback and render the same editor in the title slot. Add the existing API mutation to `ThreadPane`, patch its snapshot title from the parsed response, and invalidate the workspace list. Keep `NewChatPane` unchanged by omitting the callback.

### Milestone 4 — Verify behavior and finish documentation

Run focused and full web checks. Manually inspect long and RTL titles in both locations, a 360px pane, multiple panes, and light/dark themes; confirm no header or sidebar row height change in display mode, no editor wrap, no double mutation, and a visible recoverable failure. Fold version 3 into the current thread-management contract only after all evidence passes, complete this plan, and update indexes.

## Untrusted-data-boundary analysis

| Source and raw representation             | Entry/read point                               | Runtime parser                                                                                            | Trusted output and guarantees                                                                              | Failure behavior                                                                                                    | Boundary tests                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| User-entered title in a browser `<input>` | Shared editor commit handler                   | UI normalization trims for intent; authoritative `RenameThreadRequestSchema` executes in the server route | Server domain receives a non-empty title of at most 200 characters plus parsed branded IDs/idempotency key | Empty UI draft is retained locally and not sent; malformed direct requests remain rejected by the existing 400 path | Existing contract/server rename tests retain malformed, empty, oversized, and ownership cases; component tests cover empty and max-length UI behavior |
| Rename HTTP response JSON                 | `renameThread` in `apps/web/src/api/client.ts` | Existing `ThreadMutationResponseSchema` in the shared request helper                                      | A parsed `ThreadSummary`, including branded IDs and bounded title, safe to place in query caches           | Existing scoped `ApiClientError` rejects the mutation; editor preserves the draft and shows the error               | Existing API client parser coverage plus new component rejection tests                                                                                |

No database or new persisted/browser-storage boundary is introduced. Existing server and store parsers are consumed unchanged.

## Touched-legacy-code analysis

`ThreadRenameForm` deliberately wraps long titles and carries explicit Save/Cancel because an earlier one-line sidebar field was too narrow. The new user requirement explicitly supersedes that layout with a one-row inline editor and blur-save behavior on both surfaces. Long titles therefore scroll horizontally while being edited; tests must replace, not silently retain, the wrapping invariant. The max-length, text selection, Enter/Escape, duplicate-submit guard, `dir="auto"`, and recoverable-error invariants remain.

`App.tsx` shares one rename mutation across sidebar rows and records the currently edited target. Preserve its `reset()` discipline so an error from one thread cannot appear on another. Simplify only state made obsolete by the shared editor owning its draft; do not alter archive/menu/navigation behavior.

`PaneHeader` currently guarantees exactly two persistent pane action buttons. Revert appears only inside an active title editor and does not add a permanent header action. Existing tests for Split/Close remain and receive a separate editing-state assertion.

## Verification

Focused red/green commands:

```sh
pnpm --filter @pi-web/web exec vitest run src/components/ThreadRenameForm.test.tsx
pnpm --filter @pi-web/web exec vitest run src/features/workspace/PaneHeader.test.tsx src/features/workspace/ThreadPane.test.tsx
pnpm --filter @pi-web/web exec vitest run src/App.test.tsx
```

Final automated checks:

```sh
pnpm --filter @pi-web/web typecheck
pnpm --filter @pi-web/web exec vitest run src
pnpm --filter @pi-web/web build
```

Manual checks:

1. Single-click an unselected sidebar title and confirm normal navigation; double-click it and confirm the stable row becomes a selected one-row editor.
2. Double-click a pane title and confirm only the title slot changes, with no header-height movement.
3. Save each placement by clicking elsewhere and by Enter; confirm the other placement updates.
4. Revert each placement by icon and Escape; confirm no request and no title change.
5. Exercise unchanged, empty, long, RTL, pending double-action, and rejected-request cases.
6. Repeat at the 360px pane floor and in light and dark themes.

## Compatibility, deployment, migration, recovery, and rollback

No migration or deployment sequencing is needed. Existing clients and server versions remain compatible because the HTTP contract is unchanged. Rollback is a web-only revert of the shared editor/header/sidebar changes; durable titles already committed remain valid. A failed rename retains the prior durable title and the local draft, and Revert restores the displayed authoritative title.

## Progress

- [x] Investigated current sidebar editor, pane header, rename mutation/cache behavior, governing specifications, tests, and overlapping plan.
- [x] Drafted thread-management proposed version 3 (initially labelled revision 2.1) and plan version 1.
- [x] Obtained explicit user approval for the unchanged bounded product revision and technical approval for plan version 1 on 2026-08-29.
- [x] Implemented the shared editor, sidebar double-click activation, pane-header activation, query synchronization, styling, and regression coverage.
- [x] Verified automated checks, promoted specification version 3 to Current, and completed the plan.

## Discoveries and blockers

- The backend and shared contract already implement the required rename operation and title bounds; this is a browser-only behavior and presentation change.
- The current sidebar editor's wrapping and explicit-action design was intentional, but the new one-row/blur-save instruction explicitly replaces it.
- The repository's product and technical approval gate was satisfied on 2026-08-29.
- The harness exported `NODE_ENV=production`; jsdom React tests therefore required an explicit `NODE_ENV=test`. This is an execution-environment constraint, not a product defect.
- Repository lifecycle metadata accepts positive integer versions only. The unchanged bounded revision approved as 2.1 was editorially renumbered to version 3; the unrelated archival-recovery candidate remains deferred and unapproved.
- Automated verification passed. A hands-on browser pass was omitted because this harness has no browser interaction tool and creating UI fixture data would require writes to a database not identified by the user as disposable; the component, integration, fixed-height CSS, narrow-width rules, themes, RTL direction, and reduced-motion behavior are covered by existing and added automated checks.

## Decision and revision log

- 2026-08-29: Created plan version 1. Chose one shared one-row editor with blur/Enter commit and Escape/Revert rollback, local pane mutation rather than callback prop drilling, and no server/contract changes.
- 2026-08-29: The user explicitly approved the bounded thread-management revision, then labelled 2.1, and plan version 1; marked implementation Active.
- 2026-08-29: Renumbered the unchanged bounded product revision to specification version 3 because lifecycle metadata requires a positive integer; the deferred archival candidate remains outside this approval.

## Final outcomes

Completed on 2026-08-29.

- Sidebar threads and threaded pane headers now enter the same one-row inline editor on double-click; the sidebar menu remains available.
- Enter or focus leaving saves; Escape or the sole Revert control restores the authoritative title; there is no Save/Confirm/Cancel action row.
- Empty, unchanged, pending, failed, long, and automatic-direction title paths are handled without changing the normal row or fixed pane-header height.
- The existing parsed rename API is reused unchanged. Pane success patches the snapshot title immediately and refreshes the workspace listing; sidebar success retains its established workspace/snapshot invalidation.
- Focused tests (116), the full web suite (1,020), web typecheck/build, repository lint/format, and documentation validation passed. Vite retained its pre-existing large-chunk warning, and jsdom printed its pre-existing canvas-not-implemented diagnostic.
- No server, contract, database, route, persistence, worktree, or deployment change was made.
