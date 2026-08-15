# Pi adapter

Concrete adapter for `@earendil-works/pi-coding-agent` 0.84.2.

The adapter discovers sessions for a canonical project, returns path-free
session descriptors, resolves stored UUIDs through a fresh authorized listing,
opens/creates native persistent sessions, translates active history and live Pi
events into SDK-neutral DTOs, and owns prompt preflight, steering, abort, and
runtime disposal.

Only this package imports the Pi SDK. Native paths and raw SDK values do not
cross its public contract. Pi's normal resources, project trust, enabled tools,
and direct execution behavior remain authoritative; the application does not
add an approval hook or sandbox.
