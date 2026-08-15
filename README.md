# Pi Web Workspace

A local-first browser workspace for persistent engineering projects and Pi
coding-agent threads. It provides a compact conversation and review UI backed by
a loopback-only Fastify server, SQLite application metadata, native Pi session
history, safe file/Git inspection, and one on-demand terminal per project.

The initial implementation is in progress; the active execution plan records
remaining acceptance hardening.

## Requirements

- Node.js 22.19 or later
- pnpm 11.1.2
- Python 3 for the documentation validator
- Playwright Chromium for `pnpm test:e2e`

## Setup and verification

```sh
pnpm install
pnpm check
pnpm test:e2e
```

Start both loopback development processes with `pnpm dev`, then open the
launch URL printed by the server. To build and run the loopback production
server in one step, use `pnpm start`; it serves the built web application from
the backend origin. Both commands load ignored, machine-local settings from
`.env.local`. `--port` overrides `PI_WEB_PORT`; the backend default is `3001`.
`PI_WEB_DEV_PORT` selects the Vite port and defaults to `5173`. Copy
`.env.example` to `.env.local` to keep these values in one ignored
repository-local file. Application metadata defaults to
`~/.pi/web-workspace/metadata.sqlite` and can be relocated with an absolute
`PI_WEB_STATE_DIR`.

Pi tools and the explicit project terminal run with the server user's normal
permissions. They are not application-approved or OS-sandboxed.

See the [documentation front door](docs/README.md),
[architecture overview](docs/architecture/overview.md), and
[development workflows](docs/development/workflows.md).
