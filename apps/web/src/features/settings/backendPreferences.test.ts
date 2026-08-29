// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  BACKEND_PREFERENCE_KEY,
  readBackendChoice,
  resolveDefaultBackend,
  writeBackendChoice,
} from "./backendPreferences.js";

afterEach(() => {
  localStorage.clear();
});

describe("backendPreferences", () => {
  it("keeps jsdom Storage available in the isolated test runtime", () => {
    expect(process.env.NODE_ENV).toBe("test");
    localStorage.setItem(BACKEND_PREFERENCE_KEY, "stored");
    expect(localStorage.getItem(BACKEND_PREFERENCE_KEY)).toBe("stored");
  });

  it("follows the machine default until the user chooses otherwise", () => {
    expect(readBackendChoice()).toBe("follow-machine");
  });

  it("round-trips an explicit choice", () => {
    writeBackendChoice("pi");
    expect(readBackendChoice()).toBe("pi");
    writeBackendChoice("codex");
    expect(readBackendChoice()).toBe("codex");
  });

  it("discards a malformed value and returns to following the machine", () => {
    localStorage.setItem(BACKEND_PREFERENCE_KEY, "{not json");
    expect(readBackendChoice()).toBe("follow-machine");
    expect(localStorage.getItem(BACKEND_PREFERENCE_KEY)).toBeNull();
  });

  it("discards an unknown version", () => {
    localStorage.setItem(
      BACKEND_PREFERENCE_KEY,
      JSON.stringify({ version: 99, choice: "codex" }),
    );
    expect(readBackendChoice()).toBe("follow-machine");
  });

  it("discards a choice that is not a backend", () => {
    localStorage.setItem(
      BACKEND_PREFERENCE_KEY,
      JSON.stringify({ version: 1, choice: "claude" }),
    );
    expect(readBackendChoice()).toBe("follow-machine");
  });
});

describe("resolveDefaultBackend", () => {
  it("prefers the device choice over the machine default", () => {
    expect(resolveDefaultBackend("pi", "codex")).toBe("pi");
  });

  it("falls back to the machine default when following", () => {
    expect(resolveDefaultBackend("follow-machine", "codex")).toBe("codex");
    expect(resolveDefaultBackend("follow-machine", "pi")).toBe("pi");
  });

  it("falls back to Codex when the machine default is unknown", () => {
    expect(resolveDefaultBackend("follow-machine", undefined)).toBe("codex");
  });
});
