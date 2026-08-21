// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readThemeChoice } from "./themePreferences.js";
import { useTheme } from "./useTheme.js";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

interface MatchMediaStub {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  fire: (type: string) => void;
}

function stubMatchMedia(): MatchMediaStub {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const addEventListener = vi.fn(
    (type: string, handler: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
  );
  const removeEventListener = vi.fn(
    (type: string, handler: (event: unknown) => void) => {
      listeners.get(type)?.delete(handler);
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener,
    removeEventListener,
  }));
  return {
    addEventListener,
    removeEventListener,
    fire: (type: string) => {
      for (const handler of listeners.get(type) ?? []) handler({});
    },
  };
}

describe("useTheme", () => {
  it("starts at system with no data-theme attribute", () => {
    stubMatchMedia();
    const { result } = renderHook(() => useTheme());

    expect(result.current.choice).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("setChoice('dark') sets data-theme and persists the choice", () => {
    stubMatchMedia();
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setChoice("dark");
    });

    expect(result.current.choice).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(readThemeChoice()).toBe("dark");
  });

  it("setChoice('system') removes data-theme again", () => {
    stubMatchMedia();
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setChoice("dark");
    });
    act(() => {
      result.current.setChoice("system");
    });

    expect(result.current.choice).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(readThemeChoice()).toBe("system");
  });

  it("subscribes to matchMedia change while choice is system", () => {
    const { addEventListener } = stubMatchMedia();
    renderHook(() => useTheme());

    expect(addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("re-applies the system theme when the OS preference changes", () => {
    const { fire } = stubMatchMedia();
    renderHook(() => useTheme());
    // Simulate a stale/manually-set attribute to prove the change handler
    // actually re-runs applyThemeChoice("system") rather than being a no-op.
    document.documentElement.setAttribute("data-theme", "dark");

    act(() => {
      fire("change");
    });

    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("unsubscribes when choice leaves system, leaving no stale subscription", () => {
    const { addEventListener, removeEventListener } = stubMatchMedia();
    const { result } = renderHook(() => useTheme());
    expect(addEventListener).toHaveBeenCalledTimes(1);
    const [, handler] = addEventListener.mock.calls[0] as [
      string,
      (event: unknown) => void,
    ];

    act(() => {
      result.current.setChoice("dark");
    });

    expect(removeEventListener).toHaveBeenCalledWith("change", handler);
    // Leaving "system" must not re-subscribe.
    expect(addEventListener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes on unmount while choice is system", () => {
    const { addEventListener, removeEventListener } = stubMatchMedia();
    const { unmount } = renderHook(() => useTheme());
    const [, handler] = addEventListener.mock.calls[0] as [
      string,
      (event: unknown) => void,
    ];

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith("change", handler);
  });
});
