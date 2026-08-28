import { open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

import { TranscriptItemSchema, type TranscriptItem } from "@pi-web/contracts";
import { z } from "zod";

const MAX_LINE_BYTES = 4 * 1_048_576;
const MAX_SCAN_BYTES = 32 * 1_048_576;
const CHUNK_BYTES = 64 * 1_024;

const envelopeSchema = z.object({
  timestamp: z.string().optional(),
  type: z.string(),
  payload: z.unknown(),
});
const taskBoundarySchema = z.object({
  type: z.enum(["task_started", "task_complete", "turn_aborted"]),
  turn_id: z.string().min(1),
});
const metadataSchema = z
  .object({ turn_id: z.string().min(1), create_time: z.number().optional() })
  .optional();
const storedMessageSchema = z.object({
  type: z.literal("message"),
  id: z.string().min(1).max(200),
  internal_chat_message_metadata_passthrough: metadataSchema,
});
const customCallSchema = z.object({
  type: z.enum(["custom_tool_call", "function_call"]),
  id: z.string().min(1).max(200),
  call_id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  input: z.string(),
  internal_chat_message_metadata_passthrough: metadataSchema,
});
const outputPartSchema = z.object({ type: z.string(), text: z.string() });
const customOutputSchema = z.object({
  type: z.enum(["custom_tool_call_output", "function_call_output"]),
  call_id: z.string().min(1).max(200),
  output: z.union([z.string(), z.array(outputPartSchema)]),
  internal_chat_message_metadata_passthrough: metadataSchema,
});
const itemCompletedSchema = z.object({
  type: z.literal("item_completed"),
  turn_id: z.string().min(1),
  completed_at_ms: z.number().optional(),
  started_at_ms: z.number().optional(),
  item: z.looseObject({
    type: z.string(),
    id: z.string().min(1).max(200),
  }),
});

export interface PositionedEntry {
  position: number;
  source: "structured" | "response";
  item?: TranscriptItem;
  messageId?: string;
}

interface ReverseLine {
  line: string;
  start: number;
}

export interface RolloutTurnProjection {
  entries: readonly PositionedEntry[];
  reachedStart: boolean;
  incomplete: boolean;
  unknownDialect: boolean;
}

function contained(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return (
    fromRoot !== "" &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(fromRoot)
  );
}

export async function locateRollout(
  rawPath: unknown,
  configuredHome?: string,
): Promise<string> {
  if (
    typeof rawPath !== "string" ||
    !isAbsolute(rawPath) ||
    extname(rawPath) !== ".jsonl"
  )
    throw new Error("unavailable");
  const home = resolve(
    configuredHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
  );
  const sessions = await realpath(join(home, "sessions"));
  const path = await realpath(rawPath);
  const info = await stat(path);
  if (!info.isFile() || !contained(path, sessions))
    throw new Error("unavailable");
  return path;
}

async function* reverseLines(
  path: string,
  startOffset: number,
  maxScanBytes: number,
): AsyncGenerator<ReverseLine> {
  const handle = await open(path, "r");
  let position = startOffset;
  let carry = Buffer.alloc(0);
  let scanned = 0;
  try {
    while (position > 0 && scanned < maxScanBytes) {
      const length = Math.min(CHUNK_BYTES, position, maxScanBytes - scanned);
      const chunkStart = position - length;
      const chunk = Buffer.allocUnsafe(length);
      const result = await handle.read(chunk, 0, length, chunkStart);
      if (result.bytesRead !== length) throw new Error("short_read");
      scanned += length;
      const combined = Buffer.concat([chunk, carry]);
      const boundaries: number[] = [];
      for (let index = 0; index < combined.length; index += 1)
        if (combined[index] === 0x0a) boundaries.push(index);
      let end = combined.length;
      for (let index = boundaries.length - 1; index >= 0; index -= 1) {
        const newline = boundaries[index];
        if (newline === undefined) continue;
        const lineStart = newline + 1;
        if (lineStart < end) {
          const bytes = combined.subarray(lineStart, end);
          if (bytes.length <= MAX_LINE_BYTES)
            yield {
              line: bytes.toString("utf8").replace(/\r$/, ""),
              start: chunkStart + lineStart,
            };
        }
        end = newline;
      }
      carry = combined.subarray(0, end);
      if (carry.length > MAX_LINE_BYTES) carry = Buffer.alloc(0);
      position = chunkStart;
    }
    if (position === 0 && carry.length > 0 && carry.length <= MAX_LINE_BYTES)
      yield { line: carry.toString("utf8").replace(/\r$/, ""), start: 0 };
  } finally {
    await handle.close();
  }
}

function timestamp(
  value: string | undefined,
  milliseconds?: number,
): string | null {
  if (milliseconds !== undefined && Number.isFinite(milliseconds)) {
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function status(value: unknown): "running" | "completed" | "failed" {
  if (typeof value !== "string") return "completed";
  const normalized = value.toLowerCase();
  if (normalized.includes("progress") || normalized === "running")
    return "running";
  if (normalized === "completed" || normalized === "success")
    return "completed";
  return "failed";
}

function clamp(value: string, max: number): string {
  return value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 14))}\n…truncated…`;
}

function extractJsonObject(source: string): unknown {
  const start = source.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(source.slice(start, index + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function outputText(raw: z.infer<typeof customOutputSchema>): string {
  return typeof raw.output === "string"
    ? raw.output
    : raw.output.map((part) => part.text).join("\n");
}

function responseTool(
  call: z.infer<typeof customCallSchema>,
  output: z.infer<typeof customOutputSchema> | undefined,
  at: string | undefined,
): TranscriptItem {
  const parsedInput = z
    .looseObject({ cmd: z.string().optional(), workdir: z.string().optional() })
    .safeParse(extractJsonObject(call.input));
  const rawOutput = output === undefined ? "" : outputText(output);
  const outputBlob = z
    .looseObject({
      output: z.string().optional(),
      exit_code: z.number().int().optional(),
    })
    .safeParse(extractJsonObject(rawOutput));
  const exitCode = outputBlob.success
    ? (outputBlob.data.exit_code ?? null)
    : null;
  return TranscriptItemSchema.parse({
    id: call.id,
    kind: "tool",
    name: "shell",
    status:
      output === undefined
        ? "failed"
        : exitCode !== null && exitCode !== 0
          ? "failed"
          : "completed",
    input: clamp(
      parsedInput.success ? (parsedInput.data.cmd ?? call.input) : call.input,
      200_000,
    ),
    output: clamp(
      outputBlob.success ? (outputBlob.data.output ?? rawOutput) : rawOutput,
      1_000_000,
    ),
    cwd: parsedInput.success
      ? (parsedInput.data.workdir?.slice(0, 500) ?? null)
      : null,
    exitCode,
    timestamp: timestamp(at),
  });
}

function structuredTool(
  raw: z.infer<typeof itemCompletedSchema>,
  at: string | undefined,
): TranscriptItem | null {
  const item = raw.item as Record<string, unknown>;
  if (item.type === "CommandExecution") {
    const command = z
      .object({
        id: z.string(),
        command: z.union([z.string(), z.array(z.string())]).default(""),
        cwd: z.string().optional(),
        status: z.string().optional(),
        aggregated_output: z.string().optional(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        exit_code: z.number().int().optional(),
      })
      .safeParse(item);
    if (!command.success) return null;
    const output =
      command.data.aggregated_output ??
      `${command.data.stdout ?? ""}${command.data.stderr ?? ""}`;
    return TranscriptItemSchema.parse({
      id: command.data.id,
      kind: "tool",
      name: "shell",
      status: status(command.data.status),
      input: clamp(
        Array.isArray(command.data.command)
          ? command.data.command.join(" ")
          : command.data.command,
        200_000,
      ),
      output: clamp(output, 1_000_000),
      cwd: command.data.cwd?.slice(0, 500) ?? null,
      exitCode: command.data.exit_code ?? null,
      timestamp: timestamp(at, raw.completed_at_ms ?? raw.started_at_ms),
    });
  }
  if (item.type === "FileChange") {
    const change = z
      .object({
        id: z.string(),
        status: z.string().optional(),
        changes: z.record(
          z.string(),
          z.object({
            type: z.string().optional(),
            unified_diff: z.string().optional(),
            move_path: z.string().nullable().optional(),
          }),
        ),
      })
      .safeParse(item);
    if (!change.success) return null;
    const entries = Object.entries(change.data.changes);
    return TranscriptItemSchema.parse({
      id: change.data.id,
      kind: "tool",
      name: "apply_patch",
      status: status(change.data.status),
      input: clamp(
        entries
          .map(([path, value]) => `${value.type ?? "update"} ${path}`)
          .join("\n"),
        200_000,
      ),
      output: clamp(
        entries.map(([, value]) => value.unified_diff ?? "").join("\n"),
        1_000_000,
      ),
      cwd: null,
      exitCode: null,
      timestamp: timestamp(at, raw.completed_at_ms ?? raw.started_at_ms),
    });
  }
  if (item.type === "WebSearch") {
    const search = z
      .object({ id: z.string(), query: z.string().default("") })
      .safeParse(item);
    if (!search.success) return null;
    return TranscriptItemSchema.parse({
      id: search.data.id,
      kind: "tool",
      name: "web_search",
      status: "completed",
      input: clamp(search.data.query, 200_000),
      output: "",
      cwd: null,
      exitCode: null,
      timestamp: timestamp(at, raw.completed_at_ms ?? raw.started_at_ms),
    });
  }
  if (
    item.type === "UserMessage" ||
    item.type === "AgentMessage" ||
    item.type === "Reasoning" ||
    item.type === "Plan" ||
    item.type === "ContextCompaction"
  )
    return null;
  return TranscriptItemSchema.parse({
    id: raw.item.id,
    kind: "diagnostic",
    level: "info",
    text: `Unsupported stored Codex item type: ${raw.item.type}`.slice(
      0,
      2_000,
    ),
    timestamp: timestamp(at, raw.completed_at_ms ?? raw.started_at_ms),
  });
}

function structuredMessageType(type: string): boolean {
  return type === "UserMessage" || type === "AgentMessage";
}

/**
 * Lazily scans one confined rollout from newest to oldest. Sequential older
 * pages continue at the previous byte boundary, so the file is traversed once.
 */
export class RolloutReader {
  private offset: number;
  private structured = false;
  private recognizedDialect = false;
  private reachedStart = false;
  private incomplete = false;
  private readonly entries = new Map<string, PositionedEntry[]>();
  private readonly scannedTurns = new Set<string>();
  private readonly outputs = new Map<
    string,
    z.infer<typeof customOutputSchema>
  >();

  private constructor(
    private readonly path: string,
    size: number,
    private readonly maxScanBytes: number,
  ) {
    this.offset = size;
  }

  public static async open(
    path: string,
    maxScanBytes = MAX_SCAN_BYTES,
  ): Promise<RolloutReader> {
    const info = await stat(path);
    return new RolloutReader(path, info.size, maxScanBytes);
  }

  public async projectTurn(turnId: string): Promise<RolloutTurnProjection> {
    if (!this.scannedTurns.has(turnId) && !this.reachedStart)
      await this.scanTo(turnId);
    const entries = (this.entries.get(turnId) ?? [])
      .filter((entry) => !this.structured || entry.source === "structured")
      .sort((left, right) => left.position - right.position);
    return {
      entries,
      reachedStart: this.reachedStart,
      incomplete: this.incomplete,
      unknownDialect: !this.recognizedDialect,
    };
  }

  /** Releases a turn after its complete item range has been packed into a page. */
  public releaseTurn(turnId: string): void {
    this.entries.delete(turnId);
  }

  private add(turnId: string, entry: PositionedEntry): void {
    const values = this.entries.get(turnId) ?? [];
    values.push(entry);
    this.entries.set(turnId, values);
  }

  private async scanTo(targetTurnId: string): Promise<void> {
    let foundBoundary = false;
    for await (const line of reverseLines(
      this.path,
      this.offset,
      this.maxScanBytes,
    )) {
      this.offset = line.start;
      let raw: unknown;
      try {
        raw = JSON.parse(line.line);
      } catch {
        continue;
      }
      const envelope = envelopeSchema.safeParse(raw);
      if (
        !envelope.success ||
        typeof envelope.data.payload !== "object" ||
        envelope.data.payload === null
      )
        continue;
      const payload = envelope.data.payload;
      if (envelope.data.type === "event_msg") {
        const boundary = taskBoundarySchema.safeParse(payload);
        if (boundary.success) {
          if (
            boundary.data.type === "task_started" &&
            boundary.data.turn_id === targetTurnId
          ) {
            this.scannedTurns.add(targetTurnId);
            foundBoundary = true;
            break;
          }
          continue;
        }
        const completed = itemCompletedSchema.safeParse(payload);
        if (completed.success) {
          this.structured = true;
          this.recognizedDialect = true;
          if (structuredMessageType(completed.data.item.type))
            this.add(completed.data.turn_id, {
              position: line.start,
              source: "structured",
              messageId: completed.data.item.id,
            });
          else {
            const item = structuredTool(
              completed.data,
              envelope.data.timestamp,
            );
            if (item !== null)
              this.add(completed.data.turn_id, {
                position: line.start,
                source: "structured",
                item,
              });
          }
        }
      } else if (envelope.data.type === "response_item") {
        const output = customOutputSchema.safeParse(payload);
        if (output.success) {
          this.recognizedDialect = true;
          this.outputs.set(output.data.call_id, output.data);
          continue;
        }
        const call = customCallSchema.safeParse(payload);
        if (call.success) {
          this.recognizedDialect = true;
          const turnId =
            call.data.internal_chat_message_metadata_passthrough?.turn_id;
          if (turnId !== undefined) {
            this.add(turnId, {
              position: line.start,
              source: "response",
              item: responseTool(
                call.data,
                this.outputs.get(call.data.call_id),
                envelope.data.timestamp,
              ),
            });
            this.outputs.delete(call.data.call_id);
          }
          continue;
        }
        const message = storedMessageSchema.safeParse(payload);
        const turnId = message.success
          ? message.data.internal_chat_message_metadata_passthrough?.turn_id
          : undefined;
        if (message.success) this.recognizedDialect = true;
        if (message.success && turnId !== undefined)
          this.add(turnId, {
            position: line.start,
            source: "response",
            messageId: message.data.id,
          });
      }
    }
    if (!foundBoundary && this.offset === 0) this.reachedStart = true;
    else if (!foundBoundary) {
      this.incomplete = true;
      this.scannedTurns.add(targetTurnId);
    }
  }
}
