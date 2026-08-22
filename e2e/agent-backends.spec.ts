import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  AgentRuntime,
  OpenRuntimeSession,
  RuntimeEvent,
} from "../packages/agent-runtime/src/index.js";

import { buildServer, type WorkspaceServer } from "../apps/server/src/app.js";
import { parseConfig } from "../apps/server/src/config.js";

/**
 * Both backends are stubbed. The point of this spec is not to run a real Codex
 * — that needs an installed, signed-in CLI and is covered by the plan's manual
 * checks — but to prove the backend a user picks is the one recorded, shown,
 * and used, and that a Pi chat and a Codex chat coexist in one project.
 */
class StubSession implements OpenRuntimeSession {
  public constructor(public readonly id: string) {}
  public snapshot() {
    return Promise.resolve({
      sessionId: this.id,
      transcript: [],
      diagnostics: [],
    });
  }
  public prompt() {
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

class StubRuntime implements AgentRuntime {
  private next = 1;
  public constructor(private readonly prefix: string) {}
  public discover() {
    return Promise.resolve({ sessions: [], diagnostics: [] });
  }
  public create() {
    const id = `${this.prefix}0000-4000-8000-${String(this.next++).padStart(12, "0")}`;
    return Promise.resolve({ sessionId: id });
  }
  public open(_projectPath: string, sessionId: string) {
    return Promise.resolve(new StubSession(sessionId));
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
      const port = address.port;
      probe.close((error) => {
        if (error !== undefined) reject(error);
        else resolve(port);
      });
    });
  });
}

let server: WorkspaceServer;
let root: string;
let projectPath: string;
let launchUrl: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pi-web-e2e-backends-"));
  const state = join(root, "state");
  projectPath = join(root, "project");
  await mkdir(state, { mode: 0o700 });
  await mkdir(projectPath);
  const port = await availablePort();
  const config = parseConfig({
    argv: ["--port", String(port)],
    environment: { NODE_ENV: "production", PI_WEB_STATE_DIR: state },
  });
  server = await buildServer({
    config,
    runtimes: {
      pi: new StubRuntime("10000000-"),
      codex: new StubRuntime("20000000-"),
    },
    directoryPicker: { chooseDirectory: () => Promise.resolve(projectPath) },
    logger: false,
  });
  await server.listen({ host: config.host, port });
  launchUrl = server.workspaceContext.launchUrl;
});

test.afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

async function openProject(page: Page): Promise<void> {
  await page.goto(launchUrl);
  await page.getByRole("button", { name: "Browse…" }).click();
  const projectLink = page.getByRole("link", {
    name: new RegExp(basename(projectPath)),
  });
  await expect(projectLink).toBeVisible();
  await projectLink.click();
}

async function startChat(
  pane: Locator,
  agent: "Pi" | "Codex",
  message: string,
): Promise<void> {
  await pane
    .getByRole("combobox", { name: "Agent" })
    .selectOption(agent === "Pi" ? "pi" : "codex");
  await pane
    .getByRole("combobox", { name: "Execution location" })
    .selectOption("shared");
  await pane.getByRole("textbox", { name: "First message" }).fill(message);
  await pane.getByRole("button", { name: "Create chat and send" }).click();
}

test("a project runs Pi and Codex chats side by side, each labelled", async ({
  page,
}) => {
  await openProject(page);

  // Codex is the default, so the composer opens on it without being told.
  const firstPane = page.getByRole("region", { name: "New chat" });
  await expect(firstPane.getByRole("combobox", { name: "Agent" })).toHaveValue(
    "codex",
  );
  await startChat(firstPane, "Codex", "investigate the codex path");

  // The chat reports the agent that runs it, and addresses its composer to it.
  await expect(
    page.getByRole("textbox", { name: "Message Codex" }),
  ).toBeVisible();
  await expect(page.getByText("Codex").first()).toBeVisible();

  // AGB-01: with only a live chat on screen, nothing offers to change its
  // agent. The picker belongs to the new-chat composer alone.
  await expect(page.getByRole("combobox", { name: "Agent" })).toHaveCount(0);

  // Split, and start a Pi chat in the same project.
  await page.getByRole("button", { name: "Split" }).first().click();
  const secondPane = page.getByRole("region", { name: "New chat" });
  await startChat(secondPane, "Pi", "investigate the pi path");

  // Both chats live at once, each on its own backend.
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Codex" }),
  ).toBeVisible();
});
