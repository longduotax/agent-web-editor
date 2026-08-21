import { describe, expect, it } from "vitest";
import { needsAttention } from "./attention.js";

describe("needsAttention", () => {
  it("flags settled unread runs", () => {
    expect(needsAttention({ runState: "completed", unread: true })).toBe(true);
    expect(needsAttention({ runState: "failed", unread: true })).toBe(true);
    expect(needsAttention({ runState: "interrupted", unread: true })).toBe(
      true,
    );
  });
  it("ignores running, read, or absent runs", () => {
    expect(needsAttention({ runState: "running", unread: true })).toBe(false);
    expect(needsAttention({ runState: "completed", unread: false })).toBe(
      false,
    );
    expect(needsAttention({ runState: null, unread: true })).toBe(false);
  });
});
