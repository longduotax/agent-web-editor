# Local-client security

**Status:** Approved

**Subsystem:** Server startup, browser authentication, HTTP, and WebSocket access

**Last verified:** 2026-08-15

**Related documents:** [Initial agent workspace](../product-specs/initial-workspace.md), [initial workspace execution plan](../exec-plans/active/2026-08-15-initial-agent-workspace.md), and [Parse, Don't Validate](../architecture/data-boundaries.md)

## Decision summary

Keep local security process-scoped and small. The server binds only to `127.0.0.1`, serves the production browser application from the same origin, and accepts a user-selected port. At each process start it generates a random launch token. The browser exchanges that token once for a random HttpOnly session cookie held only in server memory. Exact Host and Origin checks protect HTTP and WebSocket access.

There are no users, persisted authentication secrets, JWTs, refresh tokens, signing keys, or account-management flows. Restarting the server invalidates browser sessions and produces a new launch URL.

Loopback binding is an exposure limit, not authentication or a sandbox.

## Port and launch configuration

- `--port <port>` takes precedence over `PI_WEB_PORT`; otherwise the port is `3001`.
- Production accepts integer ports from 1 through 65535. Tests may inject port `0` to obtain an ephemeral port.
- Invalid values fail configuration parsing. A port conflict fails startup visibly; the server does not silently choose another port.
- The host is fixed to `127.0.0.1` and is not user-configurable in the initial release.
- The selected port is used in the listener, launch URL, exact Host/Origin policy, and development proxy configuration.
- Production serves the built SPA and `/api/**` from one origin. Development keeps Vite on loopback at `PI_WEB_DEV_PORT` (default `5173`) and proxies API and WebSocket traffic so browser code uses relative same-origin URLs. Repository-local development values may be stored in the ignored root `.env.local` file.

## Bootstrap and session

1. Startup creates a cryptographically random, short-lived launch token in memory and prints the application URL with the token in the URL fragment rather than the query string.
2. The SPA reads the fragment, posts it to `/api/auth/bootstrap`, and immediately removes it with `history.replaceState`.
3. The server consumes the token and creates a random opaque session ID in an in-memory set with an idle/absolute expiry.
4. The response sets that ID in an HttpOnly, `SameSite=Strict`, `Path=/` cookie. It is not marked `Secure` because the supported endpoint is loopback HTTP.
5. Browser JavaScript never stores the launch token or session ID in localStorage/sessionStorage.

Tabs in the same browser profile share the cookie. A server restart, expiry, or explicit logout clears effective access; the user reopens the newly printed launch URL. This is acceptable because durable projects, threads, and history live independently of process authentication.

## Request policy

- Product API reads and mutations require a live process session. Static assets, readiness, and bootstrap are the only public endpoints.
- Requests must have an exact allowed `Host`. State-changing requests and every WebSocket upgrade must also have an exact allowed `Origin`.
- Non-safe methods require `X-Pi-Web-Request: 1`; this is a CSRF signal in addition to, not instead of, session authentication.
- No wildcard or reflective CORS configuration is enabled.
- WebSockets authenticate from the cookie during upgrade. Tokens never appear in WebSocket URLs or subprotocol values.
- Route authorization parses opaque IDs and verifies complete project/thread/run/terminal ownership after authentication.
- Central body/frame limits and stable safe error envelopes reject malformed or excessive input.

## Logging and browser policy

Logs may include routes, status codes, and opaque application IDs. They redact cookies, launch tokens, provider credentials, prompts by default, canonical project paths, native session paths, terminal input, and unrestricted command output. Production static responses use a restrictive CSP and deny framing. Client errors do not expose stacks, secrets, native paths, or adapter internals.

## Alternatives considered

- **Host/Origin checks with no secret:** rejected because unrelated local callers still have unauthenticated access.
- **Persistent installation secret and signed long-lived sessions:** rejected as unnecessary operational complexity for a single-user process-local application.
- **Bearer token in localStorage or URLs:** rejected because browser-readable storage, histories, referrers, and logs increase leakage.
- **Users, OAuth, or OS account integration:** rejected for the local-first initial release.
- **Local HTTPS:** deferred because certificate setup adds more management than the process-local threat model warrants.

## Failure and recovery

Invalid port configuration or an insecure bind attempt fails startup with a non-secret diagnostic. Invalid sessions return 401; Host/Origin/CSRF failures return 403 without revealing token details. Suspected token exposure is handled by restarting the process, which invalidates all process-local credentials without modifying persistent metadata or Pi sessions.

## Required tests

- CLI/environment/default port precedence, valid bounds, invalid values, test port `0`, launch URL, and address-in-use failure.
- Launch-token entropy, expiry, single consumption, concurrent exchange, and fragment removal.
- Random cookie session, expiry, restart invalidation, HttpOnly/SameSite/Path flags, and absence from browser storage.
- Exact Host/Origin cases for configured ports, absent/`null`/hostile Origin, forged Host, and WebSocket upgrades.
- Missing mutation header, safe versus unsafe methods, body/frame limits, stable errors, and log redaction.
- Valid IDs with cross-project/thread/run/terminal ownership mismatches.
