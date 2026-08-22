import { describe, expect, it, vi } from "vitest";

import { spawnCodexTransport } from "./spawn.js";

/**
 * These drive a real child process — deliberately `node`, not Codex — so line
 * framing, partial chunks, and exit reporting are exercised for real without
 * depending on a Codex installation.
 */
describe("spawnCodexTransport", () => {
  it("splits stdout into lines even when they arrive in fragments", async () => {
    const script = `
      process.stdout.write('{"a":1}\\n{"b":');
      setTimeout(() => process.stdout.write('2}\\n'), 10);
      setTimeout(() => process.exit(0), 60);
    `;
    const transport = await spawnCodexTransport("node", ["-e", script], {});
    const lines: string[] = [];
    transport.onLine((line) => lines.push(line));
    await vi.waitFor(
      () => {
        expect(lines.length).toBe(2);
      },
      { timeout: 4000 },
    );
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    transport.close();
  });

  it("reports the child's exit", async () => {
    const transport = await spawnCodexTransport(
      "node",
      ["-e", "setTimeout(() => process.exit(7), 10)"],
      {},
    );
    const exits: { code: number | null; signal: string | null }[] = [];
    transport.onExit((info) => exits.push(info));
    await vi.waitFor(
      () => {
        expect(exits.length).toBe(1);
      },
      { timeout: 4000 },
    );
    expect(exits[0]?.code).toBe(7);
    transport.close();
  });

  it("names a missing executable instead of reporting a mysterious stop", async () => {
    const transport = await spawnCodexTransport(
      "pi-web-nonexistent-binary",
      [],
      {},
    );
    const exits: {
      code: number | null;
      signal: string | null;
      error?: Error;
    }[] = [];
    transport.onExit((info) => exits.push(info));
    await vi.waitFor(
      () => {
        expect(exits.length).toBe(1);
      },
      { timeout: 4000 },
    );
    // A failed spawn emits "error", not "exit". Without the error carried
    // through, a missing binary reads as "stopped (exit code unknown)", which
    // names neither the cause nor the remedy (AGB-08).
    expect(exits[0]?.error).toBeInstanceOf(Error);
    expect(exits[0]?.error?.message).toMatch(/ENOENT|not found|spawn/i);
    transport.close();
  });

  it("writes each frame as its own line", async () => {
    const script = `
      let seen = 0;
      process.stdin.on('data', (chunk) => {
        seen += String(chunk).split('\\n').filter(Boolean).length;
        if (seen === 2) { process.stdout.write('{"got":2}\\n'); }
      });
    `;
    const transport = await spawnCodexTransport("node", ["-e", script], {});
    const lines: string[] = [];
    transport.onLine((line) => lines.push(line));
    transport.send('{"one":1}');
    transport.send('{"two":2}');
    await vi.waitFor(
      () => {
        expect(lines).toEqual(['{"got":2}']);
      },
      {
        timeout: 4000,
      },
    );
    transport.close();
  });
});
