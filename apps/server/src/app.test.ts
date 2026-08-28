import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptAcceptance,
  RuntimeSnapshot,
} from "@pi-web/agent-runtime";
import {
  ArchiveThreadResponseSchema,
  ArchivedThreadsResponseSchema,
  UnarchiveThreadResponseSchema,
  BrowseProjectResponseSchema,
  FilePreviewResponseSchema,
  FileTreeResponseSchema,
  GitDiffResponseSchema,
  GitStatusResponseSchema,
  ProjectsResponseSchema,
  AgentBackendsResponseSchema,
  StartThreadResponseSchema,
  ThreadSnapshotSchema,
  TranscriptPageSchema,
} from "@pi-web/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "./app.js";
import type { DirectoryPicker } from "./directory-picker/native.js";
import { parseConfig } from "./config.js";
import { GitWorktreeManager } from "./worktrees/manager.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class FakeRuntime implements AgentRuntime {
  public discover() {
    return Promise.resolve({ sessions: [], diagnostics: [] });
  }
  public create() {
    return Promise.resolve({
      sessionId: "10000000-0000-4000-8000-000000000001",
    });
  }
  public open(): Promise<OpenRuntimeSession> {
    return Promise.reject(new Error("not used"));
  }
}

class PromptingSession implements OpenRuntimeSession {
  public readonly id = "10000000-0000-4000-8000-000000000001";

  public snapshot(): Promise<RuntimeSnapshot> {
    return Promise.resolve({
      sessionId: this.id,
      transcript: [],
      diagnostics: [],
    });
  }

  public prompt(): Promise<PromptAcceptance> {
    return Promise.resolve({
      accepted: true,
      settlement: new Promise<"completed" | "failed" | "interrupted">(
        () => undefined,
      ),
      releaseEvents: () => undefined,
      discardEvents: () => undefined,
    });
  }

  public recoverPrompt() {
    return Promise.resolve({ outcome: "not_accepted" } as const);
  }

  public steer(): Promise<void> {
    return Promise.resolve();
  }

  public stop(): Promise<void> {
    return Promise.resolve();
  }

  public subscribe(): () => void {
    return () => undefined;
  }

  public dispose(): Promise<void> {
    return Promise.resolve();
  }
}

class PromptingRuntime implements AgentRuntime {
  private readonly session = new PromptingSession();
  public createdPath: string | null = null;
  public createdTitle: string | null = null;
  public openedPath: string | null = null;
  public createCount = 0;
  public namingCount = 0;

  public suggestTitle(): Promise<{ outcome: "available"; title: string }> {
    this.namingCount += 1;
    return Promise.resolve({
      outcome: "available",
      title: "Implement thread workspaces",
    });
  }

  public discover(): Promise<{
    sessions: [];
    diagnostics: [];
  }> {
    return Promise.resolve({ sessions: [], diagnostics: [] });
  }

  public create(path: string, title?: string): Promise<{ sessionId: string }> {
    this.createCount += 1;
    this.createdPath = path;
    this.createdTitle = title ?? null;
    return Promise.resolve({ sessionId: this.session.id });
  }

  public open(path: string): Promise<OpenRuntimeSession> {
    this.openedPath = path;
    return Promise.resolve(this.session);
  }
}

class HistorySession extends PromptingSession {
  public override snapshot(): Promise<RuntimeSnapshot> {
    return Promise.resolve({
      sessionId: this.id,
      transcript: Array.from({ length: 250 }, (_, index) => ({
        id: `message-${String(index)}`,
        kind: "message" as const,
        role: "assistant" as const,
        text: `message ${String(index)}`,
        timestamp: null,
      })),
      diagnostics: [],
    });
  }
}

class HistoryRuntime extends PromptingRuntime {
  private readonly history = new HistorySession();

  public override open(path: string): Promise<OpenRuntimeSession> {
    this.openedPath = path;
    return Promise.resolve(this.history);
  }
}

async function directories(): Promise<{ state: string; project: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-http-"));
  roots.push(root);
  const state = join(root, "state");
  const project = join(root, "project");
  await mkdir(state, { mode: 0o700 });
  await mkdir(project);
  return { state, project };
}

