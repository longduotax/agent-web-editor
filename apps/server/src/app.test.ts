import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptAcceptance,
} from "@pi-web/agent-runtime";
import {
  BrowseProjectResponseSchema,
  ProjectsResponseSchema,
} from "@pi-web/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "./app.js";
import type { DirectoryPicker } from "./directory-picker/native.js";
import { parseConfig } from "./config.js";

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

  public discover(): Promise<{
    sessions: [];
    diagnostics: [];
  }> {
    return Promise.resolve({ sessions: [], diagnostics: [] });
  }

  public create(): Promise<{ sessionId: string }> {
    return Promise.resolve({ sessionId: this.session.id });
  }

  public open(): Promise<OpenRuntimeSession> {
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
