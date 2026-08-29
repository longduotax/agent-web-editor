import { describe, expect, it, vi } from "vitest";

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

  it("retains a probed status for synchronous thread summaries", async () => {
    const codex = {
      ...stub("codex"),
      probe: () =>
        Promise.resolve({ available: false, reason: "Codex missing" }),
    };
    const registry = new RuntimeRegistry({ pi: stub("pi"), codex }, "pi");

    expect(registry.status("codex")).toEqual({
      kind: "codex",
      available: false,
      reason: "Codex availability has not been checked.",
    });
    await expect(registry.usable("codex")).rejects.toMatchObject({
      code: "unavailable",
      message: "Codex missing",
    });
    expect(registry.status("codex")).toEqual({
      kind: "codex",
      available: false,
      reason: "Codex missing",
    });
  });

  it("closes each registered external runtime once", async () => {
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const runtime = { ...stub("pi"), close };
    const registry = new RuntimeRegistry({ pi: runtime, codex: runtime }, "pi");
    await registry.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