const host = "127.0.0.1:3001";
const origin = "http://127.0.0.1:5173";

describe("credential-free project API", () => {
  it("returns one bounded latest page and loads older history by opaque cursor", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({
      config,
      runtime: new HistoryRuntime(),
      logger: false,
    });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const thread = await server.workspaceContext.workspace.createThread(
      project.id,
    );

    const snapshotResponse = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/threads/${thread.id}`,
      headers: { host },
    });
    const snapshot = ThreadSnapshotSchema.parse(snapshotResponse.json());
    expect(snapshot.version).toBe(2);
    expect(snapshot.transcriptPage.items).toHaveLength(100);
    expect(snapshot.transcriptPage.items[0]?.id).toBe("message-150");
    expect(snapshot.transcriptPage.olderCursor).not.toBeNull();
    const cursor = snapshot.transcriptPage.olderCursor;
    if (cursor === null) throw new Error("Expected an older page");

    const olderResponse = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/threads/${thread.id}/transcript?cursor=${encodeURIComponent(cursor)}`,
      headers: { host },
    });
    expect(olderResponse.statusCode).toBe(200);
    const older = TranscriptPageSchema.parse(olderResponse.json());
    expect(older.items).toHaveLength(100);
    expect(older.items[0]?.id).toBe("message-50");
    await server.close();
  });

  it("creates and names a shared thread from its first prompt", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const runtime = new PromptingRuntime();
    const server = await buildServer({ config, runtime, logger: false });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const response = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/start`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        prompt: "Build thread worktree support",
        workspace: { mode: "shared" },
        idempotencyKey: "00000000-0000-4000-8000-000000000010",
      },
    });
    expect(response.statusCode).toBe(200);
    const parsed = StartThreadResponseSchema.parse(response.json());
    expect(parsed.thread.title).toBe("Implement thread workspaces");
    expect(parsed.thread.workspace.mode).toBe("shared");
    expect(parsed.run.state).toBe("running");
    const retry = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/start`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        prompt: "Build thread worktree support",
        workspace: { mode: "shared" },
        idempotencyKey: "00000000-0000-4000-8000-000000000010",
      },
    });
    expect(StartThreadResponseSchema.parse(retry.json())).toEqual(parsed);
    expect(runtime.namingCount).toBe(1);
    expect(runtime.createCount).toBe(1);
    await server.close();
  });

  it("creates a clean isolated thread and runs Pi in its worktree", async () => {
    const paths = await directories();
    await exec("git", ["init", "-b", "main"], { cwd: paths.project });
    await exec("git", ["config", "user.email", "test@example.invalid"], {
      cwd: paths.project,
    });
    await exec("git", ["config", "user.name", "Test"], {
      cwd: paths.project,
    });
    await writeFile(join(paths.project, "tracked.txt"), "committed\n");
    await exec("git", ["add", "."], { cwd: paths.project });
    await exec("git", ["commit", "-m", "initial"], { cwd: paths.project });
    await writeFile(join(paths.project, "tracked.txt"), "dirty\n");
    const runtime = new PromptingRuntime();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({ config, runtime, logger: false });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const preflight = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/workspace-preflight`,
      headers: { host },
    });
    expect(preflight.statusCode).toBe(200);
    const response = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/start`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        prompt: "Build isolated worktrees",
        workspace: {
          mode: "worktree",
          baseBranch: "main",
          sourceChanges: "none",
        },
        idempotencyKey: "00000000-0000-4000-8000-000000000011",
      },
    });
    expect(response.statusCode).toBe(200);
    const parsed = StartThreadResponseSchema.parse(response.json());
    expect(parsed.thread.workspace.mode).toBe("worktree");
    expect(runtime.createdPath).toContain(join("worktrees", project.id));
    expect(runtime.createdPath).not.toBe(paths.project);
    expect(runtime.openedPath).toBe(runtime.createdPath);
    expect(runtime.createdTitle).toBe("Implement thread workspaces");
    await server.close();
  });

  it("recovers a failed isolated provisioning retry only after proving its stored identity", async () => {
    const paths = await directories();
    await exec("git", ["init", "-b", "main"], { cwd: paths.project });
    await exec("git", ["config", "user.email", "test@example.invalid"], {
      cwd: paths.project,
    });
    await exec("git", ["config", "user.name", "Test"], {
      cwd: paths.project,
    });
    await writeFile(join(paths.project, "tracked.txt"), "committed\n");
    await exec("git", ["add", "."], { cwd: paths.project });
    await exec("git", ["commit", "-m", "initial"], { cwd: paths.project });
    const provision = vi
      .spyOn(GitWorktreeManager.prototype, "provision")
      .mockRejectedValueOnce(new Error("provision_failed"));
    const runtime = new PromptingRuntime();
    const server = await buildServer({
      config: parseConfig({
        argv: [],
        environment: { PI_WEB_STATE_DIR: paths.state },
      }),
      runtime,
      logger: false,
    });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const payload = {
      prompt: "Recover an isolated worktree",
      workspace: {
        mode: "worktree" as const,
        baseBranch: "main",
        sourceChanges: "none" as const,
      },
      idempotencyKey: "00000000-0000-4000-8000-000000000016",
    };
    const first = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/start`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload,
    });
    expect(first.statusCode).toBe(500);
    const creation = server.workspaceContext.store.getThreadCreation(
      project.id,
      payload.idempotencyKey,
    );
    if (creation?.worktree_id === undefined || creation.worktree_id === null)
      throw new Error("failed worktree creation was not stored");
    expect(creation.state).toBe("failed");
    expect(
      server.workspaceContext.store.getWorktree(creation.worktree_id)?.state,
    ).toBe("failed");
    expect(runtime.createCount).toBe(0);

    const retry = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/start`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload,
    });
    expect(retry.statusCode).toBe(200);
    const parsed = StartThreadResponseSchema.parse(retry.json());
    const recovered = server.workspaceContext.store.getThreadCreation(
      project.id,
      payload.idempotencyKey,
    );
    expect(recovered?.state).toBe("prompt_accepted");
    expect(parsed.thread.id).toBe(recovered?.thread_id);
    expect(runtime.createCount).toBe(1);
    expect(provision).toHaveBeenCalledTimes(2);
    await server.close();
    provision.mockRestore();
  });

  it("retains a failed isolated creation when recovery proof fails", async () => {
    const paths = await directories();
    await exec("git", ["init", "-b", "main"], { cwd: paths.project });
    await exec("git", ["config", "user.email", "test@example.invalid"], {
      cwd: paths.project,
    });
    await exec("git", ["config", "user.name", "Test"], {
      cwd: paths.project,
    });
    await writeFile(join(paths.project, "tracked.txt"), "committed\n");
    await exec("git", ["add", "."], { cwd: paths.project });
    await exec("git", ["commit", "-m", "initial"], { cwd: paths.project });
    const provision = vi
      .spyOn(GitWorktreeManager.prototype, "provision")
      .mockRejectedValueOnce(new Error("provision_failed"));
    const runtime = new PromptingRuntime();
    const server = await buildServer({
      config: parseConfig({
        argv: [],
        environment: { PI_WEB_STATE_DIR: paths.state },
      }),
      runtime,
      logger: false,
    });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const payload = {
      prompt: "Reject unproven recovery",
      workspace: {
        mode: "worktree" as const,
        baseBranch: "main",
        sourceChanges: "none" as const,
      },
      idempotencyKey: "00000000-0000-4000-8000-000000000017",
    };
    await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/start`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload,
    });
    const recoveryPlan = vi
      .spyOn(GitWorktreeManager.prototype, "recoveryPlan")
      .mockRejectedValueOnce(new Error("worktree_identity_failed"));
    const retry = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/start`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload,
    });
    expect(retry.statusCode).toBe(409);
    expect(
      server.workspaceContext.store.getThreadCreation(
        project.id,
        payload.idempotencyKey,
      )?.state,
    ).toBe("failed");
    expect(runtime.createCount).toBe(0);
    await server.close();
    recoveryPlan.mockRestore();
    provision.mockRestore();
  });

  it("requires a thread and scopes inspector endpoints to its worktree", async () => {
    const paths = await directories();
    await exec("git", ["init", "-b", "main"], { cwd: paths.project });
    await exec("git", ["config", "user.email", "test@example.invalid"], {
      cwd: paths.project,
    });
    await exec("git", ["config", "user.name", "Test"], {
      cwd: paths.project,
    });
    await writeFile(join(paths.project, "tracked.txt"), "committed\n");
    await exec("git", ["add", "."], { cwd: paths.project });
    await exec("git", ["commit", "-m", "initial"], { cwd: paths.project });
    await writeFile(join(paths.project, "tracked.txt"), "source only\n");
    await writeFile(join(paths.project, "source-only.txt"), "source only\n");

    const runtime = new PromptingRuntime();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({ config, runtime, logger: false });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const start = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/start`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        prompt: "Inspect an isolated worktree",
        workspace: {
          mode: "worktree",
          baseBranch: "main",
          sourceChanges: "none",
        },
        idempotencyKey: "00000000-0000-4000-8000-000000000012",
      },
    });
    const thread = StartThreadResponseSchema.parse(start.json()).thread;

    const files = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/threads/${thread.id}/files?search=source-only`,
      headers: { host },
    });
    expect(files.statusCode).toBe(200);
    expect(FileTreeResponseSchema.parse(files.json()).entries).toEqual([]);

    const file = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/threads/${thread.id}/file?path=tracked.txt`,
      headers: { host },
    });
    expect(file.statusCode).toBe(200);
    expect(FilePreviewResponseSchema.parse(file.json()).content).toBe(
      "committed\n",
    );

    const status = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/threads/${thread.id}/git/status`,
      headers: { host },
    });
    expect(status.statusCode).toBe(200);
    expect(GitStatusResponseSchema.parse(status.json()).files).toEqual([]);

    if (runtime.createdPath === null)
      throw new Error("worktree was not created");
    await writeFile(join(runtime.createdPath, "tracked.txt"), "thread only\n");
    const diff = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/threads/${thread.id}/git/diff?path=tracked.txt`,
      headers: { host },
    });
    expect(diff.statusCode).toBe(200);
    expect(GitDiffResponseSchema.parse(diff.json()).unstaged).toContain(
      "+thread only",
    );

    for (const url of [
      `/api/projects/${project.id}/files`,
      `/api/projects/${project.id}/file?path=tracked.txt`,
      `/api/projects/${project.id}/git/status`,
      `/api/projects/${project.id}/git/diff?path=tracked.txt`,
    ]) {
      const response = await server.inject({
        method: "GET",
        url,
        headers: { host },
      });
      expect(response.statusCode).toBe(404);
    }
    await server.close();
  });

  it("does not expose the legacy empty-thread creation route", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({
      config,
      runtime: new PromptingRuntime(),
      logger: false,
    });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );

    const response = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: { idempotencyKey: "00000000-0000-4000-8000-000000000099" },
    });

    expect(response.statusCode).toBe(404);
    await server.close();
  });

  it("archives a thread through a strict idempotent endpoint", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      logger: false,
    });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const thread = await server.workspaceContext.workspace.createThread(
      project.id,
    );
    const url = `/api/projects/${project.id}/threads/${thread.id}/archive`;
    const headers = { host, origin, "x-pi-web-request": "1" };

    const malformed = await server.inject({
      method: "POST",
      url,
      headers,
      payload: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        deleteHistory: true,
      },
    });
    expect(malformed.statusCode).toBe(400);

    const response = await server.inject({
      method: "POST",
      url,
      headers,
      payload: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(ArchiveThreadResponseSchema.parse(response.json())).toEqual({
      archived: true,
    });
    expect((await server.workspaceContext.workspace.list()).threads).toEqual(
      [],
    );
    const snapshot = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/threads/${thread.id}`,
      headers: { host },
    });
    expect(snapshot.statusCode).toBe(404);
    await server.close();
  });

  // The other half of the archive door: an archived thread must be listable
  // and restorable, or archiving is irreversible from the UI.
  it("lists archived threads and restores one through a strict idempotent endpoint", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      logger: false,
    });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const thread = await server.workspaceContext.workspace.createThread(
      project.id,
    );
    const headers = { host, origin, "x-pi-web-request": "1" };
    await server.workspaceContext.workspace.archiveThread(
      project.id,
      thread.id,
      "00000000-0000-4000-8000-000000000011",
    );

    const listed = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/archived-threads`,
      headers: { host },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      ArchivedThreadsResponseSchema.parse(listed.json()).threads.map(
        (entry) => entry.id,
      ),
    ).toEqual([thread.id]);

    const url = `/api/projects/${project.id}/threads/${thread.id}/unarchive`;
    const malformed = await server.inject({
      method: "POST",
      url,
      headers,
      payload: {
        idempotencyKey: "00000000-0000-4000-8000-000000000012",
        archived: false,
      },
    });
    expect(malformed.statusCode).toBe(400);

    const restored = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { idempotencyKey: "00000000-0000-4000-8000-000000000012" },
    });
    expect(restored.statusCode).toBe(200);
    expect(UnarchiveThreadResponseSchema.parse(restored.json())).toEqual({
      archived: false,
    });
    expect(
      (await server.workspaceContext.workspace.list()).threads.map(
        (entry) => entry.id,
      ),
    ).toEqual([thread.id]);
    const afterList = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/archived-threads`,
      headers: { host },
    });
    expect(
      ArchivedThreadsResponseSchema.parse(afterList.json()).threads,
    ).toEqual([]);
    const snapshot = await server.inject({
      method: "GET",
      url: `/api/projects/${project.id}/threads/${thread.id}`,
      headers: { host },
    });
    expect(snapshot.statusCode).toBe(200);
    await server.close();
  });

  it("maps a durable thread-run lease conflict to the busy response", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({
      config,
      runtime: new PromptingRuntime(),
      logger: false,
    });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const thread = await server.workspaceContext.workspace.createThread(
      project.id,
    );
    vi.spyOn(
      server.workspaceContext.store,
      "createRunIfProjectActive",
    ).mockImplementationOnce(() => {
      throw new Error("UNIQUE constraint failed: runs.thread_id");
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/${thread.id}/prompt`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        prompt: "Work",
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "project_busy",
        message: "Another agent run is active in this thread.",
      },
    });
    await server.close();
  });

  it("prints a plain launch URL and accepts canonical default-port origins for mutations", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: ["--port", "80"],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const directoryPicker: DirectoryPicker = {
      chooseDirectory: vi.fn().mockResolvedValue(null),
    };
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      directoryPicker,
      logger: false,
    });
    expect(server.workspaceContext.launchUrl).toBe("http://127.0.0.1:5173/");
    const mutation = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: {
        host: "127.0.0.1",
        origin: "http://127.0.0.1",
        "x-pi-web-request": "1",
      },
      payload: { idempotencyKey: "00000000-0000-4000-8000-000000000001" },
    });
    expect(mutation.statusCode).toBe(200);
    expect(mutation.headers["set-cookie"]).toBeUndefined();
    await server.close();
  });

  it("allows credential-free reads while requiring exact origin and CSRF signal for mutations", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      logger: false,
    });
    const listed = await server.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["set-cookie"]).toBeUndefined();
    const forgedHost = await server.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host: "hostile.invalid" },
    });
    expect(forgedHost.statusCode).toBe(403);
    const formerBootstrap = await server.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: { token: "x".repeat(32) },
    });
    expect(formerBootstrap.statusCode).toBe(404);
    const rejected = await server.inject({
      method: "POST",
      url: "/api/projects",
      headers: {
        host,
        origin: "http://hostile.invalid",
        "x-pi-web-request": "1",
      },
      payload: {
        path: paths.project,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(rejected.statusCode).toBe(403);
    const missingSignal = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin },
      payload: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(missingSignal.statusCode).toBe(403);
    await server.close();
  });

  // R2-4. Served at http://localhost:<port> the whole app was read-only:
  // every mutation came back 403 forbidden_request because the allowlist held
  // only the 127.0.0.1 spelling of the same loopback address. Both directions
  // are asserted here -- the rejection is the important half, because the
  // allowlist is the app's DNS-rebinding defence.
  it("accepts mutations from every loopback origin and still rejects non-loopback ones", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      directoryPicker: { chooseDirectory: vi.fn().mockResolvedValue(null) },
      logger: false,
    });

    for (const loopback of ["127.0.0.1", "localhost", "[::1]"]) {
      const accepted = await server.inject({
        method: "POST",
        url: "/api/projects/browse",
        headers: {
          host: `${loopback}:3001`,
          origin: `http://${loopback}:5173`,
          "x-pi-web-request": "1",
        },
        payload: { idempotencyKey: "00000000-0000-4000-8000-000000000001" },
      });
      expect(accepted.statusCode, `${loopback} must be accepted`).toBe(200);
    }

    for (const hostile of [
      "http://hostile.invalid",
      "http://localhost.hostile.invalid:5173",
      "http://127.0.0.1.hostile.invalid:5173",
      "https://localhost:5173",
      "http://192.168.1.10:5173",
    ]) {
      const rejected = await server.inject({
        method: "POST",
        url: "/api/projects/browse",
        headers: { host, origin: hostile, "x-pi-web-request": "1" },
        payload: { idempotencyKey: "00000000-0000-4000-8000-000000000002" },
      });
      expect(rejected.statusCode, `${hostile} must be rejected`).toBe(403);
      expect(rejected.json()).toEqual({
        error: {
          code: "forbidden_request",
          message: "Request origin or CSRF signal is invalid.",
        },
      });
    }

    // A forged Host header is still refused outright, on reads too.
    const forgedHost = await server.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host: "localhost.hostile.invalid:3001" },
    });
    expect(forgedHost.statusCode).toBe(403);

    await server.close();
  });

  it("accepts credential-free WebSocket upgrades from the configured origin", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      logger: false,
    });
    await server.ready();

    await expect(
      server.injectWS("/api/live", {
        headers: { host: "hostile.invalid", origin },
      }),
    ).rejects.toThrow(/403/);
    const rejectedSocket = await server.injectWS("/api/live", {
      headers: { host, origin: "http://hostile.invalid" },
    });
    const closeCode = await new Promise<number>((resolve) => {
      rejectedSocket.once("close", resolve);
    });
    expect(closeCode).toBe(1008);

    const socket = await server.injectWS("/api/live", {
      headers: { host, origin },
    });
    expect(socket.readyState).toBe(1);
    socket.close();
    await server.close();
  });

  it("registers a browsed directory without returning its native path", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const chooseDirectory = vi.fn().mockResolvedValue(paths.project);
    const directoryPicker: DirectoryPicker = { chooseDirectory };
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      directoryPicker,
      logger: false,
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });

    expect(response.statusCode).toBe(200);
    const result = BrowseProjectResponseSchema.parse(response.json());
    expect(result.outcome).toBe("selected");
    expect(response.body).not.toContain(paths.project);
    const replay = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: { idempotencyKey: "00000000-0000-4000-8000-000000000001" },
    });
    expect(BrowseProjectResponseSchema.parse(replay.json())).toEqual(result);
    expect(chooseDirectory).toHaveBeenCalledOnce();
    await server.close();
  });

  it("treats browse cancellation as a no-op and parses the request strictly", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const chooseDirectory = vi.fn().mockResolvedValue(null);
    const directoryPicker: DirectoryPicker = { chooseDirectory };
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      directoryPicker,
      logger: false,
    });
    const cancelled = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(BrowseProjectResponseSchema.parse(cancelled.json())).toEqual({
      outcome: "cancelled",
    });
    expect((await server.workspaceContext.workspace.list()).projects).toEqual(
      [],
    );

    const replay = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: { idempotencyKey: "00000000-0000-4000-8000-000000000001" },
    });
    expect(BrowseProjectResponseSchema.parse(replay.json())).toEqual({
      outcome: "cancelled",
    });

    const malformed = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
        path: paths.project,
      },
    });
    expect(malformed.statusCode).toBe(400);
    expect(chooseDirectory).toHaveBeenCalledOnce();
    await server.close();
  });

  it("redacts native picker failures", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const directoryPicker: DirectoryPicker = {
      chooseDirectory: vi
        .fn()
        .mockRejectedValue(new Error("directory_picker_failed")),
    };
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      directoryPicker,
      logger: false,
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "directory_picker_failed",
        message: "The folder browser could not be opened.",
      },
    });
    expect(response.body).not.toContain(paths.project);
    await server.close();
  });

  it("rejects browser-supplied paths without registering a project", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    const server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      logger: false,
    });
    const rejected = await server.inject({
      method: "POST",
      url: "/api/projects",
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        path: paths.project,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(rejected.statusCode).toBe(404);
    const listed = await server.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host },
    });
    const workspace = ProjectsResponseSchema.parse(listed.json());
    expect(workspace.projects).toEqual([]);
    await server.close();
  });
});

