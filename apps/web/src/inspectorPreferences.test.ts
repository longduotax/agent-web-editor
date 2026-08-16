// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_INSPECTOR_PREFERENCES,
  INSPECTOR_PREFERENCES_KEY,
  readInspectorPreferences,
  writeInspectorPreferences,
} from "./inspectorPreferences.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inspector preferences", () => {
  it("uses defaults when no preference has been saved", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    expect(readInspectorPreferences()).toEqual(DEFAULT_INSPECTOR_PREFERENCES);
  });

  it("parses a saved versioned preference", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          version: 1,
          open: false,
          activeTab: "files",
          width: 720,
        }),
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    expect(readInspectorPreferences()).toEqual({
      version: 1,
      open: false,
      activeTab: "files",
      width: 720,
    });
  });

  it.each([
    "not json",
    JSON.stringify({ version: 2, open: true, activeTab: "files", width: 400 }),
    JSON.stringify({ version: 1, open: "yes", activeTab: "files", width: 400 }),
    JSON.stringify({
      version: 1,
      open: true,
      activeTab: "unknown",
      width: 400,
    }),
    JSON.stringify({ version: 1, open: true, activeTab: "files", width: -1 }),
    JSON.stringify({
      version: 1,
      open: true,
      activeTab: "files",
      width: 400.5,
    }),
  ])("discards malformed or unsupported saved values", (stored) => {
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: () => undefined,
      removeItem,
    });

    expect(readInspectorPreferences()).toEqual(DEFAULT_INSPECTOR_PREFERENCES);
    expect(removeItem).toHaveBeenCalledWith(INSPECTOR_PREFERENCES_KEY);
  });

  it("writes the complete preference as one versioned value", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem,
      removeItem: () => undefined,
    });

    writeInspectorPreferences({
      version: 1,
      open: true,
      activeTab: "terminal",
      width: 640,
    });

    expect(setItem).toHaveBeenCalledWith(
      INSPECTOR_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        open: true,
        activeTab: "terminal",
        width: 640,
      }),
    );
  });
});
