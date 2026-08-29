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
  private readonly statuses = new Map<RuntimeKind, AgentBackend>();

  public constructor(
    private readonly adapters: Partial<Record<RuntimeKind, AgentRuntime>>,
    public readonly defaultKind: RuntimeKind,
  ) {
    if (adapters[defaultKind] === undefined)
      throw new Error(
        `${LABELS[defaultKind]} is configured as the default agent backend but is not available.`,
      );
    for (const kind of ORDER) {
      const adapter = adapters[kind];
      this.statuses.set(
        kind,
        adapter === undefined
          ? {
              kind,
              available: false,
              reason: `${LABELS[kind]} is not configured on this machine.`,
            }
          : (adapter as ProbeableRuntime).probe === undefined
            ? { kind, available: true, reason: null }
            : {
                kind,
                available: false,
                reason: `${LABELS[kind]} availability has not been checked.`,
              },
      );
    }
  }

  public available(kind: RuntimeKind): boolean {
    return this.adapters[kind] !== undefined;
  }

  public kinds(): RuntimeKind[] {
    return ORDER.filter((kind) => this.available(kind));
  }

  /**
   * Asks each backend whether it can actually run, so the composer and every
   * persisted thread agree about availability before a thread is opened.
   */
  public async availability(): Promise<AgentBackend[]> {
    const backends: AgentBackend[] = [];
    for (const kind of ORDER) backends.push(await this.refresh(kind));
    return backends;
  }

  /** Returns the latest parsed/probed status without starting another probe. */
  public status(kind: RuntimeKind): AgentBackend {
    const status = this.statuses.get(kind);
    if (status === undefined)
      throw new Error(`No availability status exists for ${kind}.`);
    return status;
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
    const status = await this.refresh(kind);
    if (!status.available)
      throw new RuntimeFailure(
        "unavailable",
        status.reason ?? `${LABELS[kind]} is not available on this machine.`,
      );
    return this.get(kind);
  }

  /** Refreshes one backend's availability without requiring it to be usable. */
  public async refresh(kind: RuntimeKind): Promise<AgentBackend> {
    return await this.inspect(kind);
  }

  /** Records direct successful use as stronger evidence than an older probe. */
  public recordAvailable(kind: RuntimeKind): void {
    if (this.adapters[kind] === undefined) return;
    this.statuses.set(kind, { kind, available: true, reason: null });
  }

  private async inspect(kind: RuntimeKind): Promise<AgentBackend> {
    const adapter = this.adapters[kind];
    let status: AgentBackend;
    if (adapter === undefined) {
      status = {
        kind,
        available: false,
        reason: `${LABELS[kind]} is not configured on this machine.`,
      };
    } else {
      const probe = (adapter as ProbeableRuntime).probe;
      if (probe === undefined) {
        status = { kind, available: true, reason: null };
      } else {
        try {
          const result = await probe.call(adapter);
          status = {
            kind,
            available: result.available,
            reason: result.reason ?? null,
          };
        } catch (error) {
          status = {
            kind,
            available: false,
            reason:
              error instanceof Error
                ? error.message
                : `${LABELS[kind]} could not be reached.`,
          };
        }
      }
    }
    this.statuses.set(kind, status);
    return status;
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
