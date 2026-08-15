# Fast and Plan implementation lanes

**Status:** Completed

**Subsystem:** Repository development workflow

**Affected paths or contracts:** `AGENTS.md`, documentation routing and development workflow documents

**Approved specification:** Replace Fast/Medium/Plan with Fast/Plan. Every non-Fast change uses Plan: investigate, write or update a specification, obtain explicit user approval, create a living ExecPlan, implement and verify, then archive the plan. Preserve completed historical plans.

**Approval context:** User explicitly approved the working specification in the current conversation on 2026-08-15.

**Related documents or issue:** [Agent implementation workflow](../../development/agent-implementation-workflow.md), [documentation workflow](../../development/documentation-workflow.md), [ExecPlan workflow](../../development/exec-plan-workflow.md)

**Last updated:** 2026-08-15

## Purpose and acceptance criteria

Simplify repository change classification to two lanes with no semantic gap between formerly Medium and Plan work.

Acceptance criteria:

- Current routing and workflow documents describe only Fast and Plan lanes.
- Every change not clearly Fast requires an approved working or updated canonical specification before an ExecPlan is written.
- Plan work always uses a living indexed ExecPlan; mini-plans no longer exist.
- Fast-lane criteria and completed historical documents remain unchanged.
- Formatting and documentation validation pass.

## Current behavior and affected invariants

Current docs define Fast, Medium, and Plan. Medium uses an approved working specification and uncommitted mini-plan, while Plan uses an approved specification and committed ExecPlan. The new invariant is binary: work is Fast only when all Fast safety conditions hold; otherwise it is Plan.

## Scope and non-goals

In scope are current central routing, implementation workflow, documentation workflow, product-spec routing language, and development indexes. Completed ExecPlans remain historical. No application code, product behavior, runtime boundary, or documentation validator behavior changes.

No unresolved decisions remain.

## Implementation milestones

1. Remove Medium and mini-plan language from current canonical documents.
2. Define Plan as every non-Fast change and retain the specification approval gate.
3. Search current docs for stale terms and run formatting and documentation checks.
4. Record outcomes and archive this plan.

## Untrusted-data-boundary analysis

Not applicable. This change only updates contributor documentation and consumes no API, database, configuration, file-runtime, queue, webhook, or third-party data.

## Touched-legacy-code analysis

Not applicable to production code. Completed plans are deliberate historical records and remain unchanged. Current workflow text is replaced coherently rather than retaining parallel lane definitions.

## Verification

```sh
rg -n -i "medium|mini-plan" AGENTS.md README.md docs apps packages scripts --glob '*.md' --glob '*.py' --glob '!docs/exec-plans/completed/*.md'
pnpm format:check
pnpm docs:check
```

No service or runtime verification is required.

## Compatibility, deployment, migration, and recovery

No runtime compatibility, deployment, persistence, or migration impact exists. Recovery is a documentation revert.

## Progress

- [x] Working specification approved by the user.
- [x] Current workflow documents updated.
- [x] Focused searches and documentation checks passed.
- [x] Plan archived.

## Discoveries and blockers

- Obsolete lane references were confined to central routing and workflow
  documents and were removed from current canonical guidance.
- No blockers.

## Decision log

- 2026-08-15: Keep only Fast and Plan; every non-Fast task receives a living ExecPlan after specification approval.

## Final outcomes

Current repository guidance now has only Fast and Plan lanes. Fast remains
limited to clearly small, isolated, familiar, low-risk work. Every other change
requires investigation, a written or updated specification, explicit user
approval, and a living indexed ExecPlan before implementation. Current canonical
documents contain no obsolete lane or mini-plan references; historical plans
remain unchanged.
