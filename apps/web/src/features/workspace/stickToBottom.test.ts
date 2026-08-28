import { describe, expect, it } from "vitest";

import {
  isAtBottom,
  scrollToBottom,
  STICK_TO_BOTTOM_THRESHOLD_PX,
} from "./stickToBottom.js";

describe("stickToBottom", () => {
  it("treats a box scrolled to its exact bottom as at the bottom", () => {
    expect(
      isAtBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }),
    ).toBe(true);
  });

  it("tolerates a small gap below the threshold (sub-pixel/rounding drift)", () => {
    expect(
      isAtBottom({
        scrollTop: 600 - (STICK_TO_BOTTOM_THRESHOLD_PX - 1),
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  it("treats a box the user has scrolled up in as NOT at the bottom", () => {
    expect(
      isAtBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }),
    ).toBe(false);
    expect(
      isAtBottom({
        scrollTop: 600 - (STICK_TO_BOTTOM_THRESHOLD_PX + 1),
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(false);
  });

  it("treats a box shorter than its viewport as at the bottom", () => {
    expect(
      isAtBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 400 }),
    ).toBe(true);
  });

  it("scrollToBottom pins scrollTop to the full scroll height", () => {
    const box = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
    scrollToBottom(box);
    expect(box.scrollTop).toBe(1000);
  });

  it("STICK_TO_BOTTOM_THRESHOLD_PX is small enough to be sub-pixel slack, not a policy", () => {
    // If this grows into the tens of lines, "the reader has scrolled away"
    // stops being true near the bottom and the pin starts fighting them.
    expect(STICK_TO_BOTTOM_THRESHOLD_PX).toBeLessThanOrEqual(64);
  });
});
