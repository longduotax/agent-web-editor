import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type {
  AgentRuntime,
  OpenRuntimeSession,
  PromptAcceptance,
  RuntimeEvent,
} from "../packages/agent-runtime/src/index.js";

import { buildServer, type WorkspaceServer } from "../apps/server/src/app.js";
import { parseConfig } from "../apps/server/src/config.js";

const SESSION = "10000000-0000-4000-8000-000000000001";

class LongHistorySession implements OpenRuntimeSession {
  public readonly id = SESSION;
  public snapshot() {
    return Promise.resolve({
      sessionId: this.id,
      transcript: Array.from({ length: 700 }, (_, index) => ({
        id: `message-${String(index)}`,
        kind: "message" as const,
        role: "assistant" as const,
        text: `History item ${String(index)}`,
        timestamp: null,
      })),
      diagnostics: [],
    });
  }
  public prompt(): Promise<PromptAcceptance> {
    return Promise.reject(new Error("not used"));
  }
  public recoverPrompt() {
    return Promise.resolve({ outcome: "not_accepted" as const });
  }
  public steer() {
    return Promise.resolve();
  }
  public stop() {
    return Promise.resolve();
  }
  public subscribe(listener: (event: RuntimeEvent) => void) {
    void listener;
    return () => undefined;
  }
  public dispose() {
    return Promise.resolve();
  }
}

class LongHistoryRuntime implements AgentRuntime {
  private readonly session = new LongHistorySession();
  public discover() {
    return Promise.resolve({ sessions: [], diagnostics: [] });
  }
  public create() {
    return Promise.resolve({ sessionId: SESSION });
  }
  public open() {
    return Promise.resolve(this.session);
  }
}

async function availablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not allocate test port"));
        return;
      }
      probe.close((error) => {
        if (error !== undefined) reject(error);
        else resolve(address.port);
      });
    });
  });
}

let server: WorkspaceServer;
let root: string;
let launchUrl: string;
let projectId: string;
let threadId: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pi-web-e2e-history-"));
  const state = join(root, "state");
  const project = join(root, "project");
  await mkdir(state, { mode: 0o700 });
  await mkdir(project);
  const port = await availablePort();
  const config = parseConfig({
    argv: ["--port", String(port)],
    environment: { NODE_ENV: "production", PI_WEB_STATE_DIR: state },
  });
  server = await buildServer({
    config,
    runtime: new LongHistoryRuntime(),
    logger: false,
  });
  const registered =
    await server.workspaceContext.workspace.registerSelectedProject(project);
  const thread = await server.workspaceContext.workspace.createThread(
    registered.id,
  );
  projectId = registered.id;
  threadId = thread.id;
  await server.listen({ host: config.host, port });
  launchUrl = server.workspaceContext.launchUrl;
});

test.afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

test("long history opens bounded, pages explicitly, and keeps only five pages", async ({
  page,
}) => {
  await page.goto(`${launchUrl}projects/${projectId}/threads/${threadId}`);
  await expect(page.getByText("History item 699")).toBeVisible();
  await expect(page.getByText("History item 0")).toHaveCount(0);

  for (let pageIndex = 0; pageIndex < 6; pageIndex += 1)
    await page.getByRole("button", { name: "Load earlier messages" }).click();

  await expect(page.getByText("History item 0")).toBeVisible();
  await expect(page.getByText("History item 699")).toHaveCount(0);
  await expect(page.locator(".a-block")).toHaveCount(500);

  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect(page.getByText("History item 699")).toBeVisible();
  await expect(page.locator(".a-block")).toHaveCount(100);
});
