# Documentation workflow

This document defines how contributors and agents find, create, maintain, and
retire repository documentation.

## Traversal

1. Start at [`docs/README.md`](../README.md).
2. Choose the affected subsystem rather than scanning the whole tree.
3. Read the relevant current product specification and any bounded proposed
   revision.
4. Read architecture for implemented structure and a design only when prior
   decisions or tradeoffs affect the change.
5. Check the [active-plan index](../exec-plans/active/index.md) and open only an
   overlapping Draft, Ready, Active, or Blocked plan.
6. Consult [completed plans](../exec-plans/completed/index.md) only for a
   specific historical question.
7. Verify documentation claims against nearby code and tests.

Use this traversal for substantial, unfamiliar, cross-component, contract, data
flow, dependency, persistence, security, or boundary work. Avoid broad traversal
for a small familiar change.

## Directory contract

### `architecture/`

Describes the currently implemented components, dependencies, data flows,
boundaries, and invariants. Do not put requirements, task lists, proposed
implementation, or history here.

### `product-specs/`

Defines durable user-visible behavior, business rules, permissions, acceptance
criteria, and edge cases. Specifications are organized by stable product
capability, not by task or implementation plan. Update the governing capability
specification unless a new behavior area has an independent lifecycle and normal
reader entry point.

The main body preserves the Current implemented contract. Discuss changes in a
bounded proposed revision with separate current/proposed version and approval
metadata. New capabilities may have no current version while their first
proposal is Draft, Approved, or in progress. Temporary implementation steps and
technical mechanisms do not belong here.

### `design/`

Preserves important technical decisions, alternatives, and tradeoffs. Do not
copy the whole architecture or an implementation checklist into a design.

### `development/`

Contains setup, testing, migration, verification, contributor workflows, and
planning templates.

### `exec-plans/active/`

Contains living change-oriented plans in Draft, Ready, Active, or Blocked
status. Every plan must be linked from its index and maintained during discussion
and implementation. Plan versions remain in one stable dated file.

### `exec-plans/completed/`

Contains completed, superseded, and abandoned plans as history. They are not
authoritative and are not part of normal implementation traversal.

### `references/`

Contains supporting protocols, schemas, terminology, and external notes rather
than product requirements.

Component-specific documentation belongs beside its code. Link it from the
closest central subsystem or category index.

## When documentation is required

Use the implementation lanes in
[the agent workflow](agent-implementation-workflow.md). Fast applies only to
small, isolated, familiar, low-risk changes and does not require planning
artifacts. Every other change uses Plan.

Before Plan-lane production-code edits:

1. investigate current behavior and documentation;
2. create a Draft ExecPlan;
3. create a new Draft capability spec or a proposed revision when product
   behavior changes, or explicitly record no product behavior change;
4. evolve both documents during discussion; and
5. receive explicit human approval of the identified product and plan versions.

Do not force product-specification churn for architecture-only work. Link the
current governing specs and preserve their behavioral invariant explicitly in
the ExecPlan.

Update architecture only when implementation changes. Create a design only when
decision reasoning will remain useful. Do not create placeholders merely to fill
a directory.

## Specification lifecycle

1. Select the canonical capability specification.
2. Keep implemented behavior in its Current body and add a bounded proposed
   revision, or create a new Draft specification for a distinct capability.
3. Record stable requirement IDs, acceptance criteria, non-goals, and product
   open questions in the specification.
4. Link the Draft ExecPlan and discuss both documents together.
5. After explicit product approval, record the approved proposed version and
   approval context. It is approved intent, not yet Current behavior.
6. During implementation, return material product changes to Draft and
   invalidate affected plan approvals.
7. After implementation and verification, fold the proposal into the main body,
   mark that version Current, clear proposal metadata, and update the index.

Git preserves revision history; do not create a new specification file merely to
store each version. Supersede a specification only when capability ownership
itself changes, and link its replacement.

## ExecPlan lifecycle

1. Create a dated Draft plan in `exec-plans/active/`, add routing metadata to the
   active index, and link the governing specification requirements.
2. Increment `Plan version` only for material technical replanning. Keep routine
   progress in the same version.
3. Record explicit technical approval for the exact plan version. Mark it Ready
   only when product approval is also satisfied and no material question remains.
4. Mark it Active when production implementation starts; use Blocked only when
   approved work cannot currently proceed.
5. Maintain progress, discoveries, blockers, decisions, and verification while
   working.
6. Before completion, verify the governing specification and plan and update
   durable specifications, designs, and architecture.
7. Move the plan to `exec-plans/completed/`, record `Completed`, `Superseded`, or
   `Abandoned`, and update both indexes.

Unchecked boxes in a historical plan do not make it active.

## Metadata, traceability, and indexes

Use the [planning templates](planning-templates.md). New maintained documents
include status, subsystem, last verification date, relevant paths, and related
documents where useful.

Every product specification identifies current version, proposed version,
proposal status, implementation status, product approval, and related plans. A
new spec uses `Current version: None`; a Current spec with no pending change uses
`Proposed version: None` and `Proposal status: None`.

Every open plan identifies status, plan version, version-specific technical
approval, subsystem, affected paths or contracts, governing specification or
explicit no-product-change working specification, related documents or issue,
and last-updated date near the top.

- Give durable product requirements stable IDs.
- In the ExecPlan, link IDs to technical consequences and verification rather
  than copying complete behavioral rules.
- Link every canonical document from its closest index.
- Prefer relative links and subsystem-oriented routing.
- Keep active-index summaries specific enough to establish overlap without
  opening every plan.
- Investigate conflicts between documentation and implemented behavior.

## Verification

After changing indexes, metadata, links, or plan placement, run:

```sh
pnpm docs:check
```

The validator checks canonical indexes, local relative links, direct index
coverage, open-plan and product-specification metadata, duplicate plan names,
and plan placement. It does not decide whether a change is material or whether a
technical consequence faithfully satisfies a product requirement. Completed
plan bodies remain historical and are not checked as current instructions.
