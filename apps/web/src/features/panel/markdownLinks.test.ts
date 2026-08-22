import { describe, expect, it } from "vitest";

import { resolvePreviewLink } from "./markdownLinks.js";

describe("resolvePreviewLink", () => {
  const from = "docs/design/notes.md";

  it("resolves a link relative to the file that contains it", () => {
    expect(resolvePreviewLink("other.md", from)).toEqual({
      kind: "file",
      path: "docs/design/other.md",
    });
    expect(resolvePreviewLink("./other.md", from)).toEqual({
      kind: "file",
      path: "docs/design/other.md",
    });
    expect(resolvePreviewLink("../specs/one.md", from)).toEqual({
      kind: "file",
      path: "docs/specs/one.md",
    });
    expect(resolvePreviewLink("sub/deep.md", "README.md")).toEqual({
      kind: "file",
      path: "sub/deep.md",
    });
  });

  it("reads a leading slash as the workspace root, which is what a repository document means by it", () => {
    expect(resolvePreviewLink("/README.md", from)).toEqual({
      kind: "file",
      path: "README.md",
    });
  });

  it("drops a fragment and a query, which name nothing in a file", () => {
    expect(resolvePreviewLink("other.md#heading", from)).toEqual({
      kind: "file",
      path: "docs/design/other.md",
    });
    expect(resolvePreviewLink("other.md?raw=1", from)).toEqual({
      kind: "file",
      path: "docs/design/other.md",
    });
  });

  it("decodes an escaped path, and refuses one that cannot be decoded", () => {
    expect(resolvePreviewLink("my%20file.md", from)).toEqual({
      kind: "file",
      path: "docs/design/my file.md",
    });
    expect(resolvePreviewLink("%E0%A4%A.md", from)).toEqual({ kind: "inert" });
  });

  it("refuses a target outside the workspace, however it is spelled", () => {
    // The server would refuse these too — this is the same rule stated where
    // the link is turned into a path, so a document cannot even offer one.
    expect(resolvePreviewLink("../../../etc/passwd", from)).toEqual({
      kind: "inert",
    });
    expect(resolvePreviewLink("%2E%2E/%2E%2E/%2E%2E/etc/passwd", from)).toEqual(
      { kind: "inert" },
    );
    expect(resolvePreviewLink("..\\..\\secrets", from)).toEqual({
      kind: "inert",
    });
    expect(resolvePreviewLink("a%00b", from)).toEqual({ kind: "inert" });
  });

  it("does not open a directory as a file", () => {
    expect(resolvePreviewLink("../", from)).toEqual({ kind: "inert" });
    expect(resolvePreviewLink("sub/", from)).toEqual({ kind: "inert" });
    expect(resolvePreviewLink(".", from)).toEqual({ kind: "inert" });
  });

  it("sends http, https and mailto to a real browser tab", () => {
    expect(resolvePreviewLink("https://example.com/a", from)).toEqual({
      kind: "external",
      href: "https://example.com/a",
    });
    expect(resolvePreviewLink("HTTP://example.com", from)).toEqual({
      kind: "external",
      href: "HTTP://example.com",
    });
    expect(resolvePreviewLink("mailto:someone@example.com", from)).toEqual({
      kind: "external",
      href: "mailto:someone@example.com",
    });
  });

  it("makes every other scheme inert, including the ones that would run", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      // Protocol-relative: an address, not a path, and not one this tab can
      // say anything true about.
      "//example.com/x",
    ])
      expect(resolvePreviewLink(href, from)).toEqual({ kind: "inert" });
  });

  it("is inert for a link that names nothing, and for one that names only a fragment", () => {
    expect(resolvePreviewLink(undefined, from)).toEqual({ kind: "inert" });
    expect(resolvePreviewLink("", from)).toEqual({ kind: "inert" });
    expect(resolvePreviewLink("   ", from)).toEqual({ kind: "inert" });
    // The preview gives headings no ids, so an in-document anchor would go
    // nowhere; saying so is better than a link that silently does nothing.
    expect(resolvePreviewLink("#heading", from)).toEqual({ kind: "inert" });
  });
});
