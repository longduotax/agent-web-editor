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

// What the workspace panel can only be checked end to end: a real terminal
// against a real PTY, the keyboard chords, and the CSS. The unit suite had
// none of these, which is why D1 (a split killing every terminal in the
// group) and D13 (the terminal spilling out of its own tab body) both
// survived it.

// Same stub runtime as the other e2e specs: prompt() never settles, so a
// thread stays "running" for the life of the test and no transcript content
// is ever produced. The terminal, by contrast, is genuinely real — the
// server spawns a PTY through node-pty.
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

/**
 * Thirteen nested directories, so the file inside the last of them is a
 * level-14 row — the depth the hands-on pass measured as unreadable at
 * `PANEL_MIN_WIDTH`, with names of the length it saw there.
 */
const DEEP_CHAIN = [
  "packages",
  "integration",
  "fixtures",
  "elements",
  "playwright",
  "requests",
  "sessions",
  "specifications",
  "storage",
  "test-support",
  "utilities",
  "verification",
  "workspaces",
];

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pi-web-e2e-panel-"));
  const state = join(root, "state");
  projectPath = join(root, "project");
  await mkdir(state, { mode: 0o700 });
  await mkdir(projectPath);
  await writeFile(join(projectPath, "notes.txt"), "hello\n", "utf8");
  // One 937-character line, the shape that reproduced F2: the preview's
  // `pre` scrolled horizontally, but its scrollbar sat ~1600px below the
  // visible area of the tab body, so nothing could reach it with a pointer.
  const wideLine = `  {"note":"${"reachable-only-by-horizontal-scrolling-".repeat(24)}"},`;
  await writeFile(
    join(projectPath, "wide.json"),
    `[\n${wideLine}\n${'  {"note":"short"},\n'.repeat(200)}]\n`,
    "utf8",
  );
  // The working tree that produced the finding milestone 4 exists for: a
  // project README beside two hundred dependency copies of the same name,
  // with an ignore rule that says which is which.
  await writeFile(join(projectPath, ".gitignore"), "node_modules\n", "utf8");
  // Not a working repository — nothing here reads Git — but a real `.git`
  // directory, so "`.git` is excluded in both modes" is a claim this suite
  // can actually falsify.
  await mkdir(join(projectPath, ".git"));
  await writeFile(
    join(projectPath, ".git", "HEAD"),
    "ref: refs/heads/main\n",
    "utf8",
  );
  await writeFile(
    join(projectPath, "README.md"),
    "# The project's own README\n",
    "utf8",
  );
  await mkdir(join(projectPath, "src", "features"), { recursive: true });
  await writeFile(
    join(projectPath, "src", "main.ts"),
    "export const main = 1;\n",
    "utf8",
  );
  await writeFile(
    join(projectPath, "src", "features", "panel.ts"),
    "export const panel = 1;\n",
    "utf8",
  );
  // Two ordinary directories that exist only to be failed and to be deleted
  // (H5, H6), and one chain deep enough to reproduce the unreadable indent
  // at the panel's minimum width (H3): the reported case was level 14, whose
  // 11.05rem of padding left 44px for a name 128px wide.
  await mkdir(join(projectPath, "ops"));
  await writeFile(join(projectPath, "ops", "deploy.sh"), "#!/bin/sh\n", "utf8");
  await mkdir(join(projectPath, "gone"));
  await writeFile(join(projectPath, "gone", "leaving.txt"), "bye\n", "utf8");
  await mkdir(join(projectPath, DEEP_CHAIN.join("/")), { recursive: true });
  await writeFile(
    join(projectPath, ...DEEP_CHAIN, "session-storage.spec.ts"),
    "export const deep = 1;\n",
    "utf8",
  );
  for (let index = 0; index < 200; index += 1) {
    const dependency = join(
      projectPath,
      "node_modules",
      `dep-${String(index)}`,
    );
    await mkdir(dependency, { recursive: true });
    await writeFile(
      join(dependency, "README.md"),
      `# dependency ${String(index)}\n`,
      "utf8",
    );
  }
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

// This spec's tsconfig has no "dom" lib (e2e/**/*.ts is type-checked as Node
// code), so the page globals get precise local types rather than `any`.
interface ProbeElement {
  id: string;
  clientWidth: number;
  clientHeight: number;
  offsetHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  className: string;
  textContent: string | null;
  parentElement: ProbeElement | null;
  querySelector(selector: string): ProbeElement | null;
  querySelectorAll(selector: string): Iterable<ProbeElement>;
  getBoundingClientRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
declare const document: {
  head: { appendChild(node: unknown): void };
  documentElement: ProbeElement;
  createElement(tag: string): { textContent: string };
  querySelector(selector: string): ProbeElement | null;
  querySelectorAll(selector: string): Iterable<ProbeElement>;
  elementFromPoint(x: number, y: number): ProbeElement | null;
};
declare function getComputedStyle(element: ProbeElement): {
  display: string;
  fontSize: string;
  getPropertyValue(property: string): string;
  borderTopColor: string;
  backgroundColor: string;
  boxShadow: string;
  opacity: string;
  position: string;
  paddingTop: string;
  paddingBottom: string;
};
declare const window: { __sentFrames?: string[] };
declare const WebSocket: {
  prototype: { send: (this: unknown, data: unknown) => void };
};

/**
 * Records every frame the page sends on any WebSocket.
 *
 * Installed before the app loads, because the terminal's socket is opened
 * the moment its tab is mounted. F3 is about a frame that must NOT be sent.
 */
function recordSentFrames(): void {
  const frames: string[] = [];
  window.__sentFrames = frames;
  const original = WebSocket.prototype.send;
  WebSocket.prototype.send = function send(data: unknown): void {
    if (typeof data === "string") frames.push(data);
    original.call(this, data);
  };
}

/** How many `resize` frames the page has sent so far. */
async function resizeFrameCount(page: Page): Promise<number> {
  const frames = await page.evaluate(() => window.__sentFrames ?? []);
  return frames.filter((frame) => {
    const parsed: unknown = JSON.parse(frame);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === "resize"
    );
  }).length;
}

/**
 * F3. The height of the group the terminal is in, and of the terminal.
 *
 * The split-refusal announcement was an ordinary flex item of the `.panel`
 * column, so posting it shortened every group by its own height — measured
 * 1383px -> 1357px -> 1383px across one refusal, with a `resize rows:73`
 * to the running shell on the way down and a `rows:75` on the way back up
 * five seconds later. A message telling the user that nothing happened must
 * not itself be the thing that happens.
 */
function announcementGeometry() {
  const group = document.querySelector(".panel-group");
  const surface = document.querySelector(".terminal-surface");
  const announcement = document.querySelector(".panel-announcement");
  return {
    groupHeight: group === null ? -1 : group.clientHeight,
    surfaceHeight: surface === null ? -1 : surface.clientHeight,
    announcementPosition:
      announcement === null ? "" : getComputedStyle(announcement).position,
  };
}

/** The docked edge's rendered elevation, in whichever theme is active. */
function panelEdge() {
  const panel = document.querySelector(".panel");
  const rail = document.querySelector(".panel-rail");
  return {
    shadow: panel === null ? "" : getComputedStyle(panel).boxShadow,
    opacity: panel === null ? "" : getComputedStyle(panel).opacity,
    railShadow: rail === null ? "none" : getComputedStyle(rail).boxShadow,
  };
}

/** How the panel's chords are spelled on whichever OS runs this suite. */
async function primaryModifier(page: Page): Promise<"Meta" | "Alt"> {
  const isMac = await page.evaluate(() => /mac/i.test(navigator.platform));
  return isMac ? "Meta" : "Alt";
}

async function panelChord(page: Page, key: string) {
  const primary = await primaryModifier(page);
  await page.keyboard.press(`Shift+${primary}+Alt+${key}`);
}

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
  // Every test in this file registers the same directory against the same
  // server, so the sidebar accumulates threads whose names also contain the
  // project name; address the project row itself.
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

