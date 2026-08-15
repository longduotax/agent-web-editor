import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptAcceptance,
  RuntimeEvent,
} from "@pi-web/agent-runtime";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MetadataStore } from "../db/store.js";
import { LiveBroker } from "../live/broker.js";
import {
  ProjectTerminalManager,
  type PtyFactory,
  type PtyProcess,
} from "../terminal/manager.js";
import { WorkspaceService } from "./workspace.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class ControlledSession implements OpenRuntimeSession {
  public readonly id = "10000000-0000-4000-8000-000000000001";
  public promptCount = 0;
  public stopCount = 0;
  private settle:
    ((value: "completed" | "failed" | "interrupted") => void) | undefined;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  public promptGate: Promise<void> | undefined;
  public snapshot() {
    return Promise.resolve({
      sessionId: this.id,
      transcript: [],
      diagnostics: [],
    });
  }
  public async prompt(): Promise<PromptAcceptance> {
    this.promptCount += 1;
    await this.promptGate;
    const settlement = new Promise<"completed" | "failed" | "interrupted">(
      (resolve) => {
        this.settle = resolve;
      },
    );
    return {
      accepted: true,
      settlement,
      releaseEvents: () => undefined,
      discardEvents: () => undefined,
    };
  }
  public steer() {
    return Promise.resolve();
  }
  public stop() {
    this.stopCount += 1;
    this.settle?.("interrupted");
    return Promise.resolve();
  }
  public subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public dispose() {
    return Promise.resolve();
  }
  public complete(): void {
    this.settle?.("completed");
  }
}

class ControlledRuntime implements AgentRuntime {
  public readonly session = new ControlledSession();
  public created = 0;
  public discover() {
    return Promise.resolve({ sessions: [], diagnostics: [] });
  }
  public create() {
    this.created += 1;
    return Promise.resolve({
      sessionId: `10000000-0000-4000-8000-${String(this.created).padStart(12, "0")}`,
    });
  }
  public open() {
    return Promise.resolve(this.session);
  }
}

class DeferredPty implements PtyProcess {
  public killed = false;
  public write(): void {
    return undefined;
  }
  public resize(): void {
    return undefined;
  }
  public kill(): void {
    this.killed = true;
  }
  public onData(): { dispose(): void } {
    return { dispose: () => undefined };
  }
  public onExit(): { dispose(): void } {
    return { dispose: () => undefined };
  }
}

