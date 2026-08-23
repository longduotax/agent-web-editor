import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TERMINAL_MAX_PER_SCOPE,
  TerminalServerFrameSchema,
  type TerminalServerFrame,
} from "@pi-web/contracts";

import {
  ProjectTerminalManager,
  TerminalRejection,
  type PtyFactory,
  type PtyProcess,
} from "./manager.js";

const roots: string[] = [];
const projectId = "10000000-0000-4000-8000-000000000001";
const otherProjectId = "10000000-0000-4000-8000-000000000002";
const worktreeScope = "40000000-0000-4000-8000-000000000001";

class FakePty implements PtyProcess {
  public killed = false;
  public readonly writes: string[] = [];
  /**
   * The default is `null`, which is what the real adapter reports when it
   * cannot see a process id — and it exercises the unobservable-directory
   * path for free, on every test that does not care about it (WSP-07).
   */
  public pid: number | null = null;
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
  private readonly pending: {
    process: FakePty;
    resolve: (process: PtyProcess) => void;
  }[] = [];
  public spawn(): Promise<PtyProcess> {
    const process = new FakePty();
    this.processes.push(process);
    return new Promise((resolve) => {
      this.pending.push({ process, resolve });
    });
  }
  /** Settle the oldest spawn that has not settled yet. */
  public release(): void {
    const next = this.pending.shift();
    if (next === undefined) throw new Error("deferred PTY was not created");
    next.resolve(next.process);
  }
}

class FakeFactory implements PtyFactory {
  public readonly processes: FakePty[] = [];
  /** Every directory a spawn was asked for, in order. */
  public readonly directories: string[] = [];
  /** The process id every PTY this factory makes will report. */
  public pid: number | null = null;
  public spawn(cwd: string): PtyProcess {
    this.directories.push(cwd);
    const process = new FakePty();
    process.pid = this.pid;
    this.processes.push(process);
    return process;
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-"));
  roots.push(root);
  const project = join(root, "project");
  await mkdir(project);
  // Realpath'd, as the execution-context resolver hands every root over:
  // on macOS /var is a symlink to /private/var, and containment is checked
  // against the canonical spelling.
  return await realpath(project);
}

/** The frames one attachment received, and the terminal it was told about. */
function readyId(frames: readonly TerminalServerFrame[]): string {
  const ready = frames.find((frame) => frame.type === "ready");
  if (ready?.type !== "ready") throw new Error("terminal was not ready");
  return ready.terminalId;
}

function collector(): {
  frames: TerminalServerFrame[];
  send: (frame: TerminalServerFrame) => void;
} {
  const frames: TerminalServerFrame[] = [];
  return { frames, send: (frame) => frames.push(frame) };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("ProjectTerminalManager", () => {
  // WSP-07: a user working in one worktree legitimately wants a dev server
  // and a shell at the same time. Ownership is keyed by terminal id, so the
  // scope holds as many as the cap allows and each is its own process.
  it("opens several independent terminals in one execution scope", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const first = collector();
    const second = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: first,
    });
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: second,
    });

    expect(factory.processes).toHaveLength(2);
    const firstId = readyId(first.frames);
    const secondId = readyId(second.frames);
    expect(firstId).not.toBe(secondId);

    manager.input(projectId, secondId, "only the second");
    expect(factory.processes[0]?.writes).toEqual([]);
    expect(factory.processes[1]?.writes).toEqual(["only the second"]);

