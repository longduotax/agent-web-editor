import { randomUUID } from "node:crypto";
import { realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptRecovery,
  RuntimePromptDispatch,
  PromptAcceptance,
  RuntimeEvent,
  RuntimeSessionDescriptor,
  RuntimeSnapshot,
  TitleSuggestion,
} from "@pi-web/agent-runtime";
import { RuntimeFailure, TranscriptPager } from "@pi-web/agent-runtime";
import {
  TimestampSchema,
  SessionIdSchema,
  TranscriptItemSchema,
  type TranscriptCursor,
  type TranscriptItem,
  type TranscriptPage,
} from "@pi-web/contracts";
import { z } from "zod";

const sessionInfoSchema = z.object({
  id: SessionIdSchema,
  cwd: z.string(),
  name: z.string().optional(),
  path: z.string().min(1),
  created: z.date(),
  modified: z.date(),
  messageCount: z.number().int().nonnegative(),
  firstMessage: z.string(),
});
const nativeHistorySchema = z.array(z.unknown());
const nativeSessionListSchema = z.array(z.unknown());
const nativeSessionNameSchema = z.string().max(200).nullable();
const createdSessionHeaderSchema = z.strictObject({
  type: z.literal("session"),
  version: z.literal(3),
  id: SessionIdSchema,
  timestamp: TimestampSchema,
  cwd: z.string().min(1),
  parentSession: z.string().optional(),
});
const createdSessionInfoSchema = z.strictObject({
  type: z.literal("session_info"),
  id: z.string().min(1).max(200),
  parentId: z.null(),
  timestamp: TimestampSchema,
  name: z.string().min(1).max(200),
});
const createdSessionEntriesSchema = z.tuple([createdSessionInfoSchema]);

export interface NamingModelSelector {
  readonly provider: string;
  readonly id: string;
}

const namingModelSelectorSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
});
const namingModelDescriptorSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
  cost: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
  }),
});
type NamingModelDescriptor = z.infer<typeof namingModelDescriptorSchema>;
const namingModelHandleSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  api: z.string().min(1),
  baseUrl: z.string().min(1),
  reasoning: z.boolean(),
  input: z.array(z.enum(["text", "image"])).min(1),
  cost: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
  }),
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
});
type NamingModelHandle = z.infer<typeof namingModelHandleSchema>;
const namingCompletionSchema = z.object({
  stopReason: z.literal("stop"),
  content: z.tuple([
    z.strictObject({ type: z.literal("text"), text: z.string() }),
  ]),
});

const generatedTitleSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((value) => !/[\r\n]/.test(value), "Title must be one line.");

export function parseGeneratedTitle(value: unknown): TitleSuggestion {
  if (typeof value !== "string") return { outcome: "unavailable" };
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`*_#\s]+|["'`*_#\s.!?:;]+$/g, "")
    .trim();
  const title = generatedTitleSchema.safeParse(normalized);
  return title.success
    ? { outcome: "available", title: title.data }
    : { outcome: "unavailable" };
}

function parseNamingModelHandle(value: unknown): NamingModelHandle | null {
  const parsed = namingModelHandleSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    provider: parsed.data.provider,
    id: parsed.data.id,
    name: parsed.data.name,
    api: parsed.data.api,
    baseUrl: parsed.data.baseUrl,
    reasoning: parsed.data.reasoning,
    input: [...parsed.data.input],
    cost: {
      input: parsed.data.cost.input,
      output: parsed.data.cost.output,
      cacheRead: parsed.data.cost.cacheRead,
      cacheWrite: parsed.data.cost.cacheWrite,
    },
    contextWindow: parsed.data.contextWindow,
    maxTokens: parsed.data.maxTokens,
  };
}

type SessionInfo = z.infer<typeof sessionInfoSchema>;

interface NativeSessionDescriptor {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly messageCount: number;
  readonly preview: string;
  readonly path: string;
  readonly creationId: string | undefined;
}

const creationMarker = / \[pi-create:([0-9a-f-]{36})\]$/;
const initialPromptDispatchType = "pi-web-initial-prompt-dispatch";
const initialPromptDispatchEntrySchema = z.object({
  type: z.literal("custom"),
  customType: z.literal(initialPromptDispatchType),
  data: z.object({ id: z.uuid(), text: z.string() }),
});

