import { describe, expect, it } from "vitest";
import {
  deriveRunStatus,
  elapsedLabel,
  PANE_STATUS_LABEL,
  PANE_STATUS_TOKEN,
  runOutcomeNotice,
} from "./runStatus.js";

describe("deriveRunStatus", () => {
  it("maps run states to display statuses", () => {
    expect(deriveRunStatus({ runState: "running" })).toBe("working");
    expect(deriveRunStatus({ runState: "completed" })).toBe("done");
    // G1. `interrupted` used to fold into "done" -- the app's word for
    // "finished successfully" -- so pressing Stop produced a green Done that
    // was byte-for-byte the presentation of a run that had succeeded, while
    // the server held `state: "interrupted", failureCode: "user_stop"`.
    expect(deriveRunStatus({ runState: "interrupted" })).toBe("stopped");
    expect(deriveRunStatus({ runState: "failed" })).toBe("failed");
    expect(deriveRunStatus({ runState: null })).toBeNull();
  });
  it("honours the dormant needs-approval seam", () => {
    expect(deriveRunStatus({ runState: "running", needsApproval: true })).toBe(
      "needs-approval",
    );
  });
  it("lets an archived thread outrank every run state", () => {
    expect(deriveRunStatus({ runState: "completed", archived: true })).toBe(
      "archived",
    );
    expect(
      deriveRunStatus({
        runState: "running",
        archived: true,
        needsApproval: true,
      }),
    ).toBe("archived");
  });
});

describe("runOutcomeNotice", () => {
  const base = { failureCode: null, failureMessage: null };

  it("surfaces the server's own reason for an interrupted run", () => {
    // Exactly what the running server returned when Stop was pressed.
    expect(
      runOutcomeNotice({
        ...base,
        state: "interrupted",
        failureCode: "user_stop",
        failureMessage: "Stopped by the user.",
      }),
    ).toEqual({ tone: "stopped", text: "Stopped by the user." });
  });

  it("distinguishes a stopped run from a failed one by tone, not by silence", () => {
    expect(
      runOutcomeNotice({
        ...base,
        state: "failed",
        failureMessage: "The runtime exited.",
      }),
    ).toEqual({ tone: "failed", text: "The runtime exited." });
  });

  it("still says something when the server gave no message", () => {
    expect(runOutcomeNotice({ ...base, state: "interrupted" })).toEqual({
      tone: "stopped",
      text: "The run was interrupted before it finished.",
    });
    expect(
      runOutcomeNotice({ ...base, state: "interrupted", failureCode: "gone" }),
    ).toEqual({ tone: "stopped", text: "The run was interrupted (gone)." });
  });

  it("says nothing about a run that is still going or that completed", () => {
    // The load-bearing half of NOT widening the old condition to
    // `state !== "completed"`: RunState has four members, and a run that is
    // still going must not be given an outcome notice.
    expect(runOutcomeNotice({ ...base, state: "running" })).toBeNull();
    expect(runOutcomeNotice({ ...base, state: "completed" })).toBeNull();
    expect(runOutcomeNotice(null)).toBeNull();
  });
});

describe("elapsedLabel", () => {
  it("formats elapsed running time", () => {
    const start = "2026-08-22T00:00:00.000Z";
    expect(elapsedLabel(start, Date.parse(start) + 134_000)).toBe("2m 14s");
    expect(elapsedLabel(start, Date.parse(start) + 9_000)).toBe("9s");
    expect(elapsedLabel(null, 0)).toBeNull();
  });
});

describe("PANE_STATUS_LABEL", () => {
  it("labels every status for accessible, non-colour-only status", () => {
    expect(PANE_STATUS_LABEL["needs-approval"]).toBe("Needs approval");
    expect(PANE_STATUS_LABEL.stopped).toBe("Stopped");
    expect(PANE_STATUS_LABEL.archived).toBe("Archived");
  });
  it("gives the settled-but-unsuccessful states their own colour token", () => {
    // Sharing "done" is what made a stopped run green. The sidebar (App.tsx)
    // reads these same two records, so it inherits both without changing.
    expect(PANE_STATUS_TOKEN.stopped).not.toBe(PANE_STATUS_TOKEN.done);
    expect(PANE_STATUS_TOKEN.stopped).not.toBe(PANE_STATUS_TOKEN.failed);
    expect(PANE_STATUS_TOKEN.stopped).toBe("stop");
    expect(PANE_STATUS_TOKEN.archived).toBe("archived");
  });
});
