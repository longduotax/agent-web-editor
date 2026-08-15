# Pi Web Workspace

A local-first, browser-based coding-agent workspace scaffold. The monorepo is
prepared for a fast React editor, a Fastify coordination backend, and multiple
agent runtimes through adapters, beginning with Pi.

No editor, transport, persistence, or agent behavior is implemented yet.

## Requirements

- Node.js 22.19 or later
- pnpm 11.1.2
- Python 3 for the documentation validator

## Setup and verification

```sh
pnpm install
pnpm check
```

`pnpm dev` starts the web and server development processes. Do not run it when
only static setup or verification is intended.

See the [documentation front door](docs/README.md) and
[development workflows](docs/development/workflows.md).
