import { access, constants, realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { spawn } from "node:child_process";

import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptAcceptance,
  RuntimeEvent,
} from "@pi-web/agent-runtime";
import {
  ProjectIdSchema,
  ProjectSchema,
  RunIdSchema,
  RunSchema,
  ThreadIdSchema,
  ThreadSnapshotSchema,
  ThreadSummarySchema,
  type Project,
  type ProjectId,
  type Run,
  type ThreadId,
  type ThreadSnapshot,
  type ThreadSummary,
  type TranscriptItem,
} from "@pi-web/contracts";

import {
  canonicalRequestHash,
  MetadataStore,
  type ProjectRecord,
  type RunRecord,
  type ThreadRecord,
} from "../db/store.js";
import { LiveBroker } from "../live/broker.js";

async function gitAvailable(path: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: path,
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timeout = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 2_000);
    child.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

async function available(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    await access(path, constants.R_OK | constants.X_OK);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function runDto(record: RunRecord): Run {
  return RunSchema.parse({
    id: record.id,
    threadId: record.thread_id,
    projectId: record.project_id,
    state: record.state,
    startedAt: record.started_at,
    endedAt: record.ended_at,
    failureCode: record.failure_code,
    failureMessage: record.failure_message,
  });
}

export class WorkspaceService {
  private readonly runtimes = new Map<
    ThreadId,
    { runtime: OpenRuntimeSession; unsubscribe: () => void }
  >();
  private readonly activeProjects = new Set<ProjectId>();

  public constructor(
    public readonly store: MetadataStore,
    private readonly runtime: AgentRuntime,
    public readonly broker: LiveBroker,
  ) {}

  public async projectDto(record: ProjectRecord): Promise<Project> {
    const isAvailable = await available(record.canonical_path);
    return ProjectSchema.parse({
      id: record.id,
      displayName: record.display_name,
      displayPath: basename(record.canonical_path),
      createdAt: record.created_at,
      sidebarExpanded: record.sidebar_expanded === 1,
      lastOpenedThreadId: record.last_opened_thread_id,
      available: isAvailable,
      gitAvailable: isAvailable && (await gitAvailable(record.canonical_path)),
      unreadCount: this.store.unreadCount(record.id),
    });
  }

  public threadDto(record: ThreadRecord): ThreadSummary {
    const latest = this.store.latestRun(record.id);
    return ThreadSummarySchema.parse({
      id: record.id,
      projectId: record.project_id,
      title: record.title,
      createdAt: record.created_at,
      lastActivityAt: record.last_activity_at,
      runState: latest?.state ?? null,
      unread: this.store.isUnread(record),
      runtimeAvailable: true,
    });
  }

  public async list(): Promise<{
    projects: Project[];
    threads: ThreadSummary[];
    diagnostics: string[];
  }> {
    const projects = await Promise.all(
      this.store.listProjects().map((project) => this.projectDto(project)),
    );
    return {
      projects,
      threads: this.store.listThreads().map((thread) => this.threadDto(thread)),
      diagnostics: [],
    };
  }

  public async addProject(
    path: string,
    displayName?: string,
    idempotencyKey?: string,
  ): Promise<Project> {
    const canonical = await realpath(path);
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new Error("project_not_directory");
    await access(canonical, constants.R_OK | constants.X_OK);
    if (idempotencyKey === undefined) {
      return await this.projectDto(
        this.store.registerProject(canonical, displayName),
      );
    }
    const hash = canonicalRequestHash("add-project", {
      canonical,
      displayName,
    });
    const prior = this.store.readReceipt(
      "process",
      idempotencyKey,
      "add-project",
      hash,
      ProjectIdSchema,
    );
    if (prior !== null)
      return await this.projectDto(this.requireProject(prior));
    const receipt = this.store.withReceipt(
      "process",
      idempotencyKey,
      "add-project",
      hash,
      ProjectIdSchema,
      () => this.store.registerProject(canonical, displayName).id,
    );
    return await this.projectDto(this.requireProject(receipt.response));
  }

  public async removeProject(projectId: ProjectId): Promise<void> {
    const project = this.store.getProject(projectId);
    if (project === null) throw new Error("project_not_found");
    for (const thread of this.store.listThreads(projectId))
      await this.disposeThread(thread.id);
    this.store.removeProject(projectId);
  }

  public async createThread(
    projectId: ProjectId,
    title?: string,
  ): Promise<ThreadSummary> {
    const project = this.requireProject(projectId);
    const created = await this.runtime.create(project.canonical_path);
    return this.threadDto(
      this.store.createThread(projectId, created.sessionId, title),
    );
  }

  public async importThread(
    projectId: ProjectId,
    sessionId: string,
    title?: string,
  ): Promise<ThreadSummary> {
    const project = this.requireProject(projectId);
    const sessions = await this.runtime.discover(project.canonical_path);
    const descriptor = sessions.sessions.find(
      (session) => session.id === sessionId,
    );
    if (descriptor === undefined) throw new Error("session_not_found");
    return this.threadDto(
      this.store.createThread(
        projectId,
        descriptor.id,
        title ??
          descriptor.name ??
          (descriptor.preview.slice(0, 80) || "Imported thread"),
      ),
    );
  }

  public async discoverSessions(projectId: ProjectId) {
    const project = this.requireProject(projectId);
    const result = await this.runtime.discover(project.canonical_path);
    const imported = new Set(
      this.store
        .listThreads(projectId)
        .map((thread) => thread.runtime_session_id),
    );
    return {
      sessions: result.sessions.map((session) => ({
        ...session,
        imported: imported.has(session.id),
      })),
      diagnostics: result.diagnostics,
    };
  }

  public renameThread(
    projectId: ProjectId,
    threadId: ThreadId,
    title: string,
  ): ThreadSummary {
    this.requireThread(projectId, threadId);
    return this.threadDto(this.store.renameThread(projectId, threadId, title));
  }

  private async openRuntime(thread: ThreadRecord): Promise<OpenRuntimeSession> {
    const current = this.runtimes.get(thread.id);
    if (current !== undefined) return current.runtime;
    const project = this.requireProject(thread.project_id);
    const runtime = await this.runtime.open(
      project.canonical_path,
      thread.runtime_session_id,
    );
    const unsubscribe = runtime.subscribe((event) => {
      this.onRuntimeEvent(thread, event);
    });
    this.runtimes.set(thread.id, { runtime, unsubscribe });
    return runtime;
  }

  private onRuntimeEvent(thread: ThreadRecord, event: RuntimeEvent): void {
    if (event.type === "transcript" || event.type === "transcript-update") {
      this.broker.publish(thread.id, "transcript", event.item);
    } else if (event.type === "diagnostic") {
      this.broker.publish(thread.id, "diagnostic", event);
    }
  }

  public async snapshot(
    projectId: ProjectId,
    threadId: ThreadId,
  ): Promise<ThreadSnapshot> {
    const thread = this.requireThread(projectId, threadId);
    const project = this.requireProject(projectId);
    this.store.setLastOpenedThread(projectId, threadId);
    let transcript: TranscriptItem[] = [];
    const diagnostics: string[] = [];
    try {
      const runtime = await this.openRuntime(thread);
      const native = await runtime.snapshot();
      transcript = native.transcript;
      diagnostics.push(...native.diagnostics);
    } catch {
      diagnostics.push("The native agent session is unavailable or malformed.");
    }
    const latest = this.store.latestRun(threadId);
    const current = latest?.state === "running" ? latest : null;
    const cursor = this.broker.cursor(threadId);
    return ThreadSnapshotSchema.parse({
      version: 1,
      project: await this.projectDto(project),
      thread: this.threadDto(thread),
      transcript,
      currentRun: current === null ? null : runDto(current),
      lastRun: latest === null ? null : runDto(latest),
      epoch: cursor.epoch,
      highWaterSequence: cursor.sequence,
      capabilities: {
        prompt: current === null,
        steer: current !== null,
        stop: current !== null,
      },
      diagnostics,
    });
  }

  public async prompt(
    projectId: ProjectId,
    threadId: ThreadId,
    text: string,
    idempotencyKey: string,
  ): Promise<Run> {
    const thread = this.requireThread(projectId, threadId);
    const hash = canonicalRequestHash("prompt", {
      projectId,
      threadId,
      text,
    });
    const prior = this.store.readReceipt(
      projectId,
      idempotencyKey,
      "prompt",
      hash,
      RunSchema,
    );
    if (prior !== null) return prior;
    if (
      this.activeProjects.has(projectId) ||
      this.store.runningRunForProject(projectId) !== null
    )
      throw new Error("project_busy");
    this.activeProjects.add(projectId);
    let pendingAcceptance: PromptAcceptance | undefined;
    try {
      const runtime = await this.openRuntime(thread);
      const acceptance = await runtime.prompt(text);
      pendingAcceptance = acceptance;
      if (!acceptance.accepted) throw new Error("prompt_rejected");
      const receipt = this.store.withReceipt(
        projectId,
        idempotencyKey,
        "prompt",
        hash,
        RunSchema,
        () => runDto(this.store.createRun(projectId, threadId, idempotencyKey)),
      );
      const run = RunSchema.parse(receipt.response);
      this.broker.publish(threadId, "run", run);
      acceptance.releaseEvents();
      pendingAcceptance = undefined;
      void acceptance.settlement
        .then((outcome) => {
          if (this.store.runningRunForProject(projectId)?.id !== run.id) return;
          const state =
            outcome === "completed"
              ? "completed"
              : outcome === "interrupted"
                ? "interrupted"
                : "failed";
          const settled = runDto(
            this.store.settleRun(
              run.id,
              state,
              state === "failed" ? "runtime_failure" : null,
              state === "failed" ? "Agent execution failed." : null,
            ),
          );
          this.activeProjects.delete(projectId);
          this.broker.publish(threadId, "completion", settled);
        })
        .catch(() => {
          if (this.store.runningRunForProject(projectId)?.id !== run.id) return;
          const settled = runDto(
            this.store.settleRun(
              run.id,
              "failed",
              "runtime_failure",
              "Agent execution failed.",
            ),
          );
          this.activeProjects.delete(projectId);
          this.broker.publish(threadId, "completion", settled);
        });
      return run;
    } catch (error) {
      pendingAcceptance?.discardEvents();
      this.activeProjects.delete(projectId);
      throw error;
    }
  }

  public async steer(
    projectId: ProjectId,
    threadId: ThreadId,
    text: string,
  ): Promise<Run> {
    const thread = this.requireThread(projectId, threadId);
    const run = this.store.runningRunForProject(projectId);
    if (run?.thread_id !== threadId) throw new Error("run_not_active");
    const runtime = await this.openRuntime(thread);
    await runtime.steer(text);
    return runDto(run);
  }

  public async stop(projectId: ProjectId, threadId: ThreadId): Promise<Run> {
    const thread = this.requireThread(projectId, threadId);
    const run = this.store.runningRunForProject(projectId);
    if (run?.thread_id !== threadId) throw new Error("run_not_active");
    const runtime = await this.openRuntime(thread);
    await runtime.stop();
    const settled = runDto(
      this.store.settleRun(
        run.id,
        "interrupted",
        "user_stop",
        "Stopped by the user.",
      ),
    );
    this.activeProjects.delete(projectId);
    this.broker.publish(threadId, "completion", settled);
    return settled;
  }

  public markViewed(
    projectId: ProjectId,
    threadId: ThreadId,
    runId: string,
  ): void {
    this.requireThread(projectId, threadId);
    this.store.markViewed(projectId, threadId, RunIdSchema.parse(runId));
  }

  public requireProject(id: string): ProjectRecord {
    const parsed = ProjectIdSchema.parse(id);
    const project = this.store.getProject(parsed);
    if (project === null) throw new Error("project_not_found");
    return project;
  }

  public requireThread(projectId: string, threadId: string): ThreadRecord {
    const project = ProjectIdSchema.parse(projectId);
    const thread = ThreadIdSchema.parse(threadId);
    const record = this.store.getThread(project, thread);
    if (record === null) throw new Error("thread_not_found");
    return record;
  }

  public async disposeThread(threadId: ThreadId): Promise<void> {
    const owner = this.runtimes.get(threadId);
    if (owner === undefined) return;
    this.runtimes.delete(threadId);
    owner.unsubscribe();
    await owner.runtime.dispose();
  }

  public async close(): Promise<void> {
    const owners = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.allSettled(
      owners.map(async (owner) => {
        owner.unsubscribe();
        await owner.runtime.dispose();
      }),
    );
  }
}
