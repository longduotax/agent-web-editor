# Execution plans

Execution plans are versioned, change-oriented records of all implementation
work that is not clearly Fast.

- [Active plans](active/index.md) track Draft, Ready, Active, and Blocked work
  from discussion through implementation.
- [Completed plans](completed/index.md) preserve completed, superseded, or
  abandoned implementation history.

Fast changes do not require a committed plan. Every change not clearly Fast
requires a living ExecPlan before production-code edits. Product-affecting work
also requires a linked capability-specification proposal; technical-only work
records the approved no-product-change invariant in its plan. Implementation
requires explicit approval of both the identified product intent and technical
approach. See the [documentation workflow](../development/documentation-workflow.md)
and [ExecPlan workflow](../development/exec-plan-workflow.md).

## When to read plans

Use plan indexes as routing metadata; do not scan every plan body.

- Check active plans before substantial work and open only an overlapping plan.
- Read an overlapping Draft, Ready, Active, or Blocked plan before editing so
  questions, approvals, progress, and decisions are preserved.
- Consult completed plans only for a specific regression, compatibility issue,
  migration, prior decision, or documentation gap.
- Never treat a completed plan as current requirements or architecture.
