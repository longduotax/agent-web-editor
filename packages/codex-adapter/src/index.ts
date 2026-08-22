import {
  RuntimeFailure,
  type AgentRuntime,
  type OpenRuntimeSession,
  type PromptAcceptance,
  type PromptRecovery,
  type RuntimeEvent,
  type RuntimePromptDispatch,
  type RuntimeSessionDescriptor,
  type RuntimeSnapshot,
} from "@pi-web/agent-runtime";
import { z } from "zod";

import { CodexClient, type CodexTransport } from "./client.js";
import {
  mapNotification,
  sessionDescriptor,
  transcriptFromThread,
} from "./mapping.js";
import { spawnCodexTransport } from "./spawn.js";

export { spawnCodexTransport } from "./spawn.js";
export { CodexClient, type CodexTransport } from "./client.js";

/**
 * The workspace has no surface for answering an agent's permission prompt, so
 * approvals are disabled outright rather than routed nowhere. Anything Codex
 * would have asked about either proceeds inside the sandbox or fails visibly.
 * This is a property of the workspace and is deliberately not configurable.
 */
const APPROVAL_POLICY = "never";

export type CodexSandbox =
  "read-only" | "workspace-write" | "danger-full-access";

export interface CodexAgentRuntimeOptions {
  /** Executable to run; defaults to `codex` on PATH. */
  command?: string;
  /** File and network boundary for every Codex chat. */
  sandbox?: CodexSandbox;
  /** Test seam: supply a transport instead of spawning Codex. */
  connect?: () => Promise<CodexTransport>;
}

const DISCOVERY_PAGE_LIMIT = 100;
const DISCOVERY_MAX_PAGES = 50;

const threadEnvelopeSchema = z.object({ thread: z.object({ id: z.uuid() }) });
const threadListSchema = z.object({
  data: z.array(z.unknown()).default([]),
  nextCursor: z.string().nullish(),
});
const threadReadSchema = z.object({ thread: z.unknown() });
const turnEnvelopeSchema = z.object({
  turn: z.object({ id: z.string().min(1) }),
});
const threadScopedSchema = z.object({ threadId: z.string().min(1) });
const userMessageWithClientIdSchema = z.object({
  type: z.literal("userMessage"),
  clientId: z.string().nullish(),
  content: z.array(z.unknown()).default([]),
});
const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });
const turnsSchema = z.object({
  turns: z
    .array(z.object({ items: z.array(z.unknown()).default([]) }))
    .default([]),
});

export class CodexAgentRuntime implements AgentRuntime {
  private readonly client: CodexClient;
  private readonly sandbox: CodexSandbox;

  public constructor(options: CodexAgentRuntimeOptions = {}) {
    this.sandbox = options.sandbox ?? "workspace-write";
    const command = options.command ?? "codex";
    const connect =
      options.connect ??
      (() => spawnCodexTransport(command, ["app-server"], {}));
    this.client = new CodexClient({ connect });
    // Registered once for the whole process: every approval Codex raises is
    // declined immediately so no run can wait on an answer nothing can give.
    this.client.onServerRequest((method) =>
      isApprovalRequest(method) ? { decision: "denied" } : null,
    );
  }