class DeferredPtyFactory implements PtyFactory {
  public readonly processes: DeferredPty[] = [];
  private resolve: ((process: PtyProcess) => void) | undefined;
  public spawn(): Promise<PtyProcess> {
    const process = new DeferredPty();
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

async function fixture(terminalCleanup?: {
  terminate(projectId: string): void;
}) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-runs-"));
  roots.push(root);
  const state = join(root, "state");
  const projectPath = join(root, "project");
  await mkdir(state, { mode: 0o700 });
  await mkdir(projectPath);
  const store = await MetadataStore.open({ stateDirectory: state });
  const runtime = new ControlledRuntime();
  const service = new WorkspaceService(
    store,
    runtime,
    new LiveBroker(),
    terminalCleanup,
  );
  const project = await service.registerSelectedProject(projectPath);
  const first = await service.createThread(project.id);
  const second = await service.createThread(project.id);
  return { store, runtime, service, project, projectPath, first, second };
}

describe("run coordination", () => {
  it("retains healthy list entries when persisted project or thread rows are corrupt", async () => {
    const context = await fixture();
    const healthyPath = join(context.projectPath, "healthy");
    await mkdir(healthyPath);
    const healthyProject =
      await context.service.registerSelectedProject(healthyPath);
    const healthyThread = await context.service.createThread(healthyProject.id);
    await context.service.close();
    context.store.close();

    const database = new Database(
      join(context.store.stateDirectory, "metadata.sqlite"),
    );
    database
      .prepare("UPDATE projects SET display_name = '' WHERE id = ?")
      .run(context.project.id);
    database
      .prepare("UPDATE threads SET title = '' WHERE id = ?")
      .run(context.first.id);
    database.close();

    const store = await MetadataStore.open({
      stateDirectory: context.store.stateDirectory,
    });
    const service = new WorkspaceService(
      store,
      context.runtime,
      new LiveBroker(),
    );
    const listed = await service.list();
    expect(listed.projects.map((project) => project.id)).toEqual([
      healthyProject.id,
    ]);
    expect(listed.threads.map((thread) => thread.id)).toContain(
      healthyThread.id,
    );
    expect(listed.diagnostics).toEqual([
      "A malformed stored project record was omitted.",
      "A malformed stored thread record was omitted.",
    ]);
    await service.close();
    store.close();
  });

  it("cleans a pending terminal when its project is removed", async () => {
    const factory = new DeferredPtyFactory();
    const terminals = new ProjectTerminalManager(factory);
    const context = await fixture(terminals);
    const attach = terminals.attach(context.project.id, context.projectPath, {
      send: () => undefined,
    });

    await vi.waitFor(() => {
      expect(factory.processes).toHaveLength(1);
    });
    await context.service.removeProject(
      context.project.id,
      "70000000-0000-4000-8000-000000000001",
    );
    factory.release();

    await expect(attach).rejects.toThrow("terminal_gone");
    const discarded = factory.processes[0];
    if (discarded === undefined)
      throw new Error("deferred PTY was not created");
    expect(discarded.killed).toBe(true);
    await context.service.close();
    context.store.close();
  });

  it("executes an idempotent prompt once and enforces the project lease", async () => {
    const context = await fixture();
    const key = "20000000-0000-4000-8000-000000000001";
    const run = await context.service.prompt(
      context.project.id,
      context.first.id,
      "Do the work",
      key,
    );
    const retry = await context.service.prompt(
      context.project.id,
      context.first.id,
      "Do the work",
      key,
    );
    expect(retry.id).toBe(run.id);
    expect(context.runtime.session.promptCount).toBe(1);
    await expect(
      context.service.prompt(
        context.project.id,
        context.second.id,
        "Other work",
        "20000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toThrow("project_busy");

    context.runtime.session.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.store.latestRun(context.first.id)?.state).toBe("completed");
    expect(context.store.unreadCount(context.project.id)).toBe(1);
    await context.service.close();
    context.store.close();
  });

  it("joins a concurrent prompt retry while runtime preflight is pending", async () => {
    const context = await fixture();
    let release: (() => void) | undefined;
    context.runtime.session.promptGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const key = "40000000-0000-4000-8000-000000000001";
    const first = context.service.prompt(
      context.project.id,
      context.first.id,
      "Work",
      key,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const retry = context.service.prompt(
      context.project.id,
      context.first.id,
      "Work",
      key,
    );
    release?.();
    const [run, replay] = await Promise.all([first, retry]);
    expect(replay.id).toBe(run.id);
    expect(context.runtime.session.promptCount).toBe(1);
    await context.service.close();
    context.store.close();
  });

  it.each([
    [
      "another operation",
      (context: Awaited<ReturnType<typeof fixture>>, key: string) =>
        context.service.createThread(context.project.id, "Different", key),
    ],
    [
      "a different prompt payload",
      (context: Awaited<ReturnType<typeof fixture>>, key: string) =>
        context.service.prompt(
          context.project.id,
          context.first.id,
          "Different",
          key,
        ),
    ],
  ])(
    "conflicts a concurrent command sharing an idempotency key with %s",
    async (_name, second) => {
      const context = await fixture();
      let release: (() => void) | undefined;
      context.runtime.session.promptGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const key = "41000000-0000-4000-8000-000000000001";
      const first = context.service.prompt(
        context.project.id,
        context.first.id,
        "Work",
        key,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const conflicting = second(context, key);
      release?.();
      await first;
      await expect(conflicting).rejects.toThrow("Idempotency key was reused");
      expect(context.runtime.created).toBe(2);
      expect(context.runtime.session.promptCount).toBe(1);
      await context.service.stop(
        context.project.id,
        context.first.id,
        "41000000-0000-4000-8000-000000000002",
      );
      await context.service.close();
      context.store.close();
    },
  );

  it("stops an accepted prompt when durable run finalization fails", async () => {
    const context = await fixture();
    const key = "60000000-0000-4000-8000-000000000001";
    const cursor = context.service.broker.cursor(context.first.id);
    vi.spyOn(context.store, "createRun").mockImplementationOnce(() => {
      throw new Error("storage_failed");
    });

    await expect(
      context.service.prompt(context.project.id, context.first.id, "Work", key),
    ).rejects.toThrow("storage_failed");

    expect(context.runtime.session.stopCount).toBe(1);
    expect(context.store.latestRun(context.first.id)).toBeNull();
    expect(context.service.broker.cursor(context.first.id)).toEqual(cursor);

    const replacement = await context.service.prompt(
      context.project.id,
      context.second.id,
      "Tracked work",
      "60000000-0000-4000-8000-000000000002",
    );
    expect(replacement.state).toBe("running");
    await context.service.stop(
      context.project.id,
      context.second.id,
      "60000000-0000-4000-8000-000000000003",
    );
    await context.service.close();
    context.store.close();
  });

  it("replays concurrent thread creation and a stop without repeating runtime work", async () => {
    const context = await fixture();
    const createKey = "30000000-0000-4000-8000-000000000001";
    const [first, replay] = await Promise.all([
      context.service.createThread(context.project.id, "Replay", createKey),
      context.service.createThread(context.project.id, "Replay", createKey),
    ]);
    expect(replay).toEqual(first);
    expect(context.runtime.created).toBe(3);
    await expect(
      context.service.createThread(context.project.id, "Changed", createKey),
    ).rejects.toThrow("Idempotency key was reused");

    const run = await context.service.prompt(
      context.project.id,
      context.first.id,
      "Stop this",
      "30000000-0000-4000-8000-000000000002",
    );
    const stopKey = "30000000-0000-4000-8000-000000000003";
    const stopped = await context.service.stop(
      context.project.id,
      context.first.id,
      stopKey,
    );
    const retried = await context.service.stop(
      context.project.id,
      context.first.id,
      stopKey,
    );
    expect(stopped).toEqual(retried);
    expect(stopped.id).toBe(run.id);
    expect(context.runtime.session.stopCount).toBe(1);
    await context.service.close();
    context.store.close();
  });

  it("releases an active run when its project is removed and restored", async () => {
    const context = await fixture();
    const run = await context.service.prompt(
      context.project.id,
      context.first.id,
      "Remove this project",
      "50000000-0000-4000-8000-000000000001",
    );

    await context.service.removeProject(
      context.project.id,
      "50000000-0000-4000-8000-000000000002",
    );

    const interrupted = context.store.latestRun(context.first.id);
    expect(interrupted).toMatchObject({
      id: run.id,
      state: "interrupted",
      failure_code: "project_removed",
      failure_message: "Interrupted because the project was removed.",
    });
    expect(context.runtime.session.stopCount).toBe(1);

    const restored = await context.service.registerSelectedProject(
      context.projectPath,
    );
    expect(restored.id).toBe(context.project.id);

    const replacement = await context.service.prompt(
      restored.id,
      context.first.id,
      "Start again",
      "50000000-0000-4000-8000-000000000003",
    );
    expect(replacement.state).toBe("running");
    await context.service.stop(
      restored.id,
      context.first.id,
      "50000000-0000-4000-8000-000000000004",
    );
    await context.service.close();
    context.store.close();
  });
});
