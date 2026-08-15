import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";

import {
  SessionManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptAcceptance,
  RuntimeEvent,
  RuntimeSessionDescriptor,
  RuntimeSnapshot,
} from "@pi-web/agent-runtime";
import { RuntimeFailure } from "@pi-web/agent-runtime";
import {
  TimestampSchema,
  TranscriptItemSchema,
  type TranscriptItem,
} from "@pi-web/contracts";
import { z } from "zod";

const sessionInfoSchema = z.object({
  id: z.uuid(),
  cwd: z.string(),
  name: z.string().optional(),
  path: z.string().min(1),
  created: z.date(),
  modified: z.date(),
  messageCount: z.number().int().nonnegative(),
  firstMessage: z.string(),
});

const baseEntrySchema = z.looseObject({
  id: z.string().min(1),
  type: z.string(),
  timestamp: z.string(),
});

const messageShapeSchema = z.looseObject({
  role: z.string(),
  content: z.unknown(),
});

function safeTimestamp(value: string): string | null {
  const parsed = TimestampSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 2_000_000);
  if (!Array.isArray(content)) return "";
  const output: string[] = [];
  for (const block of content) {
    if (typeof block === "string") output.push(block);
    else if (typeof block === "object" && block !== null) {
      const value = block as Record<string, unknown>;
      if (typeof value.text === "string") output.push(value.text);
      else if (typeof value.content === "string") output.push(value.content);
    }
  }
  return output.join("").slice(0, 2_000_000);
}

function translateMessage(
  id: string,
  timestamp: string | null,
  raw: unknown,
): TranscriptItem | null {
  const parsed = messageShapeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const role =
    parsed.data.role === "assistant"
      ? "assistant"
      : parsed.data.role === "system"
        ? "system"
        : parsed.data.role === "user"
          ? "user"
          : null;
  if (role === null) return null;
  return TranscriptItemSchema.parse({
    id,
    kind: "message",
    role,
    text: textFromContent(parsed.data.content),
    timestamp,
  });
}

function transcriptFromManager(manager: SessionManager): RuntimeSnapshot {
  const transcript: TranscriptItem[] = [];
  const diagnostics: string[] = [];
  for (const raw of manager.getBranch()) {
    const parsed = baseEntrySchema.safeParse(raw);
    if (!parsed.success) {
      diagnostics.push("A malformed native session entry was omitted.");
      continue;
    }
    if (parsed.data.type === "message") {
      const item = translateMessage(
        parsed.data.id,
        safeTimestamp(parsed.data.timestamp),
        parsed.data.message,
      );
      if (item === null)
        diagnostics.push("An unsupported native message was omitted.");
      else transcript.push(item);
    } else if (
      parsed.data.type === "compaction" &&
      typeof parsed.data.summary === "string"
    ) {
      transcript.push({
        id: parsed.data.id,
        kind: "diagnostic",
        level: "info",
        text: `Earlier context was compacted: ${parsed.data.summary.slice(0, 1_500)}`,
        timestamp: safeTimestamp(parsed.data.timestamp),
      });
    } else if (
      parsed.data.type === "custom_message" &&
      parsed.data.display === true
    ) {
      transcript.push({
        id: parsed.data.id,
        kind: "message",
        role: "system",
        text: textFromContent(parsed.data.content),
        timestamp: safeTimestamp(parsed.data.timestamp),
      });
    }
  }
  return { sessionId: manager.getSessionId(), transcript, diagnostics };
}

function mapEvent(event: AgentSessionEvent): RuntimeEvent | null {
  if (event.type === "message_end") {
    const item = translateMessage(
      `live-${randomUUID()}`,
      new Date().toISOString(),
      event.message,
    );
    return item === null
      ? {
          type: "diagnostic",
          level: "warning",
          message: "Pi emitted an unsupported message.",
        }
      : { type: "transcript", item };
  }
  if (event.type === "message_update") {
    const item = translateMessage(
      "streaming-assistant",
      new Date().toISOString(),
      event.message,
    );
    return item === null ? null : { type: "transcript-update", item };
  }
  if (event.type === "agent_settled")
    return { type: "settled", outcome: "completed" };
  if (event.type === "auto_retry_start")
    return {
      type: "diagnostic",
      level: "info",
      message: `Provider retry ${String(event.attempt)} of ${String(event.maxAttempts)}.`,
    };
  return null;
}

class PiOpenSession implements OpenRuntimeSession {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly unsubscribe: () => void;
  private bufferedEvents: RuntimeEvent[] | null = null;
  private disposed = false;

  public constructor(
    private readonly session: AgentSession,
    private readonly manager: SessionManager,
  ) {
    this.unsubscribe = session.subscribe((event) => {
      const mapped = mapEvent(event);
      if (mapped === null) return;
      if (this.bufferedEvents !== null) this.bufferedEvents.push(mapped);
      else for (const listener of this.listeners) listener(mapped);
    });
  }

  public get id(): string {
    return this.manager.getSessionId();
  }

  public snapshot(): Promise<RuntimeSnapshot> {
    return Promise.resolve(transcriptFromManager(this.manager));
  }

