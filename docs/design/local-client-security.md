# Local-client security

**Status:** Approved

**Subsystem:** Server startup, HTTP, and WebSocket access

**Last verified:** 2026-08-15

**Related documents:** [Initial agent workspace](../product-specs/initial-workspace.md), [initial workspace execution plan](../exec-plans/active/2026-08-15-initial-agent-workspace.md), and [Parse, Don't Validate](../architecture/data-boundaries.md)

## Decision summary

Keep startup immediate and intentionally omit client authentication. The server
binds only to `127.0.0.1`, serves the production browser application from the
same origin, accepts a user-selected port, and prints a plain launch URL. The
browser opens the workspace without a launch token, login, session cookie, or
reauthentication step.

Exact Host checks limit accepted request routing. Exact browser Origin checks and
an explicit mutation header reduce cross-origin browser access. They are request
integrity protections, not authentication: any process running on the local
machine can forge these headers and access the APIs, agent controls, files, and
terminal while the server is running. This exposure is an accepted consequence
of the no-authentication local workflow.

There are no users, persisted or process-local authentication secrets, session
cookies, bootstrap/logout endpoints, JWTs, refresh tokens, signing keys, or
account-management flows.

## Port and launch configuration

- `--port <port>` takes precedence over `PI_WEB_PORT`; otherwise the port is
  `3001`.
- Production accepts integer ports from 1 through 65535. Tests may inject port
  `0` to obtain an ephemeral port.
- Invalid values fail configuration parsing. A port conflict fails startup
  visibly; the server does not silently choose another port.
- The host is fixed to `127.0.0.1` and is not user-configurable.
- Production prints `http://127.0.0.1:<port>/` without a URL token or other
  credential. Development prints the equivalent Vite loopback URL using
  `PI_WEB_DEV_PORT` (default `5173`).
- Production serves the built SPA and `/api/**` from one origin. Development
  proxies API and WebSocket traffic so browser code uses relative same-origin
  URLs.

## Request policy

- Every accepted HTTP request must have an exact configured `Host`.
- Product API reads require no credential, cookie, or Origin header.
- State-changing requests must have an exact configured `Origin` and
  `X-Pi-Web-Request: 1`.
- Every WebSocket upgrade must have exact configured Host and Origin headers.
  It requires no credential or cookie.
- No wildcard or reflective CORS configuration is enabled.
- Route authorization parses opaque IDs and verifies complete
  project/thread/run/terminal ownership. This resource scoping does not identify
  or authenticate a caller.
- Central body/frame limits and stable safe error envelopes reject malformed or
  excessive input.

## Logging and browser policy

Logs may include routes, status codes, and opaque application IDs. They redact
provider credentials, prompts by default, canonical project paths, native
session paths, terminal input, and unrestricted command output. Production
static responses use a restrictive CSP and deny framing. Client errors do not
expose stacks, secrets, native paths, or adapter internals.

## Alternatives considered

- **Process launch token and HttpOnly session cookie:** removed because the
  single-user local workflow values opening the printed URL immediately over
  distinguishing browser clients from other same-machine processes.
- **Persistent installation secret and signed long-lived sessions:** rejected as
  unnecessary operational complexity for this explicitly unauthenticated local
  application.
- **Users, OAuth, or OS account integration:** rejected for the local-first
  application.
- **Local HTTPS:** deferred because certificate setup does not authenticate
  same-machine callers and adds operational complexity.
- **Removing Host/Origin/CSRF checks too:** rejected because immediate startup
  does not require discarding low-friction browser request-integrity defenses.

## Failure and recovery

Invalid port configuration or an insecure bind attempt fails startup with a
non-secret diagnostic. Host, Origin, and mutation-header failures return 403.
There is no expired-session or restart recovery flow: refreshing, opening
another tab, or restarting the server requires no browser authentication step.

## Required tests

- CLI/environment/default port precedence, valid bounds, invalid values, test
  port `0`, plain launch URL, and address-in-use failure.
- Credential-free API reads and mutations, with mutations still rejecting
  missing/hostile Origin or missing CSRF signal.
- Exact Host/Origin cases for configured ports, absent/`null`/hostile Origin,
  forged Host, and credential-free WebSocket upgrades.
- Absence of bootstrap/logout routes, auth contracts, cookies, URL fragments,
  and browser authentication screens.
- Missing mutation header, safe versus unsafe methods, body/frame limits, stable
  errors, and log redaction.
- Valid IDs with cross-project/thread/run/terminal ownership mismatches.
