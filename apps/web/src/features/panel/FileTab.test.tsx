// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";
import type { ProjectId, ThreadId } from "@pi-web/contracts";

const api = vi.hoisted(() => ({ getFile: vi.fn() }));
vi.mock("../../api/client.js", async (importOriginal) => {
  const client = await importOriginal<typeof import("../../api/client.js")>();
  return { ...client, ...api };
});

// The highlighter is the module the tab reaches through a dynamic `import()`,
// and mocking it is how the load-order requirements become testable at all:
// a promise that never settles is "highlighting has not finished loading",
// and a rejecting one is "highlighting is unavailable" (WSP-05). jsdom cannot
// see the chunking itself — that is end to end.
const highlighter = vi.hoisted(() => ({ highlightCode: vi.fn() }));
vi.mock("./syntaxHighlight.js", () => highlighter);

import { ApiClientError } from "../../api/client.js";
import { FILE_PREVIEW_LINE_LIMIT, FileTab } from "./FileTab.js";
import type { PanelActions } from "./usePanelState.js";
import type { TabContext } from "./panelTabs.js";

beforeEach(() => {
  // The default is "declined": a test that is not about highlighting gets
  // the plain text, and an implementation left over from the previous test
  // cannot leak into this one.
  highlighter.highlightCode.mockReset();
  highlighter.highlightCode.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
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

interface Preview {
  path: string;
  language: string | null;
  content: string;
  binary: boolean;
  truncated: boolean;
}

function preview(overrides: Partial<Preview> = {}): Preview {
  return {
    path: "src/main.ts",
    language: "typescript",
    content: "const answer = 42;",
    binary: false,
    truncated: false,
    ...overrides,
  };
}

function renderTab({
  path = "src/main.ts",
  view = "preview",
  visible = true,
  actions = actionsSpy(),
}: {
  path?: string;
  view?: "preview" | "source";
  visible?: boolean;
  actions?: PanelActions;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view_ = render(
    <QueryClientProvider client={queryClient}>
      <FileTab
        tab={{ id: "t", type: "file", context, path, view }}
        visible={visible}
        actions={actions}
      />
    </QueryClientProvider>,
  );
  return { ...view_, actions };
}

describe("FileTab: markdown preview and its source toggle", () => {
  const markdown = preview({
    path: "docs/notes.md",
    language: "markdown",
    content: "# The title\n\nA paragraph.\n",
  });

  it("renders a markdown file as formatted output by default", async () => {
    api.getFile.mockResolvedValue(markdown);
    renderTab({ path: "docs/notes.md" });

    expect(
      await screen.findByRole("heading", { name: "The title" }),
    ).toBeVisible();
    // Not its characters: the source view is a deliberate choice, not the
    // default one.
    expect(screen.queryByText("# The title")).not.toBeInTheDocument();
  });

  it("records the source view on the tab, which is what makes it survive a reload", async () => {
    api.getFile.mockResolvedValue(markdown);
    const user = userEvent.setup();
    const { actions } = renderTab({ path: "docs/notes.md" });
    await screen.findByRole("heading", { name: "The title" });

    await user.click(screen.getByRole("button", { name: "View source" }));

    // The tab record, not component state: a tab dragged into another group
    // is a different React subtree, and a reload has no component state at
    // all (WSP-04).
    expect(actions.updateTab).toHaveBeenCalledWith("t", { view: "source" });
  });

  it("shows the file's characters in the source view, and offers the way back", async () => {
    api.getFile.mockResolvedValue(markdown);
    const { container } = renderTab({ path: "docs/notes.md", view: "source" });

    await waitFor(() => {
      expect(container.querySelector("pre")).toHaveTextContent("# The title");
    });
    expect(screen.queryByRole("heading", { name: "The title" })).toBeNull();
    expect(screen.getByRole("button", { name: "View preview" })).toBeVisible();
  });

  it("offers no view toggle for a file that has no rendered form", async () => {
    api.getFile.mockResolvedValue(preview());
    renderTab();

    expect(await screen.findByText("const answer = 42;")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^View / })).toBeNull();
  });

  it("opens an in-repository link from the preview as a File tab of its own", async () => {
    api.getFile.mockResolvedValue(
      preview({
        path: "docs/design/notes.md",
        content: "See [the spec](../specs/one.md).\n",
      }),
    );
    const user = userEvent.setup();
    const { actions } = renderTab({ path: "docs/design/notes.md" });

    await user.click(await screen.findByRole("button", { name: "the spec" }));

    expect(actions.openTab).toHaveBeenCalledWith({
      type: "file",
      context,
      path: "docs/specs/one.md",
      view: "preview",
    });
  });
});

describe("FileTab: syntax highlighting", () => {
  it("paints the file as plain text while the highlighter is still loading", async () => {
    // A promise that never settles: the state between first paint and the
    // chunk arriving. WSP-05 requires the file to be readable throughout it.
    highlighter.highlightCode.mockReturnValue(new Promise(() => undefined));
    api.getFile.mockResolvedValue(preview());
    const { container } = renderTab();

    expect(await screen.findByText("const answer = 42;")).toBeVisible();
    expect(container.querySelector("pre")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves the plain text alone, and says nothing, when highlighting fails", async () => {
    highlighter.highlightCode.mockRejectedValue(new Error("chunk failed"));
    api.getFile.mockResolvedValue(preview());
    renderTab();

    expect(await screen.findByText("const answer = 42;")).toBeVisible();
    // Highlighting is decoration. A reader who can read the file has lost
    // nothing worth interrupting them for.
    await waitFor(() => {
      expect(highlighter.highlightCode).toHaveBeenCalled();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("const answer = 42;")).toBeVisible();
  });

  it("keeps the plain text when the highlighter declines the file", async () => {
    // `null` is how the highlighter says "not this one" — too large, in the
    // one case it can judge for itself.
    highlighter.highlightCode.mockResolvedValue(null);
    api.getFile.mockResolvedValue(preview());
    renderTab();

    expect(await screen.findByText("const answer = 42;")).toBeVisible();
  });

  it("upgrades the text in place once the highlighter answers", async () => {
    highlighter.highlightCode.mockResolvedValue([
      [
        {
          text: "const",
          color: "var(--code-keyword)",
          italic: false,
          bold: false,
        },
        { text: " answer = ", color: null, italic: false, bold: false },
        { text: "42", color: "var(--code-number)", italic: false, bold: false },
        { text: ";", color: null, italic: false, bold: false },
      ],
    ]);
    api.getFile.mockResolvedValue(preview());
    const { container } = renderTab();

    await waitFor(() => {
      expect(container.querySelector(".file-token")).not.toBeNull();
    });
    const keyword = container.querySelector(".file-token");
    expect(keyword).toHaveTextContent("const");
    expect(keyword).toHaveStyle({ color: "var(--code-keyword)" });
    // The whole line is still the file's own text, in order.
    expect(container.querySelector("pre")).toHaveTextContent(
      "const answer = 42;",
    );
  });

  it("asks for no highlighting at all for a file it has no grammar for", async () => {
    api.getFile.mockResolvedValue(
      preview({ path: "notes.txt", language: null, content: "plain words" }),
    );
    renderTab({ path: "notes.txt" });

    expect(await screen.findByText("plain words")).toBeVisible();
    expect(highlighter.highlightCode).not.toHaveBeenCalled();
  });

  it("does no highlighting while it is hidden (WSP-09)", async () => {
    api.getFile.mockResolvedValue(preview());
    renderTab({ visible: false });

    await waitFor(() => {
      expect(api.getFile).not.toHaveBeenCalled();
    });
    expect(highlighter.highlightCode).not.toHaveBeenCalled();
  });

  it("does not highlight the source view of a markdown file", async () => {
    api.getFile.mockResolvedValue(
      preview({ path: "docs/notes.md", content: "# Title\n" }),
    );
    renderTab({ path: "docs/notes.md", view: "source" });

    expect(await screen.findByText(/# Title/)).toBeVisible();
    expect(highlighter.highlightCode).not.toHaveBeenCalled();
  });
});

describe("FileTab: every state it can be in", () => {
  it("says it is reading before the file arrives", () => {
    api.getFile.mockReturnValue(new Promise(() => undefined));
    renderTab();

    expect(screen.getByText("Reading the file…")).toBeVisible();
  });

  it("labels a binary file instead of painting bytes, and refuses to copy them", async () => {
    api.getFile.mockResolvedValue(
      preview({ path: "logo.png", language: null, content: "", binary: true }),
    );
    renderTab({ path: "logo.png" });

    expect(
      await screen.findByText(/Binary file preview is unavailable/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Copy contents" }),
    ).toBeDisabled();
  });

  it("names the 2 MiB limit when the server truncated the read", async () => {
    api.getFile.mockResolvedValue(preview({ truncated: true }));
    renderTab();

    expect(await screen.findByText(/2 MiB/)).toBeVisible();
    expect(screen.getByText("const answer = 42;")).toBeVisible();
  });

  it("says a file is empty rather than showing an empty box", async () => {
    api.getFile.mockResolvedValue(preview({ content: "" }));
    renderTab();

    expect(await screen.findByText("This file is empty.")).toBeVisible();
  });

  it("states that a file is gone rather than reporting an error", async () => {
    api.getFile.mockRejectedValue(
      new ApiClientError(
        404,
        "path_not_found",
        "The requested path was not found.",
      ),
    );
    renderTab();

    expect(await screen.findByText(/no longer in this worktree/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("states that a file cannot be read", async () => {
    api.getFile.mockRejectedValue(
      new ApiClientError(
        403,
        "path_unreadable",
        "The requested path could not be read.",
      ),
    );
    renderTab();

    expect(await screen.findByText(/permission/)).toBeVisible();
  });

  it("states that a path is not a regular file", async () => {
    api.getFile.mockRejectedValue(
      new ApiClientError(
        400,
        "file_not_regular",
        "The requested path is not a regular file.",
      ),
    );
    renderTab();

    expect(await screen.findByText(/not a regular file/)).toBeVisible();
  });

  it("falls back to the retryable error notice for anything else", async () => {
    api.getFile.mockRejectedValue(new Error("the workspace did not answer"));
    renderTab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the workspace did not answer",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("issues no request while it is hidden", () => {
    api.getFile.mockResolvedValue(preview());
    renderTab({ visible: false });

    expect(api.getFile).not.toHaveBeenCalled();
  });

  it("bounds how much of a very long file it paints, and says so", async () => {
    const lines = FILE_PREVIEW_LINE_LIMIT + 40;
    api.getFile.mockResolvedValue(
      preview({
        content: Array.from({ length: lines }, (_, index) =>
          index === lines - 1 ? "last line" : `line ${String(index)}`,
        ).join("\n"),
      }),
    );
    const { container } = renderTab();

    expect(
      await screen.findByText(
        new RegExp(
          `Showing the first ${String(FILE_PREVIEW_LINE_LIMIT)} of ${String(lines)} lines`,
        ),
      ),
    ).toBeVisible();
    // Nothing was truncated on the way here, so this sentence is true.
    expect(
      screen.getByText(/Copy contents takes the whole file/),
    ).toBeVisible();
    expect(container.querySelector("pre")).not.toHaveTextContent("last line");
  });

  it("describes a truncated read as the portion it is, not as the file (J7)", async () => {
    // The reported wording: "Showing the first 2000 of 55477 lines. Copy
    // contents takes the whole file." — over a file of 69,037 lines whose
    // first 2 MiB alone hold 55,477 of them. Both sentences were false about
    // the file, and the second was false about what Copy contents does: the
    // server handed over 2 MiB, and 2 MiB is what there is to copy.
    const lines = FILE_PREVIEW_LINE_LIMIT + 40;
    api.getFile.mockResolvedValue(
      preview({
        truncated: true,
        content: Array.from(
          { length: lines },
          (_, index) => `line ${String(index)}`,
        ).join("\n"),
      }),
    );
    renderTab();

    expect(
      await screen.findByText(
        new RegExp(
          `Showing the first ${String(FILE_PREVIEW_LINE_LIMIT)} of the ${String(lines)} lines in the 2 MiB that were read`,
        ),
      ),
    ).toBeVisible();
    expect(screen.getByText(/Copy contents takes those 2 MiB/)).toBeVisible();
    expect(screen.queryByText(/Copy contents takes the whole file/)).toBeNull();
  });
});

describe("FileTab: the header's path", () => {
  it("carries the whole path on its tooltip and splits the name from its directories", async () => {
    api.getFile.mockResolvedValue(
      preview({ path: "docs/product-specs/workspace-panel.md" }),
    );
    const { container } = renderTab({
      path: "docs/product-specs/workspace-panel.md",
      view: "source",
    });
    await screen.findByText("const answer = 42;");

    const path = container.querySelector(".file-preview > header .file-path");
    // The whole path, whatever the header has room to paint (J1): the
    // element that ellipsises has to be able to say what it left out.
    expect(path).toHaveAttribute(
      "title",
      "docs/product-specs/workspace-panel.md",
    );
    // Read together they are still the path, in order, so the accessible
    // name and a text selection are both unchanged by the split.
    expect(path).toHaveTextContent("docs/product-specs/workspace-panel.md");
    // The tail is the informative half, so it is the half in the element
    // that does not shrink.
    expect(path?.querySelector(".file-path-name")).toHaveTextContent(
      "workspace-panel.md",
    );
    expect(path?.querySelector(".file-path-dir")).toHaveTextContent(
      "docs/product-specs/",
    );
  });

  it("shows a file at the root as its name alone", async () => {
    api.getFile.mockResolvedValue(preview({ path: "README.md" }));
    const { container } = renderTab({ path: "README.md", view: "source" });
    await screen.findByText("const answer = 42;");

    const path = container.querySelector(".file-preview > header .file-path");
    expect(path).toHaveTextContent("README.md");
    expect(path?.querySelector(".file-path-dir")).toBeNull();
  });
});

describe("FileTab: copying", () => {
  it("copies the normalized workspace-relative path the server returned", async () => {
    const user = userEvent.setup();
    // After `setup()`, which installs a clipboard of its own on `navigator`.
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    api.getFile.mockResolvedValue(preview({ path: "src/main.ts" }));
    // The tab was opened with a path spelled differently from the one the
    // server normalizes to; the copied value is the server's, and an
    // absolute server path never exists in the browser to be copied.
    renderTab({ path: "./src/main.ts" });
    await screen.findByText("const answer = 42;");

    await user.click(screen.getByRole("button", { name: "Copy path" }));

    expect(writeText).toHaveBeenCalledWith("src/main.ts");
  });

  it("copies the whole file, not the bounded portion it painted", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const content = Array.from(
      { length: FILE_PREVIEW_LINE_LIMIT + 5 },
      (_, index) => `line ${String(index)}`,
    ).join("\n");
    api.getFile.mockResolvedValue(preview({ content }));
    renderTab();
    await screen.findByText(/line 0/);

    await user.click(screen.getByRole("button", { name: "Copy contents" }));

    expect(writeText).toHaveBeenCalledWith(content);
  });

  it("says so when a copy succeeds, in the panel's own live region", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    api.getFile.mockResolvedValue(preview());
    const { actions } = renderTab();
    await screen.findByText("const answer = 42;");

    await user.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => {
      expect(actions.announce).toHaveBeenCalledWith(
        "Copied the file path to the clipboard.",
      );
    });

    await user.click(screen.getByRole("button", { name: "Copy contents" }));
    await waitFor(() => {
      expect(actions.announce).toHaveBeenCalledWith(
        "Copied the file's contents to the clipboard.",
      );
    });
  });

  it("says so when a copy fails, rather than dropping the rejection", async () => {
    const user = userEvent.setup();
    // What the reporter actually produced: an `unhandledrejection`, and
    // nothing on screen changed. `void navigator.clipboard.writeText(…)`
    // with no `.catch` swallows every refusal there is — a denied
    // permission, a document that is not focused, an insecure context.
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    api.getFile.mockResolvedValue(preview());
    const { actions } = renderTab();
    await screen.findByText("const answer = 42;");

    await user.click(screen.getByRole("button", { name: "Copy path" }));

    await waitFor(() => {
      expect(actions.announce).toHaveBeenCalledWith(
        "Could not copy the file path: the browser refused access to the clipboard.",
      );
    });
  });

  it("says so when the browser offers no clipboard at all", async () => {
    const user = userEvent.setup();
    // An insecure context has no `navigator.clipboard`, and reading
    // `.writeText` off it would throw inside the click handler instead of
    // rejecting a promise. Both routes end in the same sentence.
    vi.stubGlobal("navigator", {});
    api.getFile.mockResolvedValue(preview());
    const { actions } = renderTab();
    await screen.findByText("const answer = 42;");

    await user.click(screen.getByRole("button", { name: "Copy contents" }));

    await waitFor(() => {
      expect(actions.announce).toHaveBeenCalledWith(
        "Could not copy the file's contents: the browser refused access to the clipboard.",
      );
    });
  });
});

describe("FileTab: accessibility", () => {
  it("has no axe violations in either theme, previewed or as source", async () => {
    api.getFile.mockResolvedValue(
      preview({
        path: "docs/notes.md",
        content:
          "# Title\n\nA [local link](other.md), an [external one](https://example.com), and ![a picture](https://example.com/p.png).\n",
      }),
    );
    for (const theme of ["light", "dark"] as const)
      for (const view of ["preview", "source"] as const) {
        document.documentElement.setAttribute("data-theme", theme);
        const { container, unmount } = renderTab({
          path: "docs/notes.md",
          view,
        });
        await screen.findByRole("button", { name: "Copy path" });
        await waitFor(() => {
          expect(container.querySelector(".file-preview")).not.toBeNull();
        });

        const results = await axe.run(container);
        expect(results.violations).toEqual([]);
        unmount();
      }
  });
});