  public async prompt(text: string): Promise<PromptAcceptance> {
    if (this.disposed)
      throw new RuntimeFailure("unavailable", "Runtime session is closed.");
    if (this.bufferedEvents !== null)
      throw new RuntimeFailure("busy", "A prompt preflight is already active.");
    const buffer: RuntimeEvent[] = [];
    this.bufferedEvents = buffer;
    let preflightResolve: ((accepted: boolean) => void) | undefined;
    const preflight = new Promise<boolean>((resolve) => {
      preflightResolve = resolve;
    });
    let acceptedKnown = false;
    const operation = this.session.prompt(text, {
      preflightResult: (accepted) => {
        if (!acceptedKnown) {
          acceptedKnown = true;
          preflightResolve?.(accepted);
        }
      },
    });
    const settlement = operation
      .then(() => "completed" as const)
      .catch((error: unknown) => {
        if (!acceptedKnown) {
          acceptedKnown = true;
          preflightResolve?.(false);
        }
        if (error instanceof Error && /abort/i.test(error.message))
          return "interrupted" as const;
        return "failed" as const;
      });
    const accepted = await Promise.race([
      preflight,
      settlement.then((outcome) => outcome === "completed"),
    ]);
    const discardEvents = () => {
      if (this.bufferedEvents === buffer) this.bufferedEvents = null;
      buffer.length = 0;
    };
    const releaseEvents = () => {
      if (this.bufferedEvents !== buffer) return;
      this.bufferedEvents = null;
      for (const event of buffer)
        for (const listener of this.listeners) listener(event);
      buffer.length = 0;
    };
    if (!accepted) discardEvents();
    return { accepted, settlement, releaseEvents, discardEvents };
  }

  public async steer(text: string): Promise<void> {
    await this.session.steer(text);
  }
  public async stop(): Promise<void> {
    await this.session.abort();
  }
  public subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.unsubscribe();
      this.listeners.clear();
      this.session.dispose();
    }
    return Promise.resolve();
  }
}

export class PiAgentRuntime implements AgentRuntime {
  public async discover(
    projectPath: string,
  ): Promise<{ sessions: RuntimeSessionDescriptor[]; diagnostics: string[] }> {
    const canonical = await realpath(projectPath);
    const infos = await SessionManager.list(canonical);
    const sessions: RuntimeSessionDescriptor[] = [];
    const diagnostics: string[] = [];
    const seen = new Set<string>();
    for (const raw of infos) {
      const parsed = sessionInfoSchema.safeParse(raw);
      if (!parsed.success) {
        diagnostics.push("A malformed Pi session descriptor was omitted.");
        continue;
      }
      if (seen.has(parsed.data.id)) {
        diagnostics.push("A duplicate Pi session identifier was omitted.");
        continue;
      }
      seen.add(parsed.data.id);
      let owner: string;
      try {
        owner = await realpath(parsed.data.cwd);
      } catch {
        diagnostics.push("A Pi session has an unavailable project directory.");
        continue;
      }
      if (owner !== canonical) {
        diagnostics.push(
          "A Pi session belonging to another project was omitted.",
        );
        continue;
      }
      sessions.push({
        id: parsed.data.id,
        name: parsed.data.name ?? null,
        createdAt: parsed.data.created.toISOString(),
        modifiedAt: parsed.data.modified.toISOString(),
        messageCount: parsed.data.messageCount,
        preview: parsed.data.firstMessage.slice(0, 500),
      });
    }
    return { sessions, diagnostics };
  }

  public async create(projectPath: string): Promise<{ sessionId: string }> {
    const canonical = await realpath(projectPath);
    const manager = SessionManager.create(canonical);
    manager.appendSessionInfo("New thread");
    return { sessionId: manager.getSessionId() };
  }

  public async open(
    projectPath: string,
    sessionId: string,
  ): Promise<OpenRuntimeSession> {
    const canonical = await realpath(projectPath);
    const discovered = await SessionManager.list(canonical);
    const matches = discovered
      .map((item) => sessionInfoSchema.safeParse(item))
      .filter((result) => result.success && result.data.id === sessionId);
    if (matches.length !== 1)
      throw new RuntimeFailure(
        matches.length > 1 ? "malformed" : "unavailable",
        "The native session is unavailable.",
      );
    const descriptor = matches[0];
    if (!descriptor?.success)
      throw new RuntimeFailure(
        "malformed",
        "The native session descriptor is malformed.",
      );
    let owner: string;
    try {
      owner = await realpath(descriptor.data.cwd);
    } catch (error) {
      throw new RuntimeFailure(
        "unavailable",
        "The native session project is unavailable.",
        { cause: error },
      );
    }
    if (owner !== canonical)
      throw new RuntimeFailure(
        "unauthorized",
        "The native session does not belong to this project.",
      );
    try {
      const manager = SessionManager.open(
        descriptor.data.path,
        undefined,
        canonical,
      );
      const result = await createAgentSession({
        cwd: canonical,
        sessionManager: manager,
      });
      return new PiOpenSession(result.session, manager);
    } catch (error) {
      throw new RuntimeFailure(
        "unavailable",
        "The native session could not be opened.",
        { cause: error },
      );
    }
  }
}
