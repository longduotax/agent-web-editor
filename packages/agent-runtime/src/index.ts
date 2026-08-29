import type {
  ChatImageId,
  ChatImageMimeType,
  ImageInputCapability,
  TranscriptItem,
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
  imageInput?: ImageInputCapability;
}

export interface RuntimeImageInput {
  mimeType: ChatImageMimeType;
  data: Uint8Array;
  /** SHA-256 of the bounded source bytes, used for idempotency and recovery. */
  digest: string;
}

export interface RuntimeUserInput {
  text: string;
  images: RuntimeImageInput[];
}

export interface RuntimeImageContent {
  id: ChatImageId;
  mimeType: ChatImageMimeType;
  data: string;
}

export type TitleSuggestion =
  { outcome: "available"; title: string } | { outcome: "unavailable" };

/**
 * The diagnostics a runtime can raise, named rather than merely graded.
 *
 * - `provider_retry` — the model provider failed and Pi is retrying. The run
 *   is alive but stalled, which from the outside is indistinguishable from a
 *   slow one. This is the only diagnostic the user is better off seeing.
 * - `unsupported_event` / `unsupported_message` — the adapter did not
 *   recognise something Pi emitted. Routine (tool activity lands here) and
 *   meaningless to a reader; useful only to a developer reading logs.
 */
export type DiagnosticCode =
  "provider_retry" | "unsupported_event" | "unsupported_message";

export type RuntimeEvent =
  | { type: "transcript"; item: TranscriptItem }
  | { type: "transcript-update"; item: TranscriptItem }
  | {
      type: "diagnostic";
      level: "info" | "warning" | "error";
      message: string;
      /**
       * What KIND of diagnostic this is, independent of its severity.
       *
       * Severity alone cannot gate rendering. The adapter turns every Pi
       * event it does not recognise -- which includes all tool activity --
       * into a `warning` diagnostic, so "show every warning" would put
       * "Pi emitted an unsupported event." on screen several times per tool
       * call. The code separates the one diagnostic a reader actually needs
       * ("provider_retry") from that noise, so a consumer can select on
       * meaning rather than on volume.
       */
      code?: DiagnosticCode;
    }
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
  prompt(
    input: RuntimeUserInput | string,
    dispatch?: RuntimePromptDispatch,
  ): Promise<PromptAcceptance>;
  recoverPrompt(
    input: RuntimeUserInput | string,
    dispatch: RuntimePromptDispatch,
  ): Promise<PromptRecovery>;
  steer(input: RuntimeUserInput | string): Promise<void>;
  readImage?(imageId: ChatImageId): Promise<RuntimeImageContent>;
  stop(): Promise<void>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  dispose(): Promise<void>;
}

export interface AgentRuntime {
  suggestTitle?(projectPath: string, prompt: string): Promise<TitleSuggestion>;
  inspectImageInput?(projectPath: string): Promise<ImageInputCapability>;
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