describe("agent backend selection over HTTP", () => {
  const headers = { host, origin, "x-pi-web-request": "1" };

  async function backendServer(defaultRuntime: string) {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: {
        PI_WEB_STATE_DIR: paths.state,
        PI_WEB_DEFAULT_RUNTIME: defaultRuntime,
      },
    });
    const pi = new PromptingRuntime();
    const codex = new PromptingRuntime();
    const server = await buildServer({
      config,
      runtimes: { pi, codex },
      logger: false,
    });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    return { server, project, pi, codex };
  }

  function start(
    server: Awaited<ReturnType<typeof buildServer>>,
    projectId: string,
    payload: Record<string, unknown>,
  ) {
    return server.inject({
      method: "POST",
      url: `/api/projects/${projectId}/threads/start`,
      headers,
      payload: {
        prompt: "do the thing",
        workspace: { mode: "shared" },
        idempotencyKey: randomUUID(),
        ...payload,
      },
    });
  }

  it("runs a chat on the configured default when none is requested", async () => {
    const { server, project } = await backendServer("codex");
    const response = await start(server, project.id, {});
    expect(response.statusCode).toBe(200);
    expect(
      StartThreadResponseSchema.parse(response.json()).thread.runtime,
    ).toBe("codex");
    await server.close();
  });

  it("honours an explicit backend over the default", async () => {
    const { server, project } = await backendServer("codex");
    const response = await start(server, project.id, { runtime: "pi" });
    expect(
      StartThreadResponseSchema.parse(response.json()).thread.runtime,
    ).toBe("pi");
    await server.close();
  });

  it("rejects a backend the contract does not define", async () => {
    const { server, project } = await backendServer("codex");
    const response = await start(server, project.id, { runtime: "claude" });
    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("reports the machine default and which backends are usable", async () => {
    const { server } = await backendServer("pi");
    const response = await server.inject({
      method: "GET",
      url: "/api/agent-backends",
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = AgentBackendsResponseSchema.parse(response.json());
    expect(body.defaultRuntime).toBe("pi");
    expect(body.backends.map((backend) => backend.kind)).toEqual([
      "pi",
      "codex",
    ]);
    await server.close();
  });

  it("leaves no thread behind when the chosen backend is unusable", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: {
        PI_WEB_STATE_DIR: paths.state,
        PI_WEB_DEFAULT_RUNTIME: "pi",
      },
    });
    const server = await buildServer({
      config,
      runtimes: { pi: new PromptingRuntime() },
      logger: false,
    });
    const project =
      await server.workspaceContext.workspace.registerSelectedProject(
        paths.project,
      );
    const response = await start(server, project.id, { runtime: "codex" });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);

    // A failed creation must leave nothing behind, not a half-made chat.
    expect(
      server.workspaceContext.store.listThreads(project.id, {
        includeArchived: true,
      }),
    ).toEqual([]);

    // The unavailable backend is reported as such rather than silently absent.
    const backends = await server.inject({
      method: "GET",
      url: "/api/agent-backends",
      headers,
    });
    const parsed = AgentBackendsResponseSchema.parse(backends.json());
    const codex = parsed.backends.find((entry) => entry.kind === "codex");
    expect(codex?.available).toBe(false);
    expect(codex?.reason).toMatch(/Codex/);
    await server.close();
  });
});
