// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  ENVIRONMENT_PREFERENCE_KEY,
  isEnvironmentOpen,
  readEnvironmentVisibility,
  writeEnvironmentVisibility,
} from "./environmentPreferences.js";

afterEach(() => {
  localStorage.clear();
});

describe("environmentPreferences", () => {
  it("defaults to auto when nothing is stored", () => {
    expect(readEnvironmentVisibility()).toBe("auto");
  });

  it("round-trips a written visibility", () => {
    writeEnvironmentVisibility("shown");
    expect(readEnvironmentVisibility()).toBe("shown");
    writeEnvironmentVisibility("hidden");
    expect(readEnvironmentVisibility()).toBe("hidden");
  });

  it("discards a malformed value and resets to auto", () => {
    localStorage.setItem(ENVIRONMENT_PREFERENCE_KEY, "{not json");
    expect(readEnvironmentVisibility()).toBe("auto");
    expect(localStorage.getItem(ENVIRONMENT_PREFERENCE_KEY)).toBeNull();
  });

  it("discards an unknown version", () => {
    localStorage.setItem(
      ENVIRONMENT_PREFERENCE_KEY,
      JSON.stringify({ version: 99, visibility: "shown" }),
    );
    expect(readEnvironmentVisibility()).toBe("auto");
  });

  describe("isEnvironmentOpen", () => {
    it("auto opens with a single tiled pane", () => {
      expect(isEnvironmentOpen("auto", 1)).toBe(true);
    });
    it("auto closes once the surface tiles beyond one pane", () => {
      expect(isEnvironmentOpen("auto", 2)).toBe(false);
    });
    it("shown is always open regardless of pane count", () => {
      expect(isEnvironmentOpen("shown", 4)).toBe(true);
    });
    it("hidden is always closed regardless of pane count", () => {
      expect(isEnvironmentOpen("hidden", 1)).toBe(false);
    });
  });
});
