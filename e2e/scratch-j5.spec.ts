import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
    const id = `20000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
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
  root = await mkdtemp(join(tmpdir(), "pi-web-e2e-j5-"));
  const state = join(root, "state");
  projectPath = join(root, "project");
  await mkdir(state, { mode: 0o700 });
  await mkdir(projectPath);
  await writeFile(join(projectPath, "notes.txt"), "hello\n", "utf8");
  await writeFile(
    join(projectPath, "README.md"),
    "# The project's own README\n\nA paragraph.\n",
    "utf8",
  );
  await writeFile(
    join(projectPath, "main.ts"),
    "export const main = 1;\n".repeat(40),
    "utf8",
  );
  await writeFile(
    join(projectPath, "bundle.min.js"),
    `const bundle="${"payload-".repeat(375_000)}";\n`,
    "utf8",
  );
  const port = await availablePort();
  const config = parseConfig({
    argv: ["--port", String(port)],
    environment: { NODE_ENV: "production", PI_WEB_STATE_DIR: state },
  });
  server = await buildServer({
    config,
    runtime: new BrowserRuntime(),
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

async function startThreadInNewChatPane(pane: Locator, message: string) {
  await pane
    .getByRole("combobox", { name: "Execution location" })
    .selectOption("shared");
  await pane.getByRole("textbox", { name: "First message" }).fill(message);
  await pane.getByRole("button", { name: "Create chat and send" }).click();
}

async function openProjectWithThread(page: Page) {
  await page.goto(launchUrl);
  await page.getByRole("button", { name: "Browse…" }).click();
  const projectName = basename(projectPath);
  const projectLink = page.locator(".project-link").first();
  await expect(projectLink).toBeVisible();
  await projectLink.hover();
  await page
    .getByRole("button", { name: `New thread in ${projectName}` })
    .first()
    .click();
  await startThreadInNewChatPane(page.locator("body"), "Work in this project");
  await page.getByRole("button", { name: "Open workspace panel" }).click();
}

async function openPanelTab(page: Page, name: string) {
  await page.getByRole("button", { name: "New panel tab" }).first().click();
  await page.getByRole("menuitem", { name }).first().click();
}

async function clickTreeRow(page: Page, name: string) {
  await page
    .getByRole("treeitem", { name })
    .locator(".file-tree-line")
    .first()
    .click();
}

/** The cost of activating one tab, from the click to the frame after it. */
async function switchCost(page: Page, label: string): Promise<number> {
  return await page.evaluate(async (name: string) => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const tab = tabs.find((element) =>
      (element.textContent ?? "").includes(name),
    );
    if (tab === undefined) throw new Error(`no tab called ${name}`);
    const started = performance.now();
    (tab as HTMLElement).click();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    return performance.now() - started;
  }, label);
}

test("J5 measurement: what a hidden 2 MiB body costs every other tab", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await clickTreeRow(page, "notes.txt");
  await page.getByRole("tab", { name: "Files" }).click();
  await clickTreeRow(page, "README.md");
  await page.getByRole("tab", { name: "Files" }).click();
  await clickTreeRow(page, "main.ts");
  await expect(page.getByRole("tab", { name: "main.ts" })).toBeVisible();

  const rotate = async (): Promise<number[]> => {
    const costs: number[] = [];
    for (const label of ["Files", "notes.txt", "README.md", "main.ts"]) {
      costs.push(await switchCost(page, label));
      await page.waitForTimeout(120);
    }
    return costs;
  };

  // Warm, then three rotations with the huge tab absent.
  await rotate();
  const without: number[][] = [];
  for (let index = 0; index < 3; index += 1) without.push(await rotate());

  // Open the huge one, let it settle, then leave it hidden.
  await page.getByRole("tab", { name: "Files" }).click();
  await clickTreeRow(page, "bundle.min.js");
  await expect(page.getByRole("tab", { name: "bundle.min.js" })).toBeVisible();
  await page.waitForTimeout(3000);
  const painted = await page.evaluate(() => {
    const pre = document.querySelector(
      '[role="tabpanel"]:not([hidden]) .file-preview pre',
    );
    const text = pre?.textContent ?? "";
    let longest = 0;
    for (const line of text.split("\n"))
      longest = Math.max(longest, line.length);
    return {
      characters: text.length,
      longestLine: longest,
      scrollWidth: pre === null ? 0 : pre.scrollWidth,
      notices: [
        ...document.querySelectorAll(
          '[role="tabpanel"]:not([hidden]) .panel-state',
        ),
      ].map((element) => element.textContent),
    };
  });
  await page.getByRole("tab", { name: "Files" }).click();
  await page.waitForTimeout(500);

  await rotate();
  const withHidden: number[][] = [];
  for (let index = 0; index < 3; index += 1) withHidden.push(await rotate());

  // And the cost of switching TO it, which is where the paint actually is.
  const onto: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("tab", { name: "Files" }).click();
    await page.waitForTimeout(200);
    onto.push(await switchCost(page, "bundle.min.js"));
    await page.waitForTimeout(200);
  }
  console.log("J5 switching onto the huge tab:", JSON.stringify(onto));

  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  const summarise = (runs: number[][]) =>
    ["Files", "notes.txt", "README.md", "main.ts"].map(
      (label, index) =>
        `${label} ${String(Math.round(median(runs.map((run) => run[index] ?? 0))))}ms`,
    );

  console.log("J5 painted", JSON.stringify(painted, null, 1));
  console.log("J5 without the huge tab:", summarise(without).join("  "));
  console.log("J5 with it open and hidden:", summarise(withHidden).join("  "));
});
