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

function stubMatchMedia(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
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
});
