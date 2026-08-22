// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Markdown } from "./Markdown.js";

afterEach(() => {
  cleanup();
});

const TABLE = `
| Command | Result |
| --- | --- |
| build | ok |
`;

// G13's fix gave every markdown table a focusable scroll box, which needs an
// accessible name to mean anything when a keyboard user lands in it. It was
// named `region`, and a NAMED region is a landmark: a transcript with three
// tables put "Table, Table, Table" in the landmark list, and the landmark
// list is how a screen-reader user navigates the whole page.
describe("a markdown table's scroll container", () => {
  it("is reachable by keyboard and named", () => {
    render(<Markdown>{TABLE}</Markdown>);

    const box = screen.getByRole("group", { name: "Table" });
    expect(box).toHaveClass("markdown-table-scroll");
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box.querySelector("table")).not.toBeNull();
  });

  it("does not add one landmark per table", () => {
    render(
      <Markdown>{`${TABLE}\nSome prose.\n${TABLE}\nMore prose.\n${TABLE}`}</Markdown>,
    );

    expect(screen.getAllByRole("group", { name: "Table" })).toHaveLength(3);
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });
});