    // Output from one is not delivered to the other's attachment.
    factory.processes[0]?.data("first output");
    expect(second.frames).not.toContainEqual(
      expect.objectContaining({ type: "output", data: "first output" }),
    );
  });

  // WSP-07: the limit is stated and reported, never a silent failure. The
  // code is what lets the tab say which refusal this was (D-2).
  it("refuses a terminal past the per-scope cap, with a typed code", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    for (let index = 0; index < TERMINAL_MAX_PER_SCOPE; index += 1)
      await manager.attach({
        projectId,
        executionRoot: project,
        attachment: { send: () => undefined },
      });

    await expect(
      manager.attach({
        projectId,
        executionRoot: project,
        attachment: { send: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "terminal_limit_reached" });
    expect(factory.processes).toHaveLength(TERMINAL_MAX_PER_SCOPE);

    // The cap is per scope, so another worktree of the same project is
    // unaffected by a scope that has filled up.
    await manager.attach({
      projectId,
      scopeId: worktreeScope,
      executionRoot: project,
      attachment: { send: () => undefined },
    });
    expect(factory.processes).toHaveLength(TERMINAL_MAX_PER_SCOPE + 1);
  });

  // A creation in flight holds a slot. Without that, eight simultaneous
  // creates would each see an empty scope and the cap would bound nothing.
  it("counts a creation still in flight against the cap", async () => {
    const project = await temporaryRoot();
    const factory = new DeferredFactory();
    const manager = new ProjectTerminalManager(factory);
    const attaching = Array.from({ length: TERMINAL_MAX_PER_SCOPE }, () =>
      manager.attach({
        projectId,
        executionRoot: project,
        attachment: { send: () => undefined },
      }),
    );
    await vi.waitFor(() => {
      expect(factory.processes).toHaveLength(TERMINAL_MAX_PER_SCOPE);
    });

    await expect(
      manager.attach({
        projectId,
        executionRoot: project,
        attachment: { send: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "terminal_limit_reached" });

    for (let index = 0; index < TERMINAL_MAX_PER_SCOPE; index += 1)
      factory.release();
    await Promise.all(attaching);
    expect(factory.processes).toHaveLength(TERMINAL_MAX_PER_SCOPE);
  });

  // WSP-07: a reload re-attaches to the still-running process, with replay,
  // rather than orphaning it or starting a second shell. Naming the terminal
  // is what makes that possible now that a scope holds several.
  it("re-attaches to a named terminal with its replay, and starts no second shell", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const original = collector();
    const detach = await manager.attach({
      projectId,
      executionRoot: project,
      attachment: original,
    });
    const terminalId = readyId(original.frames);
    factory.processes[0]?.data("work in progress");
    detach();

    const reloaded = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      terminalId,
      attachment: reloaded,
    });

    expect(factory.processes).toHaveLength(1);
    expect(readyId(reloaded.frames)).toBe(terminalId);
    expect(reloaded.frames).toContainEqual(
      expect.objectContaining({ type: "output", data: "work in progress" }),
    );
    // And the reclaimed process is live for the new attachment.
    factory.processes[0]?.data("later");
    expect(reloaded.frames).toContainEqual(
      expect.objectContaining({ type: "output", data: "later" }),
    );
  });

  // The scope key alone no longer proves anything: resolving a terminal
  // requires its project AND its scope to equal the request's, so a live id
  // from another worktree or another project is rejected rather than
  // reachable.
  it("refuses a live terminal id from another scope or another project", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: frames,
    });
    const terminalId = readyId(frames.frames);

    await expect(
      manager.attach({
        projectId,
        scopeId: worktreeScope,
        executionRoot: project,
        terminalId,
        attachment: { send: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "terminal_gone" });
    await expect(
      manager.attach({
        projectId: otherProjectId,
        executionRoot: project,
        terminalId,
        attachment: { send: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "terminal_gone" });
    expect(() => {
      manager.input(projectId, terminalId, "elsewhere", worktreeScope);
    }).toThrow("terminal_gone");
    expect(() => {
      manager.input(otherProjectId, terminalId, "elsewhere");
    }).toThrow("terminal_gone");
    // Nothing reached the shell through any of those.
    expect(factory.processes[0]?.writes).toEqual([]);
    // And a terminal that never existed is gone rather than an internal error.
    await expect(
      manager.attach({
        projectId,
        executionRoot: project,
        terminalId: "50000000-0000-4000-8000-000000000009",
        attachment: { send: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "terminal_gone" });
  });

  // The scope index is what every scope-wide operation reads, so a terminal
  // that goes away has to leave it. If it does not, the cap counts ghosts.
  it("keeps the scope index consistent when a terminal exits or is terminated", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const first = collector();
    const second = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: first,
    });
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: second,
    });
    expect(manager.list(projectId, projectId)).toHaveLength(2);

    // One exits of its own accord...
    factory.processes[0]?.exit({ exitCode: 0 });
    expect(manager.list(projectId, projectId).map((entry) => entry.id)).toEqual(
      [readyId(second.frames)],
    );

    // ...and one is terminated explicitly.
    manager.terminate(projectId, readyId(second.frames));
    expect(manager.list(projectId, projectId)).toEqual([]);

    // Both slots came back: the cap counted what is live, not what once was.
    for (let index = 0; index < TERMINAL_MAX_PER_SCOPE; index += 1)
      await manager.attach({
        projectId,
        executionRoot: project,
        attachment: { send: () => undefined },
      });
    expect(manager.list(projectId, projectId)).toHaveLength(
      TERMINAL_MAX_PER_SCOPE,
    );
  });

  it("lists only the live terminals of the scope that asked", async () => {
    const project = await temporaryRoot();
    const manager = new ProjectTerminalManager(new FakeFactory());
    const shared = collector();
    const isolated = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: shared,
    });
    await manager.attach({
      projectId,
      scopeId: worktreeScope,
      executionRoot: project,
      attachment: isolated,
    });

    expect(manager.list(projectId, projectId)).toEqual([
      { id: readyId(shared.frames), cwd: null },
    ]);
    expect(manager.list(projectId, worktreeScope)).toEqual([
      { id: readyId(isolated.frames), cwd: null },
    ]);
    expect(manager.list(otherProjectId, projectId)).toEqual([]);
  });

  it("disposes every terminal, and every listener, on shutdown", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const first = collector();
    const second = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: first,
    });
    await manager.attach({
      projectId,
      scopeId: worktreeScope,
      executionRoot: project,
      attachment: second,
    });

    manager.close();

    expect(factory.processes.every((process) => process.killed)).toBe(true);
    expect(manager.list(projectId, projectId)).toEqual([]);
    expect(manager.list(projectId, worktreeScope)).toEqual([]);
    const before = [first.frames.length, second.frames.length];
    for (const process of factory.processes) {
      process.data("after shutdown");
      process.staleExit({ exitCode: 0 });
    }
    expect([first.frames.length, second.frames.length]).toEqual(before);
  });

  // WSP-07: a terminal starts where the tab says it does, and the directory
  // is resolved and contained exactly as a file read is. A path outside the
  // root is refused, not clamped — and refused BEFORE anything is spawned.
  it("spawns in a contained workspace-relative directory, and refuses one outside", async () => {
    const project = await temporaryRoot();
    await mkdir(join(project, "apps", "web"), { recursive: true });
    await writeFile(join(project, "notes.txt"), "hello\n", "utf8");
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);

    await manager.attach({
      projectId,
      executionRoot: project,
      cwd: "apps/web",
      attachment: { send: () => undefined },
    });
    expect(factory.directories).toEqual([join(project, "apps", "web")]);

    for (const cwd of [
      "../outside",
      "/etc",
      "apps/../../outside",
      "apps/missing",
      "notes.txt",
      ".git",
    ])
      await expect(
        manager.attach({
          projectId,
          executionRoot: project,
          cwd,
          attachment: { send: () => undefined },
        }),
      ).rejects.toMatchObject({ code: "terminal_cwd_invalid" });
    expect(factory.processes).toHaveLength(1);
  });

  // WSP-07: restart disposes and recreates, so the terminal id changes and
  // the client adopts the one in the new `ready` frame. The replacement
  // starts in the directory the tab recorded, which is what "restart carries
  // the working directory forward" means.
  it("restarts into the directory the client supplies, under a new id", async () => {
    const project = await temporaryRoot();
    await mkdir(join(project, "apps"));
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: frames,
    });
    const firstId = readyId(frames.frames);

    await manager.restart(projectId, firstId, projectId, "apps");

    const readyFrames = frames.frames.filter((frame) => frame.type === "ready");
    expect(readyFrames).toHaveLength(2);
    const replacementId = readyFrames[1];
    if (replacementId?.type !== "ready") throw new Error("no replacement");
    expect(replacementId.terminalId).not.toBe(firstId);
    expect(factory.directories).toEqual([project, join(project, "apps")]);
    expect(factory.processes[0]?.killed).toBe(true);

    // The old id is gone and the new one is live, in the same scope.
    expect(() => {
      manager.input(projectId, firstId, "stale");
    }).toThrow("terminal_gone");
    manager.input(projectId, replacementId.terminalId, "current");
    expect(factory.processes[1]?.writes).toEqual(["current"]);
    expect(manager.list(projectId, projectId)).toHaveLength(1);
  });

  // WSP-07 and WSP-09: the directory is polled at most once a second, and
  // ONLY while a client is attached. An unobserved terminal costs nothing.
  it("observes the working directory once a second, and only while attached", async () => {
    vi.useFakeTimers();
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    let observed = project;
    const observeCwd = vi.fn(() => Promise.resolve(observed));
    factory.pid = 4321;
    const manager = new ProjectTerminalManager(factory, {
      observeCwd,
      cwdObservable: true,
    });
    const frames = collector();
    const detach = await manager.attach({
      projectId,
      executionRoot: project,
      attachment: frames,
    });

    // A newly attached client is told what is known straight away, without
    // waiting for a poll: at this point, nothing.
    expect(frames.frames).toContainEqual(
      expect.objectContaining({ type: "cwd", cwd: null }),
    );

    observed = join(project, "apps", "web");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(observeCwd.mock.calls.length).toBeLessThanOrEqual(5);
    expect(observeCwd).toHaveBeenCalledWith(4321);
    expect(frames.frames).toContainEqual(
      expect.objectContaining({ type: "cwd", cwd: "apps/web" }),
    );
    // The value is pushed when it CHANGES, not once a second for ever.
    const pushes = frames.frames.filter((frame) => frame.type === "cwd").length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(frames.frames.filter((frame) => frame.type === "cwd").length).toBe(
      pushes,
    );

    detach();
    const callsWhileAttached = observeCwd.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(observeCwd.mock.calls.length).toBe(callsWhileAttached);
  });

  // A shell that has left the worktree, and a platform that cannot answer at
  // all, are both "not observable" rather than an absolute server path.
  it("reports a directory outside the execution root as unobservable", async () => {
    vi.useFakeTimers();
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    factory.pid = 4321;
    const manager = new ProjectTerminalManager(factory, {
      observeCwd: () => Promise.resolve("/somewhere/else"),
      cwdObservable: true,
    });
    const frames = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: frames,
    });

    await vi.advanceTimersByTimeAsync(3_000);
    for (const frame of frames.frames)
      if (frame.type === "cwd") expect(frame.cwd).toBeNull();
    expect(manager.list(projectId, projectId)).toEqual([
      { id: readyId(frames.frames), cwd: null },
    ]);
  });

  it("never probes a process it has no id for, or a platform that cannot answer", async () => {
    vi.useFakeTimers();
    const project = await temporaryRoot();
    const observeCwd = vi.fn(() => Promise.resolve(project));
    const withoutPid = new ProjectTerminalManager(new FakeFactory(), {
      observeCwd,
      cwdObservable: true,
    });
    await withoutPid.attach({
      projectId,
      executionRoot: project,
      attachment: { send: () => undefined },
    });

    const unsupportedFactory = new FakeFactory();
    unsupportedFactory.pid = 4321;
    const unsupported = new ProjectTerminalManager(unsupportedFactory, {
      observeCwd,
      cwdObservable: false,
    });
    await unsupported.attach({
      projectId,
      executionRoot: project,
      attachment: { send: () => undefined },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(observeCwd).not.toHaveBeenCalled();
  });

  it("kills a terminal that resolves after termination and does not reuse it", async () => {
    const project = await temporaryRoot();
    const factory = new DeferredFactory();
    const manager = new ProjectTerminalManager(factory);
    const attach = manager.attach({
      projectId,
      executionRoot: project,
      attachment: { send: () => undefined },
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
    expect(manager.list(projectId, projectId)).toEqual([]);

    const replacement = manager.attach({
      projectId,
      executionRoot: project,
      attachment: { send: () => undefined },
    });
    await vi.waitFor(() => {
      expect(factory.processes).toHaveLength(2);
    });
    factory.release();
    await replacement;
  });

  it("cleans removed terminal attachments and marks truncated replay", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const first = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: first,
    });
    const terminalId = readyId(first.frames);
    const old = factory.processes[0];
    if (old === undefined) throw new Error("fake PTY was not created");
    old.data("x".repeat(1_100_000));

    const second = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      terminalId,
      attachment: second,
    });
    expect(second.frames.map((frame) => frame.type).slice(0, 3)).toEqual([
      "ready",
      "reset",
      "output",
    ]);

    manager.terminate(projectId);
    expect(old.killed).toBe(true);
    old.data("later");
    expect(first.frames).not.toContainEqual(
      expect.objectContaining({ data: "later" }),
    );
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: { send: () => undefined },
    });
    expect(factory.processes).toHaveLength(2);
  });

  it("notifies attached clients before terminating a terminal", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: frames,
    });

    manager.terminate(projectId, readyId(frames.frames));

    expect(frames.frames.at(-1)).toEqual({
      version: 1,
      type: "exit",
      projectId,
      exitCode: 143,
      signal: 15,
    });
    expect(factory.processes[0]?.killed).toBe(true);
  });

  it("ignores a stale exit callback from a replaced process", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: frames,
    });
    const firstId = readyId(frames.frames);

    await manager.restart(projectId, firstId);
    const replacement = frames.frames.filter(
      (frame) => frame.type === "ready",
    )[1];
    if (replacement?.type !== "ready") throw new Error("no replacement");

    factory.processes[0]?.staleExit({ exitCode: 0 });

    expect(() => {
      manager.input(projectId, replacement.terminalId, "still running");
    }).not.toThrow();
  });

  it("keeps isolated execution scopes separate within one project", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-"));
    roots.push(root);
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    await mkdir(firstRoot);
    await mkdir(secondRoot);
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    await manager.attach({
      projectId,
      executionRoot: firstRoot,
      attachment: { send: () => undefined },
    });
    await manager.attach({
      projectId,
      scopeId: worktreeScope,
      executionRoot: secondRoot,
      attachment: { send: () => undefined },
    });
    expect(factory.directories).toEqual([firstRoot, secondRoot]);

    manager.terminate(projectId);
    expect(factory.processes.every((process) => process.killed)).toBe(true);
  });

  it("detaches an attachment after its terminal is restarted", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames = collector();
    const detach = await manager.attach({
      projectId,
      executionRoot: project,
      attachment: frames,
    });

    await manager.restart(projectId, readyId(frames.frames));
    detach();
    const replacement = factory.processes[1];
    if (replacement === undefined)
      throw new Error("replacement PTY was not created");
    replacement.data("after-detach");

    expect(frames.frames).not.toContainEqual(
      expect.objectContaining({ type: "output", data: "after-detach" }),
    );
  });

  it("contains malformed PTY output and sends bounded UTF-8 frames", async () => {
    const project = await temporaryRoot();
    const factory = new FakeFactory();
    const manager = new ProjectTerminalManager(factory);
    const frames = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: frames,
    });
    const terminalId = readyId(frames.frames);
    const process = factory.processes[0];
    if (process === undefined) throw new Error("fake PTY was not created");
    process.data({ unsupported: true });
    process.data("😀".repeat(300_000));
    for (const frame of frames.frames) {
      expect(TerminalServerFrameSchema.parse(frame)).toEqual(frame);
      if (frame.type === "output")
        expect(Buffer.byteLength(frame.data)).toBeLessThanOrEqual(1_048_576);
    }
    expect(frames.frames).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: "Terminal emitted malformed output.",
      }),
    );

    const replay = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      terminalId,
      attachment: replay,
    });
    const replayOutput = replay.frames.find(
      (frame): frame is Extract<TerminalServerFrame, { type: "output" }> =>
        frame.type === "output",
    );
    expect(replayOutput).toBeDefined();
    expect(Buffer.byteLength(replayOutput?.data ?? "")).toBeLessThanOrEqual(
      1_048_576,
    );
  });

  it("refuses input and dimensions outside their bounds", async () => {
    const project = await temporaryRoot();
    const manager = new ProjectTerminalManager(new FakeFactory());
    const frames = collector();
    await manager.attach({
      projectId,
      executionRoot: project,
      attachment: frames,
    });
    const terminalId = readyId(frames.frames);

    expect(() => {
      manager.input(projectId, terminalId, "x".repeat(65_537));
    }).toThrow("terminal_input_too_large");
    expect(() => {
      manager.resize(projectId, terminalId, 1, 30);
    }).toThrow("terminal_dimensions_invalid");
    expect(() => {
      manager.resize(projectId, terminalId, 100, 1000);
    }).toThrow("terminal_dimensions_invalid");
  });

  it("rejects with a typed rejection that carries its code", () => {
    const rejection = new TerminalRejection("terminal_limit_reached");
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection.code).toBe("terminal_limit_reached");
    expect(rejection.message).toBe("terminal_limit_reached");
  });
});
