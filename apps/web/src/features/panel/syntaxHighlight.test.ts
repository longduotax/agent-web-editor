import { describe, expect, it } from "vitest";

import { CODE_LANGUAGES } from "./fileLanguage.js";
import { HIGHLIGHT_MAX_CHARACTERS, highlightCode } from "./syntaxHighlight.js";

/** The text of a highlighted line, back in one piece. */
function lineText(line: { text: string }[] | undefined): string {
  return (line ?? []).map((token) => token.text).join("");
}

describe("highlightCode", () => {
  it("colours tokens with the theme's own CSS variables, not with a bundled palette", async () => {
    const lines = await highlightCode(
      '// a note\nconst answer = "42";',
      "typescript",
    );
    expect(lines).not.toBeNull();

    const colours = new Set(
      (lines ?? []).flat().map((token) => token.color ?? "plain"),
    );
    expect(colours).toContain("var(--code-comment)");
    expect(colours).toContain("var(--code-keyword)");
    expect(colours).toContain("var(--code-string)");
    // Every colour is a reference into the stylesheet's own tokens. A literal
    // here would be a colour that ignores the active theme (WSP-05).
    for (const colour of colours)
      expect(colour === "plain" || colour.startsWith("var(--code-")).toBe(true);
  });

  it("gives back exactly the text it was given, line for line", async () => {
    // The one invariant a reader depends on: highlighting decorates the
    // file, it never edits it. A dropped or reordered token would be a
    // silent lie about what is on disk.
    const source = 'const a = 1;\n\nfunction f() {\n  return "x";\n}';
    const lines = await highlightCode(source, "typescript");

    expect((lines ?? []).map(lineText).join("\n")).toBe(source);
  });

  it("carries body text as no colour at all, so it inherits the preview's", async () => {
    const lines = await highlightCode("plain words here", "typescript");
    expect(lines?.[0]?.every((token) => token.color === null)).toBe(true);
  });

  it("reuses one highlighter across calls and across languages", async () => {
    const first = await highlightCode("{ }", "json");
    const second = await highlightCode("body { color: red; }", "css");
    const third = await highlightCode('{ "a": 1 }', "json");

    expect(lineText(first?.[0])).toBe("{ }");
    expect(lineText(second?.[0])).toBe("body { color: red; }");
    expect(lineText(third?.[0])).toBe('{ "a": 1 }');
  });

  it("declines a file too large to tokenize rather than blocking on it", async () => {
    // Declining is not an error state: the caller keeps the plain monospace
    // text it already painted, which is what WSP-05 requires of every case
    // where highlighting is unavailable.
    const huge = "x".repeat(HIGHLIGHT_MAX_CHARACTERS + 1);
    expect(await highlightCode(huge, "typescript")).toBeNull();
  });

  it("holds a grammar for every language the extension map can name", async () => {
    // `languageForPath` returns one of these and the loader is a Record over
    // the same union, so a missing entry cannot compile — but a wrong module
    // specifier can, and would fail only when someone opened that file.
    for (const language of CODE_LANGUAGES) {
      const lines = await highlightCode("x", language);
      expect(lineText(lines?.[0])).toBe("x");
    }
  });
});
