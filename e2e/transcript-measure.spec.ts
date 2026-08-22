import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { expect, test } from "@playwright/test";
import type {
  AgentRuntime,
  OpenRuntimeSession,
  RuntimeEvent,
  RuntimeSnapshot,
} from "../packages/agent-runtime/src/index.js";

import { buildServer, type WorkspaceServer } from "../apps/server/src/app.js";
import { parseConfig } from "../apps/server/src/config.js";

// R2-3 regression, measured for real.
//
// The other two e2e specs stub a runtime that always returns an EMPTY
// transcript, which is why the reading column's containment was never
// exercised end to end: expanding an "N steps · Ns" group used to size
// `.worked-items`' implicit grid track to its widest step's max-content, and
// one long shell command stretched `.transcript` to a 14,641px scrollWidth
// against a 1,042px clientWidth. The centered column silently died the
// moment anyone opened a row.
//
// jsdom has no layout, so this can only be asserted in a real browser. This
// spec's stub therefore serves a deliberately pathological transcript — a
// very long unbroken shell command, a wide unified diff, a 400-character
// token with no break opportunity, and deeply indented output — and asserts
// the geometry directly: with EVERY <details> in the transcript open, the
// transcript must not scroll horizontally and no step row may be wider than
// the reading column.
const LONG_COMMAND =
  "if command -v cloc >/dev/null 2>&1; then cloc --vcs=git " +
  "--exclude-dir=node_modules,.next,dist,build,coverage,.turbo,.cache " +
  "--json --quiet . ; else echo 'cloc missing, falling back' && " +
  "git ls-files | xargs wc -l | sort -rn | head -50; fi";
const UNBROKEN_TOKEN = "z".repeat(400);
// A single very long LINE (spaces, so `overflow-wrap: anywhere` cannot break
// it down to a small min-content): this is what used to size the step list's
// and the step detail's implicit `auto` grid tracks to max-content.
const LONG_LINE = Array.from(
  { length: 220 },
  (_, index) => `segment${String(index)}`,
).join(" ");
const WIDE_DIFF = [
  "diff --git a/apps/server/src/domain/workspace.ts b/apps/server/src/domain/workspace.ts",
  "@@ -1019,7 +1019,7 @@ export class WorkspaceService implements WorkspaceServicePort {",
  "-      const native = await runtime.snapshot(); // this line is deliberately far wider than the reading column so it cannot wrap on a space",
  "+      const native = await runtime.snapshot(thread.id); // and so is this replacement line, for the same reason",
  `                                        ${UNBROKEN_TOKEN}`,
].join("\n");

const wideTranscript: RuntimeSnapshot["transcript"] = [
  {
    id: "user-1",
    kind: "message",
    role: "user",
    text: `Count the lines and show me the diff ${UNBROKEN_TOKEN}`,
    timestamp: "2026-08-22T00:00:00.000Z",
  },
  {
    id: "tool-1",
    kind: "tool",
    name: "bash",
    status: "completed",
    input: JSON.stringify({ command: LONG_COMMAND }),
    output: `${LONG_LINE}\n${WIDE_DIFF}`,
    cwd: `/tmp/project/${"deeply/nested/".repeat(20)}`,
    exitCode: 0,
    timestamp: "2026-08-22T00:00:01.000Z",
  },
  {
    id: "tool-2",
    kind: "tool",
    name: "read",
    status: "completed",
    input: JSON.stringify({
      path: `/tmp/project/${"deeply/nested/".repeat(12)}module.ts`,
      note: LONG_LINE,
    }),
    output: `${LONG_LINE}\n${WIDE_DIFF}`,
    cwd: null,
    exitCode: null,
    timestamp: "2026-08-22T00:00:28.000Z",
  },
  {
    id: "assistant-1",
    kind: "message",
    role: "assistant",
    text: `Here is the result:\n\n\`\`\`\n${LONG_COMMAND}\n\`\`\`\n\n| column one | column two | column three | column four |\n| --- | --- | --- | --- |\n| ${UNBROKEN_TOKEN} | b | c | d |\n`,
    timestamp: "2026-08-22T00:00:29.000Z",
  },
];

