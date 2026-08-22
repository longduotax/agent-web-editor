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
import type { JSX } from "react";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

const api = vi.hoisted(() => ({ getFiles: vi.fn() }));

vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

import { ApiClientError, shouldRetryRequest } from "../../api/client.js";
import { FilesTab } from "./FilesTab.js";
import type { PanelActions } from "./usePanelState.js";
import type { PanelTab, TabContext } from "./panelTabs.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

type FilesTabRecord = Extract<PanelTab, { type: "files" }>;

function filesTab(overrides: Partial<FilesTabRecord> = {}): FilesTabRecord {
  return {
    id: "t",
    type: "files",
    context,
    search: "",
    expanded: [],
    showIgnored: false,
    ...overrides,
  };
}

function renderBody(node: JSX.Element) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

/**
 * The tab under the retry policy the application actually runs (H5).
 *
 * `retry: false` is a convenience for the other cases here and it is also
 * exactly what hid the question the hands-on pass asked: whether a failing
 * listing reaches its error row at all under the shipped policy.
 */
function renderBodyWithRetryPolicy(node: JSX.Element) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: shouldRetryRequest } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

interface StubEntry {
  path: string;
  name: string;
  kind: "file" | "directory" | "symlink";
}

/** A working tree the stub server answers one level at a time. */
const TREE: Record<string, StubEntry[]> = {
  "": [
    { path: "src", name: "src", kind: "directory" },
    { path: "README.md", name: "README.md", kind: "file" },
  ],
  src: [
    { path: "src/features", name: "features", kind: "directory" },
    { path: "src/main.ts", name: "main.ts", kind: "file" },
  ],
  "src/features": [
    { path: "src/features/panel.ts", name: "panel.ts", kind: "file" },
  ],
};

interface Listing {
  path?: string;
  search?: string;
  depth?: "1" | "full";
  showIgnored?: boolean;
}

function stubTree(ignoredHidden: Record<string, boolean> = {}) {
  api.getFiles.mockImplementation(
    (_project: ProjectId, _thread: ThreadId, options: Listing = {}) => {
      const path = options.path ?? "";
      const entries = (TREE[path] ?? []).map((entry) => ({
        ...entry,
        size: entry.kind === "file" ? 1 : null,
      }));
      return Promise.resolve({
        entries,
        truncated: false,
        ignoredHidden: ignoredHidden[path] ?? false,
      });
    },
  );
}

/** The rows the tree currently paints, in reading order. */
function rowNames(): string[] {
  return screen
    .getAllByRole("treeitem")
    .map((row) => row.querySelector(".file-tree-name")?.textContent ?? "")
    .map((text) => text.trim());
}

/**
 * The pointer target of a row.
 *
 * An expanded directory's `treeitem` also contains its children, so a click
 * on the middle of that element would land on whichever child is there. The
 * row as the user sees it is its own line, and that is what carries the
 * click.
 */
async function clickRow(
  user: ReturnType<typeof userEvent.setup>,
  name: string | RegExp,
): Promise<void> {
  const row = await screen.findByRole("treeitem", { name });
  const line = row.querySelector(".file-tree-line");
  if (line === null) throw new Error("a row with no line");
  await user.click(line);
}

