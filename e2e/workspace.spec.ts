import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { expect, test } from "@playwright/test";
import type {
  AgentRuntime,
  OpenRuntimeSession,
  RuntimeEvent,
} from "../packages/agent-runtime/src/index.js";

import { buildServer, type WorkspaceServer } from "../apps/server/src/app.js";
import { parseConfig } from "../apps/server/src/config.js";

class BrowserSession implements OpenRuntimeSession {
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

class BrowserRuntime implements AgentRuntime {
  private nextId = 1;
  public discover() {
    return Promise.resolve({ sessions: [], diagnostics: [] });
  }
  public create() {
    const id = `10000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    return Promise.resolve({ sessionId: id });
  }
  public open(_projectPath: string, sessionId: string) {
    return Promise.resolve(new BrowserSession(sessionId));
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
  root = await mkdtemp(join(tmpdir(), "pi-web-e2e-"));
  const state = join(root, "state");
  projectPath = join(root, "project");
  await mkdir(state, { mode: 0o700 });
  await mkdir(projectPath);
  const port = await availablePort();
  const config = parseConfig({
    argv: ["--port", String(port)],
    environment: {
      NODE_ENV: "production",
      PI_WEB_STATE_DIR: state,
      // This spec asserts Pi's own execution disclosure, so it pins the
      // backend rather than riding on whatever the default happens to be.
      PI_WEB_DEFAULT_RUNTIME: "pi",
    },
  });
  let browseCount = 0;
  server = await buildServer({
    config,
    runtime: new BrowserRuntime(),
    directoryPicker: {
      chooseDirectory: () => {
        const currentBrowse = browseCount++;
        if (currentBrowse === 0) return Promise.resolve(projectPath);
        if (currentBrowse === 1) return Promise.resolve(null);
        return Promise.reject(new Error("directory_picker_failed"));
      },
    },
    logger: false,
  });
  await server.listen({ host: config.host, port });
  launchUrl = server.workspaceContext.launchUrl;
});

test.afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

test("adds a project, creates a route-addressable thread, and discloses direct execution", async ({
  page,
}) => {
  await page.goto(launchUrl);
  await expect(page.getByText("No projects yet")).toBeVisible();
  await expect(page.getByPlaceholder("/absolute/project/path")).toHaveCount(0);
  await page.getByRole("button", { name: "Browse…" }).click();
  const projectName = basename(projectPath);
  const projectLink = page.getByRole("link", { name: new RegExp(projectName) });
  await expect(projectLink).toBeVisible();

  const browse = page.getByRole("button", { name: "Browse…" });
  await browse.click();
  await expect(browse).toBeEnabled();
  await expect(projectLink).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await browse.click();
  await expect(page.getByRole("alert")).toHaveText(
    "The folder browser could not be opened.",
  );

  await projectLink.hover();
  await page
    .getByRole("button", { name: `New thread in ${projectName}` })
    .click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/new$/);
  await page
    .getByRole("combobox", { name: "Execution location" })
    .selectOption("shared");
  await page
    .getByRole("textbox", { name: "First message" })
    .fill("Inspect this project");
  await page.getByRole("button", { name: "Create chat and send" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/threads\/[0-9a-f-]+$/);
  await expect(
    page.getByText(/Pi tools run with your user permissions/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Pi tools run with your user permissions/),
  ).toBeVisible();

  const inspector = page.getByRole("complementary", {
    name: "Project inspector",
  });
  await expect(inspector).toHaveCount(0);
  await page.getByRole("button", { name: "Open inspector panel" }).click();
  await expect(inspector).toBeVisible();
  await page.getByRole("tab", { name: "Files" }).click();
  await page.getByRole("button", { name: "Close inspector panel" }).click();
  await expect(inspector).toHaveCount(0);
  await page.reload();
  await expect(inspector).toHaveCount(0);
  await page.getByRole("button", { name: "Open inspector panel" }).click();
  await expect(
    page.getByRole("tab", { name: "Files", selected: true }),
  ).toBeVisible();

  const separator = page.getByRole("separator", {
    name: "Resize inspector panel",
  });
  await page.waitForTimeout(250);
  const beforeResize = await inspector.boundingBox();
  const separatorBox = await separator.boundingBox();
  if (beforeResize === null || separatorBox === null)
    throw new Error("Inspector resize controls were not laid out");
  await page.mouse.move(
    separatorBox.x + separatorBox.width / 2,
    separatorBox.y + 20,
  );
  await page.mouse.down();
  await page.mouse.move(separatorBox.x - 160, separatorBox.y + 20);
  await page.mouse.up();
  const afterResize = await inspector.boundingBox();
  expect(afterResize?.width).toBeGreaterThan(beforeResize.width + 100);
  await page.reload();
  await expect(inspector).toBeVisible();
  const restored = await inspector.boundingBox();
  expect(restored?.width).toBeCloseTo(afterResize?.width ?? 0, 0);
});
