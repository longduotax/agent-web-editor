// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

const api = vi.hoisted(() => ({
  getDiff: vi.fn(),
  getFile: vi.fn(),
  getFiles: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { ApiClientError } from "../../api/client.js";
import { ChangesTab } from "./ChangesTab.js";
import { DIFF_LINE_LIMIT } from "./parseUnifiedDiff.js";
import { DiffTab } from "./DiffTab.js";
import { FilesTab } from "./FilesTab.js";
import { FileTab } from "./FileTab.js";
import type { PanelActions } from "./usePanelState.js";
import type { PanelTab, TabContext } from "./panelTabs.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;
const threadId = "20000000-0000-4000-8000-000000000001" as ThreadId;
const context: TabContext = {
  projectId,
  threadId,
  scopeKey: projectId,
  label: "Example project",
};

function actionsSpy(): PanelActions {
  return {
    openTab: vi.fn(),
    closeTab: vi.fn(),
    activateTab: vi.fn(),
    moveTab: vi.fn(),
    splitWithTab: vi.fn(),
    closeGroup: vi.fn(),
    focusGroup: vi.fn(),
    resizeGroups: vi.fn(),
    setWidth: vi.fn(),
    setOpen: vi.fn(),
    updateTab: vi.fn(),
    bindPendingContexts: vi.fn(),
    announce: vi.fn(),
  };
}

function renderBody(body: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{body}</QueryClientProvider>,
  );
}

describe("ChangesTab", () => {
  const tab = { id: "t", type: "changes", context } as const;

  it("names the worktree it reads and summarises the change counts", async () => {
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [
        {
          path: "src/added.ts",
          originalPath: null,
          indexStatus: "A",
          worktreeStatus: " ",
          kind: "added",
        },
        {
          path: "src/changed.ts",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          kind: "modified",
        },
      ],
    });
    renderBody(<ChangesTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText(
        /Working tree: Example project.*1 added, 1 modified/,
      ),
    ).toBeVisible();
    expect(screen.getByText("Select a file to view its diff.")).toBeVisible();
  });

  it("shows a pending state, then the empty state for a clean worktree", async () => {
    let resolveStatus: (value: unknown) => void = () => undefined;
    api.getStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    renderBody(<ChangesTab tab={tab} visible actions={actionsSpy()} />);

    expect(await screen.findByText("Reading the worktree…")).toBeVisible();
    resolveStatus({ available: true, message: null, files: [] });
    expect(
      await screen.findByText("No changes in this worktree."),
    ).toBeVisible();
  });

  it("shows the server's reason when the worktree is unavailable", async () => {
    api.getStatus.mockResolvedValue({
      available: false,
      message: "git is not installed on this machine.",
      files: [],
    });
    renderBody(<ChangesTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText("git is not installed on this machine."),
    ).toBeVisible();
  });

  it("offers a retry when the read fails", async () => {
    api.getStatus.mockRejectedValue(new Error("worktree is locked"));
    renderBody(<ChangesTab tab={tab} visible actions={actionsSpy()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "worktree is locked",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  // WSP-06: activating a path opens a Diff tab rather than replacing the
  // list the user is reading.
  it("opens a Diff tab for the activated path, carrying this tab's context", async () => {
    const user = userEvent.setup();
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [
        {
          path: "src/main.ts",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          kind: "modified",
        },
      ],
    });
    const actions = actionsSpy();
    renderBody(<ChangesTab tab={tab} visible actions={actions} />);

    await user.click(await screen.findByRole("button", { name: /src\/main/ }));

    expect(actions.openTab).toHaveBeenCalledWith({
      type: "diff",
      context,
      path: "src/main.ts",
      collapsedHunks: [],
    });
  });

  it("issues no request while it is hidden", () => {
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [],
    });
    renderBody(<ChangesTab tab={tab} visible={false} actions={actionsSpy()} />);

    expect(api.getStatus).not.toHaveBeenCalled();
  });

  it("says so, instead of querying, when it has no worktree to read", () => {
    renderBody(
      <ChangesTab
        tab={{ id: "t", type: "changes", context: null }}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(screen.getByText(/not bound to a worktree/)).toBeVisible();
    expect(api.getStatus).not.toHaveBeenCalled();
  });
});

describe("FilesTab", () => {
  const tab: Extract<PanelTab, { type: "files" }> = {
    id: "t",
    type: "files",
    context,
    search: "",
    expanded: [],
    showIgnored: false,
  };

  // The tree's own behaviour is covered in FileTree.test.tsx; what is here
  // is the tab around it — the debounced, bounded, flat search mode WSP-09
  // pins, which the tree deliberately does not change.
  function listing(entries: { path: string; kind: "file" | "directory" }[]) {
    return {
      entries: entries.map((entry) => ({
        ...entry,
        name: entry.path.split("/").pop() ?? entry.path,
        size: entry.kind === "file" ? 1 : null,
      })),
      truncated: false,
      ignoredHidden: false,
    };
  }

  it("debounces the search and keeps the previous list visible", async () => {
    const user = userEvent.setup();
    api.getFiles.mockResolvedValue(
      listing([{ path: "src/main.ts", kind: "file" }]),
    );
    renderBody(
      <FilesTab
        tab={{ ...tab, search: "mai" }}
        visible
        actions={actionsSpy()}
      />,
    );

    await screen.findByText("src/main.ts");
    expect(api.getFiles).toHaveBeenCalledTimes(1);

    await user.type(
      screen.getByRole("textbox", { name: "Search project files" }),
      "n",
    );
    // One keystroke, still one request in flight-or-done...
    expect(api.getFiles).toHaveBeenCalledTimes(1);
    // ...and the list never blanks to its loading state mid-typing.
    expect(screen.queryByText("Listing files…")).not.toBeInTheDocument();
    expect(screen.getByText("src/main.ts")).toBeInTheDocument();

    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(2);
    });
    expect(api.getFiles).toHaveBeenLastCalledWith(projectId, threadId, {
      search: "main",
      depth: "full",
      showIgnored: false,
    });
    // keepPreviousData: the settled request does not blank the still-valid
    // list it is replacing (WSP-09).
    expect(screen.queryByText("Listing files…")).not.toBeInTheDocument();
  });

  // D7. The tab needs a selection to do anything, so WSP-10 requires a
  // no-selection state; the port dropped the inspector's, while the Changes
  // tab kept its analogue.
  it("says what a selection would do while nothing is selected", async () => {
    api.getFiles.mockResolvedValue(
      listing([{ path: "src/main.ts", kind: "file" }]),
    );
    renderBody(<FilesTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText("Select a file to open it in its own tab."),
    ).toBeVisible();
  });

  it("offers no no-selection line when there is nothing to select", async () => {
    api.getFiles.mockResolvedValue(listing([]));
    renderBody(<FilesTab tab={tab} visible actions={actionsSpy()} />);

    await screen.findByText("No files in this workspace.");
    expect(
      screen.queryByText("Select a file to open it in its own tab."),
    ).not.toBeInTheDocument();
  });

  it("caps the rendered rows and says how many there really are", async () => {
    api.getFiles.mockResolvedValue(
      listing(
        Array.from({ length: 250 }, (_, index) => ({
          path: `src/file-${String(index)}.ts`,
          kind: "file" as const,
        })),
      ),
    );
    renderBody(
      <FilesTab
        tab={{ ...tab, search: "file" }}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(
      await screen.findByText(
        "Showing the first 200 of 250 files. Search to narrow the list.",
      ),
    ).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(200);
  });

  it("names the search its result belongs to in the empty state", async () => {
    api.getFiles.mockResolvedValue(listing([]));
    renderBody(
      <FilesTab
        tab={{ ...tab, search: "nothing" }}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(await screen.findByText('No files match "nothing".')).toBeVisible();
  });

  // WSP-05: activating a file opens a File tab, so the list the user is
  // browsing survives.
  it("opens a File tab for the activated match", async () => {
    const user = userEvent.setup();
    api.getFiles.mockResolvedValue(
      listing([
        { path: "src/main.ts", kind: "file" },
        { path: "src", kind: "directory" },
      ]),
    );
    const actions = actionsSpy();
    renderBody(
      <FilesTab tab={{ ...tab, search: "src" }} visible actions={actions} />,
    );

    await user.click(await screen.findByRole("button", { name: /main\.ts/ }));

    expect(actions.openTab).toHaveBeenCalledWith({
      type: "file",
      context,
      path: "src/main.ts",
      view: "preview",
    });
    expect(screen.getByRole("button", { name: /src$/ })).toBeDisabled();
  });

  it("persists the settled search onto its own tab", async () => {
    const user = userEvent.setup();
    api.getFiles.mockResolvedValue(listing([]));
    const actions = actionsSpy();
    renderBody(<FilesTab tab={tab} visible actions={actions} />);

    await user.type(
      screen.getByRole("textbox", { name: "Search project files" }),
      "main",
    );

    await waitFor(() => {
      expect(actions.updateTab).toHaveBeenCalledWith("t", { search: "main" });
    });
  });

  it("issues no request while it is hidden", () => {
    api.getFiles.mockResolvedValue(listing([]));
    renderBody(<FilesTab tab={tab} visible={false} actions={actionsSpy()} />);

    expect(api.getFiles).not.toHaveBeenCalled();
  });
});

describe("DiffTab", () => {
  const tab = {
    id: "t",
    type: "diff" as const,
    context,
    path: "src/main.ts",
    collapsedHunks: [] as string[],
  };

  /** The shape of everything below: two hunks, both sides numbered. */
  const UNSTAGED = [
    "diff --git a/src/main.ts b/src/main.ts",
    "index c9e9e05..061a3ba 100644",
    "--- a/src/main.ts",
    "+++ b/src/main.ts",
    "@@ -1,3 +1,3 @@",
    " one",
    "-two",
    "+TWO",
    "@@ -20,2 +20,3 @@ function main() {",
    " twenty",
    "+twenty and a half",
    "",
  ].join("\n");

  function diffOf(
    overrides: Partial<{
      staged: string;
      unstaged: string;
      truncated: boolean;
    }> = {},
  ) {
    return {
      path: "src/main.ts",
      staged: "",
      unstaged: UNSTAGED,
      truncated: false,
      ...overrides,
    };
  }

  it("labels the staged and unstaged sections separately and keeps the +/- prefixes", async () => {
    api.getDiff.mockResolvedValue(
      diffOf({ staged: "@@ -1 +1 @@\n-old\n+new\n" }),
    );
    const { container } = renderBody(
      <DiffTab tab={tab} visible actions={actionsSpy()} />,
    );

    expect(await screen.findByText("Staged")).toBeVisible();
    expect(screen.getByText("Unstaged")).toBeVisible();
    // The prefix character stays in the text, so the distinction is never
    // carried by colour alone (WSP-06).
    expect(container.querySelector(".diff-add")).toHaveTextContent("+new");
    expect(container.querySelector(".diff-delete")).toHaveTextContent("-old");
  });

  it("names the worktree it reads and the file's own add and delete counts", async () => {
    api.getDiff.mockResolvedValue(diffOf());
    renderBody(<DiffTab tab={tab} visible actions={actionsSpy()} />);

    expect(await screen.findByText("2 added")).toBeVisible();
    expect(screen.getByText("1 deleted")).toBeVisible();
    // Current working-tree state of a named worktree, never the thread's
    // output (WSP-06).
    expect(screen.getByText("Working tree: Example project")).toBeVisible();
    expect(screen.getByTitle("src/main.ts")).toBeVisible();
  });

  it("draws both line numbers as attributes rather than as text", async () => {
    // The mechanism, not the appearance: a number in an attribute is drawn by
    // `content: attr(…)` on a `::before`, which a selection cannot reach and
    // `textContent` does not contain, so a copied diff is the diff (J11). A
    // number rendered as a text node would be copied with it. The end-to-end
    // suite measures the selection itself, which jsdom cannot.
    api.getDiff.mockResolvedValue(diffOf());
    const { container } = renderBody(
      <DiffTab tab={tab} visible actions={actionsSpy()} />,
    );
    await screen.findByText("Unstaged");

    const lines = [...container.querySelectorAll(".diff-line")].map((line) => [
      line.getAttribute("data-old"),
      line.querySelector(".diff-line-body")?.getAttribute("data-new"),
      line.textContent,
    ]);
    expect(lines).toEqual([
      ["1", "1", " one\n"],
      ["2", "", "-two\n"],
      ["", "2", "+TWO"],
      ["20", "20", " twenty\n"],
      ["", "21", "+twenty and a half"],
    ]);
    // And nothing a copy would pick up carries a gutter number.
    expect(container.querySelector(".diff-lines")?.textContent).toBe(
      " one\n-two\n+TWO",
    );
  });

  it("collapses a hunk into the tab's own record, and reopens it from there", async () => {
    const user = userEvent.setup();
    api.getDiff.mockResolvedValue(diffOf());
    const actions = actionsSpy();
    renderBody(<DiffTab tab={tab} visible actions={actions} />);
    const toggle = await screen.findByRole("button", {
      name: /@@ -1,3 \+1,3 @@/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);

    // The collapse is persisted state on the tab (WSP-04), not component
    // state, which is what carries it through a tab switch, a reload and a
    // drag between groups.
    expect(actions.updateTab).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(actions.updateTab).mock.calls[0]?.[1];
    const collapsedHunks = patch?.collapsedHunks ?? [];
    expect(collapsedHunks).toHaveLength(1);

    cleanup();
    const reopened = renderBody(
      <DiffTab
        tab={{ ...tab, collapsedHunks }}
        visible
        actions={actionsSpy()}
      />,
    );
    const restored = await screen.findByRole("button", {
      name: /@@ -1,3 \+1,3 @@/,
    });
    expect(restored).toHaveAttribute("aria-expanded", "false");
    // Hidden rather than unmounted: collapsing costs no layout and expanding
    // re-does no work (WSP-09).
    const bodies = reopened.container.querySelectorAll(".diff-lines");
    expect(bodies[0]).not.toBeVisible();
    expect(bodies[1]).toBeVisible();
  });

  it("keeps a collapsed hunk collapsed when the same diff is fetched again", async () => {
    // The identity a collapse is remembered by has to survive a refetch of
    // the same content, and survive a hunk being added above it. Both are
    // asserted over the parser in `parseUnifiedDiff.test.ts`; this is the
    // claim that the tab uses that identity and not the hunk's position.
    api.getDiff.mockResolvedValue(diffOf());
    const actions = actionsSpy();
    const first = renderBody(<DiffTab tab={tab} visible actions={actions} />);
    const toggle = await screen.findByRole("button", {
      name: /@@ -1,3 \+1,3 @@/,
    });
    await userEvent.setup().click(toggle);
    const collapsedHunks =
      vi.mocked(actions.updateTab).mock.calls[0]?.[1].collapsedHunks ?? [];
    first.unmount();
    cleanup();

    // The same file with a new hunk inserted ABOVE the collapsed one, which
    // renumbers every header below it.
    api.getDiff.mockResolvedValue(
      diffOf({
        unstaged: [
          "@@ -1,1 +1,2 @@",
          " zero",
          "+inserted",
          "@@ -2,3 +3,3 @@",
          " one",
          "-two",
          "+TWO",
          "",
        ].join("\n"),
      }),
    );
    renderBody(
      <DiffTab
        tab={{ ...tab, collapsedHunks }}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: /@@ -2,3 \+3,3 @@/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: /@@ -1,1 \+1,2 @@/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  // F2, the Diff tab's half. A `pre` that scrolls on its own puts its
  // horizontal scrollbar wherever that section happens to end, which for
  // anything but a tiny diff is below the fold. Every `pre` lives in ONE
  // box, which the stylesheet bounds to the tab's height.
  it("scrolls every section and every hunk in one box the stylesheet can bound", async () => {
    api.getDiff.mockResolvedValue(
      diffOf({ staged: "@@ -1 +1 @@\n-old\n+new\n" }),
    );
    const { container } = renderBody(
      <DiffTab tab={tab} visible actions={actionsSpy()} />,
    );
    await screen.findByText("Staged");

    const body = container.querySelector(".diff-view > .diff-body");
    expect(body).not.toBeNull();
    expect(container.querySelectorAll(".diff-view pre")).toHaveLength(3);
    expect(body?.querySelectorAll("pre")).toHaveLength(3);
  });

  it("shows an untracked file's preview as additions with no old side", async () => {
    // What the read boundary produces for a file Git does not track: a
    // `/dev/null` old side, so every line is an addition and the old gutter
    // is empty for all of them.
    api.getDiff.mockResolvedValue(
      diffOf({
        unstaged: [
          "diff --git a/src/main.ts b/src/main.ts",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/src/main.ts",
          "@@ -0,0 +1,2 @@",
          "+first",
          "+second",
          "",
        ].join("\n"),
      }),
    );
    const { container } = renderBody(
      <DiffTab tab={tab} visible actions={actionsSpy()} />,
    );
    await screen.findByText("Unstaged");

    expect(screen.getByText("new file mode 100644")).toBeVisible();
    expect(
      [...container.querySelectorAll(".diff-line")].map((line) =>
        line.getAttribute("data-old"),
      ),
    ).toEqual(["", ""]);
    expect(screen.getByText("2 added")).toBeVisible();
    expect(screen.getByText("0 deleted")).toBeVisible();
  });

  it("says a binary file has nothing to compare instead of showing nothing", async () => {
    api.getDiff.mockResolvedValue(
      diffOf({
        unstaged: [
          "diff --git a/src/main.ts b/src/main.ts",
          "index 0000000..0f49c4a 100644",
          "Binary files a/src/main.ts and b/src/main.ts differ",
          "",
        ].join("\n"),
      }),
    );
    renderBody(<DiffTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText(
        "Git reports this file as binary, so there are no lines to compare.",
      ),
    ).toBeVisible();
    // No counts either: there are no lines to have counted.
    expect(screen.queryByText("0 added")).toBeNull();
  });

  it("shows a diff it cannot read exactly as Git wrote it", async () => {
    api.getDiff.mockResolvedValue(
      diffOf({ unstaged: "fatal: something went wrong\n" }),
    );
    const { container } = renderBody(
      <DiffTab tab={tab} visible actions={actionsSpy()} />,
    );

    expect(
      await screen.findByText(/could not read this as a unified diff/),
    ).toBeVisible();
    expect(container.querySelector(".diff-raw")).toHaveTextContent(
      "fatal: something went wrong",
    );
  });

  it("says when a diff is empty rather than showing an empty box", async () => {
    api.getDiff.mockResolvedValue(diffOf({ unstaged: "" }));
    renderBody(<DiffTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText("No differences in this file."),
    ).toBeVisible();
  });

  it("says when the server stopped reading the diff short", async () => {
    api.getDiff.mockResolvedValue(diffOf({ truncated: true }));
    renderBody(<DiffTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText(
        "The workspace stopped reading this diff at its own output limit, so everything below is the beginning of the change and not all of it.",
      ),
    ).toBeVisible();
  });

  it("paints a bounded portion of a huge diff and says so, of what", async () => {
    const body = Array.from(
      { length: DIFF_LINE_LIMIT + 40 },
      (_, index) => `+line ${String(index)}`,
    );
    api.getDiff.mockResolvedValue(
      diffOf({
        unstaged: [
          `@@ -0,0 +1,${String(DIFF_LINE_LIMIT + 40)} @@`,
          ...body,
          "",
        ].join("\n"),
      }),
    );
    const { container } = renderBody(
      <DiffTab tab={tab} visible actions={actionsSpy()} />,
    );
    await screen.findByText("Unstaged");

    expect(container.querySelectorAll(".diff-line")).toHaveLength(
      DIFF_LINE_LIMIT,
    );
    expect(
      screen.getByText(
        `Showing the first ${String(DIFF_LINE_LIMIT)} of the ${String(DIFF_LINE_LIMIT + 40)} lines of the unstaged diff. The counts above are of the whole change.`,
      ),
    ).toBeVisible();
    // The counts stay the file's own, not the painted portion's (J7).
    expect(
      screen.getByText(`${String(DIFF_LINE_LIMIT + 40)} added`),
    ).toBeVisible();
  });

  it("says plainly when the file has stopped being one that changed", async () => {
    // The working tree is not stable between the status call that listed the
    // path and the diff call that asks for it — the design boundary says so —
    // so this is an ordinary event on this tab and not an error to apologise
    // for.
    api.getDiff.mockRejectedValue(
      new ApiClientError(
        404,
        "git_path_not_changed",
        "The file is not in the current change set.",
      ),
    );
    renderBody(<DiffTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText(/no changes in this worktree any more/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("offers a retry when the read fails", async () => {
    api.getDiff.mockRejectedValue(new Error("git exited with 128"));
    renderBody(<DiffTab tab={tab} visible actions={actionsSpy()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "git exited with 128",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("issues no request while it is hidden", () => {
    api.getDiff.mockResolvedValue(diffOf({ unstaged: "" }));
    renderBody(<DiffTab tab={tab} visible={false} actions={actionsSpy()} />);

    expect(api.getDiff).not.toHaveBeenCalled();
  });

  it("says so, instead of querying, when it has no worktree to read", () => {
    renderBody(
      <DiffTab
        tab={{ ...tab, context: null }}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(api.getDiff).not.toHaveBeenCalled();
    expect(screen.getByText(/not bound to a worktree yet/)).toBeVisible();
  });

  it("has no axe violations with both sections and a collapsed hunk", async () => {
    api.getDiff.mockResolvedValue(
      diffOf({ staged: "@@ -1 +1 @@\n-old\n+new\n" }),
    );
    const { container } = renderBody(
      <DiffTab tab={tab} visible actions={actionsSpy()} />,
    );
    await screen.findByText("Staged");

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});

describe("tab bodies are accessible", () => {
  it("has no axe violations across the ported bodies", async () => {
    api.getStatus.mockResolvedValue({
      available: true,
      message: null,
      files: [
        {
          path: "src/main.ts",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          kind: "modified",
        },
      ],
    });
    api.getFiles.mockResolvedValue({
      entries: [
        { path: "src/main.ts", name: "main.ts", kind: "file", size: 1 },
      ],
      truncated: false,
    });
    // `notes.txt` rather than a source file: this case is about the ported
    // bodies together, and a file with no grammar reaches none of the File
    // tab's lazy highlighting. `FileTab.test.tsx` covers that on its own.
    api.getFile.mockResolvedValue({
      path: "notes.txt",
      language: null,
      content: "const answer = 42;",
      binary: false,
      truncated: false,
    });
    const { container } = renderBody(
      <>
        <ChangesTab
          tab={{ id: "a", type: "changes", context }}
          visible
          actions={actionsSpy()}
        />
        <FilesTab
          tab={{
            id: "b",
            type: "files",
            context,
            search: "",
            expanded: [],
            showIgnored: false,
          }}
          visible
          actions={actionsSpy()}
        />
        <FileTab
          tab={{
            id: "c",
            type: "file",
            context,
            path: "notes.txt",
            view: "preview",
          }}
          visible
          actions={actionsSpy()}
        />
      </>,
    );
    await within(container).findByText("const answer = 42;");

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
