# Agent runtime

Agent-agnostic interfaces for sessions, events, commands, capabilities, and
lifecycle behavior.

This package may depend on shared contracts but never on a concrete SDK or
adapter. Interfaces will be added only when behavior and failure semantics are
designed; the initial public entry point is intentionally empty rather than a
speculative abstraction.
