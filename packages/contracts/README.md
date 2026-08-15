# Shared contracts

Runtime schemas and inferred TypeScript types shared by the browser and server.

This package is the transport-contract leaf: it must not depend on applications,
agent runtimes, or adapters. Define a runtime schema first and derive its static
type from that parser; do not maintain an unchecked interface beside a schema.
No product contract exists yet, so the public entry point is intentionally
empty.