function parseSessionName(value: string | null): {
  name: string | null;
  creationId: string | undefined;
} {
  if (value === null) return { name: null, creationId: undefined };
  const match = creationMarker.exec(value);
  if (match === null) return { name: value, creationId: undefined };
  const creationId = z.uuid().safeParse(match[1]);
  return creationId.success
    ? { name: value.slice(0, match.index), creationId: creationId.data }
    : { name: value, creationId: undefined };
}

function parseNativeHistory(value: unknown): unknown[] {
  const parsed = nativeHistorySchema.safeParse(value);
  if (!parsed.success)
    throw new RuntimeFailure(
      "malformed",
      "The native session history is malformed.",
    );
  return parsed.data;
}

async function listNativeSessions(
  projectPath: string,
  agentDirectory: string,
): Promise<unknown[]> {
  const result = await SessionManager.list(
    projectPath,
    defaultSessionDirectory(agentDirectory, projectPath),
  );
  const parsed = nativeSessionListSchema.safeParse(result);
  if (!parsed.success)
    throw new RuntimeFailure(
      "malformed",
      "The native session list is malformed.",
    );
  return parsed.data;
}

function parseAgentDirectory(value: unknown): string {
  if (value === undefined) return join(homedir(), ".pi", "agent");
  if (typeof value !== "string" || value.trim() === "" || !isAbsolute(value))
    throw new RuntimeFailure(
      "malformed",
      "The Pi agent directory configuration is invalid.",
    );
  return resolve(value);
}

function defaultSessionDirectory(
  agentDirectory: string,
  projectPath: string,
): string {
  const safeProjectPath = `--${projectPath
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;
  return join(agentDirectory, "sessions", safeProjectPath);
}

function isContainedBy(path: string, directory: string): boolean {
  const pathFromDirectory = relative(directory, path);
  return (
    pathFromDirectory.length > 0 &&
    !pathFromDirectory.startsWith(
      `..${process.platform === "win32" ? "\\" : "/"}`,
    ) &&
    pathFromDirectory !== ".." &&
    !isAbsolute(pathFromDirectory)
  );
}

async function parseNativeSessionDescriptor(
  projectPath: string,
  agentDirectory: string,
  descriptor: SessionInfo,
): Promise<NativeSessionDescriptor> {
  let owner: string;
  try {
    owner = await realpath(descriptor.cwd);
  } catch (error) {
    throw new RuntimeFailure(
      "unavailable",
      "The native session project is unavailable.",
      { cause: error },
    );
  }
  if (owner !== projectPath)
    throw new RuntimeFailure(
      "unauthorized",
      "The native session does not belong to this project.",
    );
  if (!isAbsolute(descriptor.path))
    throw new RuntimeFailure(
      "malformed",
      "The native session descriptor is malformed.",
    );
  let sessionPath: string;
  try {
    sessionPath = await realpath(descriptor.path);
    const info = await stat(sessionPath);
    if (!info.isFile() || extname(sessionPath) !== ".jsonl")
      throw new RuntimeFailure(
        "malformed",
        "The native session descriptor is malformed.",
      );
  } catch (error) {
    if (error instanceof RuntimeFailure) throw error;
    throw new RuntimeFailure(
      "unavailable",
      "The native session is unavailable.",
      { cause: error },
    );
  }
  let expectedDirectory: string;
  try {
    expectedDirectory = await realpath(
      defaultSessionDirectory(agentDirectory, projectPath),
    );
  } catch (error) {
    throw new RuntimeFailure(
      "malformed",
      "The native session descriptor is malformed.",
      { cause: error },
    );
  }
  if (!isContainedBy(sessionPath, expectedDirectory))
    throw new RuntimeFailure(
      "malformed",
      "The native session descriptor is malformed.",
    );
  const name = parseSessionName(
    nativeSessionNameSchema.parse(descriptor.name ?? null),
  );
  return {
    id: descriptor.id,
    name: name.name,
    createdAt: descriptor.created.toISOString(),
    modifiedAt: descriptor.modified.toISOString(),
    messageCount: descriptor.messageCount,
    preview: descriptor.firstMessage.slice(0, 500),
    path: sessionPath,
    creationId: name.creationId,
  };
}

function sessionIdFromManager(manager: SessionManager): string {
  const parsed = SessionIdSchema.safeParse(manager.getSessionId());
  if (!parsed.success)
    throw new RuntimeFailure(
      "malformed",
      "The native session returned an invalid identifier.",
    );
  return parsed.data;
}

async function persistNewSession(
  manager: SessionManager,
  projectPath: string,
  agentDirectory: string,
): Promise<string> {
  const sessionId = sessionIdFromManager(manager);
  const header = createdSessionHeaderSchema.safeParse(manager.getHeader());
  const entries = createdSessionEntriesSchema.safeParse(manager.getEntries());
  const rawSessionPath = manager.getSessionFile();
  if (
    !header.success ||
    !entries.success ||
    header.data.id !== sessionId ||
    header.data.cwd !== projectPath ||
    header.data.parentSession !== undefined ||
    typeof rawSessionPath !== "string" ||
    !isAbsolute(rawSessionPath) ||
    extname(rawSessionPath) !== ".jsonl"
  )
    throw new RuntimeFailure(
      "malformed",
      "The native session returned malformed creation state.",
    );

  try {
    const expectedDirectory = await realpath(
      defaultSessionDirectory(agentDirectory, projectPath),
    );
    const parentDirectory = await realpath(dirname(rawSessionPath));
    if (parentDirectory !== expectedDirectory)
      throw new RuntimeFailure(
        "malformed",
        "The native session returned malformed creation state.",
      );
    const sessionPath = join(expectedDirectory, basename(rawSessionPath));
    const jsonl = [header.data, ...entries.data]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    await writeFile(sessionPath, `${jsonl}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error instanceof RuntimeFailure) throw error;
    throw new RuntimeFailure(
      "unavailable",
      "The native session could not be created.",
      { cause: error },
    );
  }
  return sessionId;
}

