# Specification and ExecPlan approval workflow

**Status:** Completed

**Plan version:** 1

**Technical approval:** Approved by the user on 2026-08-15 for plan version 1

**Subsystem:** Repository development and documentation workflow

**Affected paths or contracts:** `docs/development/**`, `docs/product-specs/**`, `docs/exec-plans/**`, `docs/README.md`, `scripts/check_docs.py`, `scripts/test_check_docs.py`, and root verification scripts in `package.json`

**Governing specification:** No product behavior changes. The approved working specification is recorded below.

**Related documents or issue:** [Agent implementation workflow](../../development/agent-implementation-workflow.md), [documentation workflow](../../development/documentation-workflow.md), [ExecPlan workflow](../../development/exec-plan-workflow.md), and the user's 2026-08-15 approval in this conversation

**Last updated:** 2026-08-15

## Approved working specification and approval context

The repository will retain Fast and Plan lanes. Fast remains inspect, change, and test without a required specification or plan. For Plan work, investigation is followed by a Draft canonical specification or proposed revision and a Draft versioned ExecPlan that evolve together before production-code changes. Product behavior belongs authoritatively in capability-oriented product specifications; technical consequences belong in linked ExecPlans. A decision affecting both is represented as a specification requirement and a linked plan consequence, not a third document or a duplicated rule.

Implementation may start only after the user explicitly approves both the product intent and technical approach for identified document versions. Material product changes invalidate the affected specification and plan approvals. Material architecture-only changes invalidate only plan approval. Routine progress within the approved approach does not require reapproval. After implementation is verified against both documents, the proposed specification revision becomes Current and the ExecPlan becomes Completed.

The workflow must preserve a readable current behavioral contract while a change is discussed, favor updating capability-oriented canonical specifications over creating task-oriented specification files, and permit technical-only Plan work to link existing specifications while explicitly declaring no product behavior change. The user approved this intent and the proposed technical approach on 2026-08-15 by asking to implement it after reviewing the workflow proposal.

## Purpose and measurable acceptance criteria

Make the repository's documented workflow match the approved collaborative planning model without making Fast work bureaucratic or producing one specification per task.

Acceptance criteria:

1. Current workflow documents require Draft specification revisions and Draft ExecPlans to evolve together before Plan-lane production-code edits.
2. Approval metadata identifies the approved specification and plan versions, and the docs distinguish Draft, Approved/Ready, Active, Current, and historical outcomes.
3. Current behavior remains readable while proposed behavior is discussed, and completion promotes the approved proposal to Current only after verification.
4. Capability-oriented specifications remain authoritative for behavior; change-oriented ExecPlans link requirements to technical consequences and tests without duplicating rules.
5. Technical-only Plan work can state that product behavior is unchanged without editing a product specification.
6. The workflow defines open-question ownership and material-change reapproval rules.
7. Copyable lightweight metadata/traceability templates exist.
8. Documentation validation checks supported active-plan statuses, version and approval metadata, specification metadata, index coverage, and links.
9. Documentation formatting and validation pass.

## Current behavior and affected invariants

Current guidance requires a working specification to be approved in conversation before either a canonical specification or ExecPlan is written. Active-plan validation accepts only `Status: Active`, and product specifications have no validated version/approval/current-state contract. This prevents the two documents from serving as durable, co-evolving discussion artifacts.

Preserve these invariants:

- Fast is limited to small, isolated, familiar, low-risk work.
- Every non-Fast production change has an ExecPlan before production-code edits.
- Product specifications, architecture, designs, code/tests, and completed plans retain their existing source-of-truth roles.
- Completed plans remain historical and do not override current documents.
- All maintained Markdown remains indexed and uses valid relative links.

## Scope, non-goals, assumptions, and unresolved decisions

In scope are central workflow guidance, planning templates, category indexes, and deterministic documentation validation. Existing product behavior and production code are unchanged.

Non-goals:

- Retrofitting every historical plan or design to the new metadata.
- Splitting the current initial-workspace product specification during this workflow change.
- Automating semantic judgments such as whether a change is material or whether two requirements duplicate one another.
- Introducing a separate document for decisions classified as “Both.”

Assumptions:

- An active-plan directory may contain Draft, Ready, Active, or Blocked plans because discussion and approval are active work.
- Plan versions are metadata and revision-log entries within a stable dated file, not a new file for every revision.
- Existing Current behavior is retained in the canonical spec body while a bounded proposed revision is reviewed.

No unresolved decisions block implementation.

