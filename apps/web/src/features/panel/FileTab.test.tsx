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
import {
  FILE_PREVIEW_CHARACTER_LIMIT,
  FILE_PREVIEW_LINE_LIMIT,
  FileTab,
} from "./FileTab.js";
import { HIGHLIGHT_MAX_CHARACTERS } from "./fileLanguage.js";
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

describe("FileTab: a link into this same document (J8)", () => {
  const withContents = preview({
    path: "docs/guide.md",
    language: "markdown",
    content: [
      "# Workspace guide",
      "",
      "- [The hard part](#the-hard-part)",
      "- [Nowhere](#no-such-heading)",
      "",
      "## The hard part",
      "",
      "A paragraph.",
      "",
    ].join("\n"),
  });

  it("goes to the heading a fragment names, and puts the reader there", async () => {
    // These were rendered inert, tooltipped "This link does not point
    // anywhere the workspace can open" — a true sentence about the workspace
    // and a false one about the link, which points at a heading in the
    // document on screen.
    api.getFile.mockResolvedValue(withContents);
    const user = userEvent.setup();
    const { actions } = renderTab({ path: "docs/guide.md" });
    await screen.findByRole("heading", { name: "Workspace guide" });

    await user.click(screen.getByRole("button", { name: "The hard part" }));

    // Focus, not just scroll: a jump nobody's cursor followed is not a jump
    // for a keyboard or screen-reader user.
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "The hard part" }),
    );
    expect(actions.announce).not.toHaveBeenCalled();
  });

  it("says so when the document has no such heading", async () => {
    api.getFile.mockResolvedValue(withContents);
    const user = userEvent.setup();
    const { actions } = renderTab({ path: "docs/guide.md" });
    await screen.findByRole("heading", { name: "Workspace guide" });

    await user.click(screen.getByRole("button", { name: "Nowhere" }));

    expect(actions.announce).toHaveBeenCalledWith(
      "This document has no section called “no-such-heading”.",
    );
  });

  it("still refuses a link that names nothing reachable", async () => {
    api.getFile.mockResolvedValue(
      preview({
        path: "docs/guide.md",
        language: "markdown",
        content: "A [dead end](javascript:alert(1)) in a sentence.\n",
      }),
    );
    renderTab({ path: "docs/guide.md" });

    const inert = await screen.findByText("dead end");
    expect(inert.tagName).toBe("SPAN");
    expect(inert).toHaveAttribute(
      "title",
      "This link does not point anywhere the workspace can open.",
    );
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

describe("FileTab: line numbers in the source view (J11)", () => {
  it("numbers every line of the plain text, without putting a number in it", async () => {
    api.getFile.mockResolvedValue(
      preview({ content: "const a = 1;\nconst b = 2;\nconst c = 3;\n" }),
    );
    const { container } = renderTab();
    await screen.findByText(/const a = 1;/);

    const lines = [...container.querySelectorAll(".file-line")];
    // "a\nb\nc\n" is four lines, the last of them empty, and that is what a
    // reader counting in their editor sees too.
    expect(lines.map((line) => line.getAttribute("data-line"))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    // The numbers are drawn by the stylesheet from `data-line`, so the text
    // of the element is still exactly the file's own text — which is what
    // Copy contents, a text selection, and every assertion in this file all
    // read.
    expect(container.querySelector("pre")?.textContent).toBe(
      "const a = 1;\nconst b = 2;\nconst c = 3;\n",
    );
  });

  it("keeps the same lines, and the same numbers, once highlighting arrives", async () => {
    // The upgrade replaces the `pre`'s children in place, and the reported
    // requirement is that the two are geometrically identical. Same line
    // elements, same numbers, same text is the structural half of that; the
    // measured half is end to end.
    highlighter.highlightCode.mockResolvedValue([
      [{ text: "const a = 1;", color: null, italic: false, bold: false }],
      [{ text: "const b = 2;", color: null, italic: false, bold: false }],
    ]);
    api.getFile.mockResolvedValue(
      preview({ content: "const a = 1;\nconst b = 2;" }),
    );
    const { container } = renderTab();

    await waitFor(() => {
      expect(container.querySelectorAll(".file-line")).toHaveLength(2);
    });
    expect(
      [...container.querySelectorAll(".file-line")].map((line) =>
        line.getAttribute("data-line"),
      ),
    ).toEqual(["1", "2"]);
    expect(container.querySelector("pre")?.textContent).toBe(
      "const a = 1;\nconst b = 2;",
    );
  });

  it("numbers nothing in the markdown preview", async () => {
    api.getFile.mockResolvedValue(
      preview({
        path: "docs/notes.md",
        language: "markdown",
        content: "# The title\n\nA paragraph.\n",
      }),
    );
    const { container } = renderTab({ path: "docs/notes.md" });
    await screen.findByRole("heading", { name: "The title" });

    expect(container.querySelectorAll(".file-line")).toHaveLength(0);
  });

  it("sizes the gutter from the line count rather than from a guess", async () => {
    api.getFile.mockResolvedValue(
      preview({
        content: Array.from(
          { length: 120 },
          (_, index) => `line ${String(index)}`,
        ).join("\n"),
      }),
    );
    const { container } = renderTab();
    await screen.findByText(/line 0/);

    // 120 lines is three digits, and a twelve-line file must not pay for the
    // four the 2,000-line budget allows.
    expect(
      container.querySelector("pre")?.style.getPropertyValue("--file-gutter"),
    ).toBe("3ch");
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

  it("shows one coherent statement for a file that is both binary and oversized (J9)", async () => {
    // A 4.9 MB PDF rendered "Only its first 2 MiB were read." directly above
    // "Binary file preview is unavailable." — two notices that disagree
    // about whether there is anything here to read at all.
    api.getFile.mockResolvedValue(
      preview({
        path: "docs/manual.pdf",
        language: null,
        content: "",
        binary: true,
        truncated: true,
      }),
    );
    renderTab({ path: "docs/manual.pdf" });

    expect(
      await screen.findByText(
        /Binary file preview is unavailable\. This file is also larger than the 2 MiB preview limit/,
      ),
    ).toBeVisible();
    // And not the text-file truncation notice as well.
    expect(screen.queryByText(/Only its first 2 MiB were read/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy contents" }),
    ).toBeDisabled();
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

  it("neither shows nor copies a path that is not a workspace-relative one (J10)", async () => {
    // Reachable only by editing the persisted panel record, and containment
    // holds — the read boundary refuses it and the tab shows the refusal
    // with a Retry. What it must not do is echo the raw spelling in the
    // place that means "the workspace-relative path of what you are
    // looking at", or hand that spelling to the clipboard.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    api.getFile.mockRejectedValue(
      new ApiClientError(400, "bad_request", "The request is malformed."),
    );
    const { container } = renderTab({ path: "../../../etc/hosts" });

    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
    const header = container.querySelector(".file-preview > header");
    expect(header?.textContent).not.toContain("../../../etc/hosts");
    expect(header?.textContent).toContain("not a workspace path");
    expect(screen.getByRole("button", { name: "Copy path" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Copy path" }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shows the tab's own path while the read is still in flight", () => {
    // The ordinary case for the same code: a well-formed workspace-relative
    // path is shown before the server answers, because it IS one — the
    // validation is the same rule the read boundary applies, not a guess.
    api.getFile.mockReturnValue(new Promise(() => undefined));
    const { container } = renderTab({ path: "src/main.ts" });

    expect(
      container.querySelector(".file-preview > header .file-path"),
    ).toHaveTextContent("src/main.ts");
    expect(screen.getByRole("button", { name: "Copy path" })).toBeEnabled();
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

  it("bounds the characters too, for a file whose length is not in its line count", async () => {
    // J5's shape: a bundle whose whole content is ONE line. The 2,000-line
    // budget never engages — 2 MiB of it is 293 lines — so the tab painted
    // every character the server handed over: 2,097,096 of them in one
    // `pre`, longest line 878,586, `scrollWidth` 6,594,300px.
    api.getFile.mockResolvedValue(
      preview({
        path: "dist/bundle.min.js",
        content: `const bundle="${"payload".repeat(100_000)}";`,
        truncated: true,
      }),
    );
    const { container } = renderTab({ path: "dist/bundle.min.js" });

    await waitFor(() => {
      expect(container.querySelector("pre")?.textContent.length).toBe(
        FILE_PREVIEW_CHARACTER_LIMIT,
      );
    });
    expect(
      screen.getByText(
        new RegExp(
          `Showing the first ${String(FILE_PREVIEW_CHARACTER_LIMIT / 1024)} KiB of the 2 MiB that were read`,
        ),
      ),
    ).toBeVisible();
  });

  it("names this file rather than the read when nothing was truncated", async () => {
    api.getFile.mockResolvedValue(
      preview({
        path: "dist/bundle.min.js",
        content: `const bundle="${"payload".repeat(100_000)}";`,
      }),
    );
    renderTab({ path: "dist/bundle.min.js" });

    expect(
      await screen.findByText(
        new RegExp(
          `Showing the first ${String(FILE_PREVIEW_CHARACTER_LIMIT / 1024)} KiB of this file\\. Copy contents takes the whole file`,
        ),
      ),
    ).toBeVisible();
  });

  it("says when highlighting was declined for size rather than going quiet", async () => {
    // Silence reads as broken: the file is a known language, nothing is
    // coloured, and the reader is told nothing about why. The reason is a
    // bound, and a bound is something that can be said out loud.
    api.getFile.mockResolvedValue(
      preview({
        path: "dist/bundle.min.js",
        content: `const bundle="${"payload".repeat(100_000)}";`,
      }),
    );
    renderTab({ path: "dist/bundle.min.js" });

    expect(
      await screen.findByText(
        new RegExp(
          `larger than the ${String(HIGHLIGHT_MAX_CHARACTERS / 1024)} KiB`,
        ),
      ),
    ).toBeVisible();
    // And the highlighter chunk is never fetched for a file it would only
    // decline: the bound is known here, not two dynamic imports later.
    expect(highlighter.highlightCode).not.toHaveBeenCalled();
  });

  it("says nothing about highlighting for a file it has no grammar for", async () => {
    // Not a decline: nothing was refused, there is simply no grammar. A
    // notice here would be noise on every plain-text file.
    api.getFile.mockResolvedValue(
      preview({
        path: "notes.txt",
        language: null,
        content: "word ".repeat(200_000),
      }),
    );
    renderTab({ path: "notes.txt" });

    expect(await screen.findByText(/Showing the first/)).toBeVisible();
    expect(screen.queryByText(/Syntax highlighting is off/)).toBeNull();
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
