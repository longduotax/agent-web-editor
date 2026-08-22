import { RuntimeFailure, type AgentRuntime } from "@pi-web/agent-runtime";
import type { RuntimeKind } from "@pi-web/contracts";

const LABELS: Record<RuntimeKind, string> = { pi: "Pi", codex: "Codex" };
const ORDER: RuntimeKind[] = ["pi", "codex"];

/**
 * The server's map from a chat's recorded backend to the adapter that runs it.
 *
 * A backend is absent when its program is not installed on this machine. That
 * is an ordinary, recoverable state — Pi chats keep working when Codex is
 * missing and vice versa — so it surfaces as a typed failure naming the
 * backend rather than an internal error (AGB-08).
 */
export class RuntimeRegistry {
  public constructor(
    private readonly adapters: Partial<Record<RuntimeKind, AgentRuntime>>,
    public readonly defaultKind: RuntimeKind,
  ) {
    if (adapters[defaultKind] === undefined)
      throw new Error(
        `${LABELS[defaultKind]} is configured as the default agent backend but is not available.`,
      );
  }

  public available(kind: RuntimeKind): boolean {
    return this.adapters[kind] !== undefined;
  }

  public kinds(): RuntimeKind[] {
    return ORDER.filter((kind) => this.available(kind));
  }

  public get(kind: RuntimeKind): AgentRuntime {
    const adapter = this.adapters[kind];
    if (adapter === undefined)
      throw new RuntimeFailure(
        "unavailable",
        `${LABELS[kind]} is not available on this machine. Install it and restart the workspace server.`,
      );
    return adapter;
  }
}
