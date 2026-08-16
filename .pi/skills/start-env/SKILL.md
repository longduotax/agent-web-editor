---
name: start-env
description: Manually starts or cleans up this repository's isolated linked-worktree UI review environment with random loopback ports and a disposable SQLite database. Invoke only through /skill:start-env.
disable-model-invocation: true
compatibility: pi-web-app on macOS or Linux with Git, Node.js 22.19+, and pnpm 11.1.2.
---

# Start Env

This is a manual-only, repository-specific skill. Use it only when the user explicitly invokes `/skill:start-env`. Never infer invocation from an ordinary request to start or preview the application.

## Start

For `/skill:start-env`, run this exact command from the repository root:

```bash
pnpm dev:review
```

Do not manually choose ports, start another process, or provide a state directory. The checked-in command installs missing dependencies, refuses the main worktree, creates isolated SQLite state, starts the environment, verifies readiness, and prints `URL=...`.

Return the printed URL and mention that the environment has an empty, disposable project list.

## Cleanup

For `/skill:start-env cleanup`, run this exact command from the repository root:

```bash
pnpm dev:review:close
```

Report the command's cleanup result. Do not use `pkill`, manually terminate listeners, or delete any other state directory.