describe("FileTree", () => {
  it("shows one level of the tree, each row named for itself", async () => {
    stubTree();
    renderBody(<FilesTab tab={filesTab()} visible actions={actionsSpy()} />);

    const src = await screen.findByRole("treeitem", { name: "src" });
    // Its own name, not its path from the root; the path is the tooltip.
    expect(await screen.findByRole("treeitem", { name: "README.md" }));
    expect(src).toHaveAttribute("title", "src");
    expect(src).toHaveAttribute("aria-expanded", "false");
    expect(src).toHaveAttribute("aria-level", "1");
    // One level only: the point of the depth bound is not paying for the
    // whole tree to paint two rows.
    expect(api.getFiles).toHaveBeenCalledTimes(1);
    expect(api.getFiles).toHaveBeenCalledWith(projectId, threadId, {
      path: "",
      depth: "1",
      showIgnored: false,
    });
  });

  it("expands a directory in place and fetches only that level", async () => {
    const user = userEvent.setup();
    stubTree();
    const actions = actionsSpy();
    const { rerender } = renderBody(
      <FilesTab tab={filesTab()} visible actions={actions} />,
    );

    await clickRow(user, "src");

    expect(actions.updateTab).toHaveBeenCalledWith("t", { expanded: ["src"] });
    // The panel owns the expansion, so the tab comes back with it applied.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <FilesTab
          tab={filesTab({ expanded: ["src"] })}
          visible
          actions={actions}
        />
      </QueryClientProvider>,
    );

    await screen.findByRole("treeitem", { name: "main.ts" });
    // Expanding revealed children rather than replacing the view.
    expect(rowNames()).toEqual(["src", "features", "main.ts", "README.md"]);
    const src = screen.getByRole("treeitem", { name: "src" });
    expect(src).toHaveAttribute("aria-expanded", "true");
    expect(within(src).getByRole("group")).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "main.ts" })).toHaveAttribute(
      "aria-level",
      "2",
    );
  });

  it("re-serves a collapsed directory from cache when it is expanded again", async () => {
    stubTree();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const actions = actionsSpy();
    const view = (expanded: string[]) => (
      <QueryClientProvider client={client}>
        <FilesTab tab={filesTab({ expanded })} visible actions={actions} />
      </QueryClientProvider>
    );
    const { rerender } = render(view(["src"]));
    await screen.findByRole("treeitem", { name: "main.ts" });
    const afterExpand = api.getFiles.mock.calls.length;

    rerender(view([]));
    await waitFor(() => {
      expect(
        screen.queryByRole("treeitem", { name: "main.ts" }),
      ).not.toBeInTheDocument();
    });
    rerender(view(["src"]));
    await screen.findByRole("treeitem", { name: "main.ts" });

    // WSP-09: re-expanding must not re-fetch what the tab already has.
    expect(api.getFiles.mock.calls.length).toBe(afterExpand);
  });

  it("says a listing stopped short rather than reporting its own count as the total", async () => {
    // Found while checking whether J7's wording — a bounded portion
    // described as if it were the whole — was reused elsewhere. It was: the
    // tree and the flat search both said "of N entries" with N taken from
    // the response, and the read boundary's `truncated` flag, which says
    // that N is itself short, was read by nothing. WSP-05 v2 names this
    // case: a listing must not quietly under-report what is on disk.
    api.getFiles.mockImplementation(
      (_project: ProjectId, _thread: ThreadId, options: Listing = {}) =>
        Promise.resolve({
          entries: (TREE[options.path ?? ""] ?? []).map((entry) => ({
            ...entry,
            size: null,
          })),
          truncated: true,
          ignoredHidden: false,
        }),
    );
    renderBody(<FilesTab tab={filesTab()} visible actions={actionsSpy()} />);

    expect(
      await screen.findByRole("treeitem", {
        name: /The workspace stopped listing at its own limit before the end/,
      }),
    ).toBeVisible();
  });

  it("gives a directory that fails to load its own row and keeps the tree", async () => {
    const user = userEvent.setup();
    api.getFiles.mockImplementation(
      (_project: ProjectId, _thread: ThreadId, options: Listing = {}) => {
        if (options.path === "src")
          return Promise.reject(new Error("permission denied"));
        return Promise.resolve({
          entries: (TREE[options.path ?? ""] ?? []).map((entry) => ({
            ...entry,
            size: null,
          })),
          truncated: false,
          ignoredHidden: false,
        });
      },
    );
    renderBody(
      <FilesTab
        tab={filesTab({ expanded: ["src"] })}
        visible
        actions={actionsSpy()}
      />,
    );

    const failed = await screen.findByRole("treeitem", {
      name: /Could not list src/,
    });
    expect(failed).toBeInTheDocument();
    // The rest of the tree is untouched.
    expect(screen.getByRole("treeitem", { name: "README.md" })).toBeVisible();

    stubTree();
    await clickRow(user, /Could not list src/);
    expect(
      await screen.findByRole("treeitem", { name: "main.ts" }),
    ).toBeVisible();
  });

  // H5, reproduced under the application's own retry policy rather than the
  // suite's `retry: false`. The pass reported a row that read "Listing ops…"
  // thirty seconds after the server began answering 500, and never reached
  // the error row; a failing listing does reach it, in about three seconds.
  it("reaches the error row under the shipped retry policy", async () => {
    let attempts = 0;
    api.getFiles.mockImplementation(
      (_project: ProjectId, _thread: ThreadId, options: Listing = {}) => {
        if (options.path === "src") {
          attempts += 1;
          return Promise.reject(
            new ApiClientError(500, "internal_error", "Server fault."),
          );
        }
        return Promise.resolve({
          entries: (TREE[options.path ?? ""] ?? []).map((entry) => ({
            ...entry,
            size: null,
          })),
          truncated: false,
          ignoredHidden: false,
        });
      },
    );
    renderBodyWithRetryPolicy(
      <FilesTab
        tab={filesTab({ expanded: ["src"] })}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(
      await screen.findByRole(
        "treeitem",
        { name: /Could not list src/ },
        { timeout: 10_000 },
      ),
    ).toBeVisible();
    // Three attempts: the first and the two retries the policy allows.
    expect(attempts).toBe(3);
  }, 15_000);

  // H6. A directory that was expanded, persisted, and then deleted. The
  // server used to answer 500 for it; it now answers a typed 404, and a
  // client error is not worth repeating twice before saying so.
  it("shows the error row at once for a directory that is no longer there", async () => {
    let attempts = 0;
    api.getFiles.mockImplementation(
      (_project: ProjectId, _thread: ThreadId, options: Listing = {}) => {
        if (options.path === "src") {
          attempts += 1;
          return Promise.reject(
            new ApiClientError(
              404,
              "path_not_found",
              "The requested path was not found.",
            ),
          );
        }
        return Promise.resolve({
          entries: (TREE[options.path ?? ""] ?? []).map((entry) => ({
            ...entry,
            size: null,
          })),
          truncated: false,
          ignoredHidden: false,
        });
      },
    );
    renderBodyWithRetryPolicy(
      <FilesTab
        tab={filesTab({ expanded: ["src"] })}
        visible
        actions={actionsSpy()}
      />,
    );

    await screen.findByRole("treeitem", { name: /Could not list src/ });
    expect(attempts).toBe(1);
    // The rest of the tree is untouched, and the row is still a retry.
    expect(screen.getByRole("treeitem", { name: "README.md" })).toBeVisible();
  });

  it("opens a File tab for an activated file and does not expand it", async () => {
    const user = userEvent.setup();
    stubTree();
    const actions = actionsSpy();
    renderBody(<FilesTab tab={filesTab()} visible actions={actions} />);

    await clickRow(user, "README.md");

    expect(actions.openTab).toHaveBeenCalledWith({
      type: "file",
      context,
      path: "README.md",
      view: "preview",
    });
    expect(actions.updateTab).not.toHaveBeenCalledWith("t", {
      expanded: ["README.md"],
    });
  });

  it("issues no request while the tab is hidden", () => {
    stubTree();
    renderBody(
      <FilesTab tab={filesTab()} visible={false} actions={actionsSpy()} />,
    );
    expect(api.getFiles).not.toHaveBeenCalled();
  });
});

