import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRuntime, OpenRuntimeSession } from "@pi-web/agent-runtime";
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

async function sessionCookie(
  server: Awaited<ReturnType<typeof buildServer>>,
): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    headers: { host, origin, "x-pi-web-request": "1" },
    payload: { token: server.workspaceContext.auth.launchToken },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers["set-cookie"];
  if (typeof header !== "string") throw new Error("Missing session cookie");
  return header.split(";", 1)[0] ?? "";
}

describe("authenticated project API", () => {
  it("accepts canonical default-port origins for bootstrap and mutations", async () => {
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
    const canonicalHost = "127.0.0.1";
    const canonicalOrigin = "http://127.0.0.1";
    const bootstrap = await server.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      headers: {
        host: canonicalHost,
        origin: canonicalOrigin,
        "x-pi-web-request": "1",
      },
      payload: { token: server.workspaceContext.auth.launchToken },
    });
    expect(bootstrap.statusCode).toBe(200);
    const setCookie = bootstrap.headers["set-cookie"];
    if (typeof setCookie !== "string")
      throw new Error("Missing session cookie");
    const mutation = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: {
        host: canonicalHost,
        origin: canonicalOrigin,
        cookie: setCookie.split(";", 1)[0] ?? "",
        "x-pi-web-request": "1",
      },
      payload: { idempotencyKey: "00000000-0000-4000-8000-000000000001" },
    });
    expect(mutation.statusCode).toBe(200);
    await server.close();
  });

  it("requires process authentication, exact origin, and CSRF signal", async () => {
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
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/api/projects",
          headers: { host },
        })
      ).statusCode,
    ).toBe(401);
    const cookie = await sessionCookie(server);
    const rejected = await server.inject({
      method: "POST",
      url: "/api/projects",
      headers: {
        host,
        origin: "http://hostile.invalid",
        cookie,
        "x-pi-web-request": "1",
      },
      payload: {
        path: paths.project,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(rejected.statusCode).toBe(403);
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
    const cookie = await sessionCookie(server);
    const response = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, cookie, "x-pi-web-request": "1" },
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
      headers: { host, origin, cookie, "x-pi-web-request": "1" },
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
    const cookie = await sessionCookie(server);
    const cancelled = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, cookie, "x-pi-web-request": "1" },
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
      headers: { host, origin, cookie, "x-pi-web-request": "1" },
      payload: { idempotencyKey: "00000000-0000-4000-8000-000000000001" },
    });
    expect(BrowseProjectResponseSchema.parse(replay.json())).toEqual({
      outcome: "cancelled",
    });

    const malformed = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, cookie, "x-pi-web-request": "1" },
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
    const cookie = await sessionCookie(server);
    const response = await server.inject({
      method: "POST",
      url: "/api/projects/browse",
      headers: { host, origin, cookie, "x-pi-web-request": "1" },
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
    const cookie = await sessionCookie(server);
    const rejected = await server.inject({
      method: "POST",
      url: "/api/projects",
      headers: { host, origin, cookie, "x-pi-web-request": "1" },
      payload: {
        path: paths.project,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(rejected.statusCode).toBe(404);
    const listed = await server.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host, cookie },
    });
    const workspace = ProjectsResponseSchema.parse(listed.json());
    expect(workspace.projects).toEqual([]);
    await server.close();
  });
});
