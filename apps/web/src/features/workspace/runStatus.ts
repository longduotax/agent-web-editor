import type { RunState } from "@pi-web/contracts";

export type PaneRunStatus = "working" | "needs-approval" | "done" | "failed";

export interface RunStatusInput {
  runState: RunState | null;
  /** Dormant seam; no client data sets this today. */
  needsApproval?: boolean;
}

/**
 * Derives a four-way pane run status from a run state.
 *
 * running -> working; completed -> done; interrupted -> done (settled,
 * non-error); failed -> failed; null -> null (no status: threadless or
 * never-run pane). needsApproval === true overrides to "needs-approval".
 *
 * Pure and clock-free.
 */
export function deriveRunStatus(input: RunStatusInput): PaneRunStatus | null {
  if (input.needsApproval === true) {
    return "needs-approval";
  }

  switch (input.runState) {
    case "running":
      return "working";
    case "completed":
    case "interrupted":
      return "done";
    case "failed":
      return "failed";
    case null:
    case undefined:
      return null;
    default:
      return null;
  }
}

export const PANE_STATUS_LABEL: Record<PaneRunStatus, string> = {
  working: "Working",
  "needs-approval": "Needs approval",
  done: "Done",
  failed: "Failed",
};

export const PANE_STATUS_TOKEN: Record<PaneRunStatus, "run" | "wait" | "done" | "fail"> = {
  working: "run",
  "needs-approval": "wait",
  done: "done",
  failed: "fail",
};

/**
 * Formats elapsed running time as "Xm Ys" (or "Ys" under a minute).
 * Returns null when there is no start time. `nowMs` is injected — this
 * function never reads a clock internally.
 */
export function elapsedLabel(startedAtIso: string | null, nowMs: number): string | null {
  if (startedAtIso === null) {
    return null;
  }

  const elapsedMs = nowMs - Date.parse(startedAtIso);
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