/**
 * The terminal's own box, and the tab body that holds it.
 *
 * D13's whole mechanism lives in the difference between `scroll*` and
 * `client*` here. xterm leaves a stale, oversized scrollbar element inside
 * `.xterm-scrollable-element` when a terminal shrinks — 570px of it inside a
 * 210px terminal, measured — and while `.terminal-surface` was
 * `overflow: visible` that spilled out of the tab body and made the whole
 * panel body scrollable. On a machine whose scrollbars consume layout space
 * (macOS "always show scroll bars", which is what the reporter runs) the
 * resulting scrollbar shrinks the surface, the fit addon's ResizeObserver
 * fires, the terminal re-fits, its content height changes, and the scrollbar
 * flips again: the flicker. Headless Chromium uses zero-width overlay
 * scrollbars, so it never converts the overflow into a layout change — which
 * is exactly why no test caught this. The overflow itself is the honest
 * thing to assert, and it is present or absent regardless of scrollbars.
 */
function terminalGeometry() {
  const body = document.querySelector('[role="tabpanel"]:not([hidden])');
  const surface = document.querySelector(".terminal-surface");
  const screen = document.querySelector(".xterm-screen");
  return {
    bodyOverflowX: body === null ? -1 : body.scrollWidth - body.clientWidth,
    bodyOverflowY: body === null ? -1 : body.scrollHeight - body.clientHeight,
    // `.terminal-surface` clips its own content, so its scrollHeight can
    // still exceed its box; what must never happen is that overflow reaching
    // the tab body, which is what `bodyOverflow*` measures.
    surfaceClips: surface !== null,
    screenWidth: screen === null ? -1 : screen.clientWidth,
    screenHeight: screen === null ? -1 : screen.clientHeight,
  };
}

/**
 * F2. The File tab's `pre` and the tab body that holds it.
 *
 * The reported symptom was "content is clipped with no horizontal scroll",
 * and both earlier hypotheses (a missing `min-width: 0`, an overflowing
 * ancestor) were wrong: nothing overflowed the panel and the `pre` did
 * scroll. What it did not do was END anywhere near the screen — measured at
 * `pre` bottom y=2634 against a visible bottom of y=1017 — so its own
 * horizontal scrollbar was 1617px below the fold and could be reached only
 * by a shift-wheel or trackpad gesture, with no visible affordance at all.
 * The honest assertion is therefore about where the scrollable box ENDS.
 */
function previewGeometry() {
  const body = document.querySelector('[role="tabpanel"]:not([hidden])');
  const pre = document.querySelector(".file-preview pre");
  if (body === null || pre === null) return null;
  const bodyRect = body.getBoundingClientRect();
  const preRect = pre.getBoundingClientRect();
  return {
    // There is genuinely something off to the right to reach.
    overflowX: pre.scrollWidth - pre.clientWidth,
    // A real classic horizontal scrollbar inside the pre's border box.
    scrollbarHeight: pre.offsetHeight - pre.clientHeight,
    // Where that scrollbar sits, against the bottom of the visible area.
    preBottom: preRect.y + preRect.height,
    viewBottom: bodyRect.y + bodyRect.height,
    bodyOverflowX: body.scrollWidth - body.clientWidth,
    bodyOverflowY: body.scrollHeight - body.clientHeight,
  };
}

/** Same helper the transcript-measure spec uses, for the same reason. */
function forceClassicScrollbars(): void {
  const style = document.createElement("style");
  style.textContent =
    "*::-webkit-scrollbar { width: 15px; height: 15px; } *::-webkit-scrollbar-thumb { background: #888; }";
  document.head.appendChild(style);
}

type TerminalGeometry = ReturnType<typeof terminalGeometry>;

/** Five samples a quarter-second apart: enough for a loop to show itself. */
async function settledGeometry(page: Page): Promise<TerminalGeometry[]> {
  const samples: TerminalGeometry[] = [];
  for (let index = 0; index < 5; index += 1) {
    await page.waitForTimeout(250);
    samples.push(await page.evaluate(terminalGeometry));
  }
  return samples;
}

test("panel terminal: contained at every width, and in a split group", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Terminal");
  await expect(page.getByText("Terminal running")).toBeVisible({
    timeout: 15_000,
  });

  // A line far wider than the panel, which is the case the reporter hit.
  await page.locator(".terminal-surface").click();
  await page.keyboard.type(
    "printf '%s\\n' '#699  valai  agent/avm-v4-8156-followup-pr  +9,639 -570'",
  );
  await page.keyboard.press("Enter");

  // Force scrollbars that CONSUME layout space, which is the reporter's
  // machine (macOS "always show scroll bars") and NOT what headless Chromium
  // does by default. Under overlay scrollbars an overflowing tab body costs
  // nothing visible, which is exactly why this defect reached a user through
  // a green suite.
  await page.evaluate(forceClassicScrollbars);

  const atDefaultWidth = await settledGeometry(page);
  for (const sample of atDefaultWidth) {
    expect(sample.bodyOverflowX).toBeLessThanOrEqual(0);
    expect(sample.bodyOverflowY).toBeLessThanOrEqual(0);
    expect(sample.surfaceClips).toBe(true);
  }
  // Stable, not climbing: a terminal that re-fits itself in a loop reports a
  // different size on every sample.
  const settled = atDefaultWidth[atDefaultWidth.length - 1];
  expect(atDefaultWidth.map((s) => s.screenWidth)).toEqual(
    atDefaultWidth.map(() => settled?.screenWidth),
  );

  // The narrowest the panel goes, where a shrink floor bites hardest.
  await page.getByRole("separator", { name: "Resize workspace panel" }).focus();
  await page.keyboard.press("Home");
  for (const sample of await settledGeometry(page)) {
    expect(sample.bodyOverflowX).toBeLessThanOrEqual(0);
    expect(sample.bodyOverflowY).toBeLessThanOrEqual(0);
  }

  // A horizontally split panel: the terminal's group is now a few hundred
  // pixels tall. This is where `min-height: 12rem` on a `flex: 1` child used
  // to act as a shrink floor and push the terminal out of its own body.
  await openPanelTab(page, "Changes");
  await panelChord(page, "ArrowDown");
  await expect(
    page.getByRole("separator", { name: "Resize panel groups" }),
  ).toBeVisible();

  const inSplit = await settledGeometry(page);
  for (const sample of inSplit) {
    expect(sample.bodyOverflowX).toBeLessThanOrEqual(0);
    expect(sample.bodyOverflowY).toBeLessThanOrEqual(0);
    expect(sample.surfaceClips).toBe(true);
  }
  const settledInSplit = inSplit[inSplit.length - 1];
  expect(inSplit.map((s) => s.screenHeight)).toEqual(
    inSplit.map(() => settledInSplit?.screenHeight),
  );
});

