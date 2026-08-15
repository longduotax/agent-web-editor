# Native project directory picker

**Status:** Completed

**Outcome:** Completed

**Subsystem:** Project registration UI, browser/server contracts, and host OS integration

**Affected paths or contracts:** `apps/web/src/App.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/styles.css`, `apps/server/src/app.ts`, new server directory-picker adapter and tests, `packages/contracts/src/index.ts`, project API tests, Playwright workspace flow, and project-registration documentation

**Related documents or issue:** [Initial agent workspace specification](../../product-specs/initial-workspace.md), [architecture overview](../../architecture/overview.md), [Parse, Don't Validate](../../architecture/data-boundaries.md), [web workspace composition](../../design/web-workspace-composition.md), and the user's 2026-08-15 native Browse request

**Last updated:** 2026-08-15

## Approved specification and approval context

The user approved replacing manual project-path entry with a single native Browse control. The canonical [initial agent workspace specification](../../product-specs/initial-workspace.md) now requires macOS and Windows native directory choosers, immediate registration after selection, no change on cancellation, safe visible picker failures, and no selected native path crossing into the browser. The user explicitly excluded the old typed-path UI and approved implementation on 2026-08-15.

A renewed approval is required if implementation would restore manual entry, expose native paths to the browser, add uploads, support remote hosts, add Linux picker support, or materially change registration persistence.

## Purpose and measurable acceptance criteria

The project sidebar exposes one Browse button. On macOS or Windows, activating it opens the server host's native directory chooser. A selection is passed only to existing server-side canonicalization and registration logic, the parsed project DTO is returned, and the sidebar refreshes. Cancellation is a successful no-op.

Acceptance requires:

1. The path input and typed Add control are absent; an accessible Browse button is present and disabled while its request is pending.
2. Injected macOS and Windows picker tests prove selected paths and cancellation are parsed without invoking a shell or real host UI.
3. The authenticated browse endpoint accepts only its strict request contract, registers a selected directory, returns no canonical path, and returns a parsed canceled outcome without persistence.
4. Missing host tools, command failure, timeout, malformed/oversized output, non-absolute paths, and unsupported platforms become stable safe errors without command output or native paths.
5. The browser parses the browse response, refreshes projects only after selection, treats cancellation as benign, and visibly surfaces failures.
6. Focused tests, type checks, lint, build, documentation checks, and the project-add Playwright scenario pass.

## Current behavior, affected components, and invariants

`Sidebar` currently submits a browser-entered path through `addProject()` to `POST /api/projects`. `WorkspaceService.addProject()` performs `realpath`, directory and access checks, duplicate handling, receipt handling, and DTO redaction. `buildServer()` already injects runtime and PTY boundaries for deterministic tests. Browser responses are parsed with shared Zod contracts, and project DTOs reveal only a basename-like display path.

The new browse route will be an authenticated mutation covered by the existing exact Origin and `X-Pi-Web-Request` policy. It will invoke an injected server-owned picker, then reuse `WorkspaceService.addProject()`. Existing persisted records and migration behavior remain unchanged. The existing typed registration endpoint remains available as a compatibility surface, but the browser UI and client no longer call it.

## Scope and non-goals

In scope:

- one browser Browse control and pending/error behavior;
- a strict request and discriminated selected/canceled response contract;
- an injectable server picker adapter;
- macOS `osascript` and Windows PowerShell/WinForms folder selection, invoked without a shell;
- safe route error mapping and deterministic unit/integration/E2E coverage;
- current product, architecture, and component documentation.

Non-goals:

- manual path entry in the browser;
- directory uploads or browser File System Access handles;
- Linux or other platform-native pickers;
- remote/multi-user server operation;
- database schema or persistence changes;
- invoking a real picker in automated tests.

Assumptions: the browser and loopback server belong to the same interactive OS user; macOS supplies `/usr/bin/osascript`; supported Windows installations supply `powershell.exe` and WinForms. No unresolved product decisions remain.

## Implementation milestones

1. **Contracts and picker boundary:** Add strict browse request/response schemas. Add an injectable server picker interface and native implementation with platform-specific command construction, bounded execution, JSON output parsing, absolute-path construction, cancellation, and safe internal failure codes. Write boundary tests first.
2. **Authenticated registration route:** Add the browse mutation to server composition, inject the picker through `buildServer()`, reuse project registration, and add selection/cancellation/authentication/redaction/failure integration tests.
3. **Browser replacement:** Replace the path form with Browse, add the parsed API client mutation, preserve scoped errors/loading, adjust styling, and change Playwright registration to use an injected picker.
4. **Documentation and verification:** Update implemented architecture/component docs, run focused and repository checks, record results, archive this plan, and update indexes.

## Untrusted-data-boundary analysis

| Source and raw representation             | Entry/read point                | Runtime parser                                                                                                 | Trusted output and guarantees                                            | Failure behavior                                                                     | Boundary tests                                                                                                      |
| ----------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Browser browse request JSON               | Fastify browse route            | strict shared Zod request schema                                                                               | one bounded UUID idempotency key, no browser path                        | stable 400 before picker invocation                                                  | valid, missing, wrong type, extra field                                                                             |
| Native picker process stdout              | server picker adapter           | bounded process capture, `JSON.parse`, Zod nullable string parser, platform-specific absolute-path constructor | `null` cancellation or nonempty bounded absolute native path without NUL | safe picker failure; output/path never logged or returned                            | macOS/Windows selection, Unicode, cancel, malformed JSON, wrong type, relative path, NUL, oversized/process failure |
| Native selected path and filesystem state | `WorkspaceService.addProject()` | existing `realpath`, `stat`, access checks, canonical registration                                             | accessible canonical directory owned by a persisted project record       | existing safe missing/inaccessible/not-directory/duplicate errors; no partial record | selected temp directory, duplicate and unavailable characterization                                                 |
| Browse endpoint response JSON             | browser API client              | shared discriminated response schema                                                                           | selected project DTO or canceled outcome, never a canonical path         | scoped malformed-response error                                                      | selected, canceled, malformed response contract                                                                     |

The child process exit/error object and stderr are uncontrolled diagnostics. They are not forwarded or logged; only adapter-owned stable failure codes cross into application error mapping.

## Touched legacy-code analysis

- **Sidebar registration:** Existing invariant is that a nonempty typed path triggers registration and errors remain scoped. The intended invariant is now that Browse is the only registration interaction. Remove the input/form code rather than leaving hidden or dead manual behavior; preserve project-list invalidation and scoped error rendering. Playwright characterizes the resulting user flow.
- **Project API client:** `addProject(path)` becomes unused by browser production code and will be removed. The server's existing `POST /api/projects` remains deliberately compatible for current server tests or non-UI local callers; this plan does not remove that contract.
- **Server composition:** Preserve `buildServer()` as non-listening and injectable. Add picker injection beside existing runtime/PTY injection so tests never open host UI.
- **Project registration service/persistence:** Reuse without cleanup or schema changes. Existing canonicalization, idempotency, soft re-add, and redacted DTO behavior remain authoritative.

No stored representation changes. No database migration, recovery procedure, or persisted-data compatibility path is required.

## Verification, compatibility, and rollback

Run:

```sh
pnpm vitest run packages/contracts apps/server/src/directory-picker apps/server/src/app.test.ts
pnpm --filter @pi-web/web typecheck
pnpm --filter @pi-web/server typecheck
pnpm lint
pnpm build
pnpm docs:check
pnpm test:e2e -- --grep "adds a project"
pnpm check
```

Automated tests use temporary project/state directories and injected command/picker fakes. They do not open configured databases, real projects, native Pi sessions, or host dialogs. A real macOS/Windows dialog smoke test is manual and may be omitted; omission will be reported.

Deployment requires no migration. Rollback restores the previous browser form/client and removes the browse endpoint/adapter/contracts; persisted projects remain valid and untouched. Unsupported platforms receive a safe picker-unavailable response and are outside the approved UI support scope.

## Living progress

- [x] Working specification approved by the user.
- [x] Canonical product specification updated.
- [x] ExecPlan created and indexed.
- [x] Contracts and picker boundary implemented with tests.
- [x] Authenticated browse registration route implemented with tests.
- [x] Browser UI and Playwright flow replaced.
- [x] Durable documentation and verification completed.
- [x] Plan archived.

## Discoveries and decisions

- Browser directory APIs cannot provide the native absolute path required by the server, so selection must be server-owned.
- The selected path will never be a wire value. The browse endpoint combines host selection and registration and returns only a discriminated outcome plus the existing redacted project DTO.
- Native command output uses JSON rather than newline-delimited paths so Unicode and embedded line breaks have an unambiguous parser.
- Focused API tests exposed that `PI_WEB_DEV_PORT` incorrectly inherited the backend's `3001` default despite the documented `5173` default. The parser and characterization test were corrected so development authentication accepts the actual default Vite origin.
- Automated verification intentionally injects picker and command fakes. No real macOS or Windows dialog was opened during the test run.

## Final outcome

The sidebar now has one Browse control and no path input. The authenticated browse-and-register endpoint invokes an injected server-owned picker, returns only selected/cancelled outcomes and redacted project DTOs, and reuses existing canonical project registration. The native adapter runs JXA through `/usr/bin/osascript` on macOS and WinForms through `powershell.exe` on Windows without a shell; bounded JSON output is parsed as cancellation or a platform-absolute path. Unsupported platforms and picker failures map to safe errors.

Verification completed on 2026-08-15:

- `pnpm check` passed: formatting, lint, all workspace type checks, 49 Vitest tests, production builds, and documentation validation.
- `pnpm test:e2e -- --grep "adds a project"` passed the production-build Browse registration scenario.
- Vite retained its existing informational large-chunk warning; no build failed.
- Real native-dialog smoke testing was omitted to avoid opening host UI during automated work. macOS command shape/path encoding and both platform adapters are covered with deterministic boundary tests; Windows runtime confirmation remains a manual deployment check.
