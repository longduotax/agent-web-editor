import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptAcceptance,
  RuntimeEvent,
} from "@pi-web/agent-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { MetadataStore } from "../db/store.js";
import { LiveBroker } from "../live/broker.js";
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
  private settle:
    ((value: "completed" | "failed" | "interrupted") => void) | undefined;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  public snapshot() {
    return Promise.resolve({
      sessionId: this.id,
      transcript: [],
      diagnostics: [],
    });
  }
  public prompt(): Promise<PromptAcceptance> {
    this.promptCount += 1;
    const settlement = new Promise<"completed" | "failed" | "interrupted">(
      (resolve) => {
        this.settle = resolve;
      },
    );
    return Promise.resolve({
      accepted: true,
      settlement,
      releaseEvents: () => undefined,
      discardEvents: () => undefined,
    });
  }
  public steer() {
    return Promise.resolve();
  }
  public stop() {
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
  private created = 0;
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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-web-runs-"));
  roots.push(root);
  const state = join(root, "state");
  const projectPath = join(root, "project");
  await mkdir(state, { mode: 0o700 });
  await mkdir(projectPath);
  const store = await MetadataStore.open({ stateDirectory: state });
  const runtime = new ControlledRuntime();
  const service = new WorkspaceService(store, runtime, new LiveBroker());
  const project = await service.addProject(
    projectPath,
    undefined,
    "00000000-0000-4000-8000-000000000001",
  );
  const first = await service.createThread(project.id);
  const second = await service.createThread(project.id);
  return { store, runtime, service, project, first, second };
}

describe("run coordination", () => {
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
});