test("panel keyboard: a chord splits, moves a tab, and says when it cannot split", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await expect(page.getByRole("tab")).toHaveCount(2);

  // D8: with one tab in the group there is nothing to split, and the chord
  // used to do nothing at all, silently.
  await page.getByRole("tab", { name: "Files" }).click();
  await panelChord(page, "Backspace");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await panelChord(page, "ArrowRight");
  await expect(page.getByRole("status")).toHaveText(
    "Nothing to split — this group has one tab.",
  );
  await expect(page.getByRole("tablist")).toHaveCount(1);

  // With two tabs the same chord splits, and the groups are named apart
  // (D9) rather than both being "Panel tab group".
  await openPanelTab(page, "Files");
  await panelChord(page, "ArrowRight");
  await expect(
    page.getByRole("separator", { name: "Resize panel groups" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Panel tab group 1 of 2" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Panel tab group 2 of 2" }),
  ).toBeVisible();

  // And the move-tab chord puts it back, emptying the group it left, which
  // collapses the split.
  await panelChord(page, "Home");
  await expect(
    page.getByRole("separator", { name: "Resize panel groups" }),
  ).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("the docked edge is elevated in both themes, and still resizes", async ({
  page,
}) => {
  await openProjectWithThread(page);

  // Light (Playwright's default colour scheme, and the case the user called
  // out: a hairline alone barely separates two white surfaces).
  const light = await page.evaluate(panelEdge);
  expect(light.shadow).not.toBe("none");
  expect(light.shadow).not.toBe("");

  // The separator still owns this edge: a box-shadow is decorative and is
  // never hit-tested, but the resize affordance sits on the very pixels the
  // shadow is drawn over, so ask the browser what is actually there. Rect
  // and hit test happen in ONE evaluation, and it is polled, because the
  // panel slides in over 180ms — measuring the strip mid-transition and
  // probing after it settles samples a point the strip has since left.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const strip = document.querySelector(".panel-resizer");
        if (strip === null) return "no-resizer";
        const rect = strip.getBoundingClientRect();
        // Two pixels into the strip: outside the panel's border box, and
        // squarely in the band the shadow is painted over.
        const element = document.elementFromPoint(
          rect.x + 2,
          rect.y + rect.height / 2,
        );
        return element === null ? "nothing" : element.className;
      }),
    )
    .toContain("panel-resizer");

  // Dark gets its own value rather than inheriting a shadow tuned for white.
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await page.evaluate(panelEdge);
  expect(dark.shadow).not.toBe("none");
  expect(dark.shadow).not.toBe(light.shadow);

  // Railed: the panel is faded out entirely, so the rail carries no
  // orphaned shadow of its own.
  await page.getByRole("button", { name: "Close workspace panel" }).click();
  await expect
    .poll(async () => (await page.evaluate(panelEdge)).opacity)
    .toBe("0");
  expect((await page.evaluate(panelEdge)).railShadow).toBe("none");
});

// G6. The per-tab close affordance measured [9, 16] CSS px — about 7 x 12
// device px at the reporter's display scale — against the strip's own close
// button at [30, 30]. Its behaviour was and is correct: `pointer-events:
// none` while the tab is inactive, no drag armed from a press on it, a plain
// click closes the tab. It was simply too small to hit.
//
// Measured by hit-testing outward from the glyph's centre rather than by
// reading a rectangle, because the hit area is a pseudo-element: the glyph
// keeps its size and the strip keeps its height, and only what the pointer
// can land on changes.
function closeAffordanceHitBox() {
  const tab = document.querySelector(".panel-tab.active");
  const close = document.querySelector(".panel-tab.active .panel-tab-close");
  if (tab === null || close === null) return null;
  const tabRect = tab.getBoundingClientRect();
  const rect = close.getBoundingClientRect();
  const cx = Math.round(rect.x + rect.width / 2);
  const cy = Math.round(rect.y + rect.height / 2);
  const hits = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y);
    return element?.className.includes("panel-tab-close") === true;
  };
  const reach = (dx: number, dy: number) => {
    let steps = 0;
    while (steps < 80 && hits(cx + dx * (steps + 1), cy + dy * (steps + 1)))
      steps += 1;
    return steps;
  };
  const right = reach(1, 0);
  return {
    glyphWidth: Math.round(rect.width),
    glyphHeight: Math.round(rect.height),
    hitWidth: reach(-1, 0) + right + 1,
    hitHeight: reach(0, -1) + reach(0, 1) + 1,
    // How far the hit area reaches past the tab's own right edge: anything
    // over zero would put a close control on top of the next tab.
    pastTabRight: Math.max(0, cx + right - (tabRect.x + tabRect.width)),
    tabHeight: Math.round(tabRect.height),
    stripHeight: Math.round(
      document.querySelector(".panel-tabstrip")?.getBoundingClientRect()
        .height ?? 0,
    ),
    // What the strip's height is SUPPOSED to be: the header token, which is
    // what "without changing the strip's height" means.
    headerHeight:
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--header-h",
        ),
      ) * parseFloat(getComputedStyle(document.documentElement).fontSize),
  };
}

test("panel tab: the close affordance is big enough to hit", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await expect(page.getByRole("tab")).toHaveCount(2);

  // Hover the active tab, which is how a pointer reaches the affordance.
  await page.getByRole("tab", { name: "Files" }).hover();
  const box = await page.evaluate(closeAffordanceHitBox);
  expect(box).not.toBeNull();
  if (box === null) return;

  // The glyph itself is unchanged — around 9 x 16 CSS px, as reported.
  expect(box.glyphWidth).toBeLessThanOrEqual(12);
  expect(box.glyphHeight).toBeLessThanOrEqual(18);
  // What the pointer can land on is not.
  expect(box.hitWidth).toBeGreaterThanOrEqual(24);
  expect(box.hitHeight).toBeGreaterThanOrEqual(24);
  // And it grew inside the tab it belongs to: no taller than the tab, and
  // never over the next one.
  expect(box.hitHeight).toBeLessThanOrEqual(box.tabHeight);
  expect(box.pastTabRight).toBe(0);
  // The strip is still exactly the header token's height: growing the hit
  // area with a pseudo-element rather than with padding is what keeps it
  // there.
  expect(Math.abs(box.stripHeight - box.headerHeight)).toBeLessThanOrEqual(1);
});

test.describe("on a device with no hover", () => {
  test.use({ hasTouch: true });

  test("a tap on an inactive tab switches to it rather than closing it", async ({
    page,
  }) => {
    await openProjectWithThread(page);
    await openPanelTab(page, "Files");
    await expect(page.getByRole("tab")).toHaveCount(2);

    // D3: the per-tab close affordance used to rest at `opacity: 0`, which
    // hides an element from view but leaves it fully hit-testable — so the
    // right edge of an inactive tab was an invisible close button, and a
    // touch device has no hover to reveal it with. Tapped, not clicked:
    // Playwright's click moves the mouse first, which would hover the tab
    // and legitimately reveal the affordance.
    const changes = page.getByRole("tab", { name: "Changes" });
    await expect(changes).toHaveAttribute("aria-selected", "false");
    const box = await changes.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;
    // The last few pixels of the tab: exactly where the affordance sits.
    await page.touchscreen.tap(box.x + box.width - 6, box.y + box.height / 2);

    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(changes).toHaveAttribute("aria-selected", "true");
  });
});

// F2. Reported as "file content is clipped at the panel's right edge with no
// visible horizontal scroll", twice mis-diagnosed as a `min-width: 0` gap.
/**
 * A row of the file tree, and the line inside it that takes the click.
 *
 * An expanded directory's `treeitem` contains its children too, so clicking
 * the middle of that element would land on whichever child is there. The row
 * as the user sees it is its own line.
 */
function treeRow(page: Page, name: string | RegExp) {
  return page.getByRole("treeitem", { name });
}

async function clickTreeRow(page: Page, name: string | RegExp) {
  await treeRow(page, name).locator(".file-tree-line").first().click();
}

// Milestone 4: the file tree, the ignore rules, and the flat search
// (WSP-05 as revised by specification version 2, acceptance 11 to 13).
//
// End to end because the failure that produced the requirement was invisible
// to jsdom: the tab looked correct in every unit test while, against a real
// repository, every one of its two hundred rendered rows was a dependency's.
// A stubbed listing cannot reproduce that; a real working tree can.

test("panel files: the tree expands in place and hides ignored files until asked", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");

  // A tree of the root, one level deep: `src` is there and its contents are
  // not, because nothing has asked for them yet.
  const src = page.getByRole("treeitem", { name: "src" });
  await expect(src).toBeVisible();
  await expect(src).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("treeitem", { name: "main.ts" })).toHaveCount(0);

  // The ignore rule is honoured by default, and the tab says so rather than
  // under-reporting quietly.
  await expect(
    page.getByRole("treeitem", { name: "node_modules" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Files matched by this workspace's ignore rules are hidden.",
    ),
  ).toBeVisible();

  await clickTreeRow(page, "src");
  await expect(page.getByRole("treeitem", { name: "main.ts" })).toBeVisible();
  await expect(src).toHaveAttribute("aria-expanded", "true");
  // Its own name, and the full workspace-relative path on the tooltip.
  await expect(page.getByRole("treeitem", { name: "main.ts" })).toHaveAttribute(
    "title",
    "src/main.ts",
  );

  await clickTreeRow(page, "src");
  await expect(page.getByRole("treeitem", { name: "main.ts" })).toHaveCount(0);
  await expect(src).toHaveAttribute("aria-expanded", "false");

  // The explicit opt-in reveals what the rule hid — and nothing reveals
  // `.git`, which is not an ignore rule.
  await page.getByRole("checkbox", { name: "Show ignored files" }).check();
  await expect(
    page.getByRole("treeitem", { name: "node_modules" }),
  ).toBeVisible();
  await expect(
    page.getByRole("treeitem", { name: ".git", exact: true }),
  ).toHaveCount(0);
  // ...while the ignore file itself is an ordinary listed file.
  await expect(
    page.getByRole("treeitem", { name: ".gitignore", exact: true }),
  ).toBeVisible();
});

