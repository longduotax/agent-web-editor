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

// Same stub runtime shape as e2e/workspace.spec.ts: prompt() never settles,
// which mirrors an agent run that stays "running" for the lifetime of the
// test (there is no live external agent in this harness), and snapshot()
// always returns an empty transcript (the stub never calls the subscribe
// listener, so no tool/message events are ever appended). That means this
// harness can exercise the run-status pill (derived from the run's state,
// which the server sets synchronously to "running" on accept — see
// apps/server/src/domain/workspace.ts's prompt()/startThread()) but it can
// never produce actual transcript content: no user pill, no assistant
// flowing text, and no "Worked for" tool-activity header ever render here.
// Those Codex-reading-model DOM shapes are covered at the unit level instead
// (apps/web/src/features/workspace/ThreadPane.test.tsx and
// apps/web/src/components/Activity.test.tsx), which control the transcript
// items directly. This spec covers what the stub CAN produce end-to-end:
// pane run-status, split (button + chord), theme persistence, the single
// workspace panel, the non-destructive close and the sidebar's
// archive/undo flow, and the absence of any dock chrome or horizontal page
// scroll.
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
  documentElement: { getAttribute(name: string): string | null };
  querySelector(selector: string): unknown;
};
declare function getComputedStyle(element: unknown): {
  backgroundColor: string;
};

function inPageHasNoHorizontalScroll(): boolean {
  const el = document.scrollingElement;
  return el !== null && el.scrollWidth <= el.clientWidth + 1;
}

function pageDataTheme(): string | null {
  return document.documentElement.getAttribute("data-theme");
}

// C1 regression guard: the composer surface (styles.css's .composer-input)
// used to have a dark-only hardcoded background (#171b22) that never
// tokenized to the light theme's --card, so it stayed near-black even under
// the default (untouched, "System"/light) theme. Read its *rendered*
// background so a reintroduced hardcoded literal fails this instead of
// silently shipping a broken light theme again.
function composerInputBackground(): string | null {
  const el = document.querySelector(".composer-input");
  if (el === null) return null;
  return getComputedStyle(el).backgroundColor;
}

// Thread titles fall back to a deterministic derivation of the first prompt
// (apps/server/src/domain/workspace.ts's fallbackTitle, since the stub
// runtime never implements suggestTitle), so two panes need distinct prompt
// text to end up with distinguishable, assertable titles.
async function startThreadInNewChatPane(pane: Locator, message: string) {
  await pane
    .getByRole("combobox", { name: "Execution location" })
    .selectOption("shared");
  await pane.getByRole("textbox", { name: "First message" }).fill(message);
  await pane.getByRole("button", { name: "Create chat and send" }).click();
}

