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

// G4/G15 regression cover. Everything here is driven by REAL key presses on a
// real layout, because both defects lived exactly in the gap between "the
// command works when dispatched on window" and "the key does something".
//
// The four panes are built by chording, not by clicking, which is itself the
// G15 assertion: ⇧⌘= used to leave focus inside the new pane's composer, and
// every workspace chord is suppressed while a text entry has focus — so the
// second ⇧⌘= did nothing at all and this layout was unreachable from the
// keyboard.

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
    const id = `30000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
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
  root = await mkdtemp(join(tmpdir(), "pi-web-e2e-focus-"));
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

async function primaryModifier(page: Page): Promise<"Meta" | "Alt"> {
  const isMac = await page.evaluate(() => /mac/i.test(navigator.platform));
  return isMac ? "Meta" : "Alt";
}

// This spec's tsconfig has no "dom" lib (e2e/**/*.ts is type-checked as Node
// code), so the in-page helpers below get minimal local declarations rather
// than widening the shared tsconfig for one file.
interface InPageElement {
  getBoundingClientRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
    left: number;
    right: number;
  };
  classList: { contains(token: string): boolean };
  scrollWidth: number;
  clientWidth: number;
}

declare const document: {
  activeElement: { tagName: string } | null;
  querySelector(selector: string): InPageElement | null;
  // A NodeList in the page: array-like AND iterable, which is all the helpers
  // below need of it.
  querySelectorAll(selector: string): InPageElement[];
};

interface PaneBox {
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
}

function inPagePaneBoxes(): PaneBox[] {
  return Array.prototype.map.call(
    document.querySelectorAll(".tiling-region .pane"),
    (pane: {
      getBoundingClientRect(): {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      classList: { contains(token: string): boolean };
    }) => {
      const box = pane.getBoundingClientRect();
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        focused: pane.classList.contains("focused"),
      };
    },
  ) as PaneBox[];
}

function inPageActiveTag(): string | null {
  return document.activeElement?.tagName ?? null;
}

// How far the tiling surface overflows its own visible width — i.e. how much
// of the layout is off screen and reachable only by scrolling.
function inPageSurfaceOverflow(): number {
  const surface = document.querySelector(".tiling-surface");
  return surface === null ? 0 : surface.scrollWidth - surface.clientWidth;
}

function inPageFocusedPaneIsVisible(): boolean {
  const surface = document.querySelector(".tiling-surface");
  let focused: InPageElement | null = null;
  for (const pane of document.querySelectorAll(".tiling-region .pane")) {
    if (pane.classList.contains("focused")) focused = pane;
  }
  if (surface === null || focused === null) return false;
  const view = surface.getBoundingClientRect();
  const box = focused.getBoundingClientRect();
  return box.left >= view.left - 1 && box.right <= view.right + 1;
}

// Panes are read in DOM order, which is the tiling tree's in-order leaf walk.
// The names are the SCREEN positions the layout below puts them in, which is
// the whole point: before the fix, the tree order and the screen order were
// the same list and the arrow keys walked the list.
const PANE_NAMES = ["A(left)", "B(mid)", "C(top-right)", "D(bottom-right)"];

async function focusedPane(page: Page): Promise<string> {
  const boxes = await page.evaluate(inPagePaneBoxes);
  const index = boxes.findIndex((box) => box.focused);
  return PANE_NAMES[index] ?? `none(${String(index)})`;
}

async function clickPane(page: Page, name: string): Promise<void> {
  const index = PANE_NAMES.indexOf(name);
  // Click the pane's header title rather than its body: the header is inert
  // chrome, so this sets pane focus without landing inside a composer (which
  // would suppress the very chord under test).
  await page.locator(".tiling-region .pane").nth(index).locator("h1").click();
  await expect.poll(async () => await focusedPane(page)).toBe(name);
}

// Builds [ A | [ B | [ C / D ] ] ] — one full-height pane on the left, one in
// the middle, and a right-hand column split into a top and a bottom pane.
// This is the geometry the iteration-2 tester measured G4 against.
async function buildFourPanes(page: Page): Promise<void> {
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
  await expect(page.getByRole("region", { name: "New chat" })).toHaveCount(1);

  // The entry pane autofocuses its composer, which is right for the surface's
  // entry point and wrong for chording. Escape parks focus on the pane shell.
  await expect
    .poll(async () => await page.evaluate(inPageActiveTag))
    .toBe("TEXTAREA");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => await page.evaluate(inPageActiveTag))
    .toBe("SECTION");

  const primary = await primaryModifier(page);
  // Three chords back to back, with nothing in between. Each split has to
  // leave the keyboard armed for the next one (G15).
  await page.keyboard.press(`Shift+${primary}+=`);
  await expect(page.getByRole("region")).toHaveCount(2);
  await page.keyboard.press(`Shift+${primary}+=`);
  await expect(page.getByRole("region")).toHaveCount(3);
  await page.keyboard.press(`Shift+${primary}+-`);
  await expect(page.getByRole("region")).toHaveCount(4);
}

test("splitting by chord stays on the pane, so split chords chain and arrows stay armed", async ({
  page,
}) => {
  await buildFourPanes(page);

  // The pane shell, not its composer, holds focus after a split. This is the
  // property every chord in this file depends on.
  expect(await page.evaluate(inPageActiveTag)).toBe("SECTION");
  expect(await focusedPane(page)).toBe("D(bottom-right)");

  // Typing a printable character from the pane shell drops into that pane's
  // composer and keeps the character, so "split, then type" is still one
  // step even though the split no longer steals focus.
  await page.keyboard.press("h");
  await expect
    .poll(async () => await page.evaluate(inPageActiveTag))
    .toBe("TEXTAREA");
  await page.keyboard.type("ello");
  const composer = page
    .locator(".tiling-region .pane")
    .nth(3)
    .getByRole("textbox", { name: "First message" });
  await expect(composer).toHaveValue("hello");

  // ...and Escape gets back out again, which is what iteration 2 added.
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => await page.evaluate(inPageActiveTag))
    .toBe("SECTION");
  await expect(composer).toHaveValue("hello");
});

test("the four panes tile into the geometry the direction keys are judged against", async ({
  page,
}) => {
  await buildFourPanes(page);
  const boxes = await page.evaluate(inPagePaneBoxes);
  expect(boxes).toHaveLength(4);
  const [a, b, c, d] = boxes;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined
  ) {
    throw new Error("expected four panes");
  }
  // A and B are full-height columns, left to right.
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
  expect(b.x + b.width).toBeLessThanOrEqual(c.x + 1);
  expect(a.height).toBe(b.height);
  // C sits directly above D, both in the rightmost column.
  expect(c.x).toBe(d.x);
  expect(c.width).toBe(d.width);
  expect(c.y + c.height).toBeLessThanOrEqual(d.y + 1);
  // The right column is genuinely to the right of BOTH full-height columns,
  // and C/D each cover only half the height. Without that, "left from D" and
  // "up from C" would not be distinguishable questions.
  expect(c.height).toBeLessThan(a.height);
});

// The table the iteration-2 tester built by hand, as an assertion. Every row
// that reads "(no move)" was a wrong jump before the fix: tree-order
// traversal has no concept of "there is nothing above this pane", so it moved
// anyway, and from the last pane it wrapped to the first.
const TRANSITIONS: {
  from: string;
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
  to: string;
}[] = [
  { from: "D(bottom-right)", key: "ArrowLeft", to: "B(mid)" },
  { from: "D(bottom-right)", key: "ArrowUp", to: "C(top-right)" },
  { from: "D(bottom-right)", key: "ArrowRight", to: "D(bottom-right)" },
  { from: "D(bottom-right)", key: "ArrowDown", to: "D(bottom-right)" },
  { from: "C(top-right)", key: "ArrowUp", to: "C(top-right)" },
  { from: "C(top-right)", key: "ArrowDown", to: "D(bottom-right)" },
  { from: "C(top-right)", key: "ArrowLeft", to: "B(mid)" },
  { from: "A(left)", key: "ArrowDown", to: "A(left)" },
  { from: "A(left)", key: "ArrowUp", to: "A(left)" },
  { from: "A(left)", key: "ArrowLeft", to: "A(left)" },
  { from: "A(left)", key: "ArrowRight", to: "B(mid)" },
  { from: "B(mid)", key: "ArrowUp", to: "B(mid)" },
  { from: "B(mid)", key: "ArrowDown", to: "B(mid)" },
  { from: "B(mid)", key: "ArrowLeft", to: "A(left)" },
  // B spans the full height, so C and D are an exact tie on every geometric
  // measure. The documented tie-break is tree order, i.e. the topmost.
  { from: "B(mid)", key: "ArrowRight", to: "C(top-right)" },
];

test("a pane the arrows reach off screen is scrolled into view", async ({
  page,
}) => {
  await buildFourPanes(page);
  const primary = await primaryModifier(page);

  // CWS-07: below MIN_PANE_WIDTH_PX the surface scrolls sideways rather than
  // shrinking panes further, so at this viewport four panes do not all fit.
  // If they ever did, this test would prove nothing, so require the overflow.
  const overflow = await page.evaluate(inPageSurfaceOverflow);
  expect(overflow).toBeGreaterThan(1);

  // Start at the far left, then walk right by keyboard alone.
  await clickPane(page, "A(left)");
  await page.keyboard.press(`${primary}+Alt+ArrowRight`);
  await expect.poll(async () => await focusedPane(page)).toBe("B(mid)");
  await page.keyboard.press(`${primary}+Alt+ArrowRight`);
  await expect.poll(async () => await focusedPane(page)).toBe("C(top-right)");

  // The pane focus landed on has to be somewhere the user can see it.
  await expect
    .poll(async () => await page.evaluate(inPageFocusedPaneIsVisible))
    .toBe(true);
});

test("⌘⌥arrows move focus in the direction they name, and no-op at an edge", async ({
  page,
}) => {
  await buildFourPanes(page);
  const primary = await primaryModifier(page);

  const observed: string[] = [];
  for (const row of TRANSITIONS) {
    await clickPane(page, row.from);
    await page.keyboard.press(`${primary}+Alt+${row.key}`);
    // A no-op row has nothing to wait for, so poll for the expected value and
    // let the assertion below report what actually happened on timeout.
    await expect
      .poll(async () => await focusedPane(page), { timeout: 2000 })
      .toBe(row.to)
      .catch(() => undefined);
    const landed = await focusedPane(page);
    observed.push(`${row.from} + ${row.key} -> ${landed}`);
  }

  expect(observed).toEqual(
    TRANSITIONS.map((row) => `${row.from} + ${row.key} -> ${row.to}`),
  );
});
