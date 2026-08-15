// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "./components/Markdown.js";
import { Status } from "./components/Status.js";

describe("safe and accessible workspace rendering", () => {
  it("gives run states a non-color cue and accessible label", () => {
    render(<Status state="running" unread={false} />);
    expect(screen.getByLabelText("Running")).toHaveTextContent("Running");
  });

  it("does not enable raw Markdown HTML", () => {
    const { container } = render(
      <Markdown>{`<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert(1))`}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(screen.getByText("unsafe").closest("a")).not.toHaveAttribute(
      "href",
      expect.stringContaining("javascript:"),
    );
  });
});
