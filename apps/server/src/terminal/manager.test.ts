import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TerminalServerFrameSchema,
  type TerminalServerFrame,
} from "@pi-web/contracts";

import {
  ProjectTerminalManager,
  type PtyFactory,
  type PtyProcess,
} from "./manager.js";

const roots: string[] = [];
const projectId = "10000000-0000-4000-8000-000000000001";

class FakePty implements PtyProcess {
  public killed = false;
  public readonly writes: string[] = [];
  private readonly dataListeners = new Set<(data: unknown) => void>();
  private readonly exitListeners = new Set<(event: unknown) => void>();
  private readonly allExitListeners = new Set<(event: unknown) => void>();
  public write(data: string): void {
    this.writes.push(data);
  }
  public resize(): void {
    return undefined;
  }
  public kill(): void {
    this.killed = true;
  }
  public onData(listener: (data: unknown) => void): { dispose(): void } {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }
  public onExit(listener: (event: unknown) => void): { dispose(): void } {
    this.exitListeners.add(listener);
    this.allExitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }
  public data(value: unknown): void {
    for (const listener of this.dataListeners) listener(value);
  }
  public exit(value: unknown): void {
    for (const listener of this.exitListeners) listener(value);
  }
  public staleExit(value: unknown): void {
    for (const listener of this.allExitListeners) listener(value);
  }
}

