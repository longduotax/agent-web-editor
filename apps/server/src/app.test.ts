import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptAcceptance,
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
  StartThreadResponseSchema,
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

  public snapshot(): Promise<{
    sessionId: string;
    transcript: [];
    diagnostics: [];
  }> {
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

  // WSP-05 as revised by specification version 2: the listing route gained a
  // depth bound and an ignore opt-in. Both are client-supplied strings, so
  // both are parsed rather than interpreted.
  it("bounds the file listing by depth and honours ignore rules", async () => {
    const paths = await directories();
    await mkdir(join(paths.project, "node_modules", "dep"), {
      recursive: true,
    });
    await mkdir(join(paths.project, "src"));
    await mkdir(join(paths.project, ".git"));
    await writeFile(join(paths.project, ".gitignore"), "node_modules\n");
    await writeFile(join(paths.project, "README.md"), "# The project\n");
    await writeFile(join(paths.project, "src", "main.ts"), "export const a=1;");
    await writeFile(
      join(paths.project, "node_modules", "dep", "README.md"),
      "# A dependency\n",
    );
    await writeFile(join(paths.project, ".git", "config"), "[core]\n");

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
    const start = await server.inject({
      method: "POST",
      url: `/api/projects/${project.id}/threads/start`,
      headers: { host, origin, "x-pi-web-request": "1" },
      payload: {
        prompt: "Browse the files",
        workspace: { mode: "shared" },
        idempotencyKey: "00000000-0000-4000-8000-000000000031",
      },
    });
    const thread = StartThreadResponseSchema.parse(start.json()).thread;
    const base = `/api/projects/${project.id}/threads/${thread.id}/files`;
    const list = async (query: string) => {
      const response = await server.inject({
        method: "GET",
        url: `${base}${query}`,
        headers: { host },
      });
      const body: unknown = response.json();
      return { status: response.statusCode, body };
    };

    const oneLevel = await list("?depth=1");
    expect(oneLevel.status).toBe(200);
    const shallow = FileTreeResponseSchema.parse(oneLevel.body);
    expect(shallow.entries.map((entry) => entry.path)).toEqual([
      "src",
      ".gitignore",
      "README.md",
    ]);
    expect(shallow.ignoredHidden).toBe(true);

    // No `depth` at all is the whole recursive listing, exactly as before.
    const full = FileTreeResponseSchema.parse((await list("")).body);
    expect(full.entries.map((entry) => entry.path)).toContain("src/main.ts");

    // The scenario the milestone exists for.
    const search = FileTreeResponseSchema.parse(
      (await list("?search=README.md")).body,
    );
    expect(search.entries.map((entry) => entry.path)).toEqual(["README.md"]);

    const revealed = FileTreeResponseSchema.parse(
      (await list("?depth=1&showIgnored=true")).body,
    );
    expect(revealed.entries.map((entry) => entry.path)).toContain(
      "node_modules",
    );
    // The opt-in reveals ignored paths; `.git` is not one of them.
    expect(revealed.entries.map((entry) => entry.path)).not.toContain(".git");
    expect(revealed.ignoredHidden).toBe(false);

    // A nested listing addresses the same root-relative paths.
    const nested = FileTreeResponseSchema.parse(
      (await list("?depth=1&path=src")).body,
    );
    expect(nested.entries.map((entry) => entry.path)).toEqual(["src/main.ts"]);

    for (const rejected of [
      "?depth=2",
      "?depth=full%20",
      "?depth=",
      "?showIgnored=1",
      "?showIgnored=TRUE",
      "?depth=1&path=../escape",
    ]) {
      expect((await list(rejected)).status).toBe(400);
    }

    // The filter used to be applied to entries encountered while walking and
    // never to the requested root, so a directory with no row to click was
    // reachable by asking for it (H2). Each of these answered 200.
    const excluded = await list("?path=.git&depth=1");
    expect(excluded.status).toBe(403);
    expect(excluded.body).toEqual({
      error: {
        code: "path_excluded",
        message: "The requested path is not available.",
      },
    });
    expect((await list("?path=.git/config&depth=1")).status).toBe(403);
    expect((await list("?path=.git&depth=1&showIgnored=true")).status).toBe(
      403,
    );
    const ignoredRoot = await list("?path=node_modules&depth=1");
    expect(ignoredRoot.status).toBe(403);
    expect(ignoredRoot.body).toEqual({
      error: {
        code: "path_ignored",
        message:
          "The requested path is hidden by this workspace's ignore rules.",
      },
    });
    // ...and the opt-in that reveals it in a listing also opens it.
    expect(
      (await list("?path=node_modules&depth=1&showIgnored=true")).status,
    ).toBe(200);

    // A directory that was expanded, persisted, and then deleted (H6). This
    // answered 500 `internal_error`, which says nothing a client can act on.
    const missing = await list("?path=does/not/exist&depth=1");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: {
        code: "path_not_found",
        message: "The requested path was not found.",
      },
    });
    expect((await list("?path=README.md&depth=1")).status).toBe(400);
    // Containment itself was never at fault and stays where it was.
    expect((await list("?path=../../../etc&depth=1")).status).toBe(400);

    const read = async (query: string) => {
      const response = await server.inject({
        method: "GET",
        url: `/api/projects/${project.id}/threads/${thread.id}/file${query}`,
        headers: { host },
      });
      return response.statusCode;
    };
    // `.git/config` returned the file, remote URL and all.
    expect(await read("?path=.git/config")).toBe(403);
    expect(await read("?path=does/not/exist")).toBe(404);
    expect(await read("?path=src")).toBe(400);
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