test("codex workspace surface: run status, split (button + chord), one docked panel, non-destructive close, visible sidebar actions, no dock", async ({
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
  await startThreadInNewChatPane(page.locator("body"), "Inspect this project");

  // The pane header's run-status pill is derived from the run's state, which
  // the server sets to "running" synchronously as part of accepting the
  // first prompt (apps/server/src/domain/workspace.ts) — so it's visible as
  // soon as the pane mounts, independent of the stub runtime ever settling.
  const panes = page.getByRole("region");
  await expect(panes.getByText("Working", { exact: true })).toBeVisible();

  // Light theme (the default here — Playwright's default colorScheme is
  // "light" and this test never touches the theme setting before this
  // point): the composer surface must render with --card's light value
  // (#ffffff), not the dark-only hardcoded literal it used to carry
  // regardless of theme. See C1 in the codex-workspace-surface fix wave.
  await expect
    .poll(() => page.evaluate(composerInputBackground))
    .toBe("rgb(255, 255, 255)");

  // The trust note is demoted to a single inline line inside the pane's
  // header region (CWS-01), never a full-width banner in the transcript
  // flow. Assert it renders inside a <header> ancestor rather than asserting
  // on a CSS class, so this stays a structural (not styling) check.
  const trustNote = page.getByText(/Pi tools run with your user permissions/);
  await expect(trustNote).toBeVisible();
  await expect(trustNote.locator("xpath=ancestor::header[1]")).toHaveCount(1);

  // Split right via the pane header's "Split" button (not the chord) — only
  // one pane exists yet, so this is unambiguous.
  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.getByRole("region")).toHaveCount(2);
  const newPaneRegion = page.getByRole("region", { name: "New chat" });
  await expect(newPaneRegion).toBeVisible();

  // Start a second thread in the newly split pane.
  await startThreadInNewChatPane(newPaneRegion, "Second pane prompt");
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toHaveCount(
    2,
  );
  await expect(page.getByRole("region", { name: "New chat" })).toHaveCount(0);
  // Both pane headers show a labeled run status.
  await expect(panes.getByText("Working", { exact: true })).toHaveCount(2);

  // Split again via the keyboard chord this time, covering both mechanisms.
  const primary = await primaryModifier(page);
  await chord(page, primary, "=");
  await expect(page.getByRole("region")).toHaveCount(3);
  const chordSplitPane = page.getByRole("region", { name: "New chat" });
  await expect(chordSplitPane).toBeVisible();

  // Close the fresh threadless pane immediately via its header's Close
  // button. That pane's card reaches the workspace surface's right edge, so
  // a real click here also guards CWS-06's "no control overlaps pane
  // content": nothing floats over the pane header any more. No undo toast
  // for a new-chat pane either way (nothing to archive).
  await chordSplitPane.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("region", { name: "New chat" })).toHaveCount(0);
  await expect(page.getByRole("region")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);

  // CWS-06, as superseded by WSP-01: exactly one region is docked right of
  // the pane surface, and it is the workspace panel. No standalone
  // Environment column and no control for one exists at any width.
  await expect(
    page.getByRole("complementary", { name: "Environment" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /environment/i })).toHaveCount(
    0,
  );

  // R2-5 / D-9: closing a threaded pane is a PURE LAYOUT OPERATION. It used
  // to archive the thread as a side effect behind a button labelled only
  // "Close". The pane leaves the layout; the thread stays in the sidebar and
  // nothing is archived.
  const threadRows = page.locator(".thread-list li");
  await expect(threadRows).toHaveCount(2);
  await expect(page.getByRole("region")).toHaveCount(2);
  await panes.first().getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("region")).toHaveCount(1);
  await expect(
    page.getByRole("status").filter({ hasText: "Archived" }),
  ).toHaveCount(0);
  await expect(threadRows).toHaveCount(2);

  // R2-6: archiving and renaming are reached through a per-thread actions
  // menu that is visible without hovering (it used to be a hover-only archive
  // icon plus a right-click-only Rename). No pointer has touched the sidebar
  // at this point in the test.
  const actionsButton = page
    .getByRole("button", { name: /^Actions for / })
    .first();
  await expect(actionsButton).toBeVisible();
  await actionsButton.click();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  // Both threads are mid-run in this harness (the stub never settles), so
  // Archive is correctly refused rather than offered.
  await expect(
    page.getByRole("menuitem", {
      name: "Archive (unavailable while running)",
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  // Nothing was archived by any of the above.
  await expect(threadRows).toHaveCount(2);
  await expect(
    page.getByRole("status").filter({ hasText: "Archived" }),
  ).toHaveCount(0);

  // No dock chrome anywhere (no element with "dock" in its visible text or
  // accessible name), and no horizontal page scroll.
  await expect(page.getByText(/dock/i)).toHaveCount(0);
  const noHorizontalScroll = await page.evaluate(inPageHasNoHorizontalScroll);
  expect(noHorizontalScroll).toBe(true);

  // Settings: System is selected by default (no explicit data-theme yet).
  await expect.poll(() => page.evaluate(pageDataTheme)).toBeNull();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const themeGroup = page.getByRole("radiogroup", { name: "Theme" });
  await expect(themeGroup).toBeVisible();
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();

  await page.getByRole("radio", { name: "Dark" }).click();
  await expect.poll(() => page.evaluate(pageDataTheme)).toBe("dark");

  // Reload and confirm the choice persisted — applied by the before-paint
  // inline script in apps/web/index.html, so it's already set by the time
  // any post-navigation check runs (the exact before-paint guarantee is unit
  // tested in apps/web/src/features/settings/useTheme.test.tsx).
  await page.reload();
  await expect.poll(() => page.evaluate(pageDataTheme)).toBe("dark");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
});