const baseEntrySchema = z.looseObject({
  id: z.string().min(1),
  type: z.string(),
  timestamp: z.string(),
});

const messageShapeSchema = z.looseObject({
  role: z.string(),
  content: z.unknown(),
});
const toolCallBlockSchema = z.looseObject({
  type: z.literal("toolCall"),
  id: z.string().min(1).max(200),
  name: z.string().min(1),
  arguments: z.unknown(),
});
const toolResultMessageSchema = z.looseObject({
  role: z.literal("toolResult"),
  toolCallId: z.string().min(1).max(200),
  toolName: z.string().min(1),
  content: z.unknown(),
  isError: z.boolean(),
  details: z.unknown().optional(),
});
const bashExecutionMessageSchema = z.looseObject({
  role: z.literal("bashExecution"),
  command: z.string(),
  output: z.string(),
  exitCode: z.number().int().nullable().optional(),
  cancelled: z.boolean(),
});
const preflightAcceptedSchema = z.boolean();

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

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function transcriptId(base: string, suffix: string): string {
  return `${base.slice(0, Math.max(1, 200 - suffix.length))}${suffix}`;
}

function toolMetadata(value: unknown): {
  cwd: string | null;
  exitCode: number | null;
} {
  const parsed = z
    .looseObject({
      cwd: z.string().max(500).optional(),
      exitCode: z.number().int().nullable().optional(),
    })
    .safeParse(value);
  if (!parsed.success) return { cwd: null, exitCode: null };
  return {
    cwd: parsed.data.cwd ?? null,
    exitCode: parsed.data.exitCode ?? null,
  };
}

function translateToolCall(
  id: string,
  timestamp: string | null,
  raw: unknown,
): TranscriptItem | null {
  const parsed = toolCallBlockSchema.safeParse(raw);
  if (!parsed.success) return null;
  const item = TranscriptItemSchema.safeParse({
    id,
    kind: "tool",
    name: parsed.data.name,
    status: "running",
    input: textFromUnknown(parsed.data.arguments).slice(0, 200_000),
    output: "",
    cwd: toolMetadata(parsed.data.arguments).cwd,
    exitCode: null,
    timestamp,
  });
  return item.success ? item.data : null;
}