test("panel files search: the project's own README, not two hundred dependency copies", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await clickTreeRow(page, "src");
  await expect(page.getByRole("treeitem", { name: "main.ts" })).toBeVisible();

  await page
    .getByRole("textbox", { name: "Search project files" })
    .fill("README.md");

  // Exactly one match, and it is the project's own. Before the ignore rules
  // this search returned two hundred rows, every one of them under
  // `node_modules`, and the project's README was on none of them.
  const matches = page.locator(".file-list li");
  await expect(matches).toHaveCount(1);
  await expect(
    matches.getByRole("button", { name: "README.md" }),
  ).toBeVisible();
  await expect(page.getByText("node_modules")).toHaveCount(0);
  // A search is flat, not a tree of sparse matches.
  await expect(page.getByRole("tree")).toHaveCount(0);

  // Clearing it returns the tree at exactly the expansion it had.
  await page.getByRole("textbox", { name: "Search project files" }).fill("");
  await expect(page.getByRole("tree")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "main.ts" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "src" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("panel files: the expansion and the ignored opt-in survive a reload", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await clickTreeRow(page, "src");
  await clickTreeRow(page, "features");
  await expect(page.getByRole("treeitem", { name: "panel.ts" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Show ignored files" }).check();
  await expect(
    page.getByRole("treeitem", { name: "node_modules" }),
  ).toBeVisible();

  await page.reload();

  // Two levels deep, exactly as it was left (WSP-04, acceptance 11).
  await expect(page.getByRole("treeitem", { name: "panel.ts" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "src" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    page.getByRole("treeitem", { name: "features" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("checkbox", { name: "Show ignored files" }),
  ).toBeChecked();
});

// The tree is operable without a pointer (WSP-10): arrow keys move by row,
// open a directory, and close it again.
test("panel files: the keyboard walks, opens, and closes tree rows", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  const src = page.getByRole("treeitem", { name: "src" });
  await expect(src).toBeVisible();

  await src.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("treeitem", { name: "main.ts" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("treeitem", { name: "features" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("treeitem", { name: "main.ts" })).toBeFocused();
  await page.keyboard.press("Enter");
  // Activating a file opens a File tab, which takes the group; the tree is
  // still there, exactly as it was, behind its own tab.
  await expect(page.getByRole("tab", { name: "main.ts" })).toBeVisible();
  await page.getByRole("tab", { name: "Files" }).click();

  await src.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(src).toHaveAttribute("aria-expanded", "false");
});

// H5. The pass saw a row that read "Listing ops…" thirty seconds after the
// server began answering 500 for it, and never saw the error row. Driven
// here against the real server with the real client, where the recovery half
// the pass could not confirm is also checked: the row's own retry.
test("panel files: a failing listing reaches its error row, and the row retries", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await expect(page.getByRole("treeitem", { name: "ops" })).toBeVisible();

  let failing = true;
  await page.route(
    (url) => url.pathname.endsWith("/files") && url.search.includes("path=ops"),
    async (route) => {
      if (!failing) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "internal_error", message: "No." },
        }),
      });
    },
  );

  await clickTreeRow(page, "ops");
  await expect(
    page.getByRole("treeitem", { name: /Could not list ops/ }),
  ).toBeVisible({ timeout: 15_000 });
  // One unreadable directory costs its own row and not the tree.
  await expect(page.getByRole("treeitem", { name: "README.md" })).toBeVisible();

  failing = false;
  await clickTreeRow(page, /Could not list ops/);
  await expect(page.getByRole("treeitem", { name: "deploy.sh" })).toBeVisible();
});

// H6. A path that is not there answered 500 `internal_error`. The realistic
// trigger is a directory the tab is still showing because its parent listing
// was read before the directory was deleted.
test("panel files: expanding a directory that has been deleted shows its error row", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await expect(page.getByRole("treeitem", { name: "gone" })).toBeVisible();

  await rm(join(projectPath, "gone"), { recursive: true, force: true });
  await clickTreeRow(page, "gone");

  await expect(
    page.getByRole("treeitem", { name: /Could not list gone/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("treeitem", { name: /Listing gone/ }),
  ).toHaveCount(0);
  // The rest of the tree is untouched.
  await expect(page.getByRole("treeitem", { name: "README.md" })).toBeVisible();
});

test("panel file preview: a long line's scrollbar is on screen at every panel width", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await page.getByRole("treeitem", { name: "wide.json" }).click();
  await expect(
    page.getByRole("button", { name: "Copy contents" }),
  ).toBeVisible();

  // Overlay scrollbars cost nothing visible; the reporter's machine does not
  // have them, and neither does this measurement.
  await page.evaluate(forceClassicScrollbars);

  for (const width of ["default", "minimum"] as const) {
    if (width === "minimum") {
      await page
        .getByRole("separator", { name: "Resize workspace panel" })
        .focus();
      await page.keyboard.press("Home");
      await page.waitForTimeout(400);
    }
    const geometry = await page.evaluate(previewGeometry);
    expect(geometry).not.toBeNull();
    if (geometry === null) return;

    // The case under test: content really does extend past the right edge.
    expect(geometry.overflowX).toBeGreaterThan(0);
    // ...and the bottom edge of the box that scrolls — where its scrollbar
    // is drawn, overlay or classic — is inside the visible area rather than
    // a thousand pixels below it. One pixel of slack for sub-pixel layout.
    expect(geometry.preBottom).toBeLessThanOrEqual(geometry.viewBottom + 1);
    // And the overflow is still contained: the panel itself never scrolls
    // sideways to show it (D13 stays fixed).
    expect(geometry.bodyOverflowX).toBeLessThanOrEqual(0);
    expect(geometry.bodyOverflowY).toBeLessThanOrEqual(0);
  }
});

// G1. WSP-09's "returning to it restores its scroll position" and WSP-03's
// "a moved tab keeps its scroll position", both measured on the element that
// ACTUALLY scrolls.
//
// This has to be end to end, because neither mechanism exists in jsdom. An
// inactive tab body carries `hidden` and leaves layout; `PanelBodies`
// re-parents the host element, and a detached node loses its descendants'
// scroll offsets. jsdom lays nothing out and never resets a scroll offset,
// so `PanelBodies.test.tsx`'s two "keeps a body's scroll position" cases
// pass while the behaviour is broken — they are not evidence about this.
//
// The offsets asserted are an INNER scroller's, which is the regression's
// cause: the F2 fix made `.file-preview` a flex column with one bounded
// scrolling region, moving the element that scrolls inward from the tab
// body to the `<pre>`. The panel went on saving and restoring the tab
// body's own offsets, which are now always 0.
//
// **Measured on the browser this suite runs (HeadlessChrome/151), on a bare
// page as well as on ours:** `display: none` reports 0 while hidden and
// restores the offset when the box comes back, but detaching and
// re-attaching the node loses it for good. So a plain switch away and back
// is carried by the browser here and is kept below as the guard for one
// that does not do that; what fails without the fix is every case where the
// host is MOVED — the drag, and an inactive tab whose group is re-rendered
// by a split underneath it.

/** Scrolls the visible File tab's real scroller, and stamps the node. */
function scrollPreview(offsets: { top: number; left: number }) {
  const pre = document.querySelector(
    '[role="tabpanel"]:not([hidden]) .file-preview pre',
  );
  if (pre === null) return null;
  pre.id = "scroll-probe";
  pre.scrollTop = offsets.top;
  pre.scrollLeft = offsets.left;
  return { top: pre.scrollTop, left: pre.scrollLeft };
}

/** That scroller's offsets now, and whether it is the same DOM node. */
function previewScroll() {
  const pre = document.querySelector(
    '[role="tabpanel"]:not([hidden]) .file-preview pre',
  );
  if (pre === null) return null;
  return {
    top: pre.scrollTop,
    left: pre.scrollLeft,
    sameNode: pre.id === "scroll-probe",
  };
}

test("panel file tab: returning to a tab restores the scroll offset of the element that scrolls", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await page.getByRole("treeitem", { name: "wide.json" }).click();
  await expect(
    page.getByRole("button", { name: "Copy contents" }),
  ).toBeVisible();

  const scrolled = await page.evaluate(scrollPreview, { top: 800, left: 1200 });
  expect(scrolled).not.toBeNull();
  if (scrolled === null) return;
  // The case only means anything if the content really does scroll both ways.
  expect(scrolled.top).toBeGreaterThan(0);
  expect(scrolled.left).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Changes" }).click();
  await expect(page.getByRole("tab", { name: "Changes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "wide.json" }).click();
  await expect(page.getByRole("tab", { name: "wide.json" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  expect(await page.evaluate(previewScroll)).toEqual({
    top: scrolled.top,
    left: scrolled.left,
    // Nothing remounted: the offsets were restored on the same node, not
    // coincidentally reproduced by a rebuilt one.
    sameNode: true,
  });

  // Now the same tab, hidden AND moved: switching away and then splitting
  // the group re-renders it, which replaces the `.panel-bodies` node every
  // host in it is parented to. The browser's own preservation does not
  // survive that, so this half fails without the panel restoring the offset
  // itself — and it is an ordinary thing to do, not a contrived one.
  await page.getByRole("tab", { name: "Changes" }).click();
  await panelChord(page, "ArrowRight");
  await expect(
    page.getByRole("separator", { name: "Resize panel groups" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "wide.json" }).click();
  await expect(page.getByRole("tab", { name: "wide.json" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  expect(await page.evaluate(previewScroll)).toEqual({
    top: scrolled.top,
    left: scrolled.left,
    sameNode: true,
  });
});

// F3. A regression from the D8 fix: the announcement it added is an
// ordinary flex item, so announcing "nothing happened" relaid out the panel
// and resized the running shell — twice, once on the way in and once when
// the message cleared.
test("panel announcement: a refused chord changes no geometry and sends no resize", async ({
  page,
}) => {
  await page.addInitScript(recordSentFrames);
  await openProjectWithThread(page);
  await openPanelTab(page, "Terminal");
  await expect(page.getByText("Terminal running")).toBeVisible({
    timeout: 15_000,
  });

  // Leave the terminal alone in its group, so the split chord has nothing
  // to split and must refuse.
  await page.getByRole("tab", { name: "Changes" }).click();
  await panelChord(page, "Backspace");
  await expect(page.getByRole("tab")).toHaveCount(1);

  // Let the terminal settle: what follows must add nothing to either count.
  await page.waitForTimeout(1000);
  const before = await page.evaluate(announcementGeometry);
  const resizesBefore = await resizeFrameCount(page);

  await panelChord(page, "ArrowRight");
  await expect(page.getByRole("status")).toHaveText(
    "Nothing to split — this group has one tab.",
  );

  // Visible, and out of flow: the group is exactly as tall as it was.
  const during = await page.evaluate(announcementGeometry);
  expect(during.groupHeight).toBe(before.groupHeight);
  expect(during.surfaceHeight).toBe(before.surfaceHeight);
  expect(during.announcementPosition).toBe("absolute");

  // And again after it clears itself, five seconds later.
  await expect(
    page.getByText("Nothing to split — this group has one tab."),
  ).toHaveCount(0, { timeout: 10_000 });
  const after = await page.evaluate(announcementGeometry);
  expect(after.groupHeight).toBe(before.groupHeight);
  expect(after.surfaceHeight).toBe(before.surfaceHeight);

  expect(await resizeFrameCount(page)).toBe(resizesBefore);
});

/**
 * F4. What the fit addon measures, and what it produced.
 *
 * The addon reads `getComputedStyle(parent).height` and subtracts only the
 * `.xterm` element's own padding. For a `box-sizing: border-box` parent that
 * height is the BORDER box — 218.917px measured against a 206.1px content
 * box — so the container's own 0.4rem of padding was counted as space the
 * terminal could use, and between 0 and 12.8px of the last text row was cut
 * off depending on the height. The fix is to give the addon a container
 * whose computed height IS its content box, so this asserts that: no
 * vertical padding on the measured element, and a screen that fits inside
 * it.
 */
function terminalFit() {
  const xterm = document.querySelector(".xterm");
  const measured = xterm === null ? null : xterm.parentElement;
  const screen = document.querySelector(".xterm-screen");
  if (measured === null || screen === null) return null;
  const style = getComputedStyle(measured);
  return {
    measuredPaddingY:
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom),
    // The area actually available to paint rows in: the measured element's
    // padding box, less its own padding. This is the number the fit addon
    // gets wrong, because a border-box element reports the outer one.
    contentHeight:
      measured.clientHeight -
      Number.parseFloat(style.paddingTop) -
      Number.parseFloat(style.paddingBottom),
    screenHeight: screen.getBoundingClientRect().height,
  };
}

// F4. Systematic, not intermittent: every terminal in the panel was up to
// ~12.8px taller than the box it was given.
test("panel terminal: the rendered screen fits its container at every height", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Terminal");
  await expect(page.getByText("Terminal running")).toBeVisible({
    timeout: 15_000,
  });

  // A sweep of heights, because the overflow this reproduces is
  // `floor(borderBoxH / 16) * 16 - (borderBoxH - 12.8)`: it is zero at some
  // heights and 12px at others, so one sample proves nothing.
  for (const height of [720, 654, 601, 540, 487]) {
    await page.setViewportSize({ width: 1280, height });
    await page.waitForTimeout(400);
    const fit = await page.evaluate(terminalFit);
    expect(fit).not.toBeNull();
    if (fit === null) return;

    // The box the addon measures reports its content height, because it has
    // no padding of its own to confuse a border-box measurement with.
    // What was rendered fits in the space there actually is. Half a pixel of
    // slack for sub-pixel cell heights.
    expect(fit.screenHeight).toBeLessThanOrEqual(fit.contentHeight + 0.5);
    // And the box the addon measures reports its content height, because it
    // has no padding of its own to confuse a border-box measurement with.
    expect(fit.measuredPaddingY).toBe(0);
  }
});

/** Every tab group's width, and whether the tree had to scroll to fit them. */
function groupSizes() {
  const widths: number[] = [];
  const heights: number[] = [];
  for (const group of document.querySelectorAll(".panel-group")) {
    widths.push(group.clientWidth);
    heights.push(group.clientHeight);
  }
  const scroll = document.querySelector(".panel-tree-scroll");
  return {
    widths,
    heights,
    treeOverflowX:
      scroll === null ? -1 : scroll.scrollWidth - scroll.clientWidth,
  };
}

/** The columns and rows the terminal last negotiated with the server. */
async function lastNegotiatedSize(
  page: Page,
): Promise<{ columns: number; rows: number } | null> {
  const frames = await page.evaluate(() => window.__sentFrames ?? []);
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const raw = frames[index];
    if (raw === undefined) continue;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === "resize"
    ) {
      const frame = parsed as { columns: number; rows: number };
      return { columns: frame.columns, rows: frame.rows };
    }
  }
  return null;
}

// F6. WSP-04 says the panel "never shrinks a group into an unreadable
// state". It enforced a minimum outer WIDTH, but its groups were bounded
// only by MIN_FRACTION — a proportion, and therefore no floor in pixels: at
// PANEL_MIN_WIDTH split in two, each group was 139px and the terminal
// negotiated 16 columns.
test("panel groups: a split at the minimum width scrolls rather than shrinking", async ({
  page,
}) => {
  await page.addInitScript(recordSentFrames);
  await openProjectWithThread(page);
  await openPanelTab(page, "Terminal");
  await expect(page.getByText("Terminal running")).toBeVisible({
    timeout: 15_000,
  });
  await openPanelTab(page, "Files");

  // Two groups side by side, then the narrowest the panel goes.
  await panelChord(page, "ArrowRight");
  await expect(
    page.getByRole("separator", { name: "Resize panel groups" }),
  ).toBeVisible();
  await page.getByRole("separator", { name: "Resize workspace panel" }).focus();
  await page.keyboard.press("Home");
  await page.waitForTimeout(600);

  const sizes = await page.evaluate(groupSizes);
  expect(sizes.widths).toHaveLength(2);
  for (const width of sizes.widths) expect(width).toBeGreaterThanOrEqual(240);
  // Which at a 280px panel means the tree does not fit — and scrolls,
  // exactly as the chat surface does below MIN_PANE_WIDTH_PX.
  expect(sizes.treeOverflowX).toBeGreaterThan(0);

  // The point of the floor: the shell is still worth reading.
  const negotiated = await lastNegotiatedSize(page);
  expect(negotiated).not.toBeNull();
  expect(negotiated?.columns ?? 0).toBeGreaterThanOrEqual(24);
  expect(negotiated?.rows ?? 0).toBeGreaterThanOrEqual(2);
});

// Unconfirmed report 1: "no scrollback replay after reload". The server
// keeps a 1MiB replay ring and sends it as an `output` frame right after
// `ready`; whether it arrives, and whether the client writes it, is what
// this settles. The reporter's window was intermittently occluded, which
// stalls requestAnimationFrame and therefore xterm's painting.
test("panel terminal: a reload re-attaches with the scrollback replayed", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Terminal");
  await expect(page.getByText("Terminal running")).toBeVisible({
    timeout: 15_000,
  });

  await page.locator(".terminal-surface").click();
  await page.keyboard.type("echo replay-marker-9137");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "replay-marker-9137",
    {
      timeout: 15_000,
    },
  );

  await page.reload();

  // The tab comes back from the device-local record, re-attaches to the
  // same still-running process (WSP-07), and shows what was there.
  await expect(page.getByText("Terminal running")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".xterm-rows")).toContainText(
    "replay-marker-9137",
    {
      timeout: 15_000,
    },
  );
});

// Unconfirmed report 2: "restart appears to do nothing". The server does
// restart — it disposes the owner, spawns a new shell and sends a fresh
// `ready` — but nothing told the view to stop showing the dead shell's
// screen, so from the user's side the button did nothing visible.
test("panel terminal: restart clears the dead shell's screen", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Terminal");
  await expect(page.getByText("Terminal running")).toBeVisible({
    timeout: 15_000,
  });

  await page.locator(".terminal-surface").click();
  await page.keyboard.type("echo restart-marker-4471");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "restart-marker-4471",
    { timeout: 15_000 },
  );

  await page.getByRole("button", { name: "Restart" }).click();

  await expect(page.locator(".xterm-rows")).not.toContainText(
    "restart-marker-4471",
    { timeout: 15_000 },
  );
});

// Unconfirmed report 3: at the panel's minimum width a strip of three tabs
// overflows, and `scrollbar-width: none` means a mouse-only user sees no
// affordance for the rest. Keyboard and trackpad were confirmed to work.
// This measures the remaining case — a plain wheel over the strip — because
// the verdict turns on whether the strip is genuinely unreachable or merely
// undecorated. Measured: Chromium does NOT translate a vertical wheel for a
// horizontal-only scroller, so it was unreachable, and the strip now takes
// whichever axis the pointer moved.
function stripScroll() {
  const strip = document.querySelector('[role="tablist"]');
  return strip === null
    ? { overflow: -1, scrollLeft: -1 }
    : {
        overflow: strip.scrollWidth - strip.clientWidth,
        scrollLeft: strip.scrollLeft,
      };
}

test("panel tab strip: an overflowing strip scrolls under a plain wheel", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await openPanelTab(page, "Terminal");
  await page.getByRole("separator", { name: "Resize workspace panel" }).focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab")).toHaveCount(3);

  expect((await page.evaluate(stripScroll)).overflow).toBeGreaterThan(0);

  // Back to the first tab, so there is somewhere to scroll TO.
  await page.getByRole("tab", { name: "Changes" }).click();
  await expect
    .poll(async () => (await page.evaluate(stripScroll)).scrollLeft)
    .toBe(0);

  const box = await page.getByRole("tablist").boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);

  // The tabs a strip cannot fit are reachable with an ordinary mouse.
  await expect
    .poll(async () => (await page.evaluate(stripScroll)).scrollLeft)
    .toBeGreaterThan(0);
});

// WSP-03's drag. jsdom has no layout, so every one of these behaviours is
// geometric in a way the unit suite cannot see at all: which rectangle a
// point is in, which band of it, and where the resulting split lands. The
// arithmetic is unit-tested against stated rectangles in tabDrag.test.ts;
// what is measured here is that the page really has those rectangles.

/** Where each group's five drop targets are, in viewport coordinates. */
function dropPoints() {
  return [...document.querySelectorAll(".panel-group")].map((group) => {
    const rect = group.getBoundingClientRect();
    const strip = group.querySelector(".panel-tabstrip");
    // The strip is its own drop target, so the four edges divide what is
    // left below it — which is exactly how the drag resolves them.
    const stripHeight =
      strip === null ? 0 : strip.getBoundingClientRect().height;
    const top = rect.y + stripHeight;
    const height = rect.height - stripHeight;
    return {
      id: group.id,
      centre: { x: rect.x + rect.width / 2, y: top + height / 2 },
      left: { x: rect.x + 6, y: top + height / 2 },
      right: { x: rect.x + rect.width - 6, y: top + height / 2 },
      top: { x: rect.x + rect.width / 2, y: top + 6 },
      bottom: { x: rect.x + rect.width / 2, y: top + height - 6 },
    };
  });
}

/** Every group's box and tab titles, plus how the panel is split. */
function panelLayout() {
  return {
    groups: [...document.querySelectorAll(".panel-group")].map((group) => {
      const rect = group.getBoundingClientRect();
      return {
        id: group.id,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        tabs: [...group.querySelectorAll("[data-panel-tab]")].map(
          (tab) => tab.textContent ?? "",
        ),
      };
    }),
    rowSplits: [...document.querySelectorAll(".panel-split-row")].length,
    columnSplits: [...document.querySelectorAll(".panel-split-column")].length,
    dropZones: [...document.querySelectorAll(".panel-drop-zones")].length,
  };
}

interface DragPoint {
  x: number;
  y: number;
}

/**
 * Presses a tab, crosses the drag threshold, and moves to `to` — leaving the
 * button DOWN, so a case can look at the drop targets or press Escape.
 */
async function dragTabOver(page: Page, tabName: string, to: DragPoint) {
  const tab = page.getByRole("tab", { name: tabName }).first();
  const box = await tab.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // A press is not a drag: the threshold has to be crossed first.
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2);
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

async function dropTabOn(page: Page, tabName: string, to: DragPoint) {
  await dragTabOver(page, tabName, to);
  await page.mouse.up();
}

/**
 * Widens the panel to what the viewport can carry, so two groups fit side by
 * side without the tree scrolling. A scrolled tree is a real case — the drag
 * re-measures on scroll — but it moves the groups out from under points
 * measured before the drag began, which is an artifact of measuring from
 * this side rather than anything the product does.
 */
async function widenPanel(page: Page) {
  await page.getByRole("separator", { name: "Resize workspace panel" }).focus();
  await page.keyboard.press("End");
  await page.waitForTimeout(300);
}

/** A group's drop points, by position in reading order. */
async function pointsOfGroup(page: Page, index: number) {
  const points = await page.evaluate(dropPoints);
  const group = points[index];
  expect(group, `no group ${String(index)}`).toBeDefined();
  if (group === undefined) throw new Error("missing group");
  return group;
}

/** How many times the page has opened a terminal socket and attached. */
async function attachFrameCount(page: Page): Promise<number> {
  const frames = await page.evaluate(() => window.__sentFrames ?? []);
  return frames.filter((frame) => {
    const parsed: unknown = JSON.parse(frame);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === "attach"
    );
  }).length;
}

test("panel drag: a tab dropped on another group's centre moves into it", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await widenPanel(page);
  await openPanelTab(page, "Files");
  await page.getByRole("treeitem", { name: "notes.txt" }).click();
  await expect(page.getByRole("tab")).toHaveCount(3);

  // Split, so the drag has a second group to aim at: the active tab
  // (notes.txt) goes into the new half.
  await panelChord(page, "ArrowRight");
  await expect(
    page.getByRole("separator", { name: "Resize panel groups" }),
  ).toBeVisible();

  const second = await pointsOfGroup(page, 1);
  await dropTabOn(page, "Changes", second.centre);

  const layout = await page.evaluate(panelLayout);
  expect(layout.groups).toHaveLength(2);
  expect(layout.groups[0]?.tabs.map((tab) => tab.replace("×", ""))).toEqual([
    "Files",
  ]);
  expect(layout.groups[1]?.tabs.map((tab) => tab.replace("×", ""))).toEqual([
    "notes.txt",
    "Changes",
  ]);
  // WSP-03: a centre drop activates the tab in the group it lands in.
  await expect(page.getByRole("tab", { name: "Changes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // And the drop targets are gone with the drag.
  expect(layout.dropZones).toBe(0);
});

// Each of WSP-03's four edges, and both halves of the claim: the axis the
// split takes, and which side of the target group the tab ends up on.
const EDGE_CASES = [
  { edge: "left", axis: "row", side: "before" },
  { edge: "right", axis: "row", side: "after" },
  { edge: "top", axis: "column", side: "before" },
  { edge: "bottom", axis: "column", side: "after" },
] as const;

for (const { edge, axis, side } of EDGE_CASES) {
  test(`panel drag: dropping on the ${edge} edge splits ${axis === "row" ? "side by side" : "stacked"}, ${side}`, async ({
    page,
  }) => {
    await openProjectWithThread(page);
    await openPanelTab(page, "Files");
    await expect(page.getByRole("tab")).toHaveCount(2);
    expect((await page.evaluate(panelLayout)).groups).toHaveLength(1);

    const only = await pointsOfGroup(page, 0);
    await dragTabOver(page, "Changes", only[edge]);
    // The target under the pointer is announced as it changes (WSP-10),
    // before anything has been dropped.
    await expect(page.getByRole("status")).toContainText("Split");
    await page.mouse.up();

    const layout = await page.evaluate(panelLayout);
    expect(layout.groups).toHaveLength(2);
    expect(layout.rowSplits).toBe(axis === "row" ? 1 : 0);
    expect(layout.columnSplits).toBe(axis === "column" ? 1 : 0);

    const moved = layout.groups.find((group) =>
      group.tabs.some((tab) => tab.startsWith("Changes")),
    );
    const stayed = layout.groups.find(
      (group) => !group.tabs.some((tab) => tab.startsWith("Changes")),
    );
    expect(moved).toBeDefined();
    expect(stayed).toBeDefined();
    if (moved === undefined || stayed === undefined) return;
    if (axis === "row")
      expect(side === "before" ? moved.x < stayed.x : moved.x > stayed.x).toBe(
        true,
      );
    else
      expect(side === "before" ? moved.y < stayed.y : moved.y > stayed.y).toBe(
        true,
      );
  });
}

test("panel drag: a tab dragged along its own strip is reordered", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await expect(page.getByRole("tab")).toHaveCount(2);

  const files = page.getByRole("tab", { name: "Files" });
  const box = await files.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  // Past the middle of the Files tab, which is where an insertion after it
  // is resolved.
  await dropTabOn(page, "Changes", {
    x: box.x + box.width - 4,
    y: box.y + box.height / 2,
  });

  const layout = await page.evaluate(panelLayout);
  // Still one group: a strip drop reorders, it does not split.
  expect(layout.groups).toHaveLength(1);
  expect(layout.groups[0]?.tabs.map((tab) => tab.replace("×", ""))).toEqual([
    "Files",
    "Changes",
  ]);
});

test("panel drag: Escape leaves the layout exactly as it was", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await expect(page.getByRole("tab")).toHaveCount(2);

  const before = await page.evaluate(panelLayout);
  const only = await pointsOfGroup(page, 0);
  await dragTabOver(page, "Changes", only.right);

  // Drop targets are shown only while a drag is in progress, and there are
  // five of them on the one group.
  const during = await page.evaluate(panelLayout);
  expect(during.dropZones).toBe(1);
  await expect
    .poll(async () =>
      page.evaluate(
        () => [...document.querySelectorAll(".panel-drop-edge.active")].length,
      ),
    )
    .toBe(1);

  await page.keyboard.press("Escape");
  await page.mouse.up();

  const after = await page.evaluate(panelLayout);
  expect(after).toEqual({ ...before, dropZones: 0 });
  await expect(page.getByRole("status")).toContainText("Drag cancelled");
});

test("panel drag: releasing outside every drop target changes nothing", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");

  const before = await page.evaluate(panelLayout);
  const panelBox = await page.locator(".panel").boundingBox();
  expect(panelBox).not.toBeNull();
  if (panelBox === null) return;

  // Over the chat surface, which is left of the panel. Splits stay inside
  // the panel and a tab never lands anywhere else.
  await dropTabOn(page, "Changes", {
    x: panelBox.x / 2,
    y: panelBox.y + panelBox.height / 2,
  });

  expect(await page.evaluate(panelLayout)).toEqual(before);
});