class DeferredFactory implements PtyFactory {
  public readonly processes: FakePty[] = [];
  private resolve: ((process: PtyProcess) => void) | undefined;
  public spawn(): Promise<PtyProcess> {
    const process = new FakePty();
    this.processes.push(process);
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
  public release(): void {
    const process = this.processes.at(-1);
    if (process === undefined || this.resolve === undefined)
      throw new Error("deferred PTY was not created");
    this.resolve(process);
  }
}

class FakeFactory implements PtyFactory {
  public readonly processes: FakePty[] = [];
  public spawn(): PtyProcess {
    const process = new FakePty();
    this.processes.push(process);
    return process;
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("ProjectTerminalManager", () => {
  it("kills a terminal that resolves after termination and does not reuse it", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project);
    const factory = new DeferredFactory();
    const manager = new ProjectTerminalManager(factory);
    const attach = manager.attach(projectId, project, {
      send: () => undefined,
    });

    await vi.waitFor(() => {
      expect(factory.processes).toHaveLength(1);
    });
    manager.terminate(projectId);
    factory.release();

    await expect(attach).rejects.toThrow("terminal_gone");
    const discarded = factory.processes[0];
    if (discarded === undefined)
      throw new Error("deferred PTY was not created");
    expect(discarded.killed).toBe(true);

    const replacement = manager.attach(projectId, project, {
      send: () => undefined,
    });
    await vi.waitFor(() => {
      expect(factory.processes).toHaveLength(2);
    });
    factory.release();
    await replacement;
  });

  it("cleans removed terminal attachments and marks truncated replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-"));
    roots.push(root);
    await mkdir(join(root, "project"));
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const first: TerminalServerFrame[] = [];
    await manager.attach(projectId, join(root, "project"), {
      send: (frame) => first.push(frame),
    });
    const old = factory.processes[0];
    if (old === undefined) throw new Error("fake PTY was not created");
    old.data("x".repeat(1_100_000));
    const second: TerminalServerFrame[] = [];
    await manager.attach(projectId, join(root, "project"), {
      send: (frame) => second.push(frame),
    });
    expect(second.map((frame) => frame.type).slice(0, 3)).toEqual([
      "ready",
      "reset",
      "output",
    ]);
    manager.terminate(projectId);
    expect(old.killed).toBe(true);
    old.data("later");
    expect(first).not.toContainEqual(
      expect.objectContaining({ data: "later" }),
    );
    await manager.attach(projectId, join(root, "project"), {
      send: () => undefined,
    });
    expect(factory.processes).toHaveLength(2);
  });

  it("notifies attached clients before terminating a terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project);
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames: TerminalServerFrame[] = [];
    await manager.attach(projectId, project, {
      send: (frame) => frames.push(frame),
    });
    const ready = frames.at(-1);
    if (ready?.type !== "ready") throw new Error("terminal was not ready");

    manager.terminate(projectId, ready.terminalId);

    expect(frames.at(-1)).toEqual({
      version: 1,
      type: "exit",
      projectId,
      exitCode: 143,
      signal: 15,
    });
    expect(factory.processes[0]?.killed).toBe(true);
  });

  it("serializes concurrent creation and ignores stale exit callbacks", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project);
    const factory = new DeferredFactory();
    const manager = new ProjectTerminalManager(factory);
    const first: TerminalServerFrame[] = [];
    const second: TerminalServerFrame[] = [];
    const firstAttach = manager.attach(projectId, project, {
      send: (frame) => first.push(frame),
    });
    const secondAttach = manager.attach(projectId, project, {
      send: (frame) => second.push(frame),
    });
    await vi.waitFor(() => {
      expect(factory.processes).toHaveLength(1);
    });
    factory.release();
    await Promise.all([firstAttach, secondAttach]);
    expect(factory.processes).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: "ready" });
    expect(second[0]).toMatchObject({ type: "ready" });
    expect(
      first[0]?.type === "ready" && second[0]?.type === "ready"
        ? first[0].terminalId === second[0].terminalId
        : false,
    ).toBe(true);

    const firstReady = first[0];
    if (firstReady?.type !== "ready") throw new Error("terminal was not ready");
    const restart = manager.restart(projectId, firstReady.terminalId);
    await vi.waitFor(() => {
      expect(factory.processes).toHaveLength(2);
    });
    factory.release();
    await restart;
    const old = factory.processes[0];
    if (old === undefined) throw new Error("original PTY was not created");
    old.staleExit({ exitCode: 0 });
    const current = second.at(-1);
    if (current?.type !== "ready") throw new Error("terminal was not ready");
    expect(() => {
      manager.input(projectId, current.terminalId, "still running");
    }).not.toThrow();
  });

  it("rejects stale terminal controls after a restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project);
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames: TerminalServerFrame[] = [];
    await manager.attach(projectId, project, {
      send: (frame) => frames.push(frame),
    });
    const firstReady = frames.at(-1);
    if (firstReady?.type !== "ready") throw new Error("terminal was not ready");

    await manager.restart(projectId, firstReady.terminalId);
    const secondReady = frames.at(-1);
    if (secondReady?.type !== "ready")
      throw new Error("terminal was not ready");
    expect(secondReady.terminalId).not.toBe(firstReady.terminalId);

    expect(() => {
      manager.input(projectId, firstReady.terminalId, "stale input");
    }).toThrow("terminal_gone");
    const replacement = factory.processes[1];
    if (replacement === undefined)
      throw new Error("replacement PTY was not created");
    expect(replacement.writes).toEqual([]);

    manager.input(projectId, secondReady.terminalId, "current input");
    expect(replacement.writes).toEqual(["current input"]);
  });

  it("detaches an attachment after its terminal is restarted", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project);
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames: TerminalServerFrame[] = [];
    const detach = await manager.attach(projectId, project, {
      send: (frame) => frames.push(frame),
    });

    const ready = frames.at(-1);
    if (ready?.type !== "ready") throw new Error("terminal was not ready");
    await manager.restart(projectId, ready.terminalId);
    detach();
    const replacement = factory.processes[1];
    if (replacement === undefined)
      throw new Error("replacement PTY was not created");
    replacement.data("after-detach");

    expect(frames).not.toContainEqual(
      expect.objectContaining({ type: "output", data: "after-detach" }),
    );
  });

  it("contains malformed PTY output and sends bounded UTF-8 frames", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project);
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames: TerminalServerFrame[] = [];
    await manager.attach(projectId, project, {
      send: (frame) => frames.push(frame),
    });
    const process = factory.processes[0];
    if (process === undefined) throw new Error("fake PTY was not created");
    process.data({ unsupported: true });
    process.data("😀".repeat(300_000));
    for (const frame of frames) {
      expect(TerminalServerFrameSchema.parse(frame)).toEqual(frame);
      if (frame.type === "output")
        expect(Buffer.byteLength(frame.data)).toBeLessThanOrEqual(1_048_576);
    }
    expect(frames).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: "Terminal emitted malformed output.",
      }),
    );

    const replay: TerminalServerFrame[] = [];
    await manager.attach(projectId, project, {
      send: (frame) => replay.push(frame),
    });
    const replayOutput = replay.find(
      (frame): frame is Extract<TerminalServerFrame, { type: "output" }> =>
        frame.type === "output",
    );
    expect(replayOutput).toBeDefined();
    expect(Buffer.byteLength(replayOutput?.data ?? "")).toBeLessThanOrEqual(
      1_048_576,
    );
  });
});
