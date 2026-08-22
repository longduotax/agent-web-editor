// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilePreviewMarkdown } from "./FilePreviewMarkdown.js";

afterEach(() => {
  cleanup();
});

function renderDocument(source: string, path = "docs/design/notes.md") {
  const onOpenFile = vi.fn();
  const onGoToFragment = vi.fn();
  const view = render(
    <FilePreviewMarkdown
      source={source}
      path={path}
      onOpenFile={onOpenFile}
      onGoToFragment={onGoToFragment}
    />,
  );
  return { ...view, onOpenFile, onGoToFragment };
}

describe("FilePreviewMarkdown", () => {
  it("renders the document as formatted output rather than as its characters", () => {
    renderDocument("# The title\n\nA paragraph with **bold** text.\n");

    expect(screen.getByRole("heading", { name: "The title" })).toBeVisible();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("renders GitHub tables, which repository documents are full of", () => {
    renderDocument("| a | b |\n| - | - |\n| 1 | 2 |\n");

    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "a" })).toBeVisible();
  });

  it("loads no remote image, and says where the missing one pointed", () => {
    const { container } = renderDocument(
      "![A diagram](https://example.com/diagram.png)\n",
    );

    // The assertion that matters is the absence of the element: an `img` in
    // the document is a request the moment it is parsed, and this is a file
    // out of the user's working tree, not something they wrote.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/A diagram/)).toBeVisible();
    expect(screen.getByText(/not loaded/i)).toBeVisible();
  });

  it("names a relative image by the file it would have come from", () => {
    const { container } = renderDocument("![Chart](../assets/chart.png)\n");

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/docs\/assets\/chart\.png/)).toBeVisible();
  });

  it("renders no image element at all, not even an inline one", () => {
    const { container } = renderDocument(
      "![Dot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)\n",
    );

    expect(container.querySelector("img")).toBeNull();
    // And it does not paste the reference itself into the document: a data
    // URI is the file's bytes, and printing them is not a description.
    expect(screen.getByText(/Dot — not loaded$/)).toBeVisible();
  });

  it("parses no raw HTML, so a document cannot bring its own elements", () => {
    const { container } = renderDocument(
      '<img src="x" onerror="alert(1)">\n\n<script>alert(2)</script>\n',
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
  });

  it("opens an in-repository link as a File tab instead of navigating", async () => {
    const user = userEvent.setup();
    const { onOpenFile } = renderDocument(
      "See [the other note](../specs/one.md#section).\n",
    );

    await user.click(screen.getByRole("button", { name: "the other note" }));

    expect(onOpenFile).toHaveBeenCalledWith("docs/specs/one.md");
  });

  it("sends an external link to a real browser tab, and says so", () => {
    renderDocument("See [the site](https://example.com/a).\n");

    const link = screen.getByRole("link", { name: /the site/ });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
    // Unambiguous rather than merely safe: the reader is told this one
    // leaves the workspace before they follow it.
    expect(link).toHaveTextContent(/example\.com/);
  });

  it("renders a link that can go nowhere as plain text, not as a dead link", async () => {
    const user = userEvent.setup();
    const { container, onOpenFile } = renderDocument(
      "[run it](javascript:alert(1)) and [up and out](../../../etc/passwd)\n",
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(screen.getByText(/run it/)).toBeVisible();
    await user.click(screen.getByText(/up and out/));
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("resolves a link written from the root of the workspace", async () => {
    const user = userEvent.setup();
    const { onOpenFile } = renderDocument("[readme](/README.md)\n");

    await user.click(screen.getByRole("button", { name: "readme" }));

    expect(onOpenFile).toHaveBeenCalledWith("README.md");
  });

  it("offers a fragment as a control that moves inside this document (J8)", async () => {
    const user = userEvent.setup();
    const { onGoToFragment } = renderDocument(
      "# A guide\n\nSee [the hard part](#the-hard-part).\n\n## The hard part\n",
    );

    const link = screen.getByRole("button", { name: "the hard part" });
    // Not an anchor: it navigates nothing. And not inert either — the
    // previous rendering told the reader it pointed nowhere, which was true
    // about the workspace and false about the link.
    expect(link).toHaveAttribute("title", "Go to this part of the document.");
    await user.click(link);

    expect(onGoToFragment).toHaveBeenCalledWith("the-hard-part");
  });
});
