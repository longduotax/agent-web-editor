# Planning templates

**Status:** Current

**Subsystem:** Repository development workflow

**Last verified:** 2026-08-15

**Related documents:** [Agent implementation workflow](agent-implementation-workflow.md),
[ExecPlan workflow](exec-plan-workflow.md), and
[documentation workflow](documentation-workflow.md)

Use these as lightweight starting points. Remove instructional comments, but do
not omit required analysis; write `Not applicable` with evidence instead.

## Capability product specification

```md
# Capability name

**Current version:** None

**Proposed version:** 1

**Proposal status:** Draft

**Implementation status:** Not started

**Product approval:** Pending for specification version 1

**Subsystem:** Stable product capability

**Last verified:** YYYY-MM-DD

**Related ExecPlans:** `LINK_TO_ACTIVE_PLAN`

## Purpose

Why this capability exists and the user outcome it creates.

## Current contract

Current implemented behavior. For a new capability, state that there is no
Current contract yet.

## Proposed revision v1

### CAP-01 — Stable requirement name

Authoritative observable behavior, business rules, permissions, and edge cases.

### Acceptance criteria

1. Measurable product outcome linked to CAP-01.

### Non-goals

- Explicit exclusion.

### Open product questions

- None, or unresolved decisions requiring human input.
```

For an established capability, retain its Current contract and put only added or
replacement sections in the proposed revision. After verification, fold the
approved proposal into the Current contract and use:

```md
**Current version:** 1
**Proposed version:** None
**Proposal status:** None
**Implementation status:** Current
**Product approval:** Not applicable — no proposed revision
```

## Versioned ExecPlan

```md
# Change name

**Status:** Draft

**Plan version:** 1

**Technical approval:** Pending for plan version 1

**Subsystem:** Affected subsystem

**Affected paths or contracts:** `path/**`, public contract

**Governing specification:** `LINK_TO_CAPABILITY_REQUIREMENT`

**Related documents or issue:** Links

**Last updated:** YYYY-MM-DD

## Working specification and approval context

For product work, identify proposed/current spec versions and approval context.
For technical-only work, write `Product behavior change: None` and state the
preserved behavior invariant.

## Purpose and user-visible outcome

Concise outcome; link rather than duplicate complete product rules.

## Requirement traceability

| Spec requirement | Technical consequence                                   | Verification   |
| ---------------- | ------------------------------------------------------- | -------------- |
| `LINK_TO_CAP-01` | API, schema, architecture, rollout, or test consequence | Exact evidence |

## Current behavior and affected invariants

## Scope, non-goals, assumptions, and unresolved technical decisions

## Implementation milestones

## Untrusted-data-boundary analysis

| Source and raw representation | Entry/read point | Runtime parser | Trusted output and guarantees | Failure behavior | Boundary tests |
| ----------------------------- | ---------------- | -------------- | ----------------------------- | ---------------- | -------------- |

## Touched-legacy-code analysis

## Verification

Exact focused and final commands plus runtime/manual checks.

## Compatibility, deployment, migration, recovery, and rollback

## Progress

## Discoveries and blockers

## Decision and revision log

- YYYY-MM-DD: Created plan version 1.

## Final outcomes

Not completed.
```

When approved, record who approved the exact product and plan versions, change
the plan to Ready, and then to Active when production-code work starts. Material
technical replanning increments `Plan version`, returns status to Draft, and sets
technical approval to pending. Routine progress does not create another version.
