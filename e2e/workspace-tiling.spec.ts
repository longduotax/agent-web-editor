import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import type {
  AgentRuntime,
  OpenRuntimeSession,
  RuntimeEvent,
} from "../packages/agent-runtime/src/index.js";

import { buildServer, type WorkspaceServer } from "../apps/server/src/app.js";
import { parseConfig } from "../apps/server/src/config.js";

// Same stub runtime shape as e2e/workspace.spec.ts: prompt() never settles,
// which mirrors an agent run that stays "running" for the lifetime of the
// test (there is no live external agent in this harness).
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
  root = await mkdtemp(join(tmpdir(), "pi-web-e2e-tiling-"));
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
    runtime: new BrowserRuntime(),
    directoryPicker: {
      chooseDirectory: () => Promise.resolve(projectPath),
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

// The workspace's chord bindings use Cmd on mac and Alt elsewhere (see
// apps/web/src/features/workspace/keybindings.ts). Detect the platform the
// same way the app does (navigator.platform) so the chords resolve to a
// command regardless of which OS runs this suite.
async function primaryModifier(page: Page): Promise<"Meta" | "Alt"> {
  const isMac = await page.evaluate(() => /mac/i.test(navigator.platform));
  return isMac ? "Meta" : "Alt";
}

async function chord(page: Page, primary: "Meta" | "Alt", key: string) {
  await page.keyboard.press(`Shift+${primary}+${key}`);
}

// This spec's tsconfig has no "dom" lib (e2e/**/*.ts is type-checked as Node
// code), so `document` isn't a known global here even though this function's
// body only ever runs inside the page via page.evaluate. Give it a minimal,
// precise local type instead of widening to `any` or adding "dom" to the
// shared tsconfig for one assertion.
declare const document: {
  scrollingElement: { scrollWidth: number; clientWidth: number } | null;
};

function inPageHasNoHorizontalScroll(): boolean {
  const el = document.scrollingElement;
  return el !== null && el.scrollWidth <= el.clientWidth + 1;
}

test("splits, starts a thread in the new pane, collapses/restores/closes panes, no horizontal scroll", async ({
  page,
}) => {
  await page.goto(launchUrl);
  await page.getByRole("button", { name: "Browse…" }).click();
  const projectName = basename(projectPath);
  const projectLink = page.getByRole("link", { name: new RegExp(projectName) });
  await expect(projectLink).toBeVisible();

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
  // Starting a thread from an in-pane "New chat" form assigns the thread to
  // that pane without changing the route (panes, not the URL, own which
  // thread is showing) — so wait on the pane's content settling rather than
  // a URL change.
  await expect(
    page.getByText(/Pi tools run with your user permissions/),
  ).toBeVisible();

  const primary = await primaryModifier(page);

  // Split right: one pane with the thread we just started, one fresh
  // threadless "New chat" pane, focus moves to the new pane.
  await chord(page, primary, "=");
  await expect(page.getByRole("region")).toHaveCount(2);
  const newPaneRegion = page.getByRole("region", { name: "New chat" });
  await expect(newPaneRegion).toBeVisible();

  // Start a second thread from within the newly split pane.
  await newPaneRegion
    .getByRole("combobox", { name: "Execution location" })
    .selectOption("shared");
  await newPaneRegion
    .getByRole("textbox", { name: "First message" })
    .fill("Second pane prompt");
  await newPaneRegion
    .getByRole("button", { name: "Create chat and send" })
    .click();
  // Once the new pane adopts a thread it renders a ThreadPane (composer
  // labelled "Message Pi") in place of the NewChatPane form; wait for both
  // panes to have settled on that state.
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toHaveCount(
    2,
  );
  await expect(page.getByRole("region", { name: "New chat" })).toHaveCount(0);

  // Collapse the (still focused) second pane to the dock via the chord.
  await chord(page, primary, "ArrowDown");
  await expect(page.getByRole("region")).toHaveCount(1);
  const dock = page.getByRole("group", { name: "Docked panes" });
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("button")).toHaveCount(1);

  // Restore it via the chord; back to two tiled panes, dock empty again.
  await chord(page, primary, "ArrowUp");
  await expect(page.getByRole("region")).toHaveCount(2);
  await expect(page.getByRole("group", { name: "Docked panes" })).toHaveCount(
    0,
  );

  // Split again to get a fresh threadless pane, then close it via its
  // title-bar "Close" control (accessible name shared with ThreadPane's).
  await chord(page, primary, "=");
  const closablePane = page.getByRole("region", { name: "New chat" });
  await expect(closablePane).toBeVisible();
  await expect(page.getByRole("region")).toHaveCount(3);
  await closablePane.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("region", { name: "New chat" })).toHaveCount(0);
  await expect(page.getByRole("region")).toHaveCount(2);

  // The tiling surface must never force the page to scroll horizontally.
  const noHorizontalScroll = await page.evaluate(inPageHasNoHorizontalScroll);
  expect(noHorizontalScroll).toBe(true);
});