// G7. Discoverability: once a tab was picked up, every drop region was
// fully transparent until the pointer was inside it, so the only way to
// learn where the five targets were was to sweep the pointer around and
// watch for a highlight. Each band now carries a faint outline for as long
// as the drag lasts, in a token, so it reads in either theme — and the one
// under the pointer is still plainly different from the other four.
function bandOutlines() {
  return [...document.querySelectorAll(".panel-drop-zones > *")].map(
    (band) => ({
      className: band.className,
      border: getComputedStyle(band).borderTopColor,
    }),
  );
}

test("panel drag: every drop band is outlined while a drag is live, in both themes", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await expect(page.getByRole("tab")).toHaveCount(2);
  const only = await pointsOfGroup(page, 0);

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await dragTabOver(page, "Changes", only.right);

    const bands = await page.evaluate(bandOutlines);
    // Four edges and a centre.
    expect(bands, scheme).toHaveLength(5);
    for (const band of bands)
      expect(band.border, `${scheme} ${band.className}`).not.toBe(
        "rgba(0, 0, 0, 0)",
      );
    const highlighted = bands.filter((band) =>
      band.className.includes("active"),
    );
    const resting = bands.filter((band) => !band.className.includes("active"));
    expect(highlighted, scheme).toHaveLength(1);
    expect(highlighted[0]?.border, scheme).not.toBe(resting[0]?.border);

    await page.keyboard.press("Escape");
    await page.mouse.up();
  }
});

