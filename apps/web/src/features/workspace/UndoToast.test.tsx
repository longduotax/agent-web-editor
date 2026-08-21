// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as axe from "axe-core";

import { UndoToast } from "./UndoToast.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("UndoToast", () => {
  it("renders the message and an Undo button", () => {
    render(
      <UndoToast message="Archived" onUndo={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("calls onUndo when the Undo button is clicked", () => {
    const onUndo = vi.fn();
    render(
      <UndoToast message="Archived" onUndo={onUndo} onDismiss={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss exactly once after timeoutMs elapses", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <UndoToast
        message="Archived"
        onUndo={vi.fn()}
        onDismiss={onDismiss}
        timeoutMs={6000}
      />,
    );

    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);

    // The timer only ever fires once.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not call onDismiss after Undo is clicked, even once timeoutMs would have elapsed", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onUndo = vi.fn();
    render(
      <UndoToast
        message="Archived"
        onUndo={onUndo}
        onDismiss={onDismiss}
        timeoutMs={6000}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <UndoToast message="Archived" onUndo={vi.fn()} onDismiss={vi.fn()} />,
    );

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
