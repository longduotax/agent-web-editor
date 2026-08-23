import type { RunState } from "@pi-web/contracts";

export type PaneRunStatus =
  "working" | "needs-approval" | "done" | "stopped" | "failed" | "archived";

export interface RunStatusInput {
  runState: RunState | null;
  /** Dormant seam; no client data sets this today. */
  needsApproval?: boolean;
  /**
   * The thread this pane is bound to has been archived. It outranks every run
   * state, because whatever the last run did, the thread cannot be worked in
   * until it is restored.
   */
  archived?: boolean;
}

/**
 * Derives the pane run status from a run state.
 *
 * running -> working; completed -> done; interrupted -> STOPPED; failed ->
 * failed; null -> null (no status: threadless or never-run pane).
 * needsApproval === true overrides to "needs-approval"; archived === true
 * outranks everything.
 *
 * `interrupted` used to fold into "done", which spent the word the app uses
 * for "finished successfully" on a run the user cancelled and on one killed
 * by the project being removed. The run states are exactly four
 * (`RunStateSchema`), so this maps all four rather than widening a condition
 * to `!== "completed"` -- which would have caught `running` too.
 *
 * Pure and clock-free.
 */
export function deriveRunStatus(input: RunStatusInput): PaneRunStatus | null {
  if (input.archived === true) {
    return "archived";
  }

  if (input.needsApproval === true) {
    return "needs-approval";
  }

  switch (input.runState) {
    case "running":
      return "working";
    case "completed":
      return "done";
    case "interrupted":
      return "stopped";
    case "failed":
      return "failed";
    case null:
      return null;
    default:
      return null;
  }
}

export const PANE_STATUS_LABEL: Record<PaneRunStatus, string> = {
  working: "Working",
  "needs-approval": "Needs approval",
  done: "Done",
  stopped: "Stopped",
  failed: "Failed",
  archived: "Archived",
};

export const PANE_STATUS_TOKEN: Record<
  PaneRunStatus,
  "run" | "wait" | "done" | "stop" | "fail" | "archived"
> = {
  working: "run",
  "needs-approval": "wait",
  done: "done",
  stopped: "stop",
  failed: "fail",
  archived: "archived",
};

/**
 * The reason a settled run did not complete, in the server's own words.
 *
 * `Run.failureMessage` / `Run.failureCode` have always been in the contract
 * and sent by the server -- "Stopped by the user.", "Interrupted because the
 * project was removed." -- and the pane rendered neither for an `interrupted`
 * run, which is how a cancelled run came to look like a successful one.
 *
 * Returns null for a run that is still going or that genuinely completed, so
 * the caller renders nothing for the happy path.
 */
export function runOutcomeNotice(
  run: {
    state: RunState;
    failureCode: string | null;
    failureMessage: string | null;
  } | null,
): { tone: "stopped" | "failed"; text: string } | null {
  if (run === null) return null;
  if (run.state === "failed")
    return {
      tone: "failed",
      text:
        run.failureMessage ??
        (run.failureCode === null
          ? "The run failed without reporting a reason."
          : `The run failed (${run.failureCode}).`),
    };
  if (run.state === "interrupted")
    return {
      tone: "stopped",
      text:
        run.failureMessage ??
        (run.failureCode === null
          ? "The run was interrupted before it finished."
          : `The run was interrupted (${run.failureCode}).`),
    };
  return null;
}

/**
 * Formats elapsed running time as "Xm Ys" (or "Ys" under a minute).
 * Returns null when there is no start time. `nowMs` is injected — this
 * function never reads a clock internally.
 */
export function elapsedLabel(
  startedAtIso: string | null,
  nowMs: number,
): string | null {
  if (startedAtIso === null) {
    return null;
  }

  const elapsedMs = nowMs - Date.parse(startedAtIso);
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0
    ? `${String(minutes)}m ${String(seconds)}s`
    : `${String(seconds)}s`;
}
