# Pi Web Workspace documentation

This is the documentation front door for the repository. It routes readers to
current architecture, durable product behavior, technical decisions,
implementation plans, contributor workflows, and supporting references.

Start here before substantial or unfamiliar work, public-contract changes, or
changes to dependencies, persistence, security, data flow, or runtime
boundaries. For a small isolated change, nearby code, tests, and a linked
canonical document may be sufficient.

## Current entry points

- [Architecture overview](architecture/overview.md) — implemented applications,
  packages, dependency direction, and entry points.
- [Parse, Don't Validate](architecture/data-boundaries.md) — construction of
  trusted values at every external or persisted-data boundary.
- [Agent implementation workflow](development/agent-implementation-workflow.md)
  — choose Fast or Plan; Draft and approve linked product intent and technical
  approach before Plan implementation.
- [Development workflows](development/workflows.md) — setup and static/runtime
  commands.

## Find documentation by subsystem

- **Browser editor and UI:** [web component guide](../apps/web/README.md) and
  [architecture overview](architecture/overview.md).
- **Backend coordination:** [server component guide](../apps/server/README.md)
  and [architecture overview](architecture/overview.md).
- **Shared transport contracts:** [contracts component guide](../packages/contracts/README.md)
  and [data-boundary guidance](architecture/data-boundaries.md).
- **Agent runtime abstraction:** [agent-runtime component guide](../packages/agent-runtime/README.md).
- **Pi integration:** [Pi adapter component guide](../packages/pi-adapter/README.md).
- **Repository tooling:** [development index](development/index.md).
- **Work in progress and implementation history:** [execution plans](exec-plans/index.md).

Keep component-specific detail beside its code and link it from this map or the
closest category index.

## Find documentation by type

- [Architecture](architecture/index.md) describes the implemented system.
- [Product specifications](product-specs/index.md) define durable behavior and
  business rules.
- [Technical designs](design/index.md) preserve decisions and tradeoffs.
- [Development](development/index.md) covers setup, testing, migration, and
  contributor workflows.
- [Execution plans](exec-plans/index.md) track substantial implementation work.
- [References](references/index.md) contain supporting material, not product
  requirements.

## Sources of truth

- Product specifications preserve Current durable behavior and clearly bounded
  Draft or Approved proposals.
- Architecture and designs describe current structure and important decisions.
- Code and tests demonstrate implemented behavior and compatibility.
- Active plans track work in progress.
- Completed plans are historical and never override current code, tests,
  specifications, architecture, or designs.

Investigate disagreements and update or flag stale documentation with the
change.
