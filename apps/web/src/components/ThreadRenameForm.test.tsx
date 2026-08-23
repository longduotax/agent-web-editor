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

function renderForm(
  value = LONG_TITLE,
  overrides: { pending?: boolean; error?: unknown } = {},
) {
  const handlers = {
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onDismissError: vi.fn(),
  };
  render(
    <ThreadRenameForm
      value={value}
      label="Rename Example thread"
      pending={overrides.pending ?? false}
      error={overrides.error ?? null}
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

// SF5. Save and Cancel were both `disabled={pending}`; Enter went straight
// past that to `onSubmit`, so a second Enter on a slow rename fired a second
// rename of the same thread.
describe("ThreadRenameForm while a rename is in flight", () => {
  it("does not submit again on Enter", async () => {
    const user = userEvent.setup();
    const handlers = renderForm(LONG_TITLE, { pending: true });

    await user.click(
      screen.getByRole("textbox", { name: "Rename Example thread" }),
    );
    await user.keyboard("{Enter}{Enter}");

    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it("still submits on Enter once the rename has settled", async () => {
    const user = userEvent.setup();
    const handlers = renderForm();

    await user.click(
      screen.getByRole("textbox", { name: "Rename Example thread" }),
    );
    await user.keyboard("{Enter}");

    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });

  // G10's rule, applied to the one error that did not have it: a red block
  // needs an exit.
  it("gives the rename error a way out", async () => {
    const user = userEvent.setup();
    const handlers = renderForm(LONG_TITLE, {
      error: new Error("Renaming is not allowed."),
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not rename this thread: Renaming is not allowed.",
    );
    await user.click(
      screen.getByRole("button", { name: "Dismiss this message" }),
    );

    expect(handlers.onDismissError).toHaveBeenCalledTimes(1);
  });
});