// G4, in the shape it was reported in: the DEFAULT panel — one group, one
// tab, which is also the state after every migration. Picking that tab up
// and moving to any edge band highlighted it in the accent colour and
// announced "Split Panel tab group to the right."; releasing answered
// "Nothing moved." and changed nothing.
test("panel drag: a drop that would be refused says so instead of highlighting", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await expect(page.getByRole("tab")).toHaveCount(1);
  // The panel slides in over 180ms, and this case measures its geometry the
  // moment it opens rather than after a menu interaction as the others do.
  await page.waitForTimeout(400);
  const before = await page.evaluate(panelLayout);

  const only = await pointsOfGroup(page, 0);
  await dragTabOver(page, "Changes", only.right);

  const marks = await page.evaluate(() => ({
    refused: [...document.querySelectorAll(".panel-drop-zones .refused")]
      .length,
    active: [...document.querySelectorAll(".panel-drop-zones .active")].length,
  }));
  expect(marks).toEqual({ refused: 1, active: 0 });
  // The chord's own reason string, reused rather than reworded.
  await expect(page.getByRole("status")).toContainText(
    "Nothing to split — this group has one tab.",
  );

  await page.mouse.up();
  expect(await page.evaluate(panelLayout)).toEqual({
    ...before,
    dropZones: 0,
  });
});

