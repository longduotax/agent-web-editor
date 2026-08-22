// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadRenameForm } from "./ThreadRenameForm.js";

afterEach(() => {
  cleanup();
});

// The measured case: 52 characters edited through a 95px window.
const LONG_TITLE = "Explore this repository before changing anything run";

function renderForm(value = LONG_TITLE) {
  const handlers = {
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <ThreadRenameForm
      value={value}
      label="Rename Example thread"
      pending={false}
      error={null}
      {...handlers}
    />,
  );
  return handlers;
}

// G9. The field was a single-line input sharing a 227px sidebar row with Save
// (50px) and Cancel (65px): 95px of field, about twelve characters of a
// fifty-two character title. Renaming exists because generated titles are
// bad, so doing it blind defeats the point.
describe("ThreadRenameForm", () => {
  it("gives the whole row to the field and wraps the title instead of hiding it", () => {
    renderForm();

    const field = screen.getByRole("textbox", {
      name: "Rename Example thread",
    });
    // A wrapping textarea, not a one-line input: the title is visible across
    // as many short lines as it needs.
    expect(field.tagName).toBe("TEXTAREA");
    // The buttons no longer share the field's row.
    expect(field.parentElement).toBe(
      screen.getByRole("button", { name: "Save" }).parentElement?.parentElement,
    );
    expect(
      screen.getByRole("button", { name: "Save" }).parentElement,
    ).toHaveClass("thread-rename-actions");
  });

  it("selects the whole title on focus so retyping does not mean deleting first", () => {
    renderForm();

    const field = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Rename Example thread",
    });
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LONG_TITLE.length);
  });

  // A title has no second line, so Enter is a submit rather than a newline --
  // Shift+Enter included.
  it("submits on Enter and cancels on Escape", async () => {
    const user = userEvent.setup();
    const handlers = renderForm();

    await user.keyboard("{Enter}");
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(handlers.onSubmit).toHaveBeenCalledTimes(2);
    expect(handlers.onChange).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps Save and Cancel for the pointer, and names the keys for everyone else", async () => {
    const user = userEvent.setup();
    const handlers = renderForm();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);

    expect(screen.getByText("Enter saves · Esc cancels")).toBeInTheDocument();
  });

  it("collapses a pasted line break rather than growing a second line", async () => {
    const user = userEvent.setup();
    const handlers = renderForm("");

    await user.paste("first line\nsecond line");

    expect(handlers.onChange).toHaveBeenLastCalledWith(
      "first line second line",
    );
  });
});
