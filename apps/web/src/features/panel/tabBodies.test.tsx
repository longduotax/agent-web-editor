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

import { ChangesTab } from "./ChangesTab.js";
import { DiffTab } from "./DiffTab.js";
import { FilesTab } from "./FilesTab.js";
import { FileTab } from "./FileTab.js";
import type { PanelActions } from "./usePanelState.js";
import type { TabContext } from "./panelTabs.js";

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
  const tab = { id: "t", type: "files", context, search: "" } as const;

  it("debounces the search and keeps the previous list visible", async () => {
    const user = userEvent.setup();
    api.getFiles.mockResolvedValue({
      entries: [
        { path: "src/main.ts", name: "main.ts", kind: "file", size: 1 },
      ],
      truncated: false,
    });
    renderBody(<FilesTab tab={tab} visible actions={actionsSpy()} />);

    await screen.findByText("src/main.ts");
    expect(api.getFiles).toHaveBeenCalledTimes(1);

    await user.type(
      screen.getByRole("textbox", { name: "Search project files" }),
      "mai",
    );
    expect(api.getFiles).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Listing files…")).not.toBeInTheDocument();
    expect(screen.getByText("src/main.ts")).toBeInTheDocument();

    await waitFor(() => {
      expect(api.getFiles).toHaveBeenCalledTimes(2);
    });
    expect(api.getFiles).toHaveBeenLastCalledWith(projectId, threadId, "mai");
  });

  // D7. The tab needs a selection to do anything, so WSP-10 requires a
  // no-selection state; the port dropped the inspector's, while the Changes
  // tab kept its analogue.
  it("says what a selection would do while nothing is selected", async () => {
    api.getFiles.mockResolvedValue({
      entries: [
        { path: "src/main.ts", name: "main.ts", kind: "file", size: 1 },
      ],
      truncated: false,
    });
    renderBody(<FilesTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText("Select a file to open it in its own tab."),
    ).toBeVisible();
  });

  it("offers no no-selection line when there is nothing to select", async () => {
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    renderBody(<FilesTab tab={tab} visible actions={actionsSpy()} />);

    await screen.findByText("No files in this workspace.");
    expect(
      screen.queryByText("Select a file to open it in its own tab."),
    ).not.toBeInTheDocument();
  });

  it("caps the rendered rows and says how many there really are", async () => {
    api.getFiles.mockResolvedValue({
      entries: Array.from({ length: 250 }, (_, index) => ({
        path: `src/file-${String(index)}.ts`,
        name: `file-${String(index)}.ts`,
        kind: "file" as const,
        size: 1,
      })),
      truncated: false,
    });
    renderBody(<FilesTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText(
        "Showing the first 200 of 250 files. Search to narrow the list.",
      ),
    ).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(200);
  });

  it("names the search its result belongs to in the empty state", async () => {
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
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
  it("opens a File tab for the activated file", async () => {
    const user = userEvent.setup();
    api.getFiles.mockResolvedValue({
      entries: [
        { path: "src/main.ts", name: "main.ts", kind: "file", size: 1 },
        { path: "src", name: "src", kind: "directory", size: null },
      ],
      truncated: false,
    });
    const actions = actionsSpy();
    renderBody(<FilesTab tab={tab} visible actions={actions} />);

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
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
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
    api.getFiles.mockResolvedValue({ entries: [], truncated: false });
    renderBody(<FilesTab tab={tab} visible={false} actions={actionsSpy()} />);

    expect(api.getFiles).not.toHaveBeenCalled();
  });
});