describe("FileTree keyboard navigation", () => {
  async function focusedTree(expanded: string[] = []) {
    stubTree();
    const actions = actionsSpy();
    const user = userEvent.setup();
    renderBody(
      <FilesTab tab={filesTab({ expanded })} visible actions={actions} />,
    );
    await screen.findByRole("treeitem", { name: "src" });
    return { user, actions };
  }

  it("puts exactly one row in the page's tab order", async () => {
    await focusedTree();
    const rows = screen.getAllByRole("treeitem");
    expect(rows.filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("tabindex", "0");
  });

  it("moves between rows with the arrow keys", async () => {
    const { user } = await focusedTree();
    screen.getByRole("treeitem", { name: "src" }).focus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: "README.md" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("treeitem", { name: "README.md" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveFocus();
  });

  it("expands with ArrowRight and collapses with ArrowLeft", async () => {
    const { user, actions } = await focusedTree();
    screen.getByRole("treeitem", { name: "src" }).focus();

    await user.keyboard("{ArrowRight}");
    expect(actions.updateTab).toHaveBeenCalledWith("t", { expanded: ["src"] });

    cleanup();
    const collapsed = await focusedTree(["src"]);
    screen.getByRole("treeitem", { name: "src" }).focus();
    await collapsed.user.keyboard("{ArrowLeft}");
    expect(collapsed.actions.updateTab).toHaveBeenCalledWith("t", {
      expanded: [],
    });
  });

  it("steps into an open directory and back out to its parent", async () => {
    const { user } = await focusedTree(["src"]);
    await screen.findByRole("treeitem", { name: "main.ts" });
    screen.getByRole("treeitem", { name: "src" }).focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("treeitem", { name: "features" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveFocus();
  });

  it("activates a row with Enter", async () => {
    stubTree();
    const actions = actionsSpy();
    const user = userEvent.setup();
    renderBody(<FilesTab tab={filesTab()} visible actions={actions} />);
    const row = await screen.findByRole("treeitem", { name: "README.md" });
    row.focus();

    await user.keyboard("{Enter}");

    expect(actions.openTab).toHaveBeenCalledWith({
      type: "file",
      context,
      path: "README.md",
      view: "preview",
    });
  });
});

describe("ignored files", () => {
  it("says when a listing hid something, and offers the opt-in", async () => {
    stubTree({ "": true });
    renderBody(<FilesTab tab={filesTab()} visible actions={actionsSpy()} />);

    expect(
      await screen.findByText(
        "Files matched by this workspace's ignore rules are hidden.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Show ignored files" }),
    ).not.toBeChecked();
  });

  it("says nothing when nothing was hidden", async () => {
    stubTree();
    renderBody(<FilesTab tab={filesTab()} visible actions={actionsSpy()} />);
    await screen.findByRole("treeitem", { name: "src" });

    expect(
      screen.queryByText(
        "Files matched by this workspace's ignore rules are hidden.",
      ),
    ).not.toBeInTheDocument();
  });

  it("reports a rule that only hid something deeper in the tree", async () => {
    stubTree({ src: true });
    renderBody(
      <FilesTab
        tab={filesTab({ expanded: ["src"] })}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(
      await screen.findByText(
        "Files matched by this workspace's ignore rules are hidden.",
      ),
    ).toBeVisible();
  });

  it("persists the opt-in with the tab and announces it", async () => {
    const user = userEvent.setup();
    stubTree({ "": true });
    const actions = actionsSpy();
    renderBody(<FilesTab tab={filesTab()} visible actions={actions} />);

    await user.click(
      await screen.findByRole("checkbox", { name: "Show ignored files" }),
    );

    expect(actions.updateTab).toHaveBeenCalledWith("t", { showIgnored: true });
    expect(actions.announce).toHaveBeenCalledWith(
      "Showing files matched by the workspace's ignore rules.",
    );
  });

  it("asks the server to reveal ignored paths once opted in", async () => {
    stubTree();
    renderBody(
      <FilesTab
        tab={filesTab({ showIgnored: true })}
        visible
        actions={actionsSpy()}
      />,
    );
    await screen.findByRole("treeitem", { name: "src" });

    expect(api.getFiles).toHaveBeenCalledWith(projectId, threadId, {
      path: "",
      depth: "1",
      showIgnored: true,
    });
  });
});

describe("search", () => {
  function stubSearch(entries: StubEntry[], ignoredHidden = false) {
    api.getFiles.mockImplementation(
      (_project: ProjectId, _thread: ThreadId, options: Listing = {}) => {
        if ((options.search ?? "") === "")
          return Promise.resolve({
            entries: (TREE[options.path ?? ""] ?? []).map((entry) => ({
              ...entry,
              size: null,
            })),
            truncated: false,
            ignoredHidden: false,
          });
        return Promise.resolve({
          entries: entries.map((entry) => ({ ...entry, size: 1 })),
          truncated: false,
          ignoredHidden,
        });
      },
    );
  }

  it("switches to a flat list of full paths while a term is active", async () => {
    stubSearch([
      { path: "src/features/panel.ts", name: "panel.ts", kind: "file" },
    ]);
    renderBody(
      <FilesTab
        tab={filesTab({ search: "panel", expanded: ["src"] })}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(await screen.findByText("src/features/panel.ts")).toBeVisible();
    // A tree of sparse matches is harder to read than a list, so there is
    // no tree at all while a search is running.
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(api.getFiles).toHaveBeenCalledWith(projectId, threadId, {
      search: "panel",
      depth: "full",
      showIgnored: false,
    });
  });

  // The scenario the milestone exists for: `README.md` also exists inside a
  // dependency directory, and the project's own is what must come back.
  it("returns the project's own file rather than a dependency's", async () => {
    stubSearch([{ path: "README.md", name: "README.md", kind: "file" }]);
    renderBody(
      <FilesTab
        tab={filesTab({ search: "README.md" })}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(await screen.findByText("README.md")).toBeVisible();
    expect(screen.queryByText(/node_modules/)).not.toBeInTheDocument();
  });

  it("restores the tree at its previous expansion when the search is cleared", async () => {
    const user = userEvent.setup();
    stubSearch([
      { path: "src/features/panel.ts", name: "panel.ts", kind: "file" },
    ]);
    const actions = actionsSpy();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = (search: string) => (
      <QueryClientProvider client={client}>
        <FilesTab
          tab={filesTab({ search, expanded: ["src", "src/features"] })}
          visible
          actions={actions}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(view("panel"));
    await screen.findByText("src/features/panel.ts");

    // Clearing the box is what returns the tab to the tree.
    await user.clear(
      screen.getByRole("textbox", { name: "Search project files" }),
    );
    rerender(view(""));

    await screen.findByRole("tree");
    // Exactly the directories that were expanded before the search, not a
    // collapsed root (WSP-05 v2, acceptance 13).
    expect(
      await screen.findByRole("treeitem", { name: "panel.ts" }),
    ).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("says when a search hid ignored matches", async () => {
    stubSearch([{ path: "README.md", name: "README.md", kind: "file" }], true);
    renderBody(
      <FilesTab
        tab={filesTab({ search: "README" })}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(
      await screen.findByText(
        "Files matched by this workspace's ignore rules are hidden.",
      ),
    ).toBeVisible();
  });
});

describe("accessibility", () => {
  it("has no automatically detectable violations", async () => {
    stubTree({ "": true });
    const { container } = renderBody(
      <FilesTab
        tab={filesTab({ expanded: ["src"] })}
        visible
        actions={actionsSpy()}
      />,
    );
    await screen.findByRole("treeitem", { name: "main.ts" });

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  // Computed rather than read off a tree dump: an empty `name` in a dump is
  // evidence about the dump, not about the page (spec, Findings against
  // version 1). Querying by name is what makes an empty name fail.
  it("names every row by the text it displays", async () => {
    stubTree();
    renderBody(
      <FilesTab
        tab={filesTab({ expanded: ["src"] })}
        visible
        actions={actionsSpy()}
      />,
    );

    expect(
      await screen.findByRole("treeitem", { name: "main.ts" }),
    ).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "features" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "README.md" })).toBeVisible();
    // The full path is the tooltip, and never the accessible name.
    expect(screen.getByRole("treeitem", { name: "main.ts" })).toHaveAttribute(
      "title",
      "src/main.ts",
    );
  });
});
