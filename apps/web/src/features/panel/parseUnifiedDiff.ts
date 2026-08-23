// One section of `git diff` output, read into the structure WSP-06 asks the
// Diff tab to render: labelled hunks, per-line old-side and new-side numbers,
// and the `+`/`-` prefix left in the text where it belongs.
//
// It is a pure function over a string, with no DOM and no React, because
// almost everything that can go wrong with a diff is a parsing question:
// where a file header stops and a hunk starts, what a `\` line means, what a
// line number is on a side the line does not exist on. Those are answered
// here, once, and asserted in `parseUnifiedDiff.test.ts` against fixtures
// captured from real `git diff` output.
//
// Nothing here throws. A diff this parser cannot understand degrades to its
// own raw text with a reason attached, because Git is entitled to emit
// shapes this application has not met — and showing what Git actually said
// is more useful than an error page about it.

/** Which of the two diffs the server returns a section came from. */
export type DiffSection = "staged" | "unstaged";

export type DiffLineKind =
  | "context"
  | "add"
  | "delete"
  /**
   * A line that belongs to no side of the file: in practice Git's
   * `\ No newline at end of file`, written under the line it qualifies.
   * It takes no number, because numbering it would push every line below it
   * out by one on a file that has one fewer line than the diff appears to
   * show.
   */
  | "note";

export interface DiffLine {
  kind: DiffLineKind;
  /** The line's number in the old file, or null where it has none. */
  old: number | null;
  /** The line's number in the new file, or null where it has none. */
  new: number | null;
  /** The line as Git wrote it, prefix character included, newline excluded. */
  text: string;
}

export interface DiffHunk {
  /** Stable across a refetch of the same change; see `hunkIdentity`. */
  id: string;
  /** The `@@ … @@` line as written, including any trailing section heading. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  added: number;
  deleted: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  section: DiffSection;
  hunks: DiffHunk[];
  /**
   * The file-level lines worth reading — a rename, a new or deleted file, a
   * mode change. `diff --git`, `index`, `---` and `+++` are plumbing and are
   * dropped: they restate the path the header already carries.
   */
  notes: string[];
  /** Added and deleted lines in the WHOLE section, not the painted portion. */
  added: number;
  deleted: number;
  /** Git reported the file as binary, so there is no text diff to show. */
  binary: boolean;
  /**
   * Why this section must be shown as raw text, or null when it was read.
   *
   * `combined` is a merge's `@@@` diff, in which "the old side" is not one
   * file and a two-gutter rendering would be a confident lie. `malformed` is
   * anything else this parser cannot account for.
   */
  raw: "combined" | "malformed" | null;
  /** The section exactly as it arrived; what a raw rendering paints. */
  text: string;
  /** Body lines the section has, of which `shownLines` were materialized. */
  totalLines: number;
  shownLines: number;
  /** Whether the render budget stopped this section short of its end. */
  cut: boolean;
  /** Whether the character bound, rather than the line bound, made the cut. */
  byCharacters: boolean;
  /** The largest line number either gutter will draw, for its width. */
  widestNumber: number;
}

/**
 * How many diff lines one section paints.
 *
 * WSP-09's render budget, and half of the File tab's 2,000-line one, because
 * a Diff tab paints two of these: a tab showing a staged and an unstaged
 * change stays within the same total work as a file preview.
 */
export const DIFF_LINE_LIMIT = 1000;

/**
 * How many characters one section paints.
 *
 * Lines are a proxy for size, and the File tab's J5 finding — a minified
 * bundle whose 2 MiB were 293 lines, so a 2,000-line budget never engaged —
 * applies to a diff of that same bundle exactly as it did to the file. Half
 * of `FILE_PREVIEW_CHARACTER_LIMIT`, for the same reason as the line bound.
 */
export const DIFF_CHARACTER_LIMIT = 256 * 1024;

/** `@@ -oldStart,oldLines +newStart,newLines @@ optional heading` */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * File-level lines a reader learns something from, and would otherwise only
 * see by reading the raw diff.
 */
const NOTE_PREFIXES = [
  "new file mode",
  "deleted file mode",
  "old mode",
  "new mode",
  "rename from",
  "rename to",
  "copy from",
  "copy to",
];