class WideSession implements OpenRuntimeSession {
  public constructor(public readonly id: string) {}
  public snapshot(): Promise<RuntimeSnapshot> {
    return Promise.resolve({
      sessionId: this.id,
      transcript: wideTranscript,
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

class WideRuntime implements AgentRuntime {
  private nextId = 1;
  public discover() {
    return Promise.resolve({ sessions: [], diagnostics: [] });
  }
  public create() {
    const id = `30000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    return Promise.resolve({ sessionId: id });
  }
  public open(_projectPath: string, sessionId: string) {
    return Promise.resolve(new WideSession(sessionId));
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
  root = await mkdtemp(join(tmpdir(), "pi-web-e2e-measure-"));
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
    runtime: new WideRuntime(),
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

// This spec's tsconfig has no "dom" lib (e2e/**/*.ts is type-checked as Node
// code), so give the page globals a minimal, precise local type rather than
// widening to `any` or adding "dom" to the shared tsconfig.
interface MeasuredElement {
  scrollWidth: number;
  clientWidth: number;
  offsetWidth: number;
  open: boolean;
  getBoundingClientRect(): { width: number; left: number; right: number };
}
declare const document: {
  querySelector(selector: string): MeasuredElement | null;
  querySelectorAll(selector: string): Iterable<MeasuredElement>;
  head: { appendChild(node: unknown): void };
  createElement(tag: string): { textContent: string };
};

// Opens every currently-rendered <details> and reports how many it opened.
// A step row only enters the DOM once its enclosing "N steps · Ns" group has
// opened and React has re-rendered, so the caller runs this repeatedly until
// it reports 0.
function openRenderedDisclosures(): number {
  let opened = 0;
  for (const element of document.querySelectorAll(".transcript details"))
    if (!element.open) {
      element.open = true;
      opened += 1;
    }
  return opened;
}

function transcriptOverflow(): number | null {
  const transcript = document.querySelector(".transcript");
  if (transcript === null) return null;
  return transcript.scrollWidth - transcript.clientWidth;
}

function widestChildVersusColumn(): { widest: number; column: number } | null {
  const column = document.querySelector(".transcript-column");
  if (column === null) return null;
  let widest = 0;
  for (const selector of [".activity", ".markdown", ".u-bubble", ".a-block"])
    for (const element of document.querySelectorAll(
      `.transcript-column ${selector}`,
    ))
      widest = Math.max(widest, element.getBoundingClientRect().width);
  return { widest, column: column.getBoundingClientRect().width };
}

// NEW-R3-2. The transcript is a scroll container with
// `scrollbar-gutter: stable both-edges`; the composer is not. With CLASSIC
// (non-overlay) scrollbars that made the transcript's content box two
// scrollbar-widths narrower than the composer's, so in any pane below
// --surface-measure the reading column sat visibly inset from the composer on
// both sides -- the user's original "the chat should be centered" complaint,
// back again in the multi-pane layout. jsdom cannot see this: it needs real
// layout AND a real scrollbar.
function axisProbe(): {
  columnLeft: number;
  columnRight: number;
  composerLeft: number;
  composerRight: number;
  gutter: number;
} | null {
  const column = document.querySelector(".transcript-column");
  const composer = document.querySelector(".composer-input");
  const transcript = document.querySelector(".transcript");
  if (column === null || composer === null || transcript === null) return null;
  const columnBox = column.getBoundingClientRect();
  const composerBox = composer.getBoundingClientRect();
  return {
    columnLeft: columnBox.left,
    columnRight: columnBox.right,
    composerLeft: composerBox.left,
    composerRight: composerBox.right,
    // 0 with macOS overlay scrollbars, 2x the scrollbar width with classic
    // ones. Only the second case can expose the defect.
    gutter: transcript.offsetWidth - transcript.clientWidth,
  };
}

// Forces classic (space-consuming) scrollbars regardless of the OS setting,
// so this assertion means the same thing on every machine and in CI.
function forceClassicScrollbars(): void {
  const style = document.createElement("style");
  style.textContent =
    "*::-webkit-scrollbar { width: 15px; height: 15px; } *::-webkit-scrollbar-thumb { background: #888; }";
  document.head.appendChild(style);
}

async function openWideThread(page: import("@playwright/test").Page) {
  await page.goto(launchUrl);
  // Below 900px the sidebar is an overlay drawer and has to be opened first.
  const drawer = page.getByRole("button", { name: "Open projects drawer" });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByRole("button", { name: "Browse…" }).click();
  const projectName = basename(projectPath);
  await expect(
    page.getByRole("link", { name: new RegExp(projectName) }),
  ).toBeVisible();
  await page.getByRole("link", { name: new RegExp(projectName) }).hover();
  await page
    .getByRole("button", { name: `New thread in ${projectName}` })
    .click();
  await page
    .getByRole("combobox", { name: "Execution location" })
    .selectOption("shared");
  await page
    .getByRole("textbox", { name: "First message" })
    .fill("Count the lines");
  await page.getByRole("button", { name: "Create chat and send" }).click();
}

test("expanding every transcript disclosure never widens the centered reading column", async ({
  page,
}) => {
  await openWideThread(page);

  // The stub's snapshot supplies the transcript, so the step group appears as
  // soon as the pane's snapshot query resolves.
  const group = page.getByText(/^\d+ steps? · /);
  await expect(group.first()).toBeVisible();

  // Collapsed: the column already holds.
  await expect
    .poll(() => page.evaluate(transcriptOverflow))
    .toBeLessThanOrEqual(1);

  let opened = 0;
  for (let round = 0; round < 6; round += 1) {
    const justOpened = await page.evaluate(openRenderedDisclosures);
    opened += justOpened;
    if (justOpened === 0) break;
    // Let React process the toggle events and mount the newly revealed rows.
    await page.waitForTimeout(150);
  }
  // The group plus each of its step rows.
  expect(opened).toBeGreaterThanOrEqual(3);
  // The long command's full text lives in the expanded Input/Output <pre>,
  // which wraps; the summary line truncates.
  await expect(page.getByText("Input").first()).toBeVisible();

  const overflow = await page.evaluate(transcriptOverflow);
  expect(
    overflow,
    "the transcript must not scroll horizontally",
  ).not.toBeNull();
  expect(overflow ?? 0).toBeLessThanOrEqual(1);

  const measured = await page.evaluate(widestChildVersusColumn);
  expect(measured).not.toBeNull();
  const { widest, column } = measured ?? { widest: 0, column: 0 };
  expect(column).toBeGreaterThan(0);
  expect(
    widest,
    "no transcript content may be wider than the reading column",
  ).toBeLessThanOrEqual(column + 1);
});

// Run at a viewport whose single pane is NARROWER than --surface-measure
// (48rem = 768px): that is the regime where the two boxes are
// width-constrained rather than clamped to the measure, and where the gutter
// mismatch used to show. 600 was the exact width the round-2 review measured
// a 15px offset and a 30px width difference at.
test.describe("a pane narrower than the reading measure", () => {
  test.use({ viewport: { width: 600, height: 800 } });

  test("keeps the transcript column and the composer on one axis, with classic scrollbars", async ({
    page,
  }) => {
    await openWideThread(page);
    await expect(page.getByText(/^\d+ steps? · /).first()).toBeVisible();

    // As the machine renders it.
    const natural = await page.evaluate(axisProbe);
    expect(natural).not.toBeNull();
    const asRendered = natural ?? {
      columnLeft: 0,
      columnRight: 0,
      composerLeft: 0,
      composerRight: 0,
      gutter: 0,
    };
    expect(
      Math.abs(asRendered.columnLeft - asRendered.composerLeft),
      "left edges must coincide",
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(asRendered.columnRight - asRendered.composerRight),
      "right edges must coincide",
    ).toBeLessThanOrEqual(1);

    // And with a classic 15px scrollbar forced on, which is the only
    // configuration that can reproduce the defect.
    await page.evaluate(forceClassicScrollbars);
    const classic = await page.evaluate(axisProbe);
    expect(classic).not.toBeNull();
    const forced = classic ?? {
      columnLeft: 0,
      columnRight: 0,
      composerLeft: 0,
      composerRight: 0,
      gutter: 0,
    };
    expect(
      forced.gutter,
      "the forced classic scrollbar must actually consume space, or this proves nothing",
    ).toBeGreaterThan(0);
    expect(
      Math.abs(forced.columnLeft - forced.composerLeft),
      "left edges must coincide with a classic scrollbar",
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(forced.columnRight - forced.composerRight),
      "right edges must coincide with a classic scrollbar",
    ).toBeLessThanOrEqual(1);
    // The pane really is below the measure here, so this is the failing
    // regime and not the clamped one.
    expect(forced.columnRight - forced.columnLeft).toBeLessThan(768);
  });
});
