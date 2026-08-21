// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";

import { PaneHeader } from "./PaneHeader.js";

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
      screen.getByRole("button", { name: "Split" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Collapse" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bind" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dock" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Split" }));
    expect(onSplit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
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