/** File-level lines that carry nothing the rendering does not already say. */
const PLUMBING_PREFIXES = [
  "diff --git",
  "diff --no-index",
  "index ",
  "similarity index",
  "dissimilarity index",
  "--- ",
  "+++ ",
  "old file mode",
];

const BINARY_PREFIXES = ["Binary files ", "GIT binary patch"];

function startsWithAny(line: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => line.startsWith(prefix));
}

/**
 * The section's lines, without the empty string a trailing newline leaves.
 *
 * `"a\nb\n".split("\n")` ends in `""`, and treating that as a line would
 * paint a phantom context line at the end of every diff Git ever writes.
 * A `\r` is left alone: it is a character of a CRLF file, not a separator.
 */
function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * A 32-bit FNV-1a digest, in hex.
 *
 * Local and tiny on purpose: this is an identity for a device-local
 * preference, not a security claim, and a dependency for eight lines of
 * arithmetic would be the larger cost.
 */
function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    // The FNV prime, as the shifts that survive 32-bit integer arithmetic.
    hash =
      (hash +
        (hash << 1) +
        (hash << 4) +
        (hash << 7) +
        (hash << 8) +
        (hash << 24)) >>>
      0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * What a collapsed hunk is remembered by (WSP-04, WSP-06).
 *
 * Not its index: a hunk added above shifts every index below it, so every
 * collapse would move down one hunk the moment the file is edited. Not its
 * header either, for the same reason in different clothes — `@@ -12,7 +12,9 @@`
 * changes whenever anything above it changes size, so a collapse would be
 * lost on an edit that did not touch the hunk at all.
 *
 * It is the hunk's own CHANGED lines, digested, plus its ordinal among
 * identical ones in the same section. That is stable across a refetch of the
 * same content and across an edit somewhere else in the file, and it changes
 * when the hunk's own change changes — which is the case where re-expanding
 * is the honest default, because what the user collapsed is no longer what
 * is there. The context lines are deliberately excluded: two hunks close
 * enough for Git to merge them read as one hunk with more context, and a
 * collapse should survive that.
 *
 * The ordinal is the one churn this identity keeps: three identical hunks
 * with the first deleted renumber the other two. That is rare, and the
 * alternative — including the surrounding lines — churns on the common case
 * instead of the rare one.
 */
function hunkIdentity(
  section: DiffSection,
  changeDigest: string,
  ordinal: number,
): string {
  return `${section}:${changeDigest}:${String(ordinal)}`;
}

/** A hunk under construction, before the budget decides what is kept. */
interface PendingHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  changed: string[];
  added: number;
  deleted: number;
}

function emptyDiff(section: DiffSection, text: string): ParsedDiff {
  return {
    section,
    hunks: [],
    notes: [],
    added: 0,
    deleted: 0,
    binary: false,
    raw: null,
    text,
    totalLines: 0,
    shownLines: 0,
    cut: false,
    byCharacters: false,
    widestNumber: 0,
  };
}

/**
 * Reads one `git diff` section into hunks, bounded.
 *
 * The bound is applied to what is MATERIALIZED, not to what is read: the
 * walk continues to the end of the text so the added and deleted counts are
 * the whole section's, while the lines held in memory and painted stay
 * within the budget. Counting the painted portion and calling it the total
 * is precisely the defect J7 fixed on the File tab.
 */