describe("FileTab", () => {
  const tab = {
    id: "t",
    type: "file",
    context,
    path: "src/main.ts",
    view: "preview",
  } as const;

  it("renders the file's text with copy actions", async () => {
    api.getFile.mockResolvedValue({
      path: "src/main.ts",
      language: "typescript",
      content: "const answer = 42;",
      binary: false,
      truncated: false,
    });
    renderBody(<FileTab tab={tab} visible actions={actionsSpy()} />);

    expect(await screen.findByText("const answer = 42;")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy path" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy contents" })).toBeVisible();
  });

  it("labels a binary file instead of painting bytes", async () => {
    api.getFile.mockResolvedValue({
      path: "logo.png",
      language: null,
      content: "",
      binary: true,
      truncated: false,
    });
    renderBody(
      <FileTab
        tab={{ ...tab, path: "logo.png" }}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(
      await screen.findByText("Binary file preview is unavailable."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Copy contents" }),
    ).toBeDisabled();
  });

  it("says when the server truncated the file", async () => {
    api.getFile.mockResolvedValue({
      path: "src/main.ts",
      language: "typescript",
      content: "const answer = 42;",
      binary: false,
      truncated: true,
    });
    renderBody(<FileTab tab={tab} visible actions={actionsSpy()} />);

    expect(await screen.findByText(/truncated/)).toBeVisible();
  });

  it("offers a retry when the read fails", async () => {
    api.getFile.mockRejectedValue(new Error("file was not found"));
    renderBody(<FileTab tab={tab} visible actions={actionsSpy()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "file was not found",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("issues no request while it is hidden", () => {
    api.getFile.mockResolvedValue({
      path: "src/main.ts",
      language: null,
      content: "",
      binary: false,
      truncated: false,
    });
    renderBody(<FileTab tab={tab} visible={false} actions={actionsSpy()} />);

    expect(api.getFile).not.toHaveBeenCalled();
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

  it("labels the staged and unstaged sections separately and keeps the +/- prefixes", async () => {
    api.getDiff.mockResolvedValue({
      path: "src/main.ts",
      staged: "@@ -1 +1 @@\n-old\n+new\n",
      unstaged: "@@ -2 +2 @@\n-two\n+three\n",
      truncated: false,
    });
    const { container } = renderBody(
      <DiffTab tab={tab} visible actions={actionsSpy()} />,
    );

    expect(await screen.findByText("Staged")).toBeVisible();
    expect(screen.getByText("Unstaged")).toBeVisible();
    // The prefix character stays in the text, so the distinction is never
    // carried by colour alone.
    expect(container.querySelector(".diff-add")).toHaveTextContent("+new");
    expect(container.querySelector(".diff-remove")).toHaveTextContent("-old");
  });

  // F2, the Diff tab's half. A `pre` that scrolls on its own puts its
  // horizontal scrollbar wherever that section happens to end, which for
  // anything but a tiny diff is below the fold. Both sections live in ONE
  // box, which the stylesheet bounds to the tab's height.
  it("scrolls both sections in one box the stylesheet can bound", async () => {
    api.getDiff.mockResolvedValue({
      path: "src/main.ts",
      staged: "@@ -1 +1 @@\n-old\n+new\n",
      unstaged: "@@ -2 +2 @@\n-two\n+three\n",
      truncated: false,
    });
    const { container } = renderBody(
      <DiffTab tab={tab} visible actions={actionsSpy()} />,
    );
    await screen.findByText("Staged");

    const body = container.querySelector(".diff-view > .diff-body");
    expect(body).not.toBeNull();
    // Every `pre` in the view is inside it, and none of them is a scroll
    // container of its own.
    expect(container.querySelectorAll(".diff-view pre")).toHaveLength(2);
    expect(body?.querySelectorAll("pre")).toHaveLength(2);
  });

  it("says when a diff is empty rather than showing an empty box", async () => {
    api.getDiff.mockResolvedValue({
      path: "src/main.ts",
      staged: "",
      unstaged: "",
      truncated: false,
    });
    renderBody(<DiffTab tab={tab} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText("No differences in this file."),
    ).toBeVisible();
  });

  it("says when the diff was truncated", async () => {
    api.getDiff.mockResolvedValue({
      path: "src/main.ts",
      staged: "@@ -1 +1 @@\n+new\n",
      unstaged: "",
      truncated: true,
    });
    renderBody(<DiffTab tab={tab} visible actions={actionsSpy()} />);

    expect(await screen.findByText(/truncated/)).toBeVisible();
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
    api.getDiff.mockResolvedValue({
      path: "src/main.ts",
      staged: "",
      unstaged: "",
      truncated: false,
    });
    renderBody(<DiffTab tab={tab} visible={false} actions={actionsSpy()} />);

    expect(api.getDiff).not.toHaveBeenCalled();
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
    api.getFile.mockResolvedValue({
      path: "src/main.ts",
      language: "typescript",
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
          tab={{ id: "b", type: "files", context, search: "" }}
          visible
          actions={actionsSpy()}
        />
        <FileTab
          tab={{
            id: "c",
            type: "file",
            context,
            path: "src/main.ts",
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