## Implementation milestones

1. Rewrite the Fast/Plan and documentation lifecycles around co-evolving Draft specification revisions and versioned ExecPlans.
2. Define capability-oriented spec ownership, requirement IDs, traceability, open-question placement, approval semantics, invalidation, and completion promotion.
3. Add one indexed planning-template document containing product-specification and ExecPlan skeletons.
4. Update documentation routing and indexes to expose statuses and the new workflow.
5. Extend `scripts/check_docs.py` with deterministic metadata checks while exempting historical plans from retroactive requirements.
6. Run focused validator tests through temporary fixtures if practical, then formatting and documentation checks; review the final diff and archive this plan.

## Untrusted-data-boundary analysis

| Source and raw representation      | Entry/read point                                          | Runtime parser                                              | Trusted output and guarantees                                            | Failure behavior                             | Boundary tests                                                                             |
| ---------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Repository Markdown text and paths | `scripts/check_docs.py` filesystem reads and regex checks | Existing path/link resolution plus bounded metadata regexes | Indexed local documents with recognized status/version/approval metadata | Deterministic validation errors; no mutation | Current repository pass plus temporary malformed metadata fixtures or focused Python tests |

No network, database, environment configuration, persistence schema, queue, webhook, or third-party boundary is added. Markdown remains untrusted text to the validator; checks must not execute its contents.

## Touched-legacy-code analysis

`scripts/check_docs.py` is maintained repository tooling. Preserve its current required-file, relative-link, index-coverage, plan-placement, duplicate-name, and historical-plan behavior. Extend checks rather than weakening them. Existing active plans predate the new workflow, so compatibility must either accept their current metadata or update the active plan safely; completed plans remain exempt from new metadata.

Current workflow documents are replaced coherently. Historical plans retain the rules that applied when they were completed.

## Verification

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
pnpm docs:check
pnpm check
```

If the repository has no focused validator unit-test harness, add deterministic standard-library tests that operate only on temporary files or test pure metadata helpers. No production service, configured database, or external credential is required.

## Compatibility, deployment, migration, recovery, and rollback

There is no runtime API, deployment, database, or product migration. Workflow compatibility is explicit for existing active work and historical plans. Recovery is a documentation/tooling revert. The validator must report actionable errors rather than modify documents.

## Progress

- [x] Inspected current documentation routing, workflow documents, indexes, validator, product specification, active plan, and prior Fast/Plan plan.
- [x] Received explicit product-intent and technical-approach approval from the user.
- [x] Created and indexed plan version 1 before changing workflow or validator code.
- [x] Updated workflow and routing documents.
- [x] Added planning templates and metadata conventions.
- [x] Extended and tested documentation validation.
- [x] Ran formatting and repository checks.
- [x] Reviewed outcomes and archived the plan.

## Discoveries and blockers

- The repository already separates product specifications, architecture, designs, and historical plans well; this change can refine lifecycle semantics rather than reorganize the entire tree.
- The existing initial-workspace plan and specification are active user work with uncommitted changes and must not be overwritten beyond compatible metadata if validation requires it.
- Prettier intentionally ignores Python files when checking the repository; the
  validator tests use standard-library `unittest`, and `pnpm check` covers the
  repository's configured formatting, lint, type, test, build, and docs gates.
- No blockers.

## Decision log

- 2026-08-15: Keep specifications capability-oriented and ExecPlans change-oriented.
- 2026-08-15: Store decisions classified as “Both” across linked spec and plan sections, with the behavior authoritative only in the spec.
- 2026-08-15: Keep current contract text readable and place pending changes in a bounded proposed-revision section.
- 2026-08-15: Keep Draft/Ready/Active/Blocked plans under `exec-plans/active/` to avoid a separate draft directory and link churn.
- 2026-08-15: Keep plan revisions in one stable dated file with an incremented `Plan version` and approval tied to that version.

## Final outcomes

The repository now drafts capability-oriented product changes and versioned
ExecPlans together before Plan implementation. Stable requirement links keep
product behavior authoritative in specifications while plans own technical
consequences and verification. Explicit version-specific product and technical
approvals gate implementation, and material product versus architecture-only
changes invalidate the appropriate approvals.

Current behavior remains readable while bounded proposals are discussed. The
new template and validator enforce open-plan and product-specification lifecycle
metadata. Focused validator tests passed, and `pnpm check` passed with 11 Vitest
files and 90 tests; the existing non-blocking Vite chunk-size warning remains.
