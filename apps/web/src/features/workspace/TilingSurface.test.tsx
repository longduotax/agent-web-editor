// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectId, ThreadId, ThreadSnapshot } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  markViewed: vi.fn(),
  prompt: vi.fn(),
  steer: vi.fn(),
  stop: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspacePreflight: vi.fn(),
  startThread: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { tiledPaneIds } from "./layoutTree.js";
import { useWorkspaceLayout } from "./useWorkspaceLayout.js";
import type { WorkspaceLayoutController } from "./useWorkspaceLayout.js";
import { MIN_PANE_WIDTH_PX, TilingSurface } from "./TilingSurface.js";

// Extracts the declaration body of a standalone top-level CSS rule (e.g.
// ".transcript {") from the stylesheet source. Used to assert on the actual
// shipped CSS properties (not just a class name) since jsdom does not apply
// external stylesheets, so computed styles in tests can't reflect them.
async function stylesheet(): Promise<string> {
  return await readFile(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../styles.css"),
    "utf8",
  );
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\n${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null)
    throw new Error(`no top-level rule found for selector "${selector}"`);
  return match[1] ?? "";
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;

const snapshot: ThreadSnapshot = {
  version: 2,
  project: {
    id: projectId,
    displayName: "Example project",
    displayPath: "/example",
    createdAt: "2026-01-01T00:00:00.000Z",
    available: true,
    gitAvailable: true,
    sidebarExpanded: true,
    unreadCount: 0,
    lastOpenedThreadId: threadId,
  },
  thread: {
    id: threadId,
    projectId,
    title: "Example thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    runState: null,
    unread: false,
    runtimeAvailable: true,
    runtime: "pi" as const,
    workspace: { mode: "shared", branchName: null, available: true },
  },
  transcriptPage: { items: [], olderCursor: null, atLatest: true },
  currentRun: null,
  lastRun: null,
  epoch: "40000000-0000-4000-8000-000000000001",
  highWaterSequence: 0,
  capabilities: { prompt: true, steer: true, stop: true },
  diagnostics: [],
};

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

function snapshotFor(id: ThreadId, title: string): ThreadSnapshot {
  return {
    ...snapshot,
    thread: { ...snapshot.thread, id, title },
  };
}

function Harness({
  onReady,
}: {
  onReady: (controller: WorkspaceLayoutController) => void;
}) {
  const controller = useWorkspaceLayout(projectId);
  onReady(controller);
  return (
    <TilingSurface
      projectId={projectId}
      controller={controller}
      onClosePane={vi.fn()}
      onThreadStarted={(paneId, startedThreadId) => {
        controller.assignThreadToPane(paneId, startedThreadId);
      }}
    />
  );
}

function renderSurface() {
  const store = stubStorage();
  api.getWorkspace.mockResolvedValue({
    projects: [
      {
        id: projectId,
        displayName: "Example project",
        displayPath: "example",
        createdAt: "2026-01-01T00:00:00.000Z",
        available: true,
        gitAvailable: true,
        sidebarExpanded: true,
        unreadCount: 0,
        lastOpenedThreadId: null,
      },
    ],
    threads: [],
    diagnostics: [],
  });
  api.getWorkspacePreflight.mockResolvedValue({
    worktreeAvailable: true,
    unavailableReason: null,
    currentBranch: "main",
    branches: ["main"],
    headCommit: "1234567",
    changes: null,
  });
  api.getSnapshot.mockResolvedValue(snapshot);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let latest: WorkspaceLayoutController | undefined;
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Harness
          onReady={(controller) => {
            latest = controller;
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    getController: () => {
      if (latest === undefined) throw new Error("controller not ready");
      return latest;
    },
    store,
    container,
  };
}

async function seedTwoPanes(getController: () => WorkspaceLayoutController) {
  act(() => {
    getController().dispatch({ type: "split", axis: "row" });
  });
  const [firstPaneId] = tiledPaneIds(getController().layout);
  if (firstPaneId === undefined) throw new Error("missing first pane");
  act(() => {
    getController().assignThreadToPane(firstPaneId, threadId);
  });
  await screen.findByRole("heading", { name: "Example thread" });
  return firstPaneId;
}

describe("TilingSurface", () => {
  it("renders both tiled panes with a resizable divider between them", async () => {
    const { getController } = renderSurface();
    await seedTwoPanes(getController);

    expect(
      screen.getByRole("heading", { name: "Example thread" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New chat")).toBeInTheDocument();

    const divider = screen.getByRole("separator");
    expect(divider).toHaveAttribute("aria-orientation");
    expect(divider).toHaveAttribute("aria-valuemin");
    expect(divider).toHaveAttribute("aria-valuemax");
    expect(divider).toHaveAttribute("aria-valuenow");
  });

  it("keeps workspace chords armed after the user splits a pane", async () => {
    renderSurface();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Split right into a new chat" }),
    );

    const focusedPane = screen
      .getAllByRole("region", { name: "New chat" })
      .find((pane) => pane.getAttribute("aria-current") === "true");
    expect(focusedPane).toBeDefined();
    if (focusedPane === undefined) return;
    expect(focusedPane).toHaveFocus();
    expect(
      within(focusedPane).getByRole("textbox", { name: "First message" }),
    ).not.toHaveFocus();
  });

  it("adjusts split sizes on the controller when the divider is resized with the keyboard", async () => {
    const { getController } = renderSurface();
    await seedTwoPanes(getController);

    const before = getController().layout.root;
    expect(before?.type).toBe("split");
    const beforeFirst = before?.type === "split" ? before.sizes[0] : undefined;
    expect(beforeFirst).toBeCloseTo(0.5);

    const divider = screen.getByRole("separator");
    divider.focus();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");

    const after = getController().layout.root;
    expect(after?.type).toBe("split");
    if (after?.type === "split") {
      expect(after.sizes[0]).toBeGreaterThan(beforeFirst ?? 0);
      expect(after.sizes[0] + after.sizes[1]).toBeCloseTo(1);
    }
  });

  it("focuses a pane on click and marks it with aria-current", async () => {
    const { getController } = renderSurface();
    const firstPaneId = await seedTwoPanes(getController);
    // The split leaves focus on the newly created (new-chat) pane.
    expect(getController().layout.focusedPaneId).not.toBe(firstPaneId);

    const user = userEvent.setup();
    const heading = screen.getByRole("heading", { name: "Example thread" });
    await user.click(heading);

    expect(getController().layout.focusedPaneId).toBe(firstPaneId);
    const threadHeading = screen.getByRole("heading", {
      name: "Example thread",
    });
    const threadRegion = threadHeading.closest("[aria-current]");
    expect(threadRegion).toHaveAttribute("aria-current", "true");
  });

  it("gives the focused pane the ring treatment and dims the non-focused one, matching the pane it wraps", async () => {
    const { getController } = renderSurface();
    const firstPaneId = await seedTwoPanes(getController);

    const user = userEvent.setup();
    const heading = screen.getByRole("heading", { name: "Example thread" });
    await user.click(heading);
    expect(getController().layout.focusedPaneId).toBe(firstPaneId);

    const focusedPane = screen.getByRole("region", { name: "Example thread" });
    expect(focusedPane).toHaveClass("pane", "focused");
    expect(focusedPane).not.toHaveClass("dim");
    expect(focusedPane).toHaveAttribute("aria-current", "true");

    const dimmedPane = screen.getByLabelText("New chat");
    expect(dimmedPane).toHaveClass("pane", "dim");
    expect(dimmedPane).not.toHaveClass("focused");
    expect(dimmedPane).not.toHaveAttribute("aria-current");
  });

  it("never renders a dock or dock-restore affordance", async () => {
    const { getController } = renderSurface();
    await seedTwoPanes(getController);

    expect(
      screen.queryByRole("button", { name: /dock/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /restore.*dock/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: /dock/i }),
    ).not.toBeInTheDocument();
  });

  it("resizes the outer split of a 2x2 grid by keyboard, even though neither of its immediate children is a pane", async () => {
    const { getController, container } = renderSurface();

    // Build a 2x2 grid: split right, then split each side down. The outer
    // split's two children end up being splits themselves (not panes) —
    // this is the case a pane-id-based resize handle could never reach.
    act(() => {
      getController().dispatch({ type: "split", axis: "row" });
    });
    const outerSplit = getController().layout.root;
    if (outerSplit?.type !== "split") throw new Error("expected split root");
    const outerSplitId = outerSplit.id;
    const [leftPaneId, rightPaneId] = outerSplit.children.map((child) =>
      child.type === "pane" ? child.id : undefined,
    );
    if (leftPaneId === undefined || rightPaneId === undefined)
      throw new Error("expected two pane children");

    act(() => {
      getController().focus(leftPaneId);
    });
    act(() => {
      getController().dispatch({ type: "split", axis: "column" });
    });
    act(() => {
      getController().focus(rightPaneId);
    });
    act(() => {
      getController().dispatch({ type: "split", axis: "column" });
    });

    const grid = getController().layout.root;
    if (grid?.type !== "split") throw new Error("expected split root");
    expect(grid.id).toBe(outerSplitId);
    expect(grid.children[0].type).toBe("split");
    expect(grid.children[1].type).toBe("split");
    const before = grid.sizes[0];

    // The outer divider is the one directly under the top-level split
    // container; the two inner dividers sit one level deeper, inside each
    // side's own split container.
    const outerDivider = container.querySelector(
      ":scope > .tiling-surface > .tiling-tiles > .tiling-split > .tiling-divider",
    );
    if (outerDivider === null) throw new Error("outer divider not found");
    expect(outerDivider).toHaveAttribute("role", "separator");

    (outerDivider as HTMLElement).focus();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");

    const after = getController().layout.root;
    if (after?.type !== "split") throw new Error("expected split root");
    expect(after.id).toBe(outerSplitId);
    expect(after.sizes[0]).toBeGreaterThan(before);
    expect(after.sizes[0] + after.sizes[1]).toBeCloseTo(1);
  });

  it("does not leak a draft from a closed pane into the pane promoted into its position (regression: split ids as React keys)", async () => {
    const threadA = "20000000-0000-4000-8000-00000000000a" as ThreadId;
    const threadB = "20000000-0000-4000-8000-00000000000b" as ThreadId;
    const threadC = "20000000-0000-4000-8000-00000000000c" as ThreadId;
    const threadD = "20000000-0000-4000-8000-00000000000d" as ThreadId;
    const snapshots = new Map<ThreadId, ThreadSnapshot>([
      [threadA, snapshotFor(threadA, "Thread A")],
      [threadB, snapshotFor(threadB, "Thread B")],
      [threadC, snapshotFor(threadC, "Thread C")],
      [threadD, snapshotFor(threadD, "Thread D")],
    ]);

    const { getController, store } = renderSurface();
    // Override the single-thread default stub with per-thread routing; the
    // queries this test triggers all happen after this point.
    api.getSnapshot.mockImplementation((_projectId: ProjectId, tid: ThreadId) =>
      Promise.resolve(snapshots.get(tid)),
    );

    // A is the initial pane. Split A right -> B (focused). Split B right ->
    // C (focused). Split C right -> D (focused). Assign each thread as its
    // pane appears.
    const paneA = getController().layout.focusedPaneId;
    if (paneA === null) throw new Error("missing pane A");
    act(() => {
      getController().assignThreadToPane(paneA, threadA);
    });

    act(() => {
      getController().dispatch({ type: "split", axis: "row" });
    });
    const paneB = getController().layout.focusedPaneId;
    if (paneB === null) throw new Error("missing pane B");
    act(() => {
      getController().assignThreadToPane(paneB, threadB);
    });

    act(() => {
      getController().dispatch({ type: "split", axis: "row" });
    });
    const paneC = getController().layout.focusedPaneId;
    if (paneC === null) throw new Error("missing pane C");
    act(() => {
      getController().assignThreadToPane(paneC, threadC);
    });

    act(() => {
      getController().dispatch({ type: "split", axis: "row" });
    });
    const paneD = getController().layout.focusedPaneId;
    if (paneD === null) throw new Error("missing pane D");
    act(() => {
      getController().assignThreadToPane(paneD, threadD);
    });

    await screen.findByRole("heading", { name: "Thread D" });

    // Type a draft into B's composer specifically (there are four
    // identically-labeled composers, one per pane — scope by B's region).
    const regionB = screen.getByRole("region", { name: "Thread B" });
    const composerB = within(regionB).getByRole("textbox", {
      name: "Message Pi",
    });
    const user = userEvent.setup();
    await user.type(composerB, "draft typed in B");
    await waitFor(() => {
      expect(store.get(`pi-draft:${threadB}`)).toBe("draft typed in B");
    });

    // Close B. Its parent split is replaced by the surviving sibling
    // subtree (the split containing C and D), which gets promoted into B's
    // former position in the tree.
    act(() => {
      getController().close(paneB);
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Thread B" }),
      ).not.toBeInTheDocument();
    });

    // C's composer must be freshly mounted (empty), not reusing B's
    // composer instance and its leftover draft text — and C's own
    // persisted draft must be untouched by B's draft.
    const regionC = screen.getByRole("region", { name: "Thread C" });
    const composerC = within(regionC).getByRole("textbox", {
      name: "Message Pi",
    });
    expect(composerC).toHaveValue("");
    expect(store.get(`pi-draft:${threadC}`) ?? "").not.toBe("draft typed in B");
  });

  it("keeps each new-chat pane's draft separate from every other new-chat pane in the same project", async () => {
    const user = userEvent.setup();
    const { getController, store } = renderSurface();

    // Two threadless (new-chat) panes side by side in one project.
    act(() => {
      getController().dispatch({ type: "split", axis: "row" });
    });
    const composers = await screen.findAllByLabelText("First message");
    expect(composers).toHaveLength(2);
    const [first, second] = composers;
    if (first === undefined || second === undefined)
      throw new Error("expected two new-chat composers");

    await user.click(first);
    await user.paste("draft for pane one");
    await user.click(second);
    await user.paste("draft for pane two");

    expect(first).toHaveValue("draft for pane one");
    expect(second).toHaveValue("draft for pane two");

    // ...and each pane's text is persisted under its own key, so remounting
    // one never clobbers the other.
    const newChatDrafts = [...store.entries()].filter(([key]) =>
      key.startsWith("pi-new-draft:"),
    );
    expect(newChatDrafts).toHaveLength(2);
    expect(newChatDrafts.map(([, value]) => value).sort()).toEqual([
      "draft for pane one",
      "draft for pane two",
    ]);
  });

  describe("centered reading column and minimum pane width", () => {
    // Rewritten from the superseded CWS-07 ("a pane uses its full width, no
    // centered measure"). Orchestrator decisions D-2/D-3 revert that: the
    // transcript, composer and new-chat card all share ONE centered reading
    // column driven by a single custom property, --surface-measure. No
    // component may hardcode a competing width.
    it("centers the transcript, composer and new-chat card on the single --surface-measure token", async () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const cssPath = resolve(here, "../../styles.css");
      const css = await readFile(cssPath, "utf8");

      expect(css).toMatch(/--surface-measure:\s*[\d.]+rem;/);

      for (const selector of [
        ".transcript-column",
        ".composer-input",
        ".new-chat-card",
      ]) {
        const body = ruleBody(css, selector);
        expect(body, `${selector} should size on --surface-measure`).toMatch(
          /var\(--surface-measure\)/,
        );
        expect(body, `${selector} should center itself`).toMatch(
          /margin(-inline)?:\s*[^;]*\bauto\b/,
        );
      }

      // No component may reintroduce one of the three competing widths the
      // app used to carry (54rem composer / 700px card / 720px mockup).
      expect(css).not.toMatch(/\b(54rem|700px|720px)\b/);

      // The scroll container's own padding stays a comfortable, fixed amount
      // -- not the viewport-relative max(1rem, 8%) formula that faked a
      // centered column with side gutters.
      expect(ruleBody(css, ".composer")).not.toMatch(/max\(/);
      expect(ruleBody(css, ".transcript")).not.toMatch(/max\(/);
    });

    // R2-3 regression. Expanding a "Worked for Ns" step group used to blow
    // the column apart: `.worked-items` is a grid, its implicit `auto` track
    // sized to the widest step's max-content, and a single long shell command
    // stretched the transcript to a 14,641px scrollWidth against a 1,042px
    // client width. The geometry itself is asserted end-to-end in
    // e2e/transcript-measure.spec.ts (jsdom has no layout); this locks the
    // CSS contract that makes it hold.
    it("never lets transcript content widen the reading column", async () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const cssPath = resolve(here, "../../styles.css");
      const css = await readFile(cssPath, "utf8");

      // Every grid inside the transcript pins its track to the column
      // instead of letting an implicit `auto` track size to its widest
      // item's max-content.
      for (const selector of [".worked-items", ".activity-details"])
        expect(
          ruleBody(css, selector),
          `${selector}'s grid track must be pinned to the column`,
        ).toMatch(/grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)/);

      // A cwd path has no space to break on, so the step footer's spans need
      // an explicit break opportunity or they are unshrinkable flex items.
      expect(ruleBody(css, ".activity-details footer span")).toMatch(
        /overflow-wrap:\s*anywhere/,
      );

      // Grid/flex descendants must not keep min-width: auto, or they size to
      // max-content regardless of the track.
      for (const selector of [".activity", ".activity summary"]) {
        expect(
          ruleBody(css, selector),
          `${selector} needs an explicit zero minimum size`,
        ).toMatch(/min-width:\s*0/);
      }
      expect(ruleBody(css, ".activity")).toMatch(/max-width:\s*100%/);

      // The general rule: every block in the column is capped at the measure
      // with a zero automatic minimum, so wide content overflows inside its
      // own container rather than stretching the column.
      const columnChildren = ruleBody(css, ".transcript-column > *");
      expect(columnChildren).toMatch(/min-width:\s*0/);
      expect(columnChildren).toMatch(/max-width:\s*100%/);
      expect(ruleBody(css, ".transcript-column")).toMatch(/min-width:\s*0/);

      // Wide content scrolls or wraps inside its own box. A table's scroll
      // container is a wrapper element, not the table itself (Markdown.tsx):
      // `display: block` on a <table> makes a scroll box whose anonymous
      // inner table still shrink-to-fits the SAME width, so wide columns
      // compressed instead of overflowing and the scrollbar never appeared.
      // The wrapper is capped at the measure; the table inside it takes its
      // max-content width and overflows, which is what produces the scroll.
      const tableScroll = ruleBody(css, ".markdown-table-scroll");
      expect(tableScroll).toMatch(/overflow-x:\s*auto/);
      expect(tableScroll).toMatch(/max-width:\s*100%/);
      expect(ruleBody(css, ".markdown-table-scroll > table")).toMatch(
        /width:\s*max-content/,
      );
      expect(
        ruleBody(
          css,
          ".markdown pre,\n.activity pre,\n.diff-view pre,\n.file-preview pre",
        ),
      ).toMatch(/overflow:\s*auto/);
      expect(ruleBody(css, ".activity-details pre")).toMatch(
        /overflow-wrap:\s*anywhere/,
      );

      // R2-9: a classic scrollbar must not shave the centering box on one
      // side and knock the column off the composer's axis.
      expect(ruleBody(css, ".transcript")).toMatch(
        /scrollbar-gutter:\s*stable both-edges/,
      );
    });

    it("exports MIN_PANE_WIDTH_PX as the surface's enforced minimum pane width", () => {
      expect(MIN_PANE_WIDTH_PX).toBe(360);
    });

    it("gives the surface a horizontal scroll container whose content never shrinks panes below MIN_PANE_WIDTH_PX", async () => {
      const css = await stylesheet();
      const { getController, container } = renderSurface();

      // Split repeatedly to build up more panes than would comfortably fit
      // at the minimum pane width in a typical viewport.
      for (let i = 0; i < 4; i += 1) {
        act(() => {
          getController().dispatch({ type: "split", axis: "row" });
        });
      }

      const paneCount = tiledPaneIds(getController().layout).length;
      expect(paneCount).toBeGreaterThan(2);

      const surface = container.querySelector(":scope > .tiling-surface");
      if (surface === null) throw new Error("surface container not found");
      expect(ruleBody(css, ".tiling-surface")).toMatch(/overflow-x:\s*auto/);

      const tiles = surface.querySelector(":scope > .tiling-tiles");
      if (tiles === null) throw new Error("tiles container not found");
      expect(getComputedStyle(tiles).minWidth).toBe(
        `${String(paneCount * MIN_PANE_WIDTH_PX)}px`,
      );
    });

    // The total floor above says the surface is WIDE enough for every pane at
    // the minimum; it says nothing about how the width is divided. Measured
    // in the browser: three panes at a 0.5 / 0.25 / 0.25 split and 1080px of
    // tiles came out 540 / 270 / 270 -- two panes 25% under the minimum
    // CWS-07 promises they never go below. The clamp is per region, and the
    // ancestors must carry `min-width: auto` or a clamped region simply
    // overflows its split-child and paints over the neighbouring pane.
    it("clamps every pane to MIN_PANE_WIDTH_PX individually, not just in total", async () => {
      const css = await stylesheet();
      const { container } = renderSurface();

      const surface = container.querySelector(":scope > .tiling-surface");
      if (surface === null) throw new Error("surface container not found");
      // One source for the number: the stylesheet reads it from the element.
      expect(
        (surface as HTMLElement).style.getPropertyValue("--pane-min-width"),
      ).toBe(`${String(MIN_PANE_WIDTH_PX)}px`);

      expect(ruleBody(css, ".tiling-region")).toMatch(
        /min-width:\s*var\(--pane-min-width/,
      );
      expect(ruleBody(css, ".tiling-split")).toMatch(/min-width:\s*auto/);
      expect(ruleBody(css, ".tiling-split-child")).toMatch(/min-width:\s*auto/);
    });

    it("keeps the surface's min-width at exactly one pane's worth when only one pane is open", async () => {
      const { getController, container } = renderSurface();
      await seedTwoPanes(getController);
      // seedTwoPanes leaves two panes open; close one back down to one.
      const [firstPaneId] = tiledPaneIds(getController().layout);
      if (firstPaneId === undefined) throw new Error("missing pane");
      act(() => {
        getController().close(firstPaneId);
      });

      const paneCount = tiledPaneIds(getController().layout).length;
      expect(paneCount).toBe(1);

      const tiles = container.querySelector(
        ":scope > .tiling-surface > .tiling-tiles",
      );
      if (tiles === null) throw new Error("tiles container not found");
      expect(getComputedStyle(tiles).minWidth).toBe(
        `${String(MIN_PANE_WIDTH_PX)}px`,
      );
    });
  });
});
