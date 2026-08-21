import type { RunState } from "@pi-web/contracts";

export interface AttentionInput {
  runState: RunState | null;
  unread: boolean;
}

export function needsAttention({ runState, unread }: AttentionInput): boolean {
  return unread && runState !== null && runState !== "running";
}
