// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadRenameForm } from "./ThreadRenameForm.js";

const LONG_TITLE = "Explore this repository before changing anything run";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderEditor(
  initialValue = LONG_TITLE,
  onCommit: (value: string) => Promise<void> = vi.fn(() => Promise.resolve()),
) {
  const onRevert = vi.fn();
  render(
    <ThreadRenameForm
      initialValue={initialValue}
      label={`Rename ${initialValue}`}
      onCommit={onCommit}
      onRevert={onRevert}
    />,
  );
  return { onCommit, onRevert };
}

afterEach(() => {
  cleanup();
});

describe("ThreadRenameForm", () => {
  it("is one inline row, selects the title, and has only a Revert control", () => {
    renderEditor();

    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: `Rename ${LONG_TITLE}`,
    });
    expect(field.tagName).toBe("INPUT");
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveAttribute("maxlength", "200");
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LONG_TITLE.length);
    expect(
      screen.getByRole("button", { name: "Revert title" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save|confirm|cancel/i }),
    ).not.toBeInTheDocument();
  });

  it("saves a trimmed changed title when focus leaves the editor", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn(() => Promise.resolve());
    renderEditor("Original title", onCommit);

    const field = screen.getByRole("textbox", {
      name: "Rename Original title",
    });
    await user.clear(field);
    await user.type(field, "  Renamed thread  ");
    fireEvent.blur(field, { relatedTarget: document.body });

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("Renamed thread");
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("saves on Enter and never inserts a second row", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn(() => Promise.resolve());
    renderEditor("Original title", onCommit);

    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Renamed{Enter}");

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("Renamed");
    });
    expect(screen.getByRole("textbox")).toHaveValue("Renamed");
  });

  it("reverts on Escape without committing", async () => {
    const user = userEvent.setup();
    const { onCommit, onRevert } = renderEditor("Original title");

    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Draft{Escape}");

    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("lets the Revert pointer action win over blur-save", async () => {
    const user = userEvent.setup();
    const { onCommit, onRevert } = renderEditor("Original title");

    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Draft");
    await user.click(screen.getByRole("button", { name: "Revert title" }));

    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("exits an unchanged edit without sending a rename", () => {
    const { onCommit, onRevert } = renderEditor("Original title");

    fireEvent.blur(screen.getByRole("textbox"), {
      relatedTarget: document.body,
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty title editable with a compact validation error", async () => {
    const user = userEvent.setup();
    const { onCommit, onRevert } = renderEditor("Original title");

    await user.clear(screen.getByRole("textbox"));
    fireEvent.blur(screen.getByRole("textbox"), {
      relatedTarget: document.body,
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onRevert).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Title cannot be empty.",
    );
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("prevents duplicate blur or Enter commits while a save is pending", async () => {
    const user = userEvent.setup();
    const pending = deferred<undefined>();
    const onCommit = vi.fn(() => pending.promise);
    renderEditor("Original title", onCommit);

    const field = screen.getByRole("textbox");
    await user.clear(field);
    await user.type(field, "Renamed{Enter}{Enter}");
    fireEvent.blur(field, { relatedTarget: document.body });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(field).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Saving title" })).toBeDisabled();

    pending.resolve(undefined);
    await waitFor(() => {
      expect(field).not.toHaveAttribute("readonly");
    });
  });

  it("retains the draft and exposes a failed save for retry or Revert", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn(() =>
      Promise.reject(new Error("Renaming is not allowed.")),
    );
    const { onRevert } = renderEditor("Original title", onCommit);

    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Draft{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not rename this thread: Renaming is not allowed.",
    );
    expect(screen.getByRole("textbox")).toHaveValue("Draft");

    await user.click(screen.getByRole("button", { name: "Revert title" }));
    expect(onRevert).toHaveBeenCalledTimes(1);
  });
});
