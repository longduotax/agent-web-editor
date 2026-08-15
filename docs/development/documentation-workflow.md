# Documentation workflow

This document defines how contributors and agents find, create, maintain, and
retire repository documentation.

## Traversal

1. Start at [`docs/README.md`](../README.md).
2. Choose the affected subsystem rather than scanning the whole tree.
3. Read the relevant current specification and architecture document.
4. Read a design only when prior decisions or tradeoffs affect the change.
5. Check the [active-plan index](../exec-plans/active/index.md) and open only an
   overlapping plan.
6. Consult [completed plans](../exec-plans/completed/index.md) only for a
   specific historical question.
7. Verify documentation claims against nearby code and tests.

Use this traversal for substantial, unfamiliar, cross-component, contract, data
flow, dependency, persistence, security, or boundary work. Avoid broad traversal
for a small familiar change.

## Directory contract

### `architecture/`

Describes the currently implemented components, dependencies, data flows,
boundaries, and invariants. Do not put requirements, task lists, or history here.

### `product-specs/`

Defines durable user-visible behavior, business rules, acceptance criteria, and
edge cases. Do not create a placeholder spec before behavior is decided.

### `design/`

Preserves important technical decisions, alternatives, and tradeoffs. Do not
copy the whole architecture or an implementation checklist into a design.

### `development/`

Contains setup, testing, migration, verification, and contributor workflows.

### `exec-plans/active/`

Contains living plans for current work that is not clearly Fast. Every plan must
be linked from its index and maintained during implementation.

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
small, isolated, familiar, low-risk changes. Every other change uses Plan and
requires a written working specification, explicit user approval, and a living
ExecPlan before implementation.

The working specification may stay in the conversation or task state. When it
changes durable product behavior, update the existing canonical product
specification that governs that behavior after approval and before planning.
Create a new specification file only for a distinct durable contract.

Update architecture only when implementation changes. Create a design only when
decision reasoning will remain useful. Do not create placeholders merely to fill
a directory.

## ExecPlan lifecycle

1. Write the working specification, present it to the user, and receive explicit
   approval. Update the governing canonical product specification, or create one
   for a distinct durable contract, when durable product behavior is involved.
2. Create a dated plan in `exec-plans/active/` and add routing metadata to the
   active index.
3. Maintain progress, discoveries, blockers, and decisions while working.
4. Before completion, update durable specifications, designs, and architecture.
5. Move the plan to `exec-plans/completed/`, record `Completed`, `Superseded`, or
   `Abandoned`, and update both indexes.

Unchecked boxes in a historical plan do not make it active.

## Metadata and indexes

New maintained documents should include status, subsystem, last verification
date, relevant paths, and related documents where useful. Every active plan
must identify status, subsystem, affected paths or contracts, related documents
or issue, and last-updated date near the top.

- Link every canonical document from its closest index.
- Prefer relative links and subsystem-oriented routing.
- Keep active-index summaries specific enough to establish overlap without
  opening every plan.
- Investigate conflicts between documentation and implemented behavior.

## Verification

After changing indexes, links, or plan placement, run:

```sh
pnpm docs:check
```

The validator checks canonical indexes, local relative links, direct index
coverage, active metadata, duplicate plan names, and legacy plan locations. It
does not treat completed plan bodies as current instructions.