// G3. A fast flick used to drop the whole gesture on the floor.
//
// `onTabPointerMove` is bound to the tab, and the pointer was captured only
// INSIDE `startDrag` — after a first `pointermove` that both crossed the 4px
// threshold and was still delivered to the tab. A tab is 78 x 43px, so a
// pointer leaving its box in one event (a downward yank at about 1300px/s)
// delivered no move to it at all and nothing happened: no announcement, no
// drop zones, no layout change. Measured with real input, the same start and
// end, differing only in step size: 47 x 28px landed on `panel-tabpanel` and
// did nothing; 8px steps armed the drag and dropped.
test("panel drag: a single large first move arms the drag", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect((await page.evaluate(panelLayout)).groups).toHaveLength(1);

  const only = await pointsOfGroup(page, 0);
  const tab = page.getByRole("tab", { name: "Changes" }).first();
  const box = await tab.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  // The measurement the reporter took: the tab really is small enough for
  // one event to leave it.
  expect(box.width).toBeLessThan(2 * 47);
  expect(box.height).toBeLessThan(2 * 28);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // ONE move, off the tab, with no intermediate steps.
  await page.mouse.move(
    box.x + box.width / 2 + 47,
    box.y + box.height / 2 + 28,
  );

  expect((await page.evaluate(panelLayout)).dropZones).toBe(1);
  await expect(page.getByRole("status")).toContainText("Dragging Changes");

  await page.mouse.move(only.right.x, only.right.y);
  await page.mouse.up();

  const layout = await page.evaluate(panelLayout);
  expect(layout.groups).toHaveLength(2);
  expect(layout.rowSplits).toBe(1);
});

