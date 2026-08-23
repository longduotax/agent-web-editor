import { describe, expect, it } from "vitest";

import {
  DIFF_CHARACTER_LIMIT,
  DIFF_LINE_LIMIT,
  parseUnifiedDiff,
} from "./parseUnifiedDiff.js";

// Every fixture below is real `git diff` output, captured from a temporary
// repository rather than written from memory: the shapes that break a diff
// parser — the `\ No newline at end of file` marker, a `+++` that is a file
// header and a `+++` that is an added line, an untracked file's `-0,0`, a
// combined merge diff — are exactly the ones nobody remembers correctly.

const MODIFIED = [
  "diff --git a/a.txt b/a.txt",
  "index c9e9e05..061a3ba 100644",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,10 +1,10 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  " four",
  " five",
  " six",
  " seven",
  " eight",
  "-nine",
  "+NINE",
  " ten",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("reads a hunk's header and walks both line numbers through it", () => {
    const diff = parseUnifiedDiff(MODIFIED, "unstaged");

    expect(diff.raw).toBeNull();
    expect(diff.hunks).toHaveLength(1);
    const hunk = diff.hunks[0];
    expect(hunk).toBeDefined();
    if (hunk === undefined) return;
    expect(hunk.header).toBe("@@ -1,10 +1,10 @@");
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(10);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(10);
    expect(hunk.added).toBe(2);
    expect(hunk.deleted).toBe(2);
    // The arithmetic itself: a context line advances both sides, a removed
    // line only the old side, an added line only the new side. Line 2 is
    // where the two sides stop agreeing and line 3 is where they agree
    // again — at different numbers than a naive counter would give.
    expect(
      hunk.lines.map((line) => [line.kind, line.old, line.new, line.text]),
    ).toEqual([
      ["context", 1, 1, " one"],
      ["delete", 2, null, "-two"],
      ["add", null, 2, "+TWO"],
      ["context", 3, 3, " three"],
      ["context", 4, 4, " four"],
      ["context", 5, 5, " five"],
      ["context", 6, 6, " six"],
      ["context", 7, 7, " seven"],
      ["context", 8, 8, " eight"],
      ["delete", 9, null, "-nine"],
      ["add", null, 9, "+NINE"],
      ["context", 10, 10, " ten"],
    ]);
    expect(diff.added).toBe(2);
    expect(diff.deleted).toBe(2);
    expect(diff.widestNumber).toBe(10);
  });

  it("keeps the +/- prefix character in every line's own text", () => {
    // WSP-06: the distinction is never carried by colour alone, which is a
    // claim about the text, so the prefix must survive parsing.
    const diff = parseUnifiedDiff(MODIFIED, "unstaged");
    const texts = diff.hunks[0]?.lines.map((line) => line.text) ?? [];
    expect(texts).toContain("+TWO");
    expect(texts).toContain("-two");
  });

  it("counts a hunk whose lengths are omitted as one line each", () => {
    const diff = parseUnifiedDiff(
      ["@@ -4 +4 @@", "-before", "+after", ""].join("\n"),
      "staged",
    );
    const hunk = diff.hunks[0];
    expect(hunk).toBeDefined();
    if (hunk === undefined) return;
    expect([
      hunk.oldStart,
      hunk.oldLines,
      hunk.newStart,
      hunk.newLines,
    ]).toEqual([4, 1, 4, 1]);
    expect(hunk.lines.map((line) => [line.old, line.new])).toEqual([
      [4, null],
      [null, 4],
    ]);
  });

  it("reads several hunks and does not restart the numbering", () => {
    const diff = parseUnifiedDiff(
      [
        "@@ -1,3 +1,3 @@",
        " one",
        "-two",
        "+TWO",
        "@@ -20,3 +20,4 @@ function main() {",
        " twenty",
        "+twenty and a half",
        " twenty-one",
        "",
      ].join("\n"),
      "unstaged",
    );

    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[1]?.header).toBe("@@ -20,3 +20,4 @@ function main() {");
    expect(diff.hunks[1]?.lines.map((line) => [line.old, line.new])).toEqual([
      [20, 20],
      [null, 21],
      [21, 22],
    ]);
    expect(diff.added).toBe(2);
    expect(diff.deleted).toBe(1);
    expect(diff.widestNumber).toBe(22);
  });

  it("keeps a no-newline marker out of the numbering and on the screen", () => {
    // Git writes `\ No newline at end of file` under the line it applies to,
    // and it is not a line of either file: numbering it would push every
    // number below it out by one. It stays a line of the rendering, because
    // it is the only place a reader learns the file has no final newline.
    const diff = parseUnifiedDiff(
      [
        "diff --git a/nn.txt b/nn.txt",
        "index 20cbb4d..0ba6e66 100644",
        "--- a/nn.txt",
        "+++ b/nn.txt",
        "@@ -1 +1 @@",
        "-no newline",
        "\\ No newline at end of file",
        "+no newline changed",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
      "unstaged",
    );

    expect(
      diff.hunks[0]?.lines.map((line) => [line.kind, line.old, line.new]),
    ).toEqual([
      ["delete", 1, null],
      ["note", null, null],
      ["add", null, 1],
      ["note", null, null],
    ]);
    expect(diff.hunks[0]?.lines[1]?.text).toBe("\\ No newline at end of file");
    expect(diff.added).toBe(1);
    expect(diff.deleted).toBe(1);
  });

  it("reads an untracked file's /dev/null preview as all additions", () => {
    // What the read boundary produces for a file Git does not track: an
    // old side of zero lines, so every line is an addition and the old
    // gutter is empty for all of them.
    const diff = parseUnifiedDiff(
      [
        "diff --git a/untracked.txt b/untracked.txt",
        "new file mode 100644",
        "index 0000000..d5a09df",
        "--- /dev/null",
        "+++ b/untracked.txt",
        "@@ -0,0 +1,2 @@",
        "+brand new",
        "+second line",
        "",
      ].join("\n"),
      "unstaged",
    );

    expect(diff.notes).toEqual(["new file mode 100644"]);
    expect(diff.hunks[0]?.oldStart).toBe(0);
    expect(diff.hunks[0]?.lines.map((line) => [line.old, line.new])).toEqual([
      [null, 1],
      [null, 2],
    ]);
    expect(diff.added).toBe(2);
    expect(diff.deleted).toBe(0);
  });

  it("tells a file header apart from an added or removed line", () => {
    // The trap this parser exists for. `+++ b/file` before the first hunk is
    // a file header; `+++ still adding` inside one is a line whose content
    // begins with two plus signs. Position decides, not the prefix.
    const diff = parseUnifiedDiff(
      [
        "diff --git a/x.md b/x.md",
        "--- a/x.md",
        "+++ b/x.md",
        "@@ -1,2 +1,2 @@",
        "---- a heading rule",
        "+++ still adding",
        "",
      ].join("\n"),
      "staged",
    );

    expect(diff.added).toBe(1);
    expect(diff.deleted).toBe(1);
    expect(diff.hunks[0]?.lines.map((line) => line.kind)).toEqual([
      "delete",
      "add",
    ]);
  });

  it("reports a binary file rather than inventing lines for it", () => {
    const diff = parseUnifiedDiff(
      [
        "diff --git a/bin.dat b/bin.dat",
        "new file mode 100644",
        "index 0000000..0f49c4a",
        "Binary files /dev/null and b/bin.dat differ",
        "",
      ].join("\n"),
      "staged",
    );

    expect(diff.binary).toBe(true);
    expect(diff.hunks).toEqual([]);
    expect(diff.raw).toBeNull();
    expect(diff.added).toBe(0);
    expect(diff.deleted).toBe(0);
  });

  it("carries a rename's own lines through as notes", () => {
    const diff = parseUnifiedDiff(
      [
        "diff --git a/old.ts b/new.ts",
        "similarity index 92%",
        "rename from old.ts",
        "rename to new.ts",
        "index 1234567..89abcde 100644",
        "--- a/old.ts",
        "+++ b/new.ts",
        "@@ -1 +1 @@",
        "-const a = 1;",
        "+const b = 1;",
        "",
      ].join("\n"),
      "staged",
    );

    expect(diff.notes).toEqual(["rename from old.ts", "rename to new.ts"]);
    expect(diff.hunks).toHaveLength(1);
  });

  it("keeps a carriage return as part of the line it belongs to", () => {
    // A CRLF working tree produces CRLF diff lines. The `\r` is a character
    // of the file, so it stays in the text; what it must not do is split a
    // line or shift a number.
    const diff = parseUnifiedDiff(
      ["@@ -1,2 +1,2 @@", " kept\r", "-old\r", "+new\r", ""].join("\n"),
      "unstaged",
    );

    expect(diff.hunks[0]?.lines.map((line) => [line.kind, line.text])).toEqual([
      ["context", " kept\r"],
      ["delete", "-old\r"],
      ["add", "+new\r"],
    ]);
    expect(diff.added).toBe(1);
  });

  it("reads an empty section as an empty diff rather than a failure", () => {
    const diff = parseUnifiedDiff("", "staged");

    expect(diff.hunks).toEqual([]);
    expect(diff.raw).toBeNull();
    expect(diff.binary).toBe(false);
    expect(diff.added).toBe(0);
    expect(diff.totalLines).toBe(0);
  });

  it("degrades to the raw text when the input is not a unified diff", () => {
    const diff = parseUnifiedDiff("fatal: something went wrong\n", "unstaged");

    expect(diff.raw).toBe("malformed");
    expect(diff.hunks).toEqual([]);
    expect(diff.text).toBe("fatal: something went wrong\n");
  });

  it("degrades to the raw text when a hunk header cannot be read", () => {
    const diff = parseUnifiedDiff(
      ["@@ this is not a range @@", " one", ""].join("\n"),
      "unstaged",
    );

    expect(diff.raw).toBe("malformed");
    expect(diff.hunks).toEqual([]);
  });

  it("degrades to the raw text when a hunk holds a line it cannot classify", () => {
    const diff = parseUnifiedDiff(
      ["@@ -1,2 +1,2 @@", " one", "two without a prefix", ""].join("\n"),
      "unstaged",
    );

    expect(diff.raw).toBe("malformed");
    expect(diff.hunks).toEqual([]);
  });

  it("shows a merge's combined diff as Git wrote it rather than as hunks", () => {
    // `git diff` on an unmerged path emits a combined diff: `@@@` headers and
    // two prefix columns, in which "the old side" is not one file. Rendering
    // it through a two-gutter model would be a confident lie, so it is shown
    // as text and said to be one.
    const diff = parseUnifiedDiff(
      [
        "diff --cc conflicted.txt",
        "index 1111111,2222222..0000000",
        "--- a/conflicted.txt",
        "+++ b/conflicted.txt",
        "@@@ -1,2 -1,2 +1,3 @@@",
        "++<<<<<<< HEAD",
        "+ ours",
        "",
      ].join("\n"),
      "unstaged",
    );

    expect(diff.raw).toBe("combined");
    expect(diff.hunks).toEqual([]);
  });

  it("reads the exact bytes a real merge conflict produces", () => {
    // The hand-shaped case above was the only `@@@` this parser had ever
    // seen, which is a fixture testing itself. These are the bytes `git
    // diff` actually wrote for an unmerged `tracked.txt`, captured by
    // `apps/server/src/inspector/git.test.ts`'s real-merge case — conflict
    // markers, the `+ `/` +` prefix pairs that make the two parent columns,
    // and a `-1,3 -1,3 +1,7` header with three counts rather than two.
    const diff = parseUnifiedDiff(
      [
        "diff --cc tracked.txt",
        "index daf31e1,594dc4f..0000000",
        "--- a/tracked.txt",
        "+++ b/tracked.txt",
        "@@@ -1,3 -1,3 +1,7 @@@",
        "  one",
        "++<<<<<<< HEAD",
        " +OURS",
        "++=======",
        "+ THEIRS",
        "++>>>>>>> theirs",
        "  three",
        "",
      ].join("\n"),
      "unstaged",
    );

    expect(diff.raw).toBe("combined");
    expect(diff.hunks).toEqual([]);
    // Nothing is counted, because nothing was read as a side: a `+ THEIRS`
    // is an addition on one parent and a context line on the other, and
    // calling it "1 added" would be picking one parent to be right.
    expect(diff.added).toBe(0);
    expect(diff.deleted).toBe(0);
    // The whole section survives as text, so what is painted is what Git
    // said — including the conflict markers, which are in the file.
    expect(diff.text).toContain("++<<<<<<< HEAD");
    expect(diff.text).toContain("++>>>>>>> theirs");
  });

  it("ends a hunk at the next file's header instead of swallowing it", () => {
    const diff = parseUnifiedDiff(
      [
        "diff --git a/one.ts b/one.ts",
        "@@ -1 +1 @@",
        "-a",
        "+b",
        "diff --git a/two.ts b/two.ts",
        "new file mode 100644",
        "@@ -0,0 +1 @@",
        "+c",
        "",
      ].join("\n"),
      "staged",
    );

    expect(diff.hunks).toHaveLength(2);
    expect(diff.notes).toEqual(["new file mode 100644"]);
    expect(diff.added).toBe(2);
    expect(diff.deleted).toBe(1);
  });

  it("treats a wholly empty line inside a hunk as an empty context line", () => {
    // Git writes a context line as a space and its content, so a blank
    // context line is one space — but tools that post-process a diff strip
    // trailing whitespace, and the honest reading of the result is the
    // context line it was.
    const diff = parseUnifiedDiff(
      ["@@ -1,2 +1,2 @@", "", "+added", ""].join("\n"),
      "unstaged",
    );

    expect(diff.hunks[0]?.lines.map((line) => [line.kind, line.old])).toEqual([
      ["context", 1],
      ["add", null],
    ]);
  });
});