  public async discover(
    projectPath: string,
  ): Promise<{ sessions: RuntimeSessionDescriptor[]; diagnostics: string[] }> {
    const sessions: RuntimeSessionDescriptor[] = [];
    const diagnostics: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < DISCOVERY_MAX_PAGES; page += 1) {
      const raw = await this.client.request("thread/list", {
        cwd: projectPath,
        limit: DISCOVERY_PAGE_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      });
      const parsed = threadListSchema.safeParse(raw);
      if (!parsed.success)
        throw new RuntimeFailure(
          "malformed",
          "Codex returned an unreadable session list.",
        );
      for (const entry of parsed.data.data) {
        const descriptor = sessionDescriptor(entry);
        if (descriptor === null)
          diagnostics.push("Skipped an unreadable Codex session entry.");
        else sessions.push(descriptor);
      }
      const next = parsed.data.nextCursor;
      if (next === null || next === undefined || next === "") break;
      cursor = next;
      if (page === DISCOVERY_MAX_PAGES - 1)
        diagnostics.push(
          "Stopped listing Codex sessions after reaching the page limit.",
        );
    }
    return { sessions, diagnostics };
  }

  public async create(
    projectPath: string,
    title?: string,
  ): Promise<{ sessionId: string }> {
    const raw = await this.client.request("thread/start", {
      cwd: projectPath,
      approvalPolicy: APPROVAL_POLICY,
      sandbox: this.sandbox,
    });
    const parsed = threadEnvelopeSchema.safeParse(raw);
    if (!parsed.success)
      throw new RuntimeFailure(
        "malformed",
        "Codex did not return a usable thread identifier.",
      );
    const sessionId = parsed.data.thread.id;
    if (title !== undefined && title !== "")
      await this.client.request("thread/name/set", {
        threadId: sessionId,
        name: title,
      });
    return { sessionId };
  }

  public async open(
    projectPath: string,
    sessionId: string,
  ): Promise<OpenRuntimeSession> {
    await this.client.request("thread/resume", {
      threadId: sessionId,
      cwd: projectPath,
      approvalPolicy: APPROVAL_POLICY,
      sandbox: this.sandbox,
    });
    return new CodexOpenSession(this.client, sessionId);
  }

  /**
   * Reports whether Codex can actually run here. Used to show the backend
   * disabled with a reason rather than letting chat creation fail (AGB-03).
   */
  public async probe(): Promise<{ available: boolean; reason?: string }> {
    try {
      await this.client.ready();
      return { available: true };
    } catch (error) {
      return {
        available: false,
        reason:
          error instanceof Error
            ? error.message
            : "Codex is not available on this machine.",
      };
    }
  }

  /** Releases the shared app-server process. */
  public close(): Promise<void> {
    return this.client.dispose();
  }
}

function isApprovalRequest(method: string): boolean {
  return /approval/i.test(method) || /elicitation/i.test(method);
}

class CodexOpenSession implements OpenRuntimeSession {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private bufferedEvents: RuntimeEvent[] | null = null;
  private activeTurnId: string | null = null;
  private settleActiveTurn:
    ((outcome: "completed" | "failed" | "interrupted") => void) | undefined;
  private disposed = false;
  private readonly unsubscribeNotifications: () => void;
  private readonly unsubscribeDisconnect: () => void;

  public constructor(
    private readonly client: CodexClient,
    public readonly id: string,
  ) {
    this.unsubscribeNotifications = client.onNotification((method, params) => {
      this.receive(method, params);
    });
    // A dead app-server can never complete an in-flight turn, so settle it as
    // failed rather than leaving the run hanging.
    this.unsubscribeDisconnect = client.onDisconnect((reason) => {
      this.emit({ type: "diagnostic", level: "error", message: reason });
      this.settle("failed");
    });
  }

  public async snapshot(): Promise<RuntimeSnapshot> {
    const raw = await this.client.request("thread/read", { threadId: this.id });
    const parsed = threadReadSchema.safeParse(raw);
    if (!parsed.success)
      throw new RuntimeFailure(
        "malformed",
        "Codex returned an unreadable thread.",
      );
    return {
      sessionId: this.id,
      transcript: transcriptFromThread(parsed.data.thread),
      diagnostics: [],
    };
  }

