import { access, constants, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { spawn } from "node:child_process";

import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptAcceptance,
  RuntimeEvent,
} from "@pi-web/agent-runtime";
import {
  BrowseProjectResponseSchema,
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
import { z } from "zod";

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

async function parseProjectRoot(path: unknown): Promise<string | null> {
  if (typeof path !== "string" || !isAbsolute(path)) return null;
  try {
    const canonical = await realpath(path);
    const info = await stat(canonical);
    if (!info.isDirectory()) return null;
    await access(canonical, constants.R_OK | constants.X_OK);
    return canonical;
  } catch {
    return null;
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

const browseReceiptSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("selected"), projectId: ProjectIdSchema }),
  z.object({ outcome: z.literal("cancelled") }),
]);
const removedReceiptSchema = z.object({ removed: z.literal(true) });
const viewedReceiptSchema = z.object({ viewed: z.literal(true) });

export class WorkspaceService {
  private readonly runtimes = new Map<
    ThreadId,
    { runtime: OpenRuntimeSession; unsubscribe: () => void }
  >();
  private readonly activeProjects = new Set<ProjectId>();
  private readonly inFlightCommands = new Map<
    string,
    { operation: string; requestHash: string; pending: Promise<unknown> }
  >();

  public constructor(
    public readonly store: MetadataStore,
    private readonly runtime: AgentRuntime,
    public readonly broker: LiveBroker,
    private readonly terminalCleanup: { terminate(projectId: string): void } = {
      terminate: () => undefined,
    },
  ) {}

