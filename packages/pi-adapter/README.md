# Pi adapter

Concrete adapter for `@earendil-works/pi-coding-agent` 0.84.2.

The adapter uses a bounded tool-free request to suggest a first-prompt title.
An explicit naming-model override takes precedence; otherwise it uses the
project's configured default Pi model when that model is authenticated and
available. It also discovers sessions for a canonical execution root, returns path-free
session descriptors, resolves stored UUIDs through a fresh authorized listing,
opens/creates native persistent sessions, translates active history and live Pi
events into SDK-neutral DTOs, serves that projection in authenticated bounded
latest/older pages, and owns prompt preflight, steering, abort, and runtime
disposal. For chat images it reports selected-model/settings capability,
verifies source fingerprints, bounds concurrent worker-backed normalization,
passes flat Pi image blocks to prompt or steer, projects valid native user
images as opaque content refs, and resolves those refs without exposing a native
path. New blank sessions are atomically materialized from narrowly
parsed `SessionManager` state because Pi SDK 0.84.2 otherwise delays its first
JSONL write until an assistant message exists.

`PI_CODING_AGENT_DIR`, when set, must be an absolute path. The adapter
normalizes it once during runtime construction; when absent it uses Pi's
`~/.pi/agent` default. Invalid values fail before native session discovery or
opening.

Only this package imports the Pi SDK. Native paths and raw SDK values do not
cross its public contract. Pi's normal resources, project trust, enabled tools,
and direct execution behavior remain authoritative; the application does not
add an approval hook or sandbox.
