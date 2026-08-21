import { describe, expect, it } from "vitest";
import { deriveRunStatus, elapsedLabel, PANE_STATUS_LABEL } from "./runStatus.js";

describe("deriveRunStatus", () => {
  it("maps run states to display statuses", () => {
    expect(deriveRunStatus({ runState: "running" })).toBe("working");
    expect(deriveRunStatus({ runState: "completed" })).toBe("done");
    expect(deriveRunStatus({ runState: "interrupted" })).toBe("done");
    expect(deriveRunStatus({ runState: "failed" })).toBe("failed");
    expect(deriveRunStatus({ runState: null })).toBeNull();
  });
  it("honours the dormant needs-approval seam", () => {
    expect(deriveRunStatus({ runState: "running", needsApproval: true })).toBe(
      "needs-approval",
    );
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
  });
});
