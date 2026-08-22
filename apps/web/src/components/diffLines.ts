/**
 * Minimal unified-diff line classifier.
 *
 * Deliberately not a diff parser and not a syntax highlighter: the Changes
 * tab only needs to tell added, removed, hunk-header and file-header lines
 * apart so they can be coloured. Everything else is context.
 *
 * The one real trap is that a unified diff's FILE headers start with `+++`
 * and `---`, so a naive `startsWith("+")` paints them as an addition and a
 * removal respectively.
 */
export type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

const META_PREFIXES = [
  "+++",
  "---",
  "diff ",
  "index ",
  "new file mode",
  "deleted file mode",
  "old mode",
  "new mode",
  "similarity index",
  "dissimilarity index",
  "rename from",
  "rename to",
  "copy from",
  "copy to",
  "Binary files",
  "GIT binary patch",
  "\\ No newline at end of file",
];

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  for (const prefix of META_PREFIXES)
    if (line.startsWith(prefix)) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Splits a unified diff into classified lines, preserving blank lines. */
export function classifyDiff(text: string): DiffLine[] {
  if (text === "") return [];
  return text
    .split("\n")
    .map((line) => ({ kind: classifyDiffLine(line), text: line }));
}
