# Codex adapter

Concrete `AgentRuntime` over the OpenAI Codex CLI's `codex app-server`
JSON-RPC protocol, pinned to Codex CLI 0.149.0.

Unlike the [Pi adapter](../pi-adapter/README.md), which drives an in-process
SDK, Codex is an external program. That difference is the reason this package
exists and is confined entirely inside it: nothing above `AgentRuntime` learns
that one backend spawns a child process and the other does not.

## Process model

One supervised `codex app-server` child serves every thread. The protocol
addresses threads explicitly, so multiplexing keeps memory flat as the number
of open panes grows and leaves a single supervisor to reason about rather than
one per chat. `CodexClient` owns newline framing, request/response correlation
by id, the `initialize` handshake, notification fan-out, and reconnect.

When the child dies, every in-flight request fails immediately rather than
hanging on a promise nothing can resolve, subscribers are told so open threads
can reattach, and the next call reconnects.

## Trust boundary

Everything the app-server emits is untrusted input. Each frame is parsed into a
response, server-request, or notification shape; anything matching none of them
is counted in `droppedFrames` and discarded rather than failing the session. A
response naming an id nothing awaits is discarded the same way, since a late
answer to an already-failed request must not resolve anything.

Codex items are projected onto the shared `TranscriptItem` contract, and every
field is truncated to the contract's caps: Codex output is unbounded, and
losing an item to a failed parse is worse than showing a truncated one. An item
type this adapter does not recognise becomes an `info` diagnostic naming the
type, so a Codex capability we predate is visible rather than silently dropped.

## Approvals and confinement

Threads are started and resumed with `approvalPolicy: "never"`, which is **not
configurable**. The workspace has no surface for answering a permission prompt,
so a run must never be able to wait on one. Any approval request Codex raises
anyway is answered `denied` the moment it arrives.

The sandbox is configurable and defaults to `workspace-write`: Codex may read
and write within the chat's execution root and has no network access. An
operator can widen it with `PI_WEB_CODEX_SANDBOX` — see the repository README.
A refusal from that boundary surfaces as a failed command in the transcript and
a settled run, never a silent stall.

This is deliberately stricter than Pi, which runs with the server user's full
permissions. The difference is a stated product property, not an accident; see
[Agent backends](../../docs/product-specs/agent-backends.md) AGB-06.

## Configuration

`PI_WEB_CODEX_BIN` selects the executable (default `codex`, resolved on PATH).
A missing or unusable installation surfaces as `RuntimeFailure("unavailable")`
naming Codex, and `probe()` reports it so the browser can show the backend
disabled with its reason instead of failing at chat-creation time.

## Protocol types

The app-server protocol is experimental and can change under `codex update`.
This package hand-writes narrow Zod schemas for only the messages it uses
rather than generating types at build time, so `pnpm check` does not require
Codex to be installed. `codex app-server generate-ts --out <dir>` emits the
full typed protocol and is the reference to consult when extending the schemas.