  public async prompt(
    text: string,
    dispatch?: RuntimePromptDispatch,
  ): Promise<PromptAcceptance> {
    if (this.disposed)
      throw new RuntimeFailure("unavailable", "Runtime session is closed.");
    if (this.bufferedEvents !== null)
      throw new RuntimeFailure("busy", "A prompt preflight is already active.");
    const buffer: RuntimeEvent[] = [];
    this.bufferedEvents = buffer;

    let settleResolve:
      ((outcome: "completed" | "failed" | "interrupted") => void) | undefined;
    const settlement = new Promise<"completed" | "failed" | "interrupted">(
      (resolve) => {
        settleResolve = resolve;
      },
    );

    const discardEvents = () => {
      if (this.bufferedEvents === buffer) this.bufferedEvents = null;
      buffer.length = 0;
    };
    const releaseEvents = () => {
      if (this.bufferedEvents !== buffer) return;
      this.bufferedEvents = null;
      for (const event of buffer) this.emit(event);
      buffer.length = 0;
    };

    let turnId: string;
    try {
      const raw = await this.client.request("turn/start", {
        threadId: this.id,
        input: [{ type: "text", text, text_elements: [] }],
        ...(dispatch === undefined ? {} : { clientUserMessageId: dispatch.id }),
      });
      const parsed = turnEnvelopeSchema.safeParse(raw);
      if (!parsed.success) throw new RuntimeFailure("malformed", "no turn");
      turnId = parsed.data.turn.id;
    } catch (error) {
      discardEvents();
      settleResolve?.("failed");
      return {
        accepted: false,
        reason:
          error instanceof Error ? error.message : "Codex refused the prompt.",
        settlement,
        releaseEvents,
        discardEvents,
      };
    }

    this.activeTurnId = turnId;
    this.settleActiveTurn = settleResolve;
    return { accepted: true, settlement, releaseEvents, discardEvents };
  }

  public async recoverPrompt(
    text: string,
    dispatch: RuntimePromptDispatch,
  ): Promise<PromptRecovery> {
    const raw = await this.client.request("thread/read", { threadId: this.id });
    const envelope = threadReadSchema.safeParse(raw);
    if (!envelope.success) return { outcome: "not_accepted" };
    const thread = turnsSchema.safeParse(envelope.data.thread);
    if (!thread.success) return { outcome: "not_accepted" };
    // Codex echoes the caller's clientUserMessageId back on the stored user
    // message, which is the durable evidence that this dispatch arrived.
    for (const turn of thread.data.turns)
      for (const item of turn.items) {
        const parsed = userMessageWithClientIdSchema.safeParse(item);
        if (!parsed.success || parsed.data.clientId !== dispatch.id) continue;
        const recorded = parsed.data.content
          .map((part) => textPartSchema.safeParse(part))
          .filter((part) => part.success)
          .map((part) => part.data.text)
          .join("\n");
        if (recorded === text) return { outcome: "accepted" };
      }
    return { outcome: "not_accepted" };
  }

  public async steer(text: string): Promise<void> {
    const turnId = this.activeTurnId;
    if (turnId === null)
      throw new RuntimeFailure(
        "rejected",
        "There is no running Codex turn to steer.",
      );
    await this.client.request("turn/steer", {
      threadId: this.id,
      input: [{ type: "text", text, text_elements: [] }],
      expectedTurnId: turnId,
    });
  }

  public async stop(): Promise<void> {
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    await this.client.request("turn/interrupt", {
      threadId: this.id,
      turnId,
    });
  }

  public subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeNotifications();
    this.unsubscribeDisconnect();
    this.listeners.clear();
    try {
      await this.client.request("thread/unsubscribe", { threadId: this.id });
    } catch {
      // Detaching is best effort; the shared process outlives this session.
    }
  }

  private receive(method: string, params: unknown): void {
    if (this.disposed) return;
    // One app-server serves every thread, so a notification is only ours when
    // it names this thread.
    const scoped = threadScopedSchema.safeParse(params);
    if (!scoped.success || scoped.data.threadId !== this.id) return;
    const event = mapNotification(method, params);
    if (event === null) return;
    if (event.type === "settled") {
      this.settle(event.outcome);
      return;
    }
    this.emit(event);
  }

  private settle(outcome: "completed" | "failed" | "interrupted"): void {
    const resolve = this.settleActiveTurn;
    this.settleActiveTurn = undefined;
    this.activeTurnId = null;
    resolve?.(outcome);
  }

  private emit(event: RuntimeEvent): void {
    if (this.bufferedEvents !== null) {
      this.bufferedEvents.push(event);
      return;
    }
    for (const listener of this.listeners) listener(event);
  }
}
