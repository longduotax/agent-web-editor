// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isAtBottom,
  scrollToBottom,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  useStickToBottom,
} from "./stickToBottom.js";

const resizeCallbacks: (() => void)[] = [];

afterEach(() => {
  resizeCallbacks.splice(0);
  vi.unstubAllGlobals();
});

function stubResizeObserver(): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      public constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(() => {
          callback([], this);
        });
      }

      public disconnect(): void {
        return undefined;
      }

      public observe(): void {
        return undefined;
      }

      public unobserve(): void {
        return undefined;
      }
    },
  );
}

function resizeObservedElements(): void {
  for (const callback of resizeCallbacks) callback();
}

function transcript(): {
  element: HTMLDivElement;
  resizeForComposer: () => void;
} {
  const element = document.createElement("div");
  element.append(document.createElement("div"));
  let clientHeight = 400;
  Object.defineProperties(element, {
    clientHeight: {
      configurable: true,
      get: () => clientHeight,
    },
    scrollHeight: {
      configurable: true,
      get: () => 1000,
    },
  });
  return {
    element,
    resizeForComposer: () => {
      clientHeight = 300;
    },
  };
}

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

  it("re-pins a transcript when composer growth shrinks its viewport", () => {
    stubResizeObserver();
    const { result } = renderHook(() => useStickToBottom("thread", "content"));
    const { element, resizeForComposer } = transcript();
    result.current.attach(element);
    element.scrollTop = 600;

    resizeForComposer();
    act(resizeObservedElements);

    expect(element.scrollTop).toBe(1000);
  });

  it("does not move an unpinned transcript when the composer grows", () => {
    stubResizeObserver();
    const { result } = renderHook(() => useStickToBottom("thread", "content"));
    const { element, resizeForComposer } = transcript();
    result.current.attach(element);
    element.scrollTop = 100;
    act(() => {
      element.dispatchEvent(new Event("scroll"));
    });

    resizeForComposer();
    act(resizeObservedElements);

    expect(element.scrollTop).toBe(100);
  });
});