function translateToolResult(
  id: string,
  timestamp: string | null,
  raw: unknown,
  inputs: ReadonlyMap<string, string>,
): { item: TranscriptItem; toolCallId: string } | null {
  const parsed = toolResultMessageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const metadata = toolMetadata(parsed.data.details);
  const item = TranscriptItemSchema.safeParse({
    id,
    kind: "tool",
    name: parsed.data.toolName,
    status: parsed.data.isError ? "failed" : "completed",
    input: (inputs.get(parsed.data.toolCallId) ?? "").slice(0, 200_000),
    output: textFromContent(parsed.data.content),
    cwd: metadata.cwd,
    exitCode: metadata.exitCode,
    timestamp,
  });
  return item.success
    ? { item: item.data, toolCallId: parsed.data.toolCallId }
    : null;
}

function translateBashExecution(
  id: string,
  timestamp: string | null,
  raw: unknown,
): TranscriptItem | null {
  const parsed = bashExecutionMessageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const exitCode = parsed.data.exitCode ?? null;
  const item = TranscriptItemSchema.safeParse({
    id,
    kind: "tool",
    name: "bash",
    status:
      parsed.data.cancelled || (exitCode !== null && exitCode !== 0)
        ? "failed"
        : "completed",
    input: parsed.data.command.slice(0, 200_000),
    output: parsed.data.output.slice(0, 1_000_000),
    cwd: null,
    exitCode,
    timestamp,
  });
  return item.success ? item.data : null;
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
  const toolInputs = new Map<string, string>();
  const toolIndexes = new Map<string, number | null>();
  for (const raw of parseNativeHistory(manager.getBranch())) {
    const parsed = baseEntrySchema.safeParse(raw);
    if (!parsed.success) {
      diagnostics.push("A malformed native session entry was omitted.");
      continue;
    }
    if (parsed.data.type === "message") {
      const timestamp = safeTimestamp(parsed.data.timestamp);
      const result = translateToolResult(
        parsed.data.id,
        timestamp,
        parsed.data.message,
        toolInputs,
      );
      if (result !== null) {
        const callIndex = toolIndexes.get(result.toolCallId);
        if (callIndex === undefined || callIndex === null)
          transcript.push(result.item);
        else {
          transcript[callIndex] = result.item;
          toolIndexes.delete(result.toolCallId);
        }
        continue;
      }
      const bash = translateBashExecution(
        parsed.data.id,
        timestamp,
        parsed.data.message,
      );
      if (bash !== null) {
        transcript.push(bash);
        continue;
      }
      const item = translateMessage(
        parsed.data.id,
        timestamp,
        parsed.data.message,
      );
      if (item === null)
        diagnostics.push("An unsupported native message was omitted.");
      else {
        transcript.push(item);
        if (
          parsed.data.message !== null &&
          typeof parsed.data.message === "object"
        ) {
          const content = z
            .looseObject({
              role: z.literal("assistant"),
              content: z.array(z.unknown()),
            })
            .safeParse(parsed.data.message);
          if (content.success)
            content.data.content.forEach((block, index) => {
              const tool = translateToolCall(
                transcriptId(parsed.data.id, `:tool:${String(index)}`),
                safeTimestamp(parsed.data.timestamp),
                block,
              );
              if (tool === null) {
                const isTool = z
                  .looseObject({ type: z.literal("toolCall") })
                  .safeParse(block);
                if (isTool.success)
                  diagnostics.push(
                    "A malformed native tool activity was omitted.",
                  );
                return;
              }
              const call = toolCallBlockSchema.safeParse(block);
              const toolIndex = transcript.push(tool) - 1;
              if (call.success && tool.kind === "tool") {
                if (toolIndexes.has(call.data.id)) {
                  toolIndexes.set(call.data.id, null);
                  toolInputs.delete(call.data.id);
                } else {
                  toolIndexes.set(call.data.id, toolIndex);
                  toolInputs.set(call.data.id, tool.input);
                }
              }
            });
        }
      }
    } else if (
      parsed.data.type === "compaction" &&
      typeof parsed.data.summary === "string"
    ) {
      const item = TranscriptItemSchema.safeParse({
        id: parsed.data.id,
        kind: "diagnostic",
        level: "info",
        text: `Earlier context was compacted: ${parsed.data.summary.slice(0, 1_500)}`,
        timestamp: safeTimestamp(parsed.data.timestamp),
      });
      if (item.success) transcript.push(item.data);
      else diagnostics.push("A malformed native session entry was omitted.");
    } else if (
      parsed.data.type === "custom_message" &&
      parsed.data.display === true
    ) {
      const item = TranscriptItemSchema.safeParse({
        id: parsed.data.id,
        kind: "message",
        role: "system",
        text: textFromContent(parsed.data.content),
        timestamp: safeTimestamp(parsed.data.timestamp),
      });
      if (item.success) transcript.push(item.data);
      else diagnostics.push("A malformed native session entry was omitted.");
    }
  }
  return { sessionId: sessionIdFromManager(manager), transcript, diagnostics };
}