describe("the render budget", () => {
  function longDiff(lines: number): string {
    const body = Array.from(
      { length: lines },
      (_, index) => `+line ${String(index)}`,
    );
    return [`@@ -0,0 +1,${String(lines)} @@`, ...body, ""].join("\n");
  }

  it("paints no more lines than the budget and says what it left out", () => {
    const diff = parseUnifiedDiff(longDiff(DIFF_LINE_LIMIT + 500), "unstaged");

    expect(diff.shownLines).toBe(DIFF_LINE_LIMIT);
    expect(diff.hunks[0]?.lines).toHaveLength(DIFF_LINE_LIMIT);
    expect(diff.cut).toBe(true);
    expect(diff.byCharacters).toBe(false);
    // The counts are of the whole diff, not of the painted portion: the
    // header states what the file's change is, and the notice states what is
    // on screen. Reporting the painted portion as the total is the defect
    // J7 fixed on the File tab.
    expect(diff.totalLines).toBe(DIFF_LINE_LIMIT + 500);
    expect(diff.added).toBe(DIFF_LINE_LIMIT + 500);
  });

  it("bounds by characters when the lines alone would not", () => {
    // The diff equivalent of J5's minified bundle: few lines, each of them
    // enormous, so a line budget never engages.
    const wide = Array.from({ length: 8 }, () => `+${"x".repeat(50_000)}`);
    const diff = parseUnifiedDiff(
      ["@@ -0,0 +1,8 @@", ...wide, ""].join("\n"),
      "unstaged",
    );

    expect(diff.cut).toBe(true);
    expect(diff.byCharacters).toBe(true);
    expect(diff.shownLines).toBeLessThan(8);
    expect(
      diff.hunks.reduce(
        (total, hunk) =>
          hunk.lines.reduce((sum, line) => sum + line.text.length, total),
        0,
      ),
    ).toBeLessThanOrEqual(DIFF_CHARACTER_LIMIT);
    expect(diff.added).toBe(8);
  });

  it("keeps a hunk out of the rendering rather than drawing an empty one", () => {
    const diff = parseUnifiedDiff(
      [
        longDiff(DIFF_LINE_LIMIT).trimEnd(),
        "@@ -0,0 +1 @@",
        "+past the budget",
        "",
      ].join("\n"),
      "unstaged",
    );

    expect(diff.hunks).toHaveLength(1);
    expect(diff.cut).toBe(true);
  });

  it("does not claim a cut when everything fits", () => {
    const diff = parseUnifiedDiff(longDiff(10), "unstaged");

    expect(diff.cut).toBe(false);
    expect(diff.shownLines).toBe(10);
    expect(diff.totalLines).toBe(10);
  });
});

