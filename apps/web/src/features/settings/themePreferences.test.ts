// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  readThemeChoice,
  writeThemeChoice,
  THEME_PREFERENCE_KEY,
} from "./themePreferences.js";

afterEach(() => {
  localStorage.clear();
});

describe("themePreferences", () => {
  it("defaults to system when nothing is stored", () => {
    expect(readThemeChoice()).toBe("system");
  });
  it("round-trips a written choice", () => {
    writeThemeChoice("dark");
    expect(readThemeChoice()).toBe("dark");
  });
  it("discards a malformed value and resets to system", () => {
    localStorage.setItem(THEME_PREFERENCE_KEY, "{not json");
    expect(readThemeChoice()).toBe("system");
    expect(localStorage.getItem(THEME_PREFERENCE_KEY)).toBeNull();
  });
  it("discards an unknown version", () => {
    localStorage.setItem(
      THEME_PREFERENCE_KEY,
      JSON.stringify({ version: 99, choice: "dark" }),
    );
    expect(readThemeChoice()).toBe("system");
  });
});
