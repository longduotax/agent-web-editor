# Local-client security

**Status:** Approved

**Subsystem:** Server startup, HTTP, and WebSocket access

**Last verified:** 2026-08-22

**Related documents:** [Initial agent workspace](../product-specs/initial-workspace.md), [initial workspace execution plan](../exec-plans/active/2026-08-15-initial-agent-workspace.md), [Workspace panel](../product-specs/workspace-panel.md), [workspace panel implementation plan](../exec-plans/active/2026-08-22-workspace-panel.md), [inspector and terminal boundaries](inspector-and-terminal.md), and [Parse, Don't Validate](../architecture/data-boundaries.md)

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

## Outbound URL probe and frame sandboxing

The workspace panel's browser tab embeds a web page — normally a local
development server started from a terminal in the same worktree. Two boundaries
support it, and one of them is genuinely new.

### The probe is the server's first outbound fetch of a user-supplied URL

Until now the server has only ever read the local filesystem, spawned `git` and
a shell, and talked to the Pi SDK. `POST /api/browser/probe` is the first
primitive where **the server issues a network request to an address the user
typed**. That is an expansion of the local attack surface and is recorded as
such rather than folded into an existing boundary.

What it does:

- accepts one URL, parsed with the platform URL parser, whose protocol must be
  exactly `http:` or `https:`. `file:`, `data:`, `javascript:`, `blob:`,
  `ftp:`, an embedded credential, and an unparseable string are rejected before
  any socket is opened;
- rejects, with its own code, any address whose origin equals the workspace's
  own, so a self-framing address fails here and never reaches an `iframe`;
- issues a **headers-only** request: `HEAD`, falling back once to `GET` with the
  response stream destroyed as soon as the headers arrive, for targets that
  refuse `HEAD`;
- carries **no** client-supplied method, headers, body, cookies, or
  credentials, and no ambient authentication of any kind;
- follows at most **three** redirects, counted and enforced by the server rather
  than delegated to the fetch implementation, with a five-second deadline
  covering the whole chain;
- returns **three facts**: whether the target is reachable, whether it refuses
  framing, and which header said so. Nothing else — no status line, no header
  values, no redirect chain, no response text, no error detail from the target.

Why headers-only and body-discarded matter: the probe would otherwise be a
general-purpose fetch primitive whose output a caller could read. Discarding the
body keeps it a two-bit oracle, caps memory regardless of what the target sends,
and means a hostile target cannot use the response path to deliver anything into
the workspace. Bounding redirects prevents a redirect loop from holding a
connection and prevents a permitted first hop from laundering an arbitrary
later one.

What it deliberately does **not** do: block private, loopback, or link-local
address ranges. The primary and intended target of this feature is
`http://localhost:<port>`, so a private-range blocklist would block the feature
itself. The honest statement of residual risk is therefore this: a same-machine
process — which, under the no-authentication model, can already forge `Origin`
and `X-Pi-Web-Request` and call every other route — can additionally use the
server to learn whether an arbitrary `http`/`https` address, including other
loopback services and cloud metadata endpoints, is reachable and whether it
sends framing headers. It cannot read any response content through this route.
That is a blind reachability oracle available to a caller that already has the
run of the API, and it is accepted on those terms.

### The frame is sandboxed, and self-origin addresses are refused

The embedded page is loaded by the browser, not proxied by the server, into an
iframe with
`sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin"`.

The security-relevant part is what is **absent**. Neither `allow-top-navigation`
nor `allow-top-navigation-by-user-activation` is granted, which is what stops an
embedded page navigating the workspace away from itself. The browser enforces
that independently of anything the frame does to its own attribute.

`allow-same-origin` is granted, because withholding it does not protect what it
appears to. A framed `http://localhost:3000` is cross-origin to our
`http://127.0.0.1:3001` — a different port is a different origin — so the token
gives that page **its own** real origin, never ours. It cannot read our DOM or
our storage, and it is exactly as privileged as the same page is in an ordinary
browser tab. Withholding the token instead forces an **opaque** origin on every
framed page: no cookies, no `localStorage`, no IndexedDB. That breaks or subtly
misbehaves any development application with a session, a persisted store, or an
auth token — a large share of precisely what this tab exists to display — in
exchange for a protection against a threat that was never present for
cross-origin content.

The real hazard is narrower and is closed directly: **an address whose origin
equals the workspace's own is refused**, on the server in the probe route and
again in the client before an `iframe` element is created, and the tab renders an
explicit named state. Only in that case could a same-origin frame reach
`window.parent` and this origin's `localStorage`, and rejecting the address is a
precise fix rather than a broad one levied on every legitimate page.

Stated rather than glossed: `allow-scripts` combined with `allow-same-origin`
permits a frame to clear its own `sandbox` attribute. For cross-origin content
that changes nothing real — such content already has full ordinary page powers,
and the top-navigation restriction that matters here is enforced by the browser
regardless of what the frame does to the attribute. The residual exposure is
therefore exactly this: a framed page runs with the powers its own origin has,
as it would in any browser tab.

Production static responses gain `frame-src http: https:` in their CSP, which is
required for the frame to load at all under `default-src 'self'`. This permits
**us to frame others**. It does not change who may frame us: `frame-ancestors
'none'` and `X-Frame-Options: DENY` on our own responses are retained unchanged.

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
- **Probing the target from the browser instead of the server:** rejected
  because it cannot work. A cross-origin response's framing headers are not
  readable from script, and a `no-cors` fetch reveals nothing about them.
- **Returning the probe's status code, headers, or body to the browser:**
  rejected. Each of those turns a two-bit framing oracle into a general
  outbound fetch primitive that any same-machine caller could read the results
  of, for no product benefit — the tab needs to know only whether to embed.
- **Blocking private and link-local address ranges in the probe:** rejected as
  incompatible with the feature, whose primary target is a loopback development
  server. The residual reachability oracle is documented above instead of being
  hidden behind a blocklist that would have to be full of holes to be useful.
- **A local header-stripping proxy so any site embeds:** rejected. It would make
  the server an open forward proxy for any same-machine process and is a large
  permanently-breaking subsystem; see
  [inspector and terminal boundaries](inspector-and-terminal.md).
- **Omitting `allow-same-origin` so a framed page gets an opaque origin:**
  rejected. It defeats the tab's primary purpose — a local development server
  with a session or a persisted store does not work under an opaque origin — and
  it protects nothing for cross-origin content, which the token would give its
  own origin rather than ours. The one case it would have covered, framing the
  workspace's own origin, is refused by address instead.
- **Relying on the sandbox rather than an address check to stop self-framing:**
  rejected as indirect. Refusing the address is a decidable check at the
  boundary, testable with no browser, and it leaves the sandbox free to be
  correct about the case that actually occurs.

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
- Browser probe: every rejected scheme, an embedded credential, an unparseable
  URL, the workspace's own origin rejected with no request issued, a differing
  port accepted, three redirects accepted and a fourth rejected, a redirect
  loop, an unreachable host, a host that exceeds the deadline, a `HEAD`-refusing
  target, `X-Frame-Options` present and absent, a CSP `frame-ancestors`
  directive, and an assertion that the target's body is never read or returned.
- Probe request policy: it is a mutation and is rejected without an exact
  `Origin` and `X-Pi-Web-Request: 1`, like every other mutation.
- Production headers: the CSP contains `frame-src http: https:` and still
  contains `frame-ancestors 'none'`, and `X-Frame-Options: DENY` is unchanged.
- Frame sandboxing: the rendered iframe's `sandbox` attribute contains
  `allow-same-origin` and contains **neither** `allow-top-navigation` nor
  `allow-top-navigation-by-user-activation`; and an address equal to the
  workspace's own origin — typed or restored from device-local state — renders
  the named refusal state and mounts no `iframe` at all.
