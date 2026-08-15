# Agent implementation workflow

**Status:** Current

**Subsystem:** Repository development workflow

**Last verified:** 2026-08-15

**Related documents:** [ExecPlan workflow](exec-plan-workflow.md),
[documentation workflow](documentation-workflow.md),
[Parse, Don't Validate](../architecture/data-boundaries.md), and
[development workflows](workflows.md)

Classify every change as Fast or Plan. Use Fast only when all of its safety
conditions are clearly satisfied; every other change uses Plan. The Plan lane is
a repository classification, not a harness UI mode.

| Lane | Use when                                | Required sequence                                                                  |
| ---- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| Fast | Small, isolated, familiar, and low-risk | Inspect → edit → verify                                                            |
| Plan | Any change not clearly Fast             | Investigate → specification → user approval → living ExecPlan → implement → verify |

File count alone does not choose the lane.

## Fast lane

Use Fast only for an obvious change that is small, isolated, familiar, and
low-risk. It must not alter a public contract, persistence, authentication,
authorization, trust boundary, deployment, migration behavior, consequential
technical decision, or compatibility policy.

Typical examples are a typo, a local styling correction, a narrowly understood
bug, or a mechanical cleanup with established verification.

Fast work does not require a working specification or ExecPlan.

1. Inspect nearby code and tests.
2. Add a focused regression test for a bug when practical.
3. Make the smallest coherent change.
4. Run the narrowest credible checks.
5. Update documentation only when it became stale.

Move to Plan immediately when any Fast condition stops being true.

## Plan lane

Use Plan for every change not clearly Fast. This includes bounded one-subsystem
work as well as cross-component, staged, or high-risk work. Examples include:

- meaningful feature work or refactoring, even when it fits in one session;
- public contracts, integrations, persistence, or architectural boundaries;
- new untrusted sources or changes to parsing and failure behavior;
- authentication, authorization, migration, deployment, or recovery;
- compatibility-sensitive or legacy replacement work;
- consequential product or technical decisions; and
- work likely to span sessions.

### Specification and approval gate

Investigate enough to understand the request, relevant current documentation,
active plans, code, and tests. Before creating an ExecPlan or editing
implementation code, write a working specification in the conversation or task
state. It must state:

- desired outcome and observable behavior;
- acceptance criteria;
- scope and explicit non-goals;
- constraints, compatibility requirements, and known data boundaries; and
- unresolved product or technical decisions.

The working specification may propose creating a canonical product specification
or updating an existing one. Prefer updating the existing canonical document
when it already governs the changed behavior. Create a new file only for a
distinct durable product contract. Technical or temporary working specifications
may remain in the conversation or task state.

Present the working specification to the user and wait for explicit approval.
Only after approval may the canonical specification be created or updated and
the living ExecPlan be written. A material change to behavior, acceptance
criteria, scope, non-goals, constraints, compatibility, or boundaries requires a
revised specification and renewed user approval before the plan or implementation
continues.

### Planning and implementation

After approval, create and index a dated living ExecPlan under
`docs/exec-plans/active/` following the
[ExecPlan workflow](exec-plan-workflow.md). The plan turns the approved outcome
into concrete implementation, boundary, compatibility, and verification steps;
it must not silently change the approved specification.

Ask the user again if planning exposes a material unresolved decision or requires
a material specification change. Otherwise begin implementation when the plan
is actionable and maintain progress, discoveries, blockers, and decisions while
work proceeds.

For external or persisted data, apply
[Parse, Don't Validate](../architecture/data-boundaries.md) and inventory each
raw source, entry or read point, runtime parser, trusted guarantee, failure
behavior, and boundary test. For touched legacy code, establish current behavior,
bring the touched path to the intended invariant, preserve deliberate
compatibility explicitly, and avoid unrelated cleanup.

## Completion

Update or create canonical product specifications for durable behavior,
architecture for implemented structure, and designs for important tradeoffs.
Temporary steps remain in the ExecPlan. Review the final changes, run the plan's
checks, archive the ExecPlan, and report omitted verification or unresolved
risk.