  public async projectDto(record: ProjectRecord): Promise<Project> {
    const root = await parseProjectRoot(record.canonical_path);
    const isAvailable = root !== null;
    return ProjectSchema.parse({
      id: record.id,
      displayName: record.display_name,
      displayPath: basename(record.canonical_path),
      createdAt: record.created_at,
      sidebarExpanded: record.sidebar_expanded === 1,
      lastOpenedThreadId: record.last_opened_thread_id,
      available: isAvailable,
      gitAvailable: root !== null && (await gitAvailable(root)),
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
    const projectResults = this.store.listProjectResults();
    const threadResults = this.store.listThreadResults();
    const projectRecords = projectResults.flatMap((result) =>
      result.record === null ? [] : [result.record],
    );
    const threadRecords = threadResults.flatMap((result) =>
      result.record === null ? [] : [result.record],
    );
    return {
      projects: await Promise.all(
        projectRecords.map((project) => this.projectDto(project)),
      ),
      threads: threadRecords.map((thread) => this.threadDto(thread)),
      diagnostics: [...projectResults, ...threadResults]
        .flatMap((result) =>
          result.diagnostic === null ? [] : [result.diagnostic],
        )
        .slice(0, 100),
    };
  }

  private async serialized<T>(
    scope: string,
    key: string,
    operation: string,
    requestHash: string,
    parser: z.ZodType<T>,
    action: () => Promise<T>,
  ): Promise<T> {
    const lock = `${scope}:${key}`;
    const current = this.inFlightCommands.get(lock);
    if (current !== undefined) {
      if (
        current.operation === operation &&
        current.requestHash === requestHash
      )
        return parser.parse(await current.pending);
      try {
        await current.pending;
      } catch {
        // A failed command leaves no receipt to conflict with; run the normal
        // receipt check before this distinct command performs any work.
      }
      return await action();
    }
    const pending = action();
    const entry = { operation, requestHash, pending };
    this.inFlightCommands.set(lock, entry);
    try {
      return parser.parse(await pending);
    } finally {
      if (this.inFlightCommands.get(lock) === entry)
        this.inFlightCommands.delete(lock);
    }
  }

  private async canonicalProject(path: string): Promise<string> {
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch {
      throw new Error("project_unavailable");
    }
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(canonical);
    } catch {
      throw new Error("project_unavailable");
    }
    if (!info.isDirectory()) throw new Error("project_not_directory");
    try {
      await access(canonical, constants.R_OK | constants.X_OK);
    } catch {
      throw new Error("project_unavailable");
    }
    return canonical;
  }

  public async registerSelectedProject(path: string): Promise<Project> {
    const canonical = await this.canonicalProject(path);
    return await this.projectDto(this.store.registerProject(canonical));
  }

  public async browseProject(
    idempotencyKey: string,
    chooseDirectory: () => Promise<string | null>,
  ): Promise<z.infer<typeof BrowseProjectResponseSchema>> {
    const operation = "browse-project";
    const hash = canonicalRequestHash(operation, {});
    return await this.serialized<z.infer<typeof BrowseProjectResponseSchema>>(
      "process",
      idempotencyKey,
      operation,
      hash,
      BrowseProjectResponseSchema,
      async () => {
        const prior = this.store.readReceipt(
          "process",
          idempotencyKey,
          operation,
          hash,
          browseReceiptSchema,
        );
        if (prior !== null)
          return prior.outcome === "cancelled"
            ? { outcome: "cancelled" as const }
            : {
                outcome: "selected" as const,
                project: await this.projectDto(
                  this.requireProject(prior.projectId),
                ),
              };
        const selected = await chooseDirectory();
        if (selected === null) {
          this.store.withReceipt(
            "process",
            idempotencyKey,
            operation,
            hash,
            browseReceiptSchema,
            () => ({ outcome: "cancelled" as const }),
          );
          return { outcome: "cancelled" as const };
        }
        const canonical = await this.canonicalProject(selected);
        const receipt = this.store.withReceipt(
          "process",
          idempotencyKey,
          operation,
          hash,
          browseReceiptSchema,
          () => ({
            outcome: "selected" as const,
            projectId: this.store.registerProject(canonical).id,
          }),
        );
        if (receipt.response.outcome === "cancelled")
          return { outcome: "cancelled" as const };
        return {
          outcome: "selected" as const,
          project: await this.projectDto(
            this.requireProject(receipt.response.projectId),
          ),
        };
      },
    );
  }

  public async setProjectExpanded(
    projectId: ProjectId,
    expanded: boolean,
    idempotencyKey: string,
  ): Promise<Project> {
    const operation = "update-project";
    const hash = canonicalRequestHash(operation, { projectId, expanded });
    return await this.serialized(
      projectId,
      idempotencyKey,
      operation,
      hash,
      ProjectSchema,
      async () => {
        const prior = this.store.readReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          ProjectIdSchema,
        );
        if (prior !== null)
          return await this.projectDto(this.requireProject(prior));
        const receipt = this.store.withReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          ProjectIdSchema,
          () => {
            this.requireProject(projectId);
            this.store.setProjectExpanded(projectId, expanded);
            return projectId;
          },
        );
        return await this.projectDto(this.requireProject(receipt.response));
      },
    );
  }

  public async removeProject(
    projectId: ProjectId,
    idempotencyKey: string,
  ): Promise<void> {
    const operation = "remove-project";
    const hash = canonicalRequestHash(operation, { projectId });
    await this.serialized(
      projectId,
      idempotencyKey,
      operation,
      hash,
      removedReceiptSchema,
      async () => {
        const prior = this.store.readReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          removedReceiptSchema,
        );
        if (prior !== null) return { removed: true as const };
        const project = this.requireProject(projectId);
        this.interruptRunForProjectRemoval(project.id);
        for (const thread of this.store.listThreads(project.id))
          await this.disposeThread(thread.id);
        this.store.withReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          removedReceiptSchema,
          () => {
            this.store.removeProject(projectId);
            return { removed: true as const };
          },
        );
        this.terminalCleanup.terminate(projectId);
        return { removed: true as const };
      },
    );
  }

  private interruptRunForProjectRemoval(projectId: ProjectId): void {
    const run = this.store.runningRunForProject(projectId);
    if (run === null) return;
    const owner = this.runtimes.get(run.thread_id);
    if (owner !== undefined) {
      try {
        void owner.runtime.stop().catch(() => undefined);
      } catch {
        // Removing a project must release its persisted run lease even if the
        // in-memory runtime can no longer be interrupted.
      }
    }
    if (this.store.runningRunForProject(projectId)?.id !== run.id) return;
    const settled = runDto(
      this.store.settleRun(
        run.id,
        "interrupted",
        "project_removed",
        "Interrupted because the project was removed.",
      ),
    );
    this.activeProjects.delete(projectId);
    this.broker.publish(run.thread_id, "completion", settled);
  }

  public async createThread(
    projectId: ProjectId,
    title?: string,
    idempotencyKey?: string,
  ): Promise<ThreadSummary> {
    if (idempotencyKey === undefined)
      return await this.createThreadUnprotected(projectId, title);
    const operation = "create-thread";
    const hash = canonicalRequestHash(operation, { projectId, title });
    return await this.serialized(
      projectId,
      idempotencyKey,
      operation,
      hash,
      ThreadSummarySchema,
      async () => {
        const prior = this.store.readReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          ThreadIdSchema,
        );
        if (prior !== null)
          return this.threadDto(this.requireThread(projectId, prior));
        const created = await this.runtime.create(
          await this.requireProjectRoot(projectId),
        );
        const receipt = this.store.withReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          ThreadIdSchema,
          () => this.store.createThread(projectId, created.sessionId, title).id,
        );
        return this.threadDto(this.requireThread(projectId, receipt.response));
      },
    );
  }

  private async createThreadUnprotected(
    projectId: ProjectId,
    title?: string,
  ): Promise<ThreadSummary> {
    const created = await this.runtime.create(
      await this.requireProjectRoot(projectId),
    );
    return this.threadDto(
      this.store.createThread(projectId, created.sessionId, title),
    );
  }

  public async importThread(
    projectId: ProjectId,
    sessionId: string,
    title?: string,
    idempotencyKey?: string,
  ): Promise<ThreadSummary> {
    if (idempotencyKey !== undefined) {
      const operation = "import-thread";
      const hash = canonicalRequestHash(operation, {
        projectId,
        sessionId,
        title,
      });
      return await this.serialized(
        projectId,
        idempotencyKey,
        operation,
        hash,
        ThreadSummarySchema,
        async () => {
          const prior = this.store.readReceipt(
            projectId,
            idempotencyKey,
            operation,
            hash,
            ThreadIdSchema,
          );
          if (prior !== null)
            return this.threadDto(this.requireThread(projectId, prior));
          const sessions = await this.runtime.discover(
            await this.requireProjectRoot(projectId),
          );
          const descriptor = sessions.sessions.find(
            (session) => session.id === sessionId,
          );
          if (descriptor === undefined) throw new Error("session_not_found");
          const receipt = this.store.withReceipt(
            projectId,
            idempotencyKey,
            operation,
            hash,
            ThreadIdSchema,
            () =>
              this.store.createThread(
                projectId,
                descriptor.id,
                title ??
                  descriptor.name ??
                  (descriptor.preview.slice(0, 80) || "Imported thread"),
              ).id,
          );
          return this.threadDto(
            this.requireThread(projectId, receipt.response),
          );
        },
      );
    }
    const sessions = await this.runtime.discover(
      await this.requireProjectRoot(projectId),
    );
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
    const result = await this.runtime.discover(
      await this.requireProjectRoot(projectId),
    );
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
    idempotencyKey?: string,
  ): ThreadSummary {
    if (idempotencyKey !== undefined) {
      const operation = "rename-thread";
      const hash = canonicalRequestHash(operation, {
        projectId,
        threadId,
        title,
      });
      const prior = this.store.readReceipt(
        projectId,
        idempotencyKey,
        operation,
        hash,
        ThreadIdSchema,
      );
      if (prior !== null)
        return this.threadDto(this.requireThread(projectId, prior));
      const receipt = this.store.withReceipt(
        projectId,
        idempotencyKey,
        operation,
        hash,
        ThreadIdSchema,
        () => {
          this.requireThread(projectId, threadId);
          return this.store.renameThread(projectId, threadId, title).id;
        },
      );
      return this.threadDto(this.requireThread(projectId, receipt.response));
    }
    this.requireThread(projectId, threadId);
    return this.threadDto(this.store.renameThread(projectId, threadId, title));
  }

  private async openRuntime(thread: ThreadRecord): Promise<OpenRuntimeSession> {
    const current = this.runtimes.get(thread.id);
    if (current !== undefined) return current.runtime;
    const runtime = await this.runtime.open(
      await this.requireProjectRoot(thread.project_id),
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
    const operation = "prompt";
    const hash = canonicalRequestHash(operation, {
      projectId,
      threadId,
      text,
    });
    return await this.serialized(
      projectId,
      idempotencyKey,
      operation,
      hash,
      RunSchema,
      async () => {
        const prior = this.store.readReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          RunSchema,
        );
        if (prior !== null) return prior;
        const thread = this.requireThread(projectId, threadId);
        if (
          this.activeProjects.has(projectId) ||
          this.store.runningRunForProject(projectId) !== null
        )
          throw new Error("project_busy");
        this.activeProjects.add(projectId);
        let pendingAcceptance: PromptAcceptance | undefined;
        let acceptedRuntime: OpenRuntimeSession | undefined;
        try {
          const runtime = await this.openRuntime(thread);
          acceptedRuntime = runtime;
          const acceptance = await runtime.prompt(text);
          pendingAcceptance = acceptance;
          if (!acceptance.accepted) throw new Error("prompt_rejected");
          const receipt = this.store.withReceipt(
            projectId,
            idempotencyKey,
            operation,
            hash,
            RunSchema,
            () =>
              runDto(this.store.createRun(projectId, threadId, idempotencyKey)),
          );
          const run = RunSchema.parse(receipt.response);
          this.broker.publish(threadId, "run", run);
          acceptance.releaseEvents();
          pendingAcceptance = undefined;
          acceptedRuntime = undefined;
          void acceptance.settlement
            .then((outcome) => {
              if (this.store.runningRunForProject(projectId)?.id !== run.id)
                return;
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
              if (this.store.runningRunForProject(projectId)?.id !== run.id)
                return;
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
          if (pendingAcceptance?.accepted && acceptedRuntime !== undefined) {
            try {
              await acceptedRuntime.stop();
            } catch {
              // Preserve the persistence failure that left this prompt untracked.
            }
          }
          pendingAcceptance?.discardEvents();
          this.activeProjects.delete(projectId);
          throw error;
        }
      },
    );
  }

  public async steer(
    projectId: ProjectId,
    threadId: ThreadId,
    text: string,
    idempotencyKey: string,
  ): Promise<Run> {
    const operation = "steer";
    const hash = canonicalRequestHash(operation, { projectId, threadId, text });
    return await this.serialized(
      projectId,
      idempotencyKey,
      operation,
      hash,
      RunSchema,
      async () => {
        const prior = this.store.readReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          RunSchema,
        );
        if (prior !== null) return prior;
        const thread = this.requireThread(projectId, threadId);
        const run = this.store.runningRunForProject(projectId);
        if (run?.thread_id !== threadId) throw new Error("run_not_active");
        await (await this.openRuntime(thread)).steer(text);
        return this.store.withReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          RunSchema,
          () => runDto(run),
        ).response;
      },
    );
  }

  public async stop(
    projectId: ProjectId,
    threadId: ThreadId,
    idempotencyKey: string,
  ): Promise<Run> {
    const operation = "stop";
    const hash = canonicalRequestHash(operation, { projectId, threadId });
    return await this.serialized(
      projectId,
      idempotencyKey,
      operation,
      hash,
      RunSchema,
      async () => {
        const prior = this.store.readReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          RunSchema,
        );
        if (prior !== null) return prior;
        const thread = this.requireThread(projectId, threadId);
        const run = this.store.runningRunForProject(projectId);
        if (run?.thread_id !== threadId) throw new Error("run_not_active");
        await (await this.openRuntime(thread)).stop();
        const settled = this.store.withReceipt(
          projectId,
          idempotencyKey,
          operation,
          hash,
          RunSchema,
          () =>
            runDto(
              this.store.settleRun(
                run.id,
                "interrupted",
                "user_stop",
                "Stopped by the user.",
              ),
            ),
        ).response;
        this.activeProjects.delete(projectId);
        this.broker.publish(threadId, "completion", settled);
        return settled;
      },
    );
  }

  public markViewed(
    projectId: ProjectId,
    threadId: ThreadId,
    runId: string,
    idempotencyKey: string,
  ): void {
    const operation = "mark-viewed";
    const parsedRunId = RunIdSchema.parse(runId);
    const hash = canonicalRequestHash(operation, {
      projectId,
      threadId,
      runId: parsedRunId,
    });
    const prior = this.store.readReceipt(
      projectId,
      idempotencyKey,
      operation,
      hash,
      viewedReceiptSchema,
    );
    if (prior !== null) return;
    this.store.withReceipt(
      projectId,
      idempotencyKey,
      operation,
      hash,
      viewedReceiptSchema,
      () => {
        this.requireThread(projectId, threadId);
        this.store.markViewed(projectId, threadId, parsedRunId);
        return { viewed: true as const };
      },
    );
  }

  public requireProject(id: string): ProjectRecord {
    const parsed = ProjectIdSchema.parse(id);
    const project = this.store.getProject(parsed);
    if (project === null) throw new Error("project_not_found");
    return project;
  }

  public async requireProjectRoot(id: string): Promise<string> {
    const root = await parseProjectRoot(this.requireProject(id).canonical_path);
    if (root === null) throw new Error("project_unavailable");
    return root;
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
