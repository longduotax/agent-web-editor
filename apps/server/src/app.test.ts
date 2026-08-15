import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRuntime, OpenRuntimeSession } from "@pi-web/agent-runtime";
import {
  ProjectMutationResponseSchema,
  ProjectsResponseSchema,
} from "@pi-web/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "./app.js";
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

  it("persists project metadata without returning its canonical path", async () => {
    const paths = await directories();
    const config = parseConfig({
      argv: [],
      environment: { PI_WEB_STATE_DIR: paths.state },
    });
    let server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      logger: false,
    });
    let cookie = await sessionCookie(server);
    const added = await server.inject({
      method: "POST",
      url: "/api/projects",
      headers: { host, origin, cookie, "x-pi-web-request": "1" },
      payload: {
        path: paths.project,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(added.statusCode).toBe(200);
    const project = ProjectMutationResponseSchema.parse(added.json()).project;
    expect(JSON.stringify(project)).not.toContain(paths.project);
    await server.close();

    server = await buildServer({
      config,
      runtime: new FakeRuntime(),
      logger: false,
    });
    cookie = await sessionCookie(server);
    const listed = await server.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host, cookie },
    });
    const workspace = ProjectsResponseSchema.parse(listed.json());
    expect(workspace.projects.map((item) => item.id)).toEqual([project.id]);
    await server.close();
  });
});