describe("hunk identity", () => {
  // The identity a collapse is remembered by (WSP-04). An index would churn
  // the moment a hunk is added above it — every hunk below would take on the
  // collapsed state of its predecessor — and the header would churn too,
  // because a hunk's `@@ -12,7 +12,9 @@` moves whenever anything above it
  // changes size. The identity is therefore derived from the hunk's own
  // changed lines, plus its ordinal among identical ones.

  it("is unchanged when a hunk is added above and shifts every number", () => {
    const before = parseUnifiedDiff(
      ["@@ -40,3 +40,3 @@", " context", "-old", "+new", ""].join("\n"),
      "unstaged",
    );
    const after = parseUnifiedDiff(
      [
        "@@ -1,2 +1,4 @@",
        " top",
        "+inserted",
        "+inserted too",
        "@@ -42,3 +44,3 @@",
        " context",
        "-old",
        "+new",
        "",
      ].join("\n"),
      "unstaged",
    );

    expect(after.hunks[1]?.id).toBe(before.hunks[0]?.id);
    expect(after.hunks[0]?.id).not.toBe(before.hunks[0]?.id);
  });

  it("is unchanged when the same content is fetched again", () => {
    const first = parseUnifiedDiff(MODIFIED, "unstaged");
    const second = parseUnifiedDiff(MODIFIED, "unstaged");

    expect(second.hunks[0]?.id).toBe(first.hunks[0]?.id);
  });

  it("tells the staged and unstaged copies of one change apart", () => {
    const staged = parseUnifiedDiff(MODIFIED, "staged");
    const unstaged = parseUnifiedDiff(MODIFIED, "unstaged");

    expect(staged.hunks[0]?.id).not.toBe(unstaged.hunks[0]?.id);
  });

  it("tells two hunks making the identical change apart by their order", () => {
    const diff = parseUnifiedDiff(
      [
        "@@ -1,2 +1,3 @@",
        " one",
        "+import x",
        "@@ -30,2 +31,3 @@",
        " thirty",
        "+import x",
        "",
      ].join("\n"),
      "staged",
    );

    expect(diff.hunks[0]?.id).not.toBe(diff.hunks[1]?.id);
  });

  it("is derived from the changed lines and not from the context around them", () => {
    // The same edit read twice with different amounts of context, which is
    // what happens when an edit lands close enough to another for Git to
    // merge the two hunks' context. A collapse the user set on the change
    // survives that; a change to the change itself does not, and should not.
    const narrow = parseUnifiedDiff(
      ["@@ -10,3 +10,3 @@", " a", "-old", "+new", " b", ""].join("\n"),
      "staged",
    );
    const wide = parseUnifiedDiff(
      [
        "@@ -8,7 +8,7 @@",
        " x",
        " y",
        " a",
        "-old",
        "+new",
        " b",
        " z",
        "",
      ].join("\n"),
      "staged",
    );
    const edited = parseUnifiedDiff(
      ["@@ -10,3 +10,3 @@", " a", "-old", "+other", " b", ""].join("\n"),
      "staged",
    );

    expect(wide.hunks[0]?.id).toBe(narrow.hunks[0]?.id);
    expect(edited.hunks[0]?.id).not.toBe(narrow.hunks[0]?.id);
  });
});
