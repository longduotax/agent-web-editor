import { describe, expect, it, vi } from "vitest";

import { RuntimeFailure } from "@pi-web/agent-runtime";

import { CodexClient, type CodexTransport } from "./client.js";

/** A scripted stand-in for `codex app-server`'s stdio. */
class FakeTransport implements CodexTransport {
  public readonly sent: string[] = [];
  public closed = false;
  private lineListener: ((line: string) => void) | undefined;
  private exitListener:
    | ((info: {
        code: number | null;
        signal: string | null;
        error?: Error;
      }) => void)
    | undefined;

  public constructor(private readonly autoHandshake = true) {}

  public send(line: string): void {
    this.sent.push(line);
    if (!this.autoHandshake) return;
    const frame = JSON.parse(line) as { id?: number; method?: string };
    // A real app-server answers `initialize` promptly; do the same so tests
    // exercise the handshake without hand-sequencing it.
    if (frame.method === "initialize" && frame.id !== undefined) {
      const id = frame.id;
      queueMicrotask(() => {
        this.reply(id, { userAgent: "codex/0.149.0" });
      });
    }
  }
  public onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }
  public onExit(
    listener: (info: {
      code: number | null;
      signal: string | null;
      error?: Error;
    }) => void,
  ): void {
    this.exitListener = listener;
  }
  public close(): void {
    this.closed = true;
  }

  public emit(value: unknown): void {
    this.lineListener?.(
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  public exit(code: number | null = 1): void {
    this.exitListener?.({ code, signal: null });
  }
  /** A spawn that never produced a process, as a missing binary does. */
  public failToStart(error: Error): void {
    this.exitListener?.({ code: null, signal: null, error });
  }
  /** Resolve the pending request with `id` as the app-server would. */
  public reply(id: number, result: unknown): void {
    this.emit({ jsonrpc: "2.0", id, result });
  }
  public parsedSent(index: number): {
    id?: number;
    method?: string;
    params?: unknown;
  } {
    const line = this.sent[index];
    if (line === undefined) throw new Error(`no frame at ${String(index)}`);
    return JSON.parse(line) as {
      id?: number;
      method?: string;
      params?: unknown;
    };
  }
}

function client(transport: FakeTransport) {
  return new CodexClient({ connect: () => Promise.resolve(transport) });
}

describe("CodexClient framing and correlation", () => {
  it("performs the initialize handshake before any other request", async () => {
    const transport = new FakeTransport(false);
    const codex = client(transport);
    const ready = codex.ready();
    await vi.waitFor(() => {
      expect(transport.sent.length).toBe(1);
    });
    const handshake = transport.parsedSent(0);
    expect(handshake.method).toBe("initialize");
    expect(handshake.id).toBeTypeOf("number");
    transport.reply(handshake.id ?? 0, { userAgent: "codex/0.149.0" });
    await ready;
    // `initialized` is a notification: no id, no response expected.
    await vi.waitFor(() => {
      expect(transport.sent.length).toBe(2);
    });
    const initialized = transport.parsedSent(1);
    expect(initialized.method).toBe("initialized");
    expect(initialized.id).toBeUndefined();
    await codex.dispose();
  });

  it("resolves each request with its own response regardless of order", async () => {
    const transport = new FakeTransport();
    const codex = client(transport);
    await codex.ready();

    const first = codex.request("thread/list", { cwd: "/a" });
    const second = codex.request("thread/list", { cwd: "/b" });
    await vi.waitFor(() => {
      expect(transport.sent.length).toBe(4);
    });
    const firstId = transport.parsedSent(2).id ?? 0;
    const secondId = transport.parsedSent(3).id ?? 0;
    expect(firstId).not.toBe(secondId);

    // Answer out of order to prove correlation is by id, not arrival.
    transport.reply(secondId, { threads: ["b"] });
    transport.reply(firstId, { threads: ["a"] });
    expect(await first).toEqual({ threads: ["a"] });
    expect(await second).toEqual({ threads: ["b"] });
    await codex.dispose();
  });

  it("rejects a request the app-server answers with an error", async () => {
    const transport = new FakeTransport();
    const codex = client(transport);
    await codex.ready();
    const pending = codex.request("turn/start", {});
    await vi.waitFor(() => {
      expect(transport.sent.length).toBe(3);
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.parsedSent(2).id,
      error: { code: -32000, message: "thread is busy" },
    });
    await expect(pending).rejects.toThrow("thread is busy");
    await codex.dispose();
  });

  it("ignores unparseable and unknown frames rather than failing the session", async () => {
    const transport = new FakeTransport();
    const codex = client(transport);
    await codex.ready();
    const seen: { method: string; params: unknown }[] = [];
    codex.onNotification((method, params) => seen.push({ method, params }));

    transport.emit("{not json");
    transport.emit("");
    transport.emit({ jsonrpc: "2.0" });
    transport.emit({ jsonrpc: "2.0", id: 4242, result: {} });
    transport.emit({
      jsonrpc: "2.0",
      method: "turn/started",
      params: { turnId: "t1" },
    });

    expect(seen).toEqual([
      { method: "turn/started", params: { turnId: "t1" } },
    ]);
    // Four unusable frames: invalid JSON, empty, neither response nor
    // notification, and a response to an id nothing is waiting on.
    expect(codex.droppedFrames).toBe(4);
    await codex.dispose();
  });

  it("answers a server request through the registered handler", async () => {
    const transport = new FakeTransport();
    const codex = client(transport);
    await codex.ready();
    codex.onServerRequest((method) =>
      method === "applyPatchApproval" ? { decision: "denied" } : null,
    );
    transport.emit({
      jsonrpc: "2.0",
      id: 77,
      method: "applyPatchApproval",
      params: { threadId: "t1" },
    });
    await vi.waitFor(() => {
      expect(transport.sent.length).toBe(3);
    });
    expect(transport.parsedSent(2)).toEqual({
      jsonrpc: "2.0",
      id: 77,
      result: { decision: "denied" },
    });
    await codex.dispose();
  });
});

describe("CodexClient process supervision", () => {
  it("reports an unusable Codex installation as a typed failure", async () => {
    const codex = new CodexClient({
      connect: () => Promise.reject(new Error("spawn codex ENOENT")),
    });
    await expect(codex.ready()).rejects.toBeInstanceOf(RuntimeFailure);
    await expect(codex.ready()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("fails a handshake that never completes", async () => {
    const transport = new FakeTransport(false);
    const codex = new CodexClient({
      connect: () => Promise.resolve(transport),
      handshakeTimeoutMs: 10,
    });
    await expect(codex.ready()).rejects.toMatchObject({ code: "unavailable" });
    await codex.dispose();
  });

  it("fails in-flight requests when the app-server exits", async () => {
    const transport = new FakeTransport();
    const codex = client(transport);
    await codex.ready();
    const pending = codex.request("turn/start", {});
    await vi.waitFor(() => {
      expect(transport.sent.length).toBe(3);
    });
    transport.exit(1);
    await expect(pending).rejects.toMatchObject({ code: "unavailable" });
    await codex.dispose();
  });

  it("reconnects on the next request after an exit", async () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    let handed = 0;
    const codex = new CodexClient({
      connect: () => Promise.resolve(handed++ === 0 ? first : second),
      restartDelayMs: 0,
    });
    await codex.ready();
    first.exit(1);

    await codex.ready();
    await vi.waitFor(() => {
      expect(second.sent.length).toBeGreaterThan(0);
    });
    expect(handed).toBe(2);
    await codex.dispose();
  });

  it("names a missing Codex installation and the remedy", async () => {
    const transport = new FakeTransport();
    const codex = client(transport);
    await codex.ready();
    const drops: string[] = [];
    codex.onDisconnect((reason) => {
      drops.push(reason);
    });
    transport.failToStart(new Error("spawn codex ENOENT"));
    expect(drops[0]).toContain("Codex could not be started");
    expect(drops[0]).toContain("PI_WEB_CODEX_BIN");
    await codex.dispose();
  });

  it("notifies subscribers that the session dropped so threads can reattach", async () => {
    const transport = new FakeTransport();
    const codex = client(transport);
    await codex.ready();
    const drops: string[] = [];
    codex.onDisconnect((reason) => drops.push(reason));
    transport.exit(3);
    expect(drops.length).toBe(1);
    expect(drops[0]).toContain("3");
    await codex.dispose();
  });
});
