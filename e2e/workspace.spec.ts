import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { expect, test } from "@playwright/test";
import type {
  AgentRuntime,
  OpenRuntimeSession,
  RuntimeEvent,
  RuntimeUserInput,
} from "../packages/agent-runtime/src/index.js";

import { buildServer, type WorkspaceServer } from "../apps/server/src/app.js";
import { parseConfig } from "../apps/server/src/config.js";

class BrowserSession implements OpenRuntimeSession {
  public constructor(
    public readonly id: string,
    private readonly onPrompt: (input: RuntimeUserInput | string) => void,
  ) {}
  public snapshot() {
    return Promise.resolve({
      sessionId: this.id,
      transcript: [],
      diagnostics: [],
    });
  }
  public prompt(input: RuntimeUserInput | string) {
    this.onPrompt(input);
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
  private lastInput: RuntimeUserInput | string | null = null;
  public resetInput(): void {
    this.lastInput = null;
  }
  public receivedInput(): RuntimeUserInput | string | null {
    return this.lastInput;
  }
  public discover() {
    return Promise.resolve({ sessions: [], diagnostics: [] });
  }
  public create() {
    const id = `10000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    return Promise.resolve({ sessionId: id });
  }
  public open(_projectPath: string, sessionId: string) {
    return Promise.resolve(
      new BrowserSession(sessionId, (input) => {
        this.lastInput = input;
      }),
    );
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
let runtime: BrowserRuntime;
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
    environment: { NODE_ENV: "production", PI_WEB_STATE_DIR: state },
  });
  let browseCount = 0;
  runtime = new BrowserRuntime();
  server = await buildServer({
    config,
    runtime,
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
  // The path field EXISTS now (NEW-5 -- the chooser was the only way in and
  // it has no fallback when it misbehaves), but it stays folded away: the
  // sidebar's default state is still one label and one primary button.
  await expect(
    page.getByRole("textbox", { name: "Project directory path" }),
  ).toBeHidden();
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
  const browseFailure = page.getByRole("alert");
  await expect(browseFailure).toContainText(
    "The folder browser could not be opened.",
  );
  // G10: the notice used to have no way out. It is not tied to a retryable
  // mutation, so it carries a dismiss, and navigating away clears it too.
  await expect(
    browseFailure.getByRole("button", { name: "Dismiss this message" }),
  ).toBeVisible();
  await browseFailure
    .getByRole("button", { name: "Dismiss this message" })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await projectLink.hover();
  await page
    .getByRole("button", { name: `New thread in ${projectName}` })
    .click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/new$/);
  await page
    .getByRole("combobox", { name: "Execution location" })
    .selectOption("shared");
  // G7: the note used to say only that Pi would SEE the existing files. This
  // mode's defining property is that it WRITES to the user's own directory,
  // and it is the one irreversible choice on this screen.
  await expect(
    page.getByText("Pi writes to your project directory"),
  ).toBeVisible();
  // The base branch control does not apply here, and it used to sit greyed
  // out still displaying a branch, which reads as "it will use that one".
  await expect(
    page.getByRole("combobox", { name: "Base branch" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Base branch" }),
    // "Already on <branch>" where there is one, and this where there is not.
    // Either way it states a fact about the checkout rather than offering a
    // base branch it will not use.
  ).toContainText(/Already on |Whatever is checked out/);
  await page
    .getByRole("textbox", { name: "First message" })
    .fill("Inspect this project");
  await page.getByRole("button", { name: "Create chat and send" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/threads\/[0-9a-f-]+$/);
  // The pane shows a width-appropriate form of this and keeps the whole
  // sentence in the accessibility tree, so assert the complete wording rather
  // than whichever abbreviation the current width happens to select.
  const trustNotice =
    "Direct execution: Pi tools run with your user permissions, without application approval or an OS sandbox.";
  await expect(page.getByText(trustNotice, { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText(trustNotice, { exact: true })).toHaveCount(1);

  const panel = page.getByRole("complementary", {
    name: "Workspace panel",
  });
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Open workspace panel" }).click();
  await expect(panel).toBeVisible();
  // A second durable tab, opened for the focused pane's thread (WSP-02).
  await page.getByRole("button", { name: "New panel tab" }).click();
  await page.getByRole("menuitem", { name: "Files" }).click();
  await expect(
    page.getByRole("tab", { name: "Files", selected: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close workspace panel" }).click();
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Open workspace panel" }).click();
  // Both tabs came back, still with the same one selected (WSP-04).
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(
    page.getByRole("tab", { name: "Files", selected: true }),
  ).toBeVisible();

  const separator = page.getByRole("separator", {
    name: "Resize workspace panel",
  });
  await page.waitForTimeout(250);
  const beforeResize = await panel.boundingBox();
  const separatorBox = await separator.boundingBox();
  if (beforeResize === null || separatorBox === null)
    throw new Error("Panel resize controls were not laid out");
  await page.mouse.move(
    separatorBox.x + separatorBox.width / 2,
    separatorBox.y + 20,
  );
  await page.mouse.down();
  await page.mouse.move(separatorBox.x - 160, separatorBox.y + 20);
  await page.mouse.up();
  const afterResize = await panel.boundingBox();
  expect(afterResize?.width).toBeGreaterThan(beforeResize.width + 100);
  await page.reload();
  await expect(panel).toBeVisible();
  const restored = await panel.boundingBox();
  expect(restored?.width).toBeCloseTo(afterResize?.width ?? 0, 0);
});

test("attaches and sends an image-only message through the real multipart boundary", async ({
  page,
}) => {
  runtime.resetInput();
  await page.goto(launchUrl);
  const projectName = basename(projectPath);
  const projectLink = page.locator("a.project-link", { hasText: projectName });
  await expect(projectLink).toBeVisible();
  await projectLink.hover();
  await page
    .getByRole("button", { name: `New thread in ${projectName}` })
    .click();
  const pane = page.getByRole("region", { name: "New chat" });
  await pane
    .getByRole("combobox", { name: "Execution location" })
    .selectOption("shared");
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJ8AAAAASUVORK5CYII=",
    "base64",
  );
  await pane.locator('input[type="file"]').setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    pane.getByRole("img", { name: "Preview of pixel.png" }),
  ).toBeVisible();
  await expect(
    pane.getByText("stored in native Pi session history"),
  ).toBeVisible();
  await pane.getByRole("button", { name: "Create chat and send" }).click();
  await expect(page).toHaveURL(/\/threads\/[0-9a-f-]+$/);

  const input = runtime.receivedInput();
  if (input === null || typeof input === "string")
    throw new Error("The image input did not reach the runtime");
  expect(input.text).toBe("");
  expect(input.images).toHaveLength(1);
  expect(input.images[0]?.mimeType).toBe("image/png");
  expect(input.images[0]?.data.byteLength).toBe(image.byteLength);
});

// NEW-5. The single worst thing left in the product: the ONLY way to add a
// project was a native OS folder dialog. It opens as a separate window that
// can land behind the browser or on another desktop; when it fails the app
// says so and, until now, offered nothing else -- and adding a project is the
// first thing every reader must do.
//
// This drives the fallback the way a person would: open the disclosure, type
// a path, submit. The picker is untouched and still primary; the test above
// still exercises it.
test("adds a project by typing its path when the folder chooser cannot be used", async ({
  page,
}) => {
  const typedPath = join(root, "typed-project");
  await mkdir(typedPath, { recursive: true });

  await page.goto(launchUrl);
  const field = page.getByRole("textbox", { name: "Project directory path" });
  await expect(field).toBeHidden();
  await page.getByText("Or enter a path").click();
  await expect(field).toBeVisible();

  const add = page.getByRole("button", { name: "Add" });
  // Nothing to send yet, so nothing to press.
  await expect(add).toBeDisabled();

  // A path that is not there says so, in those words, rather than failing
  // generically -- a typo is the likeliest failure of a typed field.
  await field.fill(join(typedPath, "no-such-directory"));
  await add.click();
  const notice = page.getByRole("alert");
  await expect(notice).toContainText("There is nothing at that path.");

  // A relative path is refused rather than resolved against whatever
  // directory the server happens to be running in.
  await field.fill("relative/path");
  await add.click();
  await expect(page.getByRole("alert")).toContainText(
    "Enter the full path to the directory",
  );

  // And the real one lands: the row appears and the disclosure folds away.
  await field.fill(typedPath);
  await add.click();
  await expect(
    page.getByRole("link", { name: new RegExp(basename(typedPath)) }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(field).toBeHidden();

  // The picker is still there and still primary.
  await expect(page.getByRole("button", { name: "Browse…" })).toBeVisible();
});
