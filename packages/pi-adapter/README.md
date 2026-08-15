# Pi adapter

Initial adapter package for `@earendil-works/pi-coding-agent`.

Only this package may import the Pi SDK. It will translate SDK-specific session,
event, command, capability, and error representations into the agent-agnostic
runtime contract. Raw SDK output must be parsed or exhaustively narrowed here
and must not leak into the server or browser. The SDK dependency and package
boundary are scaffolded; implementation is intentionally deferred.
