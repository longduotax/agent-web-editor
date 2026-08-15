# ExecPlan workflow

**Status:** Current

**Subsystem:** Repository development workflow

**Last verified:** 2026-08-15

**Related documents:** [Agent implementation workflow](agent-implementation-workflow.md),
[planning templates](planning-templates.md),
[documentation workflow](documentation-workflow.md),
[execution-plan index](../exec-plans/index.md), and
[Parse, Don't Validate](../architecture/data-boundaries.md)

Use this workflow only for Plan-lane work. The specification and ExecPlan are
linked Draft artifacts that evolve together before production-code changes.
Neither product nor technical approval is a prerequisite for drafting them;
both are prerequisites for implementation.

## Investigation and specification relationship

Begin with investigation. Read relevant current and proposed specifications,
architecture, designs, active plans, code, and tests. Consult completed plans
only to answer a specific historical question.

Choose the capability-oriented canonical specification before creating the
plan. If product behavior changes, create a new Draft specification only for a
distinct durable capability; otherwise add a bounded proposed revision to the
existing specification without replacing its readable current contract. For
technical-only work, link governing specifications and record
`Product behavior change: None` plus the preserved behavioral invariant. A
technical working specification with no durable product contract may live in
the plan.

## Plan creation and statuses

Create and index one dated plan under `docs/exec-plans/active/` before editing
production code. Planning itself is active repository work, so this directory
contains these open statuses:

- `Draft`: approach or material questions are unresolved; not approved for
  implementation.
- `Ready`: the recorded plan version and product intent are explicitly approved;
  production implementation may start.
- `Active`: approved production implementation is underway.
- `Blocked`: implementation was approved but cannot currently proceed; record
  whether approval remains valid.

Completed, superseded, and abandoned plans move to `docs/exec-plans/completed/`.

Keep revisions in one stable dated file. Start at `Plan version: 1`. Increment
that version only for a material technical approach change, set technical
approval to pending, and return the plan to Draft. Routine progress and detail
within the approved approach do not increment the version.

Near the top include status, plan version, technical approval tied to that
version, subsystem, affected paths or contracts, governing specification
versions or explicit working specification, related documents or issue, and
last-updated date. The index entry must summarize subsystem and scope well enough
to route overlapping work.

## Co-evolving discussion

Maintain the product outcome in the specification and technical consequences in
the plan. Requirements that affect both documents receive stable IDs. Link them
rather than copying the complete rule:

| Spec requirement                  | Technical consequence                                                            | Verification                       |
| --------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------- |
| Linked requirement ID and heading | Architecture, API, schema, migration, rollout, or test work needed to satisfy it | Exact automated or manual evidence |

Product questions belong in the proposed specification revision. Technical
questions belong in the plan. The plan may link a product blocker but must not
create a second authoritative wording of it.

Present both documents for review. Implementation starts only after explicit
human approval of the identified product and plan versions. Record the approval
context in both documents, mark the proposal Approved, and move the plan through
Ready to Active. Ask again if planning exposes a material unresolved decision.

## Required contents

Every Plan-lane ExecPlan includes:

1. status, plan version, version-specific technical approval, and related
   specification versions;
2. approved working specification for technical-only work, or links to the
   canonical product requirements and approval context;
3. purpose and user-visible outcome without duplicating the full product rule;
4. requirement-to-consequence-to-verification traceability where behavior
   changes;
5. current behavior, affected components, contracts, and invariants;
6. scope, non-goals, assumptions, and unresolved technical decisions;
7. milestone-sized steps with concrete locations;
8. untrusted-data-boundary analysis;
9. touched-legacy-code analysis;
10. exact tests, type checks, linting, builds, and runtime verification;
11. compatibility, deployment, migration, recovery, and rollback where relevant;
12. living progress, discoveries, decisions, revision history, and final
    outcomes.

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

## Approval invalidation

- Material product changes return the proposed specification and every affected
  plan to Draft. Increment each affected document's proposed or plan version as
  appropriate and obtain both approvals again.
- Material architecture-only changes increment the plan version and invalidate
  only technical approval.
- Routine implementation progress does not invalidate either approval.

Do not continue affected production work while required approval is pending.

## Lifecycle and completion

Maintain progress, discoveries, blockers, decisions, and verification evidence
during work. Before completion, verify every affected product requirement and
all technical checks. Update durable architecture and designs. Promote the
approved proposed specification version to Current only when its coherent
contract is implemented and verified.

Then move the plan to `docs/exec-plans/completed/`, set its outcome to
`Completed`, `Superseded`, or `Abandoned`, and update both indexes. Completed
plans are history, not current requirements. If only part of a proposal ships,
do not label the whole proposal Current; approve a smaller coherent revision or
keep the plan open.
