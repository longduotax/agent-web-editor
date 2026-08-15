# Web application

React and Vite browser shell for the local coding-agent workspace.

## Boundary

The browser may depend on `@pi-web/contracts`. It must not import server,
agent-runtime, adapter, or Pi SDK implementation modules. Runtime interaction
will cross an explicitly parsed HTTP or streaming contract once designed.

## Commands

Run from the repository root:

```sh
pnpm --filter @pi-web/web dev
pnpm --filter @pi-web/web typecheck
pnpm --filter @pi-web/web build
```

The first command starts a service; use it only when runtime work is explicitly
requested.
