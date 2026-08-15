# Server application

Fastify process boundary for local workspace orchestration and future agent
runtime adapters. The scaffold intentionally registers no product routes.

## Boundary

The server may compose `@pi-web/agent-runtime` implementations and expose
values defined by `@pi-web/contracts`. Browser code never imports this package.
Raw requests, configuration, files, stored data, runtime events, and SDK output
must be parsed at their entry or read boundary before application logic uses
them.

## Commands

Run from the repository root:

```sh
pnpm --filter @pi-web/server dev
pnpm --filter @pi-web/server typecheck
pnpm --filter @pi-web/server build
pnpm --filter @pi-web/server start
```

The `dev` and `start` commands start a service; use them only when runtime work
is explicitly requested.
