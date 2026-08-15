# Initial agent workspace specification

**Status:** Completed

**Subsystem:** Product specification and workspace UX

**Affected paths or contracts:** `docs/product-specs/initial-workspace.md`,
`docs/product-specs/index.md`

**Approved specification:** [Initial agent workspace](../../product-specs/initial-workspace.md)

**Approval context:** The user approved the brainstormed project/thread model,
completion indicators, three-region layout, inspector contents, native Pi
history strategy, application metadata, and run terminology in the current
conversation, then explicitly requested the canonical specification on
2026-08-15.

**Related documents or issue:** [Documentation workflow](../../development/documentation-workflow.md),
[architecture overview](../../architecture/overview.md)

**Last updated:** 2026-08-15

## Purpose and acceptance criteria

Record the approved initial product behavior and design direction in one indexed
canonical specification without implying that the static scaffold implements
it.

Acceptance criteria:

- The specification defines projects, threads, runs, selected-thread state, and
  completion-notification behavior.
- It records the sidebar, selected-thread, and Changes/Files/Terminal inspector
  layout.
- It distinguishes native Pi transcript persistence from application metadata.
- It captures security boundaries, recovery behavior, non-goals, and remaining
  technical-design work.
- The product-spec index links the new document.
- Formatting and documentation validation pass.

## Current behavior and affected invariants

The repository has no canonical product behavior and implements only a static
browser shell. The new document is an approved future contract; architecture
must continue to describe the unimplemented scaffold until production behavior
exists.

## Scope, non-goals, assumptions, and unresolved decisions

This plan covers documentation only. It does not implement UI, transport,
database, filesystem, Git, PTY, authentication, or Pi adapter behavior. The
specification records unresolved internal designs for those boundaries rather
than inventing implementations.

## Implementation milestones

1. Create and index the approved initial workspace specification.
2. Check formatting, links, and documentation structure.
3. Record outcomes and archive this plan.

## Untrusted-data-boundary analysis

No runtime boundary is added by this documentation-only change. The
specification inventories future browser API, persistence, filesystem, Git,
terminal, and Pi SDK boundaries and requires runtime parsing before production
implementation.

## Touched-legacy-code analysis

No production or legacy implementation is touched. The product-spec index
previously stated that no product behavior was specified; replacing that text is
required to keep routing accurate.

## Verification

```sh
pnpm exec prettier --check docs/product-specs/initial-workspace.md \
  docs/product-specs/index.md \
  docs/exec-plans/active/2026-08-15-initial-workspace-specification.md
pnpm docs:check
```

No runtime verification is applicable because no application code changes.

## Compatibility, deployment, migration, and recovery

There is no runtime compatibility, deployment, or migration impact. Recovery is
a documentation revert. Future implementation must independently design the
migration and compatibility behavior required by the specification.

## Progress

- [x] Working specification approved by the user.
- [x] Canonical specification created and indexed.
- [x] Documentation checks pass.
- [x] Plan archived.

## Discoveries and blockers

- Pi natively persists session history as project-organized JSONL, while project
  registration, run status, unread state, and UI metadata require separate
  application persistence.
- No blockers.

## Decision log

- 2026-08-15: Keep native Pi sessions authoritative for transcripts and use
  application persistence for workspace organization and UI state.
- 2026-08-15: Treat browser selection, run lifecycle, and archival as separate
  concepts rather than one `active` flag.

## Final outcomes

The approved initial workspace behavior is now recorded in an indexed canonical
product specification. Focused formatting and documentation-navigation checks
passed. No application behavior or current architecture changed.
