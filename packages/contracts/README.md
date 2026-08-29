# Shared contracts

Executable Zod wire schemas and inferred TypeScript types shared by browser and
server.

The package defines branded opaque IDs, timestamps, project/thread/run and
thread-workspace DTOs, new-chat preflight/start commands, bounded chat-image
limits, multipart metadata, image capability/ref/response values, authoritative
snapshots and live events, file/Git responses, and terminal frames. Callers must execute a schema at every transport boundary;
static types or casts are not runtime parsing.

This is the dependency leaf and does not import applications, runtimes, or SDKs.