export function parseUnifiedDiff(
  text: string,
  section: DiffSection,
  budget: { lines: number; characters: number } = {
    lines: DIFF_LINE_LIMIT,
    characters: DIFF_CHARACTER_LIMIT,
  },
): ParsedDiff {
  if (text === "") return emptyDiff(section, text);
  const result = emptyDiff(section, text);
  const lines = splitLines(text);

  // A merge's combined diff is refused whole rather than line by line: its
  // `@@@` header and two prefix columns describe two old sides, and there is
  // no honest way to draw that in one old gutter.
  if (
    lines.some(
      (line) =>
        line.startsWith("@@@") ||
        line.startsWith("diff --cc ") ||
        line.startsWith("diff --combined "),
    )
  ) {
    return { ...result, raw: "combined" };
  }

  const hunks: PendingHunk[] = [];
  const ordinals = new Map<string, number>();
  let hunk: PendingHunk | null = null;
  let oldNumber = 0;
  let newNumber = 0;
  let characters = 0;
  let painting = true;

  const close = () => {
    if (hunk === null) return;
    if (hunk.lines.length > 0) hunks.push(hunk);
    hunk = null;
  };

  /** Whether this line still fits, and the recording of it if it does. */
  const take = (line: DiffLine): boolean => {
    if (!painting) return false;
    if (result.shownLines >= budget.lines) {
      painting = false;
      result.cut = true;
      return false;
    }
    if (characters + line.text.length > budget.characters) {
      painting = false;
      result.cut = true;
      result.byCharacters = true;
      return false;
    }
    characters += line.text.length;
    result.shownLines += 1;
    if (line.old !== null)
      result.widestNumber = Math.max(result.widestNumber, line.old);
    if (line.new !== null)
      result.widestNumber = Math.max(result.widestNumber, line.new);
    return true;
  };

  const fileLevel = (line: string): boolean => {
    if (startsWithAny(line, BINARY_PREFIXES)) {
      result.binary = true;
      return true;
    }
    if (startsWithAny(line, NOTE_PREFIXES)) {
      result.notes.push(line);
      return true;
    }
    return startsWithAny(line, PLUMBING_PREFIXES);
  };

  for (const line of lines) {
    if (line.startsWith("@@")) {
      close();
      const match = HUNK_HEADER.exec(line);
      if (match === null) return { ...result, raw: "malformed" };
      oldNumber = Number(match[1]);
      newNumber = Number(match[3]);
      hunk = {
        header: line,
        oldStart: oldNumber,
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: newNumber,
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
        changed: [],
        added: 0,
        deleted: 0,
      };
      continue;
    }
    if (hunk === null) {
      // Between files, or before the first hunk. Anything that is not a
      // file-level line here is not a diff this parser can account for.
      if (!fileLevel(line)) return { ...result, raw: "malformed" };
      continue;
    }
    const prefix = line[0] ?? " ";
    if (prefix === "\\") {
      // Git's `\ No newline at end of file`, which belongs to the line above
      // it and to neither file's numbering.
      result.totalLines += 1;
      if (take({ kind: "note", old: null, new: null, text: line }))
        hunk.lines.push({ kind: "note", old: null, new: null, text: line });
      continue;
    }
    if (prefix === "+") {
      result.totalLines += 1;
      result.added += 1;
      hunk.added += 1;
      hunk.changed.push(line);
      const entry: DiffLine = {
        kind: "add",
        old: null,
        new: newNumber,
        text: line,
      };
      newNumber += 1;
      if (take(entry)) hunk.lines.push(entry);
      continue;
    }
    if (prefix === "-") {
      result.totalLines += 1;
      result.deleted += 1;
      hunk.deleted += 1;
      hunk.changed.push(line);
      const entry: DiffLine = {
        kind: "delete",
        old: oldNumber,
        new: null,
        text: line,
      };
      oldNumber += 1;
      if (take(entry)) hunk.lines.push(entry);
      continue;
    }
    if (prefix === " " || line === "") {
      result.totalLines += 1;
      const entry: DiffLine = {
        kind: "context",
        old: oldNumber,
        new: newNumber,
        text: line,
      };
      oldNumber += 1;
      newNumber += 1;
      if (take(entry)) hunk.lines.push(entry);
      continue;
    }
    // Not a body line at all: either the next file's header, which ends this
    // hunk, or something this parser has no account of.
    close();
    if (!fileLevel(line)) return { ...result, raw: "malformed" };
  }
  close();

  result.hunks = hunks.map((pending) => {
    const key = digest(pending.changed.join("\n"));
    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);
    return {
      id: hunkIdentity(section, key, ordinal),
      header: pending.header,
      oldStart: pending.oldStart,
      oldLines: pending.oldLines,
      newStart: pending.newStart,
      newLines: pending.newLines,
      added: pending.added,
      deleted: pending.deleted,
      lines: pending.lines,
    };
  });
  return result;
}