// G2. The ghost is the whole of the drag's pick-up feedback, and it was
// drawn off screen every time.
//
// `.panel-drag-ghost` is `position: fixed` and moved by a transform in
// VIEWPORT coordinates, but `.panel` computes a non-`none` transform from
// the slide-in rule — and a transformed element is the containing block for
// its fixed descendants, so the panel's own left edge was added to every
// position. Measured with the pointer at x = 1870: `translate(1882px, …)`
// and `getBoundingClientRect().left = 3020.33`, which is 1882 + 1138.33,
// the panel's left edge, in a 1920px viewport. The panel is always the
// right-hand dock, so the ghost was ALWAYS outside the viewport.
//
// End to end, and only end to end: this is a containing block, which is
// layout. jsdom computes none, so the same assertion there passes whether
// the ghost is portalled out of the transformed subtree or not.
function ghostBox() {
  const ghost = document.querySelector(".panel-drag-ghost");
  if (ghost === null) return null;
  const rect = ghost.getBoundingClientRect();
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    // Which subtree it is actually in: a transformed ancestor is what put
    // it off screen, so the fix has to be checkable and not just the
    // coordinates it happens to produce at one pointer position.
    insidePanel: ghost.parentElement?.className.includes("panel") === true,
  };
}

test("panel drag: the ghost follows the pointer in viewport coordinates", async ({
  page,
}) => {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport === null) return;

  await openProjectWithThread(page);
  await openPanelTab(page, "Files");

  const only = await pointsOfGroup(page, 0);
  await dragTabOver(page, "Changes", only.centre);

  for (const at of [only.centre, only.left, only.bottom]) {
    await page.mouse.move(at.x, at.y);
    const box = await page.evaluate(ghostBox);
    expect(box).not.toBeNull();
    if (box === null) return;
    // Just off the pointer, which is over the target being resolved.
    expect(box.left).toBeCloseTo(at.x + 12, 0);
    expect(box.top).toBeCloseTo(at.y + 12, 0);
    // And on screen at all, which is the defect: the ghost's whole box was
    // ~1138px right of the viewport at every pointer position. The bottom
    // band's point is within the ghost's own height of the viewport floor,
    // so only its horizontal containment is asserted — the ghost is not
    // clamped, deliberately: clamping needs the ghost's measured size on
    // every pointer move, and reading it there is the layout per move that
    // WSP-09 says a drag must not do.
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(viewport.width);
    if (at !== only.bottom)
      expect(box.bottom).toBeLessThanOrEqual(viewport.height);
    expect(box.insidePanel).toBe(false);
  }

  await page.mouse.up();
});

// G1, the drag half: WSP-03's "a moved tab keeps its ... scroll position".
// End to end for the same reason as its tab-switch twin above — the offset
// is lost because the host element is detached and re-attached, which jsdom
// does not model at all.
test("panel drag: a dragged tab keeps the scroll offset of the element that scrolls", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await widenPanel(page);
  await openPanelTab(page, "Files");
  await page.getByRole("treeitem", { name: "wide.json" }).click();
  await expect(page.getByRole("tab")).toHaveCount(3);

  // Two groups, the File tab alone in the second one, so dropping it back
  // into the first is a real move between groups.
  await panelChord(page, "ArrowRight");
  await expect(
    page.getByRole("separator", { name: "Resize panel groups" }),
  ).toBeVisible();

  const scrolled = await page.evaluate(scrollPreview, { top: 1000, left: 900 });
  expect(scrolled).not.toBeNull();
  if (scrolled === null) return;
  expect(scrolled.top).toBeGreaterThan(0);
  expect(scrolled.left).toBeGreaterThan(0);

  const first = await pointsOfGroup(page, 0);
  await dropTabOn(page, "wide.json", first.centre);

  const layout = await page.evaluate(panelLayout);
  expect(layout.groups).toHaveLength(1);
  await expect(page.getByRole("tab", { name: "wide.json" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await page.evaluate(previewScroll)).toEqual({
    top: scrolled.top,
    left: scrolled.left,
    sameNode: true,
  });
});

// WSP-03's explicit "a moved tab keeps its process" clause, for the drag
// rather than for the chord: the previous round proved a PROGRAMMATIC move
// preserves a body, which is a different code path from a dropped one only
// in how it is triggered — and that is exactly the part a test can get
// wrong by never exercising it.
test("panel drag: a dragged terminal keeps its shell and its scrollback", async ({
  page,
}) => {
  await page.addInitScript(recordSentFrames);
  await openProjectWithThread(page);
  await widenPanel(page);
  await openPanelTab(page, "Terminal");
  await expect(page.getByText("Terminal running")).toBeVisible({
    timeout: 15_000,
  });

  await page.locator(".terminal-surface").click();
  await page.keyboard.type("echo dragged-marker-6620");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "dragged-marker-6620",
    { timeout: 15_000 },
  );

  // Two groups, with the terminal alone in the second one. The tab is
  // clicked first because the keyboard is inside the shell's textarea, and
  // no chord is stolen from something the user is typing into.
  await page.getByRole("tab", { name: "Terminal" }).click();
  await panelChord(page, "ArrowRight");
  await expect(
    page.getByRole("separator", { name: "Resize panel groups" }),
  ).toBeVisible();
  const attachesBefore = await attachFrameCount(page);
  expect(attachesBefore).toBeGreaterThan(0);

  const first = await pointsOfGroup(page, 0);
  await dropTabOn(page, "Terminal", first.centre);

  // One group again, holding both tabs: the terminal's group emptied and
  // its sibling was promoted.
  const layout = await page.evaluate(panelLayout);
  expect(layout.groups).toHaveLength(1);
  expect(layout.groups[0]?.tabs.map((tab) => tab.replace("×", ""))).toEqual([
    "Changes",
    "Terminal",
  ]);

  // The same process, with the same screen: a body that had been torn down
  // and rebuilt would have opened a second socket and attached again.
  await expect(page.getByText("Terminal running")).toBeVisible();
  await expect(page.locator(".xterm-rows")).toContainText(
    "dragged-marker-6620",
  );
  expect(await attachFrameCount(page)).toBe(attachesBefore);
});
