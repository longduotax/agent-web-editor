# Execution plans

Execution plans are versioned records of all implementation work that is not
clearly Fast.

- [Active plans](active/index.md) track work currently in progress.
- [Completed plans](completed/index.md) preserve completed, superseded, or
  abandoned implementation history.

Fast changes do not require a committed plan. Every change not clearly Fast
requires an approved specification and a living ExecPlan. See the
[documentation workflow](../development/documentation-workflow.md) and
[ExecPlan workflow](../development/exec-plan-workflow.md).

## When to read plans

Use plan indexes as routing metadata; do not scan every plan body.

- Check active plans before substantial work and open only an overlapping plan.
- Read an overlapping active plan before editing so progress and decisions are
  preserved.
- Consult completed plans only for a specific regression, compatibility issue,
  migration, prior decision, or documentation gap.
- Never treat a completed plan as current requirements or architecture.
