// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";

import { PaneHeader } from "./PaneHeader.js";

// jsdom applies no external stylesheet, so height/clamping can only be
// asserted against the shipped CSS text (the rendered geometry is covered by
// e2e/workspace-tiling.spec.ts).
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\n${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null)
    throw new Error(`no top-level rule found for selector "${selector}"`);
  return match[1] ?? "";
}

async function stylesheet(): Promise<string> {
  return await readFile(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../styles.css"),
    "utf8",
  );
}

afterEach(() => {
  cleanup();
});

describe("PaneHeader", () => {
  it("shows the status label (not colour-only), title, chip, and exactly Split/Close actions", async () => {
    const onSplit = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <PaneHeader
        status="needs-approval"
        elapsed={null}
        title="fix the merge conflict"
        projectLabel="valai"
        focused
        onSplit={onSplit}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Needs approval")).toBeInTheDocument();
    expect(screen.getByText("fix the merge conflict")).toBeInTheDocument();
    expect(screen.getByText("valai")).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Split right into a new chat" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Collapse" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bind" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Dock" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Split right into a new chat" }),
    );
    expect(onSplit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renames the title in place on double-click with the shared one-row editor", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn<(title: string) => Promise<void>>(() =>
      Promise.resolve(),
    );

    function EditableHeader() {
      const [title, setTitle] = useState("Original title");
      return (
        <PaneHeader
          status="done"
          elapsed={null}
          title={title}
          projectLabel="pi-web-app"
          focused
          onRename={async (nextTitle) => {
            await onRename(nextTitle);
            setTitle(nextTitle);
          }}
          onSplit={vi.fn()}
          onClose={vi.fn()}
        />
      );
    }

    render(<EditableHeader />);
    await user.dblClick(
      screen.getByRole("heading", { name: "Original title" }),
    );

    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Rename Original title",
    });
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe("Original title".length);
    expect(
      screen.getByRole("button", { name: "Revert title" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save|confirm|cancel/i }),
    ).not.toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "Renamed in header{Enter}");

    expect(onRename).toHaveBeenCalledWith("Renamed in header");
    expect(
      await screen.findByRole("heading", { name: "Renamed in header" }),
    ).toBeInTheDocument();
  });

  it("keeps New chat static when no rename callback is provided", async () => {
    const user = userEvent.setup();
    render(
      <PaneHeader
        status={null}
        elapsed={null}
        title="New chat"
        projectLabel="pi-web-app"
        focused
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.dblClick(screen.getByRole("heading", { name: "New chat" }));
    expect(
      screen.queryByRole("textbox", { name: /rename/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the elapsed time alongside a working status", () => {
    render(
      <PaneHeader
        status="working"
        elapsed="2m 14s"
        title="Refactor the auth module"
        projectLabel="pi-web-app"
        focused={false}
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText(/2m 14s/)).toBeInTheDocument();
  });

  it("renders no status text when status is null", () => {
    render(
      <PaneHeader
        status={null}
        elapsed={null}
        title="New chat"
        projectLabel="valai"
        focused={false}
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("Working")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs approval")).not.toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.getByText("New chat")).toBeInTheDocument();
  });

  // R2-2 (closes UX-14 and the UX-4 remainder). The detail line used to be
  // full-bleed wrapping content in a content-height header, so a thread pane
  // stood 95px tall next to a 62px new-chat pane and the hairlines were 34px
  // apart in a two-pane layout.
  it("pins its height to the shared --header-h token and clamps the detail line to one line", async () => {
    const css = await stylesheet();

    expect(css).toMatch(/--header-h:\s*[\d.]+rem;/);
    for (const selector of [
      ".pane-head",
      ".panel-tabstrip",
      ".panel-rail-head",
    ])
      expect(
        ruleBody(css, selector),
        `${selector} must size on --header-h`,
      ).toMatch(/\bheight:\s*var\(--header-h\)/);
    // A min-height would let content push a header taller again.
    expect(ruleBody(css, ".pane-head")).not.toMatch(/min-height:/);
    expect(ruleBody(css, ".panel-tabstrip")).not.toMatch(/min-height:/);

    const detail = ruleBody(css, ".pane-head-detail");
    expect(detail).toMatch(/white-space:\s*nowrap/);
    expect(detail).toMatch(/flex-wrap:\s*nowrap/);
    expect(detail).toMatch(/overflow:\s*hidden/);
    const detailChildren = ruleBody(css, ".pane-head-detail > *");
    expect(detailChildren).toMatch(/text-overflow:\s*ellipsis/);
    expect(detailChildren).toMatch(/white-space:\s*nowrap/);
    // The trust note must be a block container or text-overflow cannot apply
    // to it.
    expect(ruleBody(css, ".trust-note")).toMatch(/display:\s*block/);
  });

  it("puts the full detail text on the row's title so clamping loses nothing", () => {
    render(
      <PaneHeader
        status="done"
        elapsed={null}
        title="Investigate flaky test"
        projectLabel="valai"
        focused
        detail={<span className="pane-meta">⌂ Local checkout</span>}
        detailTitle="⌂ Local checkout · Direct execution: Pi tools run with your user permissions."
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const detail = document.querySelector(".pane-head-detail");
    expect(detail).toHaveAttribute(
      "title",
      "⌂ Local checkout · Direct execution: Pi tools run with your user permissions.",
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <PaneHeader
        status="failed"
        elapsed={null}
        title="Investigate flaky test"
        projectLabel="valai"
        focused
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
