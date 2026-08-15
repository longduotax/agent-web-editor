# Parse, Don't Validate

Follow the principle in the canonical
[Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
essay.

At each trust boundary, transform an uncontrolled representation into a value
whose construction establishes everything downstream code needs. If parsing
fails, handle the failure at that boundary. Do not pass raw data onward beside
a boolean or assertion claiming it was checked.

## Boundaries in this repository

Apply this rule whenever data enters or is read from:

- HTTP APIs, streaming frames, and browser messages;
- database rows, serialized columns, and local persistence;
- environment variables, command-line arguments, and configuration files;
- workspace files, imports, generated files, and filesystem metadata;
- queues, event logs, and resumed session state;
- webhooks and callbacks;
- third-party services and agent SDK output, including Pi events and tool data.

Persisted and internal data is untrusted again when read. Parsing before a write
does not guarantee that old, partial, corrupt, or independently written data is
safe at a later read boundary.

## Practical TypeScript pattern

Put shared wire schemas in `packages/contracts` and infer static types from the
schema. Keep adapter-only parsers in the adapter that owns the external SDK.
Application logic should receive the parsed output, not `unknown`.

```ts
const result = ExampleSchema.safeParse(rawValue);
if (!result.success) {
  // Reject, report, quarantine, retry, or use an explicit fallback here.
  return boundaryFailure(result.error);
}
return useTrustedValue(result.data);
```

A TypeScript interface, generic argument, cast, non-null assertion, or
`as unknown as T` does not parse runtime data. A schema declaration also does
nothing unless the boundary executes it.

## Parser design

For every affected boundary, identify:

| Question         | Required answer                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Raw source       | Where does the uncontrolled representation originate?                                      |
| Entry/read point | What first application location receives it?                                               |
| Parser           | Which runtime function constructs the trusted value?                                       |
| Guarantee        | What can downstream code safely assume?                                                    |
| Failure          | Is malformed data rejected, surfaced, quarantined, retried, or given an explicit fallback? |
| Tests            | Which valid, malformed, missing, and legacy cases prove the boundary?                      |

Reuse one authoritative parser for a domain concept where representations share
the same contract. Create a branded or domain type only when construction
preserves a meaningful invariant; ordinary unconstrained text can remain a
primitive.

Keep parsing separate from business authorization. A well-formed command can
still be forbidden, conflict with current state, or violate a business rule.

## Failure behavior

Choose failure behavior deliberately:

- reject malformed client input with a stable, non-sensitive error;
- fail startup for invalid required configuration rather than guessing;
- quarantine or surface corrupt persisted records instead of spreading partial
  values;
- acknowledge webhooks or queue messages only according to their retry and
  idempotency contract;
- map SDK and third-party failures into adapter-owned typed failures without
  leaking credentials or provider internals;
- use fallback values only when the product contract defines them.

Tests should execute the real parser at the real boundary. At minimum, cover a
valid representation, malformed or wrong-type input, missing required values,
normalization, and relevant legacy forms.