const eventSchema = z.looseObject({ type: z.string() });
const retryEventSchema = z.looseObject({
  type: z.literal("auto_retry_start"),
  attempt: z.number().int().nonnegative().max(1_000),
  maxAttempts: z.number().int().positive().max(1_000),
});

function mapEvent(event: unknown): RuntimeEvent {
  const parsed = eventSchema.safeParse(event);
  if (!parsed.success)
    return {
      type: "diagnostic",
      level: "warning",
      message: "Pi emitted an unsupported event.",
    };
  if (parsed.data.type === "message_end") {
    const item = translateMessage(
      `live-${randomUUID()}`,
      new Date().toISOString(),
      parsed.data.message,
    );
    return item === null
      ? {
          type: "diagnostic",
          level: "warning",
          message: "Pi emitted an unsupported message.",
        }
      : { type: "transcript", item };
  }
  if (parsed.data.type === "message_update") {
    const item = translateMessage(
      "streaming-assistant",
      new Date().toISOString(),
      parsed.data.message,
    );
    return item === null
      ? {
          type: "diagnostic",
          level: "warning",
          message: "Pi emitted an unsupported message.",
        }
      : { type: "transcript-update", item };
  }
  if (parsed.data.type === "agent_settled")
    return { type: "settled", outcome: "completed" };
  if (parsed.data.type === "auto_retry_start") {
    const retry = retryEventSchema.safeParse(event);
    if (!retry.success)
      return {
        type: "diagnostic",
        level: "warning",
        message: "Pi emitted an unsupported event.",
      };
    return {
      type: "diagnostic",
      level: "info",
      message: `Provider retry ${String(retry.data.attempt)} of ${String(retry.data.maxAttempts)}.`,
    };
  }
  return {
    type: "diagnostic",
    level: "warning",
    message: "Pi emitted an unsupported event.",
  };
}

class PiOpenSession implements OpenRuntimeSession {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly pager = new TranscriptPager();
  private readonly unsubscribe: () => void;
  private bufferedEvents: RuntimeEvent[] | null = null;
  private disposed = false;

  public constructor(
    private readonly session: AgentSession,
    private readonly manager: SessionManager,
  ) {
    this.unsubscribe = session.subscribe((event) => {
      const mapped = mapEvent(event);
      if (this.bufferedEvents !== null) this.bufferedEvents.push(mapped);
      else for (const listener of this.listeners) listener(mapped);
    });
  }

  public get id(): string {
    return sessionIdFromManager(this.manager);
  }

  public snapshot(): Promise<RuntimeSnapshot> {
    return Promise.resolve().then(() => transcriptFromManager(this.manager));
  }

  public latestTranscriptPage(): Promise<TranscriptPage> {
    return this.snapshot().then((snapshot) =>
      this.pager.latest(snapshot.transcript),
    );
  }

  public olderTranscriptPage(
    cursor: TranscriptCursor,
  ): Promise<TranscriptPage> {
    return this.snapshot().then((snapshot) =>
      this.pager.older(snapshot.transcript, cursor),
    );
  }

