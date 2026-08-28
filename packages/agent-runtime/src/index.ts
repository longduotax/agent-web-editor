import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  TranscriptCursorSchema,
  TranscriptPageSchema,
  type TranscriptCursor,
  type TranscriptItem,
  type TranscriptPage,
} from "@pi-web/contracts";

export type RuntimeFailureCode =
  | "unavailable"
  | "malformed"
  | "unauthorized"
  | "busy"
  | "rejected"
  | "provider"
  | "tool"
  | "interrupted";

export class RuntimeFailure extends Error {
  public constructor(
    public readonly code: RuntimeFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuntimeFailure";
  }
}

export interface RuntimeSessionDescriptor {
  id: string;
  name: string | null;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
  preview: string;
  creationId?: string;
}

export interface RuntimeSnapshot {
  sessionId: string;
  transcript: TranscriptItem[];
  diagnostics: string[];
}

export type TitleSuggestion =
  { outcome: "available"; title: string } | { outcome: "unavailable" };

export type RuntimeEvent =
  | { type: "transcript"; item: TranscriptItem }
  | { type: "transcript-update"; item: TranscriptItem }
  | { type: "diagnostic"; level: "info" | "warning" | "error"; message: string }
  | {
      type: "settled";
      outcome: "completed" | "failed" | "interrupted";
      message?: string;
    };

export interface PromptAcceptance {
  accepted: boolean;
  reason?: string;
  settlement: Promise<"completed" | "failed" | "interrupted">;
  releaseEvents(): void;
  discardEvents(): void;
}

/** A durable caller-owned identity for a prompt that may need recovery. */
export interface RuntimePromptDispatch {
  id: string;
}

export type PromptRecovery =
  { outcome: "accepted" } | { outcome: "not_accepted" };

export interface OpenRuntimeSession {
  readonly id: string;
  snapshot(): Promise<RuntimeSnapshot>;
  /** Bounded latest history. Implementations should prefer this over snapshot. */
  latestTranscriptPage?(): Promise<TranscriptPage>;
  /** One bounded page immediately older than a runtime-owned cursor. */
  olderTranscriptPage?(cursor: TranscriptCursor): Promise<TranscriptPage>;
  prompt(
    text: string,
    dispatch?: RuntimePromptDispatch,
  ): Promise<PromptAcceptance>;
  recoverPrompt(
    text: string,
    dispatch: RuntimePromptDispatch,
  ): Promise<PromptRecovery>;
  steer(text: string): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  dispose(): Promise<void>;
}

export const TRANSCRIPT_PAGE_ITEM_LIMIT = 100;
export const TRANSCRIPT_PAGE_BYTE_TARGET = 1_048_576;

interface CursorPayload {
  version: 1;
  end: number;
  prefix: string;
}

function parseCursorPayload(value: unknown): CursorPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.end !== "number" ||
    !Number.isInteger(record.end) ||
    record.end < 0 ||
    typeof record.prefix !== "string" ||
    record.prefix.length !== 43
  )
    return null;
  return { version: 1, end: record.end, prefix: record.prefix };
}

/**
 * Small provider-neutral pager used by runtimes whose native SDK exposes a
 * complete in-process projection. It bounds every server/browser page by item
 * count and serialized bytes and authenticates append-stable cursors.
 */
export class TranscriptPager {
  private readonly key = randomBytes(32);

  public latest(items: readonly TranscriptItem[]): TranscriptPage {
    return this.packOlder(items, items.length, true);
  }

  public older(
    items: readonly TranscriptItem[],
    rawCursor: TranscriptCursor,
  ): TranscriptPage {
    const cursor = this.decode(rawCursor);
    if (
      cursor.end > items.length ||
      this.prefix(items, cursor.end) !== cursor.prefix
    )
      throw new RuntimeFailure("rejected", "The transcript position is stale.");
    return this.packOlder(items, cursor.end, false);
  }

  private packOlder(
    items: readonly TranscriptItem[],
    end: number,
    atLatest: boolean,
  ): TranscriptPage {
    let start = end;
    let bytes = 0;
    while (start > 0 && end - start < TRANSCRIPT_PAGE_ITEM_LIMIT) {
      const candidate = items[start - 1];
      if (candidate === undefined) break;
      const candidateBytes = Buffer.byteLength(JSON.stringify(candidate));
      if (start < end && bytes + candidateBytes > TRANSCRIPT_PAGE_BYTE_TARGET)
        break;
      start -= 1;
      bytes += candidateBytes;
      if (bytes > TRANSCRIPT_PAGE_BYTE_TARGET) break;
    }
    return TranscriptPageSchema.parse({
      items: items.slice(start, end),
      olderCursor: start === 0 ? null : this.encode(items, start),
      atLatest,
    });
  }

  private prefix(items: readonly TranscriptItem[], end: number): string {
    const hash = createHash("sha256");
    for (let index = 0; index < end; index += 1) {
      const item = items[index];
      if (item !== undefined) hash.update(item.id).update("\0");
    }
    return hash.digest("base64url");
  }

  private encode(
    items: readonly TranscriptItem[],
    end: number,
  ): TranscriptCursor {
    const payload = Buffer.from(
      JSON.stringify({ version: 1, end, prefix: this.prefix(items, end) }),
    ).toString("base64url");
    const signature = createHmac("sha256", this.key)
      .update(payload)
      .digest("base64url");
    return TranscriptCursorSchema.parse(
      Buffer.from(`${payload}.${signature}`).toString("base64url"),
    );
  }

  private decode(cursor: TranscriptCursor): CursorPayload {
    let combined: string;
    try {
      combined = Buffer.from(cursor, "base64url").toString("utf8");
    } catch {
      throw new RuntimeFailure(
        "rejected",
        "The transcript position is malformed.",
      );
    }
    const separator = combined.lastIndexOf(".");
    if (separator <= 0)
      throw new RuntimeFailure(
        "rejected",
        "The transcript position is malformed.",
      );
    const payload = combined.slice(0, separator);
    const signature = combined.slice(separator + 1);
    const expected = createHmac("sha256", this.key).update(payload).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "base64url");
    } catch {
      throw new RuntimeFailure(
        "rejected",
        "The transcript position is malformed.",
      );
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new RuntimeFailure("rejected", "The transcript position is stale.");
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new RuntimeFailure(
        "rejected",
        "The transcript position is malformed.",
      );
    }
    const parsed = parseCursorPayload(raw);
    if (parsed === null)
      throw new RuntimeFailure(
        "rejected",
        "The transcript position is malformed.",
      );
    return parsed;
  }
}

export interface AgentRuntime {
  suggestTitle?(projectPath: string, prompt: string): Promise<TitleSuggestion>;
  discover(
    projectPath: string,
  ): Promise<{ sessions: RuntimeSessionDescriptor[]; diagnostics: string[] }>;
  create(
    projectPath: string,
    title?: string,
    creationId?: string,
  ): Promise<{ sessionId: string }>;
  open(projectPath: string, sessionId: string): Promise<OpenRuntimeSession>;
}
