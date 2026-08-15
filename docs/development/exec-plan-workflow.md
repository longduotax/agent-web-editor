# ExecPlan workflow

**Status:** Current

**Subsystem:** Repository development workflow

**Last verified:** 2026-08-15

**Related documents:** [Agent implementation workflow](agent-implementation-workflow.md),
[documentation workflow](documentation-workflow.md),
[execution-plan index](../exec-plans/index.md), and
[Parse, Don't Validate](../architecture/data-boundaries.md)

Use this workflow only for Plan-lane work. An explicitly user-approved working
specification is a prerequisite; do not create an ExecPlan without one.

## Specification prerequisite

Begin with investigation only. Read relevant current specifications,
architecture, designs, active plans, code, and tests. Consult completed plans
only to answer a specific historical question.

Before creating or editing an ExecPlan, write a working specification in the
conversation or task state as required by the
[agent implementation workflow](agent-implementation-workflow.md#specification-and-approval-gate).
Present it to the user and wait for explicit approval. If it changes durable
product behavior, update the existing canonical specification that governs that
behavior before creating the ExecPlan. Create and index a new product-spec file
only for a distinct durable contract.

A material change to behavior, acceptance criteria, scope, non-goals,
constraints, compatibility, or boundaries invalidates the prior approval. Pause,
revise the specification, and obtain approval again before changing the plan or
continuing implementation.

## Plan creation

After specification approval and any required canonical specification update,
create a dated living plan under `docs/exec-plans/active/` and index it before
production-code edits. Include status, subsystem, affected paths or contracts,
the approved working or canonical specification, related documents or issue,
and last-updated date near the top.
The index entry must summarize subsystem and scope well enough to route other
work.

Resolve approach, contracts, risks, compatibility, and verification before
implementation. Ask the user when planning exposes another material product,
architecture, compatibility, or rollout choice; otherwise proceed once
actionable.

## Required contents

Every Plan-lane ExecPlan includes:

1. the approved specification or a link to its canonical document, plus the
   approval context;
2. purpose, user-visible outcome, and measurable acceptance criteria;
3. current behavior, affected components, contracts, and invariants;
4. scope, non-goals, assumptions, and unresolved decisions;
5. milestone-sized steps with concrete locations;
6. untrusted-data-boundary analysis;
7. touched-legacy-code analysis;
8. exact tests, type checks, linting, builds, and runtime verification;
9. compatibility, deployment, migration, recovery, or rollback where relevant;
10. living progress, discoveries, decisions, and final outcomes.

State `Not applicable` with evidence rather than omitting an analysis.

## Boundary analysis

Inventory every uncontrolled representation affected by the plan: APIs,
database reads and serialized fields, service responses, queues, files,
configuration, webhooks, third parties, and agent SDK output. Data is untrusted
again when read from persistence or internal transport.

| Source and raw representation | Entry/read point                     | Runtime parser                         | Trusted output and guarantees | Failure behavior                                       | Boundary tests                              |
| ----------------------------- | ------------------------------------ | -------------------------------------- | ----------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| Origin and uncontrolled shape | First receiving application location | Constructing parser/narrowing function | Downstream assumptions        | Reject, fallback, quarantine, retry, or surfaced error | Valid, malformed, missing, and legacy cases |

Static types, casts, assertions, and generic SDK types are not runtime parsers.
If no boundary exists, record that conclusion and evidence.

## Legacy analysis

For every modified legacy path:

1. identify existing behavior and the intended invariant;
2. include cleanup needed to establish that invariant;
3. identify callers, stored forms, and compatibility behavior;
4. preserve deliberate compatibility explicitly;
5. add characterization or regression coverage.

Keep unrelated cleanup out of scope. Record constraints and request approval if
the touched path cannot safely meet the invariant.

## Lifecycle

Maintain progress, discoveries, blockers, and decisions during work. Update
durable docs before completion. Then move the plan to
`docs/exec-plans/completed/`, set its outcome to `Completed`, `Superseded`, or
`Abandoned`, and update both indexes. Completed plans are history, not current
requirements.
