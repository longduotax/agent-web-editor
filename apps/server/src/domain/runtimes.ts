import { RuntimeFailure, type AgentRuntime } from "@pi-web/agent-runtime";
import type { AgentBackend, RuntimeKind } from "@pi-web/contracts";

/**
 * An adapter whose program lives outside this process can report whether it is
 * actually usable. Adapters that run in-process do not need to.
 */
interface ProbeableRuntime {
  probe?: () => Promise<{ available: boolean; reason?: string }>;
}

interface ClosableRuntime {
  close?: () => Promise<void> | void;
}

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

  /**
   * Asks each backend whether it can actually run, so the composer can show an
   * unusable one disabled with its reason instead of failing at create time.
   */
  public async availability(): Promise<AgentBackend[]> {
    const backends: AgentBackend[] = [];
    for (const kind of ORDER) {
      const adapter = this.adapters[kind];
      if (adapter === undefined) {
        backends.push({
          kind,
          available: false,
          reason: `${LABELS[kind]} is not configured on this machine.`,
        });
        continue;
      }
      const probe = (adapter as ProbeableRuntime).probe;
      if (probe === undefined) {
        backends.push({ kind, available: true, reason: null });
        continue;
      }
      try {
        const result = await probe.call(adapter);
        backends.push({
          kind,
          available: result.available,
          reason: result.reason ?? null,
        });
      } catch (error) {
        backends.push({
          kind,
          available: false,
          reason:
            error instanceof Error
              ? error.message
              : `${LABELS[kind]} could not be reached.`,
        });
      }
    }
    return backends;
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

  /** Returns a selected adapter only after its optional availability probe passes. */
  public async usable(kind: RuntimeKind): Promise<AgentRuntime> {
    const adapter = this.get(kind);
    const probe = (adapter as ProbeableRuntime).probe;
    if (probe === undefined) return adapter;
    try {
      const result = await probe.call(adapter);
      if (result.available) return adapter;
      throw new RuntimeFailure(
        "unavailable",
        result.reason ?? `${LABELS[kind]} is not available on this machine.`,
      );
    } catch (error) {
      if (error instanceof RuntimeFailure) throw error;
      throw new RuntimeFailure(
        "unavailable",
        error instanceof Error
          ? error.message
          : `${LABELS[kind]} could not be reached.`,
      );
    }
  }

  /** Shuts down each registered external runtime once during server teardown. */
  public async close(): Promise<void> {
    await Promise.allSettled(
      [...new Set(Object.values(this.adapters))].map(async (adapter) => {
        await (adapter as ClosableRuntime).close?.();
      }),
    );
  }
}
