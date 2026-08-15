# Monorepo and documentation scaffold

**Status:** Completed

**Subsystem:** Repository foundation

**Affected paths or contracts:** Root workspace configuration, `apps/*`, `packages/*`, `docs/*`, and `scripts/check_docs.py`

**Related documents or issue:** Initial repository request; [architecture overview](../../architecture/overview.md), [development workflows](../../development/workflows.md)

**Last updated:** 2026-08-15

## Purpose and acceptance criteria

Create a minimal, strict pnpm TypeScript monorepo for a browser workspace, a Fastify backend, shared contracts, an agent-runtime abstraction, and a Pi SDK adapter. Recreate ValAI's documentation conventions without importing its domain content.

The work is complete when dependency installation is reproducible; root build, typecheck, lint, test, formatting, and documentation checks pass; package boundaries are documented; and no service has been started.

## Current state

The target directory is empty and is not a Git repository. There are no existing files, contracts, compatibility constraints, or documentation to preserve. ValAI's documentation system was inspected as the source for conventions only.

## Scope

- Root pnpm workspace and shared TypeScript/tooling configuration.
- Minimal React/Vite and Fastify entry points required to build the scaffold.
- Empty public package entry points and dependency direction for contracts, runtime abstraction, and Pi adapter.
- Canonical documentation indexes, workflows, architecture, and validator.
- Dependency installation and static verification.

## Non-goals

- Editor, workspace persistence, transport endpoints, agent sessions, streaming, tool execution, authentication, or other product behavior.
- Starting either application.
- Database, queue, file-import, webhook, or third-party runtime integration.
- Product specifications or technical designs before durable behavior or a decision exists.

## Assumptions and decisions

- Node.js 22.19 or later is the baseline because the Pi SDK requires it.
- Browser and server remain separate processes; shared packages contain no process startup or environment access.
- Root tooling is centralized to keep package configuration small.
- The Pi package is installed only in `packages/pi-adapter`; SDK calls are deferred until an agent contract is designed.
- No material product or architecture choice remains unresolved for this scaffold.

## Implementation milestones

1. Add workspace manifests, strict shared compiler settings, linting, formatting, and Vitest configuration.
2. Add minimal buildable application and package entry points with one-way workspace dependencies.
3. Add component READMEs and adapted canonical documentation.
4. Add the documentation validator and package scripts.
5. Install dependencies, run all static checks, update documentation from observed results, and archive this plan.

## Untrusted-data-boundary analysis

No runtime data boundary is introduced. The scaffold does not read HTTP payloads, database rows, configuration values, files, queues, webhooks, or third-party responses. The Fastify process binds only when explicitly started and registers no application routes. Future boundary work must identify runtime parsers and failure behavior before downstream values are trusted.

Dependency metadata and tool configuration are consumed by pnpm, TypeScript, ESLint, Vite, and Python as development-tool boundaries. Verification consists of their native parsers plus deterministic build and documentation checks; application code does not consume those representations.

## Touched-legacy-code analysis

Not applicable. The target directory is empty, so there are no legacy callers, stored representations, or compatibility behavior.

## Verification

```sh
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:check
```

Do not run `pnpm dev`, application package `dev` scripts, built server entry points, or database commands.

## Compatibility, deployment, and recovery

There is no deployment or migration. Node.js compatibility follows the Pi SDK engine floor. If installation or checks fail, adjust only scaffold configuration and rerun from the lockfile; no runtime or persistent state requires recovery.

## Progress

- [x] Inspected the empty target and relevant ValAI documentation conventions.
- [x] Created workspace and package scaffolding.
- [x] Created canonical documentation and validator.
- [x] Installed dependencies and passed static checks.
- [x] Archived this plan with final outcomes.

## Discoveries and blockers

- The available environment provides Node.js 22.22.1, pnpm 11.1.2, and Python 3.12.3.
- The current Pi SDK release requires Node.js 22.19 or later.
- pnpm 11 blocks dependency lifecycle scripts unless explicitly classified; the
  workspace allows the Pi/Vite dependency scripts for `@google/genai`,
  `esbuild`, and `protobufjs`.

## Decision log

- 2026-08-15: Use a centralized root toolchain and package-local build/dev scripts.
- 2026-08-15: Keep shared package entry points empty until actual contracts are designed; package manifests establish boundaries without inventing behavior.

## Final outcomes

The repository now contains all five requested workspace projects, a centralized
strict TypeScript/ESLint/Prettier/Vitest toolchain, a locked Pi SDK dependency,
component boundary guides, canonical documentation and indexes, and an adapted
documentation validator. Dependency installation and the full static gate pass.
No application service was started, and no product contract, persistence, or
agent behavior was introduced.
