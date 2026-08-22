import { describe, expect, it } from "vitest";

import { RuntimeFailure, type AgentRuntime } from "@pi-web/agent-runtime";

import { RuntimeRegistry } from "./runtimes.js";

function stub(name: string): AgentRuntime {
  return {
    discover: () =>
      Promise.resolve({ sessions: [], diagnostics: [`from ${name}`] }),
    create: () => Promise.resolve({ sessionId: name }),
    open: () => Promise.reject(new Error("not used")),
  };
}

describe("RuntimeRegistry", () => {
  it("resolves each backend to its own adapter", () => {
    const pi = stub("pi");
    const codex = stub("codex");
    const registry = new RuntimeRegistry({ pi, codex }, "codex");
    expect(registry.get("pi")).toBe(pi);
    expect(registry.get("codex")).toBe(codex);
  });

  it("reports the configured default for new chats", () => {
    expect(new RuntimeRegistry({ pi: stub("pi") }, "pi").defaultKind).toBe(
      "pi",
    );
  });

  it("refuses a backend that is not installed, naming it", () => {
    const registry = new RuntimeRegistry({ pi: stub("pi") }, "pi");
    expect(registry.available("codex")).toBe(false);
    expect(() => registry.get("codex")).toThrow(RuntimeFailure);
    expect(() => registry.get("codex")).toThrow(/Codex/);
  });

  it("lists only the backends that are actually registered", () => {
    expect(new RuntimeRegistry({ pi: stub("pi") }, "pi").kinds()).toEqual([
      "pi",
    ]);
    expect(
      new RuntimeRegistry(
        { pi: stub("pi"), codex: stub("codex") },
        "pi",
      ).kinds(),
    ).toEqual(["pi", "codex"]);
  });

  it("refuses to make an unregistered backend the default", () => {
    expect(() => new RuntimeRegistry({ pi: stub("pi") }, "codex")).toThrow(
      /Codex/,
    );
  });
});