  public async prompt(
    text: string,
    dispatch?: RuntimePromptDispatch,
  ): Promise<PromptAcceptance> {
    if (dispatch !== undefined) {
      z.uuid().parse(dispatch.id);
      if (!this.hasPromptDispatch(dispatch, text))
        this.manager.appendCustomEntry(initialPromptDispatchType, {
          id: dispatch.id,
          text,
        });
    }
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
          const parsed = preflightAcceptedSchema.safeParse(accepted);
          preflightResolve?.(parsed.success ? parsed.data : false);
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

  public async recoverPrompt(
    text: string,
    dispatch: RuntimePromptDispatch,
  ): Promise<PromptRecovery> {
    z.uuid().parse(dispatch.id);
    const snapshot = await this.snapshot();
    return this.hasPromptDispatch(dispatch, text) &&
      snapshot.transcript.some(
        (item) =>
          item.kind === "message" && item.role === "user" && item.text === text,
      )
      ? { outcome: "accepted" }
      : { outcome: "not_accepted" };
  }

  private hasPromptDispatch(
    dispatch: RuntimePromptDispatch,
    text: string,
  ): boolean {
    return parseNativeHistory(this.manager.getBranch()).some((entry) => {
      const parsed = initialPromptDispatchEntrySchema.safeParse(entry);
      return (
        parsed.success &&
        parsed.data.data.id === dispatch.id &&
        parsed.data.data.text === text
      );
    });
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
  private readonly agentDirectory: string;
  private readonly namingModel: NamingModelSelector | null;
  private modelRuntime: Promise<ModelRuntime> | undefined;

  public constructor(
    agentDirectory: unknown = process.env.PI_CODING_AGENT_DIR,
    namingModel: NamingModelSelector | null = null,
  ) {
    this.agentDirectory = parseAgentDirectory(agentDirectory);
    this.namingModel = namingModel;
  }

  public async suggestTitle(
    projectPath: string,
    prompt: string,
  ): Promise<TitleSuggestion> {
    try {
      const canonical = await realpath(projectPath);
      const runtime = await (this.modelRuntime ??= ModelRuntime.create({
        authPath: join(this.agentDirectory, "auth.json"),
        modelsPath: join(this.agentDirectory, "models.json"),
        allowModelNetwork: false,
      }));
      const rawAvailable: unknown = await runtime.getAvailable(undefined, {
        signal: AbortSignal.timeout(5_000),
      });
      const available = z
        .array(namingModelDescriptorSchema)
        .parse(rawAvailable);
      let model: NamingModelDescriptor | undefined;
      const explicitNamingModel = this.namingModel;
      if (explicitNamingModel !== null) {
        model = available.find(
          (candidate) =>
            candidate.provider === explicitNamingModel.provider &&
            candidate.id === explicitNamingModel.id,
        );
      } else {
        const settings = SettingsManager.create(canonical, this.agentDirectory);
        const defaultSelector = namingModelSelectorSchema.safeParse({
          provider: settings.getDefaultProvider(),
          id: settings.getDefaultModel(),
        });
        if (!defaultSelector.success) return { outcome: "unavailable" };
        const rawDefaultModel = runtime.getModel(
          defaultSelector.data.provider,
          defaultSelector.data.id,
        );
        const defaultModel =
          namingModelDescriptorSchema.safeParse(rawDefaultModel).data;
        if (
          defaultModel?.provider === defaultSelector.data.provider &&
          defaultModel.id === defaultSelector.data.id
        ) {
          const defaultCost =
            defaultModel.cost.input * 1_000 + defaultModel.cost.output * 32;
          model = available
            .filter(
              (candidate) =>
                candidate.provider === defaultSelector.data.provider &&
                candidate.id !== defaultSelector.data.id &&
                candidate.cost.input * 1_000 + candidate.cost.output * 32 <
                  defaultCost,
            )
            .sort((left, right) => {
              const leftCost = left.cost.input * 1_000 + left.cost.output * 32;
              const rightCost =
                right.cost.input * 1_000 + right.cost.output * 32;
              return leftCost - rightCost || left.id.localeCompare(right.id);
            })[0];
        }
      }
      if (model === undefined) return { outcome: "unavailable" };
      const rawHandle = runtime.getModel(model.provider, model.id);
      const handle = parseNamingModelHandle(rawHandle);
      if (handle === null) return { outcome: "unavailable" };
      const resolved = namingModelDescriptorSchema.safeParse(handle);
      if (
        !resolved.success ||
        resolved.data.provider !== model.provider ||
        resolved.data.id !== model.id
      )
        return { outcome: "unavailable" };
      const rawResponse: unknown = await runtime.completeSimple(
        handle,
        {
          systemPrompt:
            "Return only a concise 3-7 word title summarizing the user's coding task. No quotes, markdown, or punctuation suffix.",
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        },
        {
          maxTokens: 32,
          cacheRetention: "none",
          signal: AbortSignal.timeout(5_000),
        },
      );
      const response = namingCompletionSchema.safeParse(rawResponse);
      if (!response.success) return { outcome: "unavailable" };
      return parseGeneratedTitle(response.data.content[0].text);
    } catch {
      return { outcome: "unavailable" };
    }
  }

  public async discover(
    projectPath: string,
  ): Promise<{ sessions: RuntimeSessionDescriptor[]; diagnostics: string[] }> {
    const canonical = await realpath(projectPath);
    const infos = await listNativeSessions(canonical, this.agentDirectory);
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
      try {
        const descriptor = await parseNativeSessionDescriptor(
          canonical,
          this.agentDirectory,
          parsed.data,
        );
        sessions.push({
          id: descriptor.id,
          name: descriptor.name,
          createdAt: descriptor.createdAt,
          modifiedAt: descriptor.modifiedAt,
          messageCount: descriptor.messageCount,
          preview: descriptor.preview,
          ...(descriptor.creationId === undefined
            ? {}
            : { creationId: descriptor.creationId }),
        });
      } catch (error) {
        if (error instanceof RuntimeFailure && error.code === "unauthorized")
          diagnostics.push(
            "A Pi session belonging to another project was omitted.",
          );
        else if (
          error instanceof RuntimeFailure &&
          error.message === "The native session project is unavailable."
        )
          diagnostics.push(
            "A Pi session has an unavailable project directory.",
          );
        else if (
          error instanceof RuntimeFailure &&
          error.code === "unavailable"
        )
          diagnostics.push("A Pi session is unavailable.");
        else diagnostics.push("A malformed Pi session descriptor was omitted.");
      }
    }
    return { sessions, diagnostics };
  }

  public async create(
    projectPath: string,
    title = "New thread",
    creationId?: string,
  ): Promise<{ sessionId: string }> {
    const canonical = await realpath(projectPath);
    if (creationId !== undefined) {
      const discovered = await this.discover(canonical);
      const existing = discovered.sessions.find(
        (session) => session.creationId === creationId,
      );
      if (existing !== undefined) return { sessionId: existing.id };
    }
    const manager = SessionManager.create(
      canonical,
      defaultSessionDirectory(this.agentDirectory, canonical),
    );
    manager.appendSessionInfo(
      creationId === undefined ? title : `${title} [pi-create:${creationId}]`,
    );
    return {
      sessionId: await persistNewSession(
        manager,
        canonical,
        this.agentDirectory,
      ),
    };
  }

  public async open(
    projectPath: string,
    sessionId: string,
  ): Promise<OpenRuntimeSession> {
    const canonical = await realpath(projectPath);
    const discovered = await listNativeSessions(canonical, this.agentDirectory);
    const matches: SessionInfo[] = [];
    for (const raw of discovered) {
      const parsed = sessionInfoSchema.safeParse(raw);
      if (parsed.success && parsed.data.id === sessionId)
        matches.push(parsed.data);
    }
    if (matches.length !== 1)
      throw new RuntimeFailure(
        matches.length > 1 ? "malformed" : "unavailable",
        "The native session is unavailable.",
      );
    const listedDescriptor = matches[0];
    if (listedDescriptor === undefined)
      throw new RuntimeFailure(
        "unavailable",
        "The native session is unavailable.",
      );
    const descriptor = await parseNativeSessionDescriptor(
      canonical,
      this.agentDirectory,
      listedDescriptor,
    );
    try {
      const manager = SessionManager.open(
        descriptor.path,
        undefined,
        canonical,
      );
      const result = await createAgentSession({
        cwd: canonical,
        agentDir: this.agentDirectory,
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
