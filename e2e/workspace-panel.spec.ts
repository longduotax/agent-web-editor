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
  clientWidth: number;
  clientHeight: number;
  offsetHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  className: string;
  parentElement: ProbeElement | null;
  getBoundingClientRect(): { x: number; y: number; height: number };
}
declare const document: {
  head: { appendChild(node: unknown): void };
  createElement(tag: string): { textContent: string };
  querySelector(selector: string): ProbeElement | null;
  querySelectorAll(selector: string): Iterable<ProbeElement>;
  elementFromPoint(x: number, y: number): ProbeElement | null;
};
declare function getComputedStyle(element: ProbeElement): {
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
test("panel file preview: a long line's scrollbar is on screen at every panel width", async ({
  page,
}) => {
  await openProjectWithThread(page);
  await openPanelTab(page, "Files");
  await page.getByRole("button", { name: "wide.json" }).click();
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
