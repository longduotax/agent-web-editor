# Agent runtime

SDK-neutral interfaces for bounded prompt-derived naming, persistent session
discovery/create/open, transcript snapshots, text-plus-image prompt preflight and
settlement, image-bearing steering, capability inspection, authorized native
image lookup, stopping, events, and lifecycle disposal.

Failures use application-owned categories. No Pi classes, paths, content blocks,
or provider types cross this package boundary. Concrete Pi integration lives in
`@pi-web/pi-adapter`; deterministic fakes live in application tests.
