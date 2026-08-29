import { describe, expect, it } from "vitest";

import { TranscriptPager } from "./index.js";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value");
  return value;
}

function messages(count: number, text = "x") {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${String(index)}`,
    kind: "message" as const,
    role: "assistant" as const,
    text,
    timestamp: null,
  }));
}

describe("TranscriptPager", () => {
  it("opens at a bounded latest page and reaches all older items without overlap", () => {
    const pager = new TranscriptPager();
    const transcript = messages(250);
    const latest = pager.latest(transcript);
    expect(latest.items).toHaveLength(100);
    expect(latest.items[0]?.id).toBe("message-150");
    expect(latest.atLatest).toBe(true);

    const middle = pager.older(transcript, required(latest.olderCursor));
    const oldest = pager.older(transcript, required(middle.olderCursor));
    const ids = [...oldest.items, ...middle.items, ...latest.items].map(
      (item) => item.id,
    );
    expect(new Set(ids).size).toBe(250);
    expect(ids[0]).toBe("message-0");
    expect(oldest.olderCursor).toBeNull();
  });

  it("uses the byte target and still returns one oversized schema-bounded item", () => {
    const pager = new TranscriptPager();
    const page = pager.latest(messages(3, "x".repeat(600_000)));
    expect(page.items).toHaveLength(1);
    expect(page.olderCursor).not.toBeNull();
  });

  it("keeps a deterministic 10,000-item history bounded while every item remains reachable", () => {
    const pager = new TranscriptPager();
    const transcript = messages(10_000);
    let page = pager.latest(transcript);
    let total = 0;
    let pages = 0;
    for (;;) {
      expect(page.items.length).toBeLessThanOrEqual(100);
      total += page.items.length;
      pages += 1;
      if (page.olderCursor === null) break;
      page = pager.older(transcript, page.olderCursor);
    }
    expect(total).toBe(10_000);
    expect(pages).toBe(100);
  });

  it("rejects a cursor after history before its boundary changes", () => {
    const pager = new TranscriptPager();
    const transcript = messages(150);
    const page = pager.latest(transcript);
    const changed = [...transcript];
    changed[0] = { ...required(changed[0]), id: "changed" };
    expect(() => pager.older(changed, required(page.olderCursor))).toThrow(
      "transcript position is stale",
    );
  });
});
