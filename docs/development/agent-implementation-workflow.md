# Agent implementation workflow

**Status:** Current

**Subsystem:** Repository development workflow

**Last verified:** 2026-08-15

**Related documents:** [ExecPlan workflow](exec-plan-workflow.md),
[planning templates](planning-templates.md),
[documentation workflow](documentation-workflow.md),
[Parse, Don't Validate](../architecture/data-boundaries.md), and
[development workflows](workflows.md)

Classify every change as Fast or Plan. Use Fast only when all of its safety
conditions are clearly satisfied; every other change uses Plan. The Plan lane is
a repository classification, not a harness UI mode.

| Lane | Use when                                | Required sequence                                                                                                                             |
| ---- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Fast | Small, isolated, familiar, and low-risk | Inspect → edit → verify                                                                                                                       |
| Plan | Any change not clearly Fast             | Investigate → Draft spec revision + Draft ExecPlan → approve product + technical approach → implement → verify → promote spec + complete plan |

File count alone does not choose the lane.

## Fast lane

Use Fast only for an obvious change that is small, isolated, familiar, and
low-risk. It must not alter a public contract, persistence, authentication,
authorization, trust boundary, deployment, migration behavior, consequential
technical decision, or compatibility policy.

Typical examples are a typo, a local styling correction, a narrowly understood
bug, or a mechanical cleanup with established verification.

Fast work does not require a specification revision or ExecPlan.

1. Inspect nearby code and tests.
2. Add a focused regression test for a bug when practical.
3. Make the smallest coherent change.
4. Run the narrowest credible checks.
5. Update current documentation only when it became stale.

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

### Investigate before drafting

Read the relevant current specification, architecture, design, overlapping
active plan, code, and tests. Consult completed plans only for a specific
historical question. Investigation may inspect and test current behavior, but do
not edit production code, public schemas, migrations, or generated production
artifacts before both approvals described below.

Choose the canonical capability specification that governs the behavior. Product
specifications are capability-oriented, not task-oriented:

- Update the existing specification when it already owns the behavior.
- Create a new specification only for a distinct durable capability with an
  independent lifecycle and normal reader entry point.
- For technical-only work, do not make a meaningless specification edit. Link
  the governing current specifications from the ExecPlan and state
  `Product behavior change: None` with the invariant being preserved.
- If no durable product behavior is involved, the approved working
  specification may be recorded directly in the ExecPlan.

### Draft the specification and ExecPlan together

Before production-code edits, create and index a dated ExecPlan under
`docs/exec-plans/active/` with `Status: Draft`. At the same time, create a new
Draft product specification or add a bounded proposed revision to the existing
canonical specification when product behavior changes. Use the
[planning templates](planning-templates.md).

For an established specification, keep its currently implemented contract in
the main body while discussion changes only the `Proposed revision` section.
Record current and proposed versions separately. A new capability has no current
version until its first approved implementation is verified.

Sort mixed product and technical discussion as follows:

| Kind                                                                           | Authoritative location                                                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Product behavior, business rules, permissions, edge cases, acceptance criteria | Product specification                                                              |
| Architecture, APIs, schemas, migrations, rollout, and testing                  | ExecPlan                                                                           |
| Both                                                                           | Outcome in a stable spec requirement; linked technical consequence in the ExecPlan |
| Open product question                                                          | Proposed spec revision                                                             |
| Open technical question                                                        | ExecPlan                                                                           |

A decision classified as Both is not copied in full and is not stored in a third
document. Give material requirements stable IDs and use a traceability table in
the plan to link each requirement to its technical consequence and verification.
The specification remains authoritative for expected behavior.

Draft both documents during the conversation. Keep unresolved questions explicit
and do not present either document as ready while a material question remains.

### Product and implementation approval gate

Implementation begins only after explicit human approval of both:

1. **Product intent:** the identified proposed specification version, or the
   explicit no-product-change invariant for technical-only work.
2. **Technical approach:** the identified ExecPlan version.

One user message may approve both when it is unequivocal. Do not infer approval
from discussion, silence, or approval of only one document. Record the approver,
date, and exact version in both documents. Then mark the specification proposal
`Approved` and the ExecPlan `Ready`. Change the plan to `Active` when production
implementation begins.

Approval applies only to the recorded versions:

- A material change to behavior, business rules, permissions, acceptance
  criteria, scope, non-goals, or compatibility returns the proposal to Draft
  and invalidates approval of every affected ExecPlan. Pause affected
  implementation until both are approved again.
- A material architecture, API, schema, migration, rollout, or verification
  approach change increments the plan version and invalidates only technical
  approval unless product behavior also changes.
- Routine progress, file-location discoveries, checklist updates, and technical
  detail within the approved approach do not require reapproval or a version
  increment.
- Editorial clarification that does not change meaning does not require
  reapproval; record it when readers could otherwise mistake it for a material
  revision.

## Planning and implementation

An actionable approved ExecPlan turns the approved outcome into concrete
implementation, boundary, compatibility, migration, rollout, and verification
steps. It must not silently alter the governing specification. Maintain its
progress, discoveries, blockers, decisions, and approval status while working.

For external or persisted data, apply
[Parse, Don't Validate](../architecture/data-boundaries.md) and inventory each
raw source, entry or read point, runtime parser, trusted guarantee, failure
behavior, and boundary test. For touched legacy code, establish current behavior,
bring the touched path to the intended invariant, preserve deliberate
compatibility explicitly, and avoid unrelated cleanup.

## Completion

Verify the implementation against both documents:

1. Trace every affected specification requirement to automated or recorded
   manual evidence.
2. Run the ExecPlan's technical checks and record omitted verification or
   residual risk.
3. Update architecture to describe implemented structure and designs when
   durable tradeoff reasoning changed.
4. Fold the approved proposed revision into the canonical specification body,
   make that version Current, clear the proposal metadata, and update its last
   verification date.
5. Record final outcomes, mark the ExecPlan Completed, move it to
   `docs/exec-plans/completed/`, and update both plan indexes.

A partially implemented proposal does not become Current. Either finish it,
approve a smaller coherent product revision, or leave the proposal visibly in
progress with the plan active or blocked.
