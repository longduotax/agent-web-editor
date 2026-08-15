import type { TranscriptItem } from "@pi-web/contracts";

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
}

export interface RuntimeSnapshot {
  sessionId: string;
  transcript: TranscriptItem[];
  diagnostics: string[];
}

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

export interface OpenRuntimeSession {
  readonly id: string;
  snapshot(): Promise<RuntimeSnapshot>;
  prompt(text: string): Promise<PromptAcceptance>;
  steer(text: string): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  dispose(): Promise<void>;
}

export interface AgentRuntime {
  discover(
    projectPath: string,
  ): Promise<{ sessions: RuntimeSessionDescriptor[]; diagnostics: string[] }>;
  create(projectPath: string): Promise<{ sessionId: string }>;
  open(projectPath: string, sessionId: string): Promise<OpenRuntimeSession>;
}
