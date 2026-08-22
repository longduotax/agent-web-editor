import { open } from "node:fs/promises";
import { join } from "node:path";

// Ignore rules for the file listing (WSP-05 as revised by specification
// version 2).
//
// An ignore file is UNTRUSTED INPUT: arbitrary bytes in the user's working
// tree, written by the user, by a dependency, or by a generator, and read on
// a request path. It therefore gets the treatment every other boundary here
// gets (see docs/architecture/data-boundaries.md): a bounded read, a total
// parse into a value, and no partially-trusted intermediate. `parseIgnoreFile`
// cannot throw and cannot allocate more than its bounds allow, and the
// matcher it produces is a pure predicate over strings — it never touches the
// filesystem, so it cannot be made to follow a symlink or leave the root.
// Containment stays the job of `resolveContained` in files.ts, unchanged.
//
// **Every bound degrades towards showing MORE.** A user who cannot see a file
// is worse off than one who sees a file they meant to ignore, so a rule that
// does not fit a bound is dropped and the file it named stays visible. There
// is no path here that fails a listing, and none that hides more than a fully
// parsed file would have.
//
// Deliberately NOT here (both are decisions, not oversights, and both are
// recorded in the implementation plan): shelling out to `git check-ignore` —
// a process per listing on a hot path, and an answer only a Git project has —
// and the user's global `core.excludesFile`.

/** At most this many bytes of any one ignore file are read. */
export const IGNORE_MAX_FILE_BYTES = 256 * 1024;
/** A line longer than this in UTF-8 bytes is dropped, not truncated. */
export const IGNORE_MAX_LINE_BYTES = 1024;
/** At most this many patterns are kept from any one ignore file. */
export const IGNORE_MAX_PATTERNS = 4_000;

/**
 * One character of a path segment.
 *
 * Every token matches exactly one character except `any`, which is what lets
 * the matcher below be the classic linear wildcard walk rather than a regular
 * expression. That is deliberate: a pattern built from untrusted text and
 * compiled to a regex is a backtracking hazard (`a*a*a*a*b` against a long
 * name), and this input is exactly the kind an attacker or a careless
 * generator controls.
 */
type Token =
  | { kind: "literal"; value: string }
  | { kind: "any" } // `*` — any run of characters, never crossing a `/`
  | { kind: "one" } // `?` — exactly one character, never a `/`
  | { kind: "class"; negated: boolean; ranges: readonly [string, string][] };

/** One `/`-delimited piece of a pattern. */
type Segment = { kind: "globstar" } | { kind: "tokens"; tokens: Token[] };

export interface IgnorePattern {
  /** A `!` rule: a later match re-includes the path. */
  readonly negated: boolean;
  /** A trailing-slash rule: it addresses directories only. */
  readonly directoryOnly: boolean;
  readonly segments: readonly Segment[];
}

/**
 * The patterns of one ignore file, and the directory they are relative to.
 *
 * `base` is the workspace-relative path of the directory holding the ignore
 * file — `""` for the execution root. A layer says nothing about a path
 * outside its own base, which is what makes a nested `.gitignore` scoped to
 * its own subtree.
 */
export interface IgnoreLayer {
  readonly base: string;
  readonly patterns: readonly IgnorePattern[];
}

/** The ignore files read at the execution root, in increasing precedence. */
const ROOT_IGNORE_FILES = [join(".git", "info", "exclude"), ".gitignore"];

const DIRECTORY_IGNORE_FILE = ".gitignore";

export function parseIgnoreFile(text: string): IgnorePattern[] {
  const patterns: IgnorePattern[] = [];
  for (const rawLine of text.split("\n")) {
    if (patterns.length >= IGNORE_MAX_PATTERNS) break;
    // Bounded before anything else looks at it: a 1 MiB line is dropped
    // without ever being scanned character by character.
    if (Buffer.byteLength(rawLine, "utf8") > IGNORE_MAX_LINE_BYTES) continue;
    const pattern = parseIgnoreLine(rawLine);
    if (pattern !== null) patterns.push(pattern);
  }
  return patterns;
}

/** One line, or `null` for a line that is not a rule or cannot be honoured. */
function parseIgnoreLine(rawLine: string): IgnorePattern | null {
  // CRLF working trees are ordinary on this product's platforms.
  let line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  line = stripUnescapedTrailingSpaces(line);
  if (line === "") return null;
  if (line.startsWith("#")) return null;

  const negated = line.startsWith("!");
  if (negated) line = line.slice(1);
  if (line === "") return null;

  let directoryOnly = false;
  if (line.endsWith("/") && !isEscaped(line, line.length - 1)) {
    directoryOnly = true;
    line = line.slice(0, -1);
  }
  if (line === "") return null;

  // A leading slash anchors to the ignore file's own directory; so does any
  // other slash the pattern contains. Only a pattern with no slash at all
  // floats, matching a name at any depth.
  let anchored = false;
  if (line.startsWith("/")) {
    anchored = true;
    line = line.slice(1);
  }
  if (line === "") return null;
  if (line.includes("/")) anchored = true;

  const segments: Segment[] = [];
  for (const rawSegment of line.split("/")) {
    // "a//b" and a trailing "a/" (already handled above) have no meaning we
    // can represent, so the whole line is discarded rather than guessed at.
    if (rawSegment === "") return null;
    if (rawSegment === "**") {
      segments.push({ kind: "globstar" });
      continue;
    }
    const tokens = parseSegment(rawSegment);
    if (tokens === null) return null;
    segments.push({ kind: "tokens", tokens });
  }
  if (segments.length === 0) return null;

  // A trailing `**` means "everything inside", never the directory itself,
  // so it is spelled as "one more segment, then any number of further ones".
  if (segments[segments.length - 1]?.kind === "globstar") {
    segments.splice(segments.length - 1, 1, {
      kind: "tokens",
      tokens: [{ kind: "any" }],
    });
    segments.push({ kind: "globstar" });
  }
  // A floating pattern is the anchored one with "at any depth" in front.
  if (!anchored) segments.unshift({ kind: "globstar" });

  return { negated, directoryOnly, segments };
}

/**
 * Trailing whitespace is not part of a pattern unless it was escaped.
 *
 * Git's own rule, and it matters: `dist   ` in a hand-edited file is `dist`,
 * and treating the spaces as literal would silently stop the rule matching.
 */
function stripUnescapedTrailingSpaces(line: string): string {
  let end = line.length;
  while (end > 0) {
    const character = line[end - 1];
    if (character !== " " && character !== "\t") break;
    if (isEscaped(line, end - 1)) break;
    end -= 1;
  }
  return line.slice(0, end);
}

/** Whether the character at `index` is preceded by an odd run of backslashes. */
function isEscaped(line: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (line[cursor] !== "\\") break;
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/** One segment's tokens, or `null` if the segment cannot be represented. */
function parseSegment(segment: string): Token[] | null {
  const tokens: Token[] = [];
  const characters = Array.from(segment);
  let index = 0;
  while (index < characters.length) {
    const character = characters[index];
    if (character === undefined) break;
    if (character === "\\") {
      const escaped = characters[index + 1];
      // A trailing backslash escapes nothing; there is no honest reading.
      if (escaped === undefined) return null;
      tokens.push({ kind: "literal", value: escaped });
      index += 2;
      continue;
    }
    if (character === "*") {
      tokens.push({ kind: "any" });
      index += 1;
      continue;
    }
    if (character === "?") {
      tokens.push({ kind: "one" });
      index += 1;
      continue;
    }
    if (character === "[") {
      const parsed = parseClass(characters, index);
      // An unterminated class has no meaning; approximating it would hide a
      // file the user never asked to hide.
      if (parsed === null) return null;
      tokens.push(parsed.token);
      index = parsed.next;
      continue;
    }
    tokens.push({ kind: "literal", value: character });
    index += 1;
  }
  return tokens;
}

function parseClass(
  characters: readonly string[],
  start: number,
): { token: Token; next: number } | null {
  let index = start + 1;
  let negated = false;
  const first = characters[index];
  if (first === "!" || first === "^") {
    negated = true;
    index += 1;
  }
  const ranges: [string, string][] = [];
  // A `]` immediately after the opening bracket is a literal `]`, as in a
  // POSIX bracket expression.
  let firstMember = true;
  while (index < characters.length) {
    const character = characters[index];
    if (character === undefined) return null;
    if (character === "]" && !firstMember) {
      return { token: { kind: "class", negated, ranges }, next: index + 1 };
    }
    firstMember = false;
    let low = character;
    index += 1;
    if (low === "\\") {
      const escaped = characters[index];
      if (escaped === undefined) return null;
      low = escaped;
      index += 1;
    }
    if (characters[index] === "-" && characters[index + 1] !== "]") {
      const high = characters[index + 1];
      if (high === undefined) return null;
      ranges.push([low, high]);
      index += 2;
      continue;
    }
    ranges.push([low, low]);
  }
  return null;
}

/**
 * Whether these layers ignore this path.
 *
 * Layers are consulted in order, and the LAST pattern that matches decides —
 * so a later negation wins inside one file, and a nearer ignore file wins
 * over a further one, because the walk appends deeper layers as it descends.
 *
 * Pure: it reads no filesystem and holds no state. `relativePath` is already
 * normalized and already proven contained by `resolveContained`; the root
 * itself (`""`) is never ignored, because a listing of nothing is not a
 * degradation towards showing more.
 */
export function isIgnored(
  layers: readonly IgnoreLayer[],
  relativePath: string,
  isDirectory: boolean,
): boolean {
  if (relativePath === "") return false;
  let ignored = false;
  for (const layer of layers) {
    const scoped = relativeToBase(layer.base, relativePath);
    if (scoped === null) continue;
    for (const pattern of layer.patterns) {
      if (pattern.directoryOnly && !isDirectory) continue;
      if (matchesPattern(pattern, scoped)) ignored = !pattern.negated;
    }
  }
  return ignored;
}

/** The path as the layer sees it, or `null` if it is outside the layer. */
function relativeToBase(base: string, relativePath: string): string | null {
  if (base === "") return relativePath;
  if (!relativePath.startsWith(`${base}/`)) return null;
  return relativePath.slice(base.length + 1);
}

function matchesPattern(pattern: IgnorePattern, path: string): boolean {
  return matchSegments(pattern.segments, path.split("/"));
}

/**
 * Glob matching over path segments, with `**` as zero or more segments.
 *
 * The classic wildcard walk with one remembered backtrack point: linear in
 * the common case, O(pattern × path) in the worst, and constant in memory.
 * A recursive or regex formulation of the same grammar is exponential on
 * inputs an ignore file can trivially contain.
 */
function matchSegments(
  segments: readonly Segment[],
  path: readonly string[],
): boolean {
  let patternIndex = 0;
  let pathIndex = 0;
  let starPattern = -1;
  let starPath = -1;
  while (pathIndex < path.length) {
    const segment = segments[patternIndex];
    const name = path[pathIndex];
    if (segment?.kind === "globstar") {
      starPattern = patternIndex;
      starPath = pathIndex;
      patternIndex += 1;
      continue;
    }
    if (
      segment !== undefined &&
      name !== undefined &&
      matchTokens(segment.tokens, name)
    ) {
      patternIndex += 1;
      pathIndex += 1;
      continue;
    }
    if (starPattern === -1) return false;
    starPath += 1;
    patternIndex = starPattern + 1;
    pathIndex = starPath;
  }
  while (segments[patternIndex]?.kind === "globstar") patternIndex += 1;
  return patternIndex === segments.length;
}

/** The same walk one level down: tokens against the characters of a name. */
function matchTokens(tokens: readonly Token[], name: string): boolean {
  const characters = Array.from(name);
  let tokenIndex = 0;
  let characterIndex = 0;
  let starToken = -1;
  let starCharacter = -1;
  while (characterIndex < characters.length) {
    const token = tokens[tokenIndex];
    const character = characters[characterIndex];
    if (token?.kind === "any") {
      starToken = tokenIndex;
      starCharacter = characterIndex;
      tokenIndex += 1;
      continue;
    }
    if (
      token !== undefined &&
      character !== undefined &&
      matchToken(token, character)
    ) {
      tokenIndex += 1;
      characterIndex += 1;
      continue;
    }
    if (starToken === -1) return false;
    starCharacter += 1;
    tokenIndex = starToken + 1;
    characterIndex = starCharacter;
  }
  while (tokens[tokenIndex]?.kind === "any") tokenIndex += 1;
  return tokenIndex === tokens.length;
}

function matchToken(token: Token, character: string): boolean {
  switch (token.kind) {
    case "literal":
      return token.value === character;
    case "one":
      return true;
    case "any":
      // Handled by the caller's backtracking; never reached.
      return true;
    case "class": {
      const inside = token.ranges.some(
        ([low, high]) => character >= low && character <= high,
      );
      return token.negated ? !inside : inside;
    }
  }
}

/**
 * The layers that apply at the execution root.
 *
 * `.git/info/exclude` first and `.gitignore` second, so the tracked file the
 * user can see wins over the untracked one they may have forgotten.
 */
export async function loadRootIgnoreLayers(
  rootPath: string,
): Promise<IgnoreLayer[]> {
  const layers: IgnoreLayer[] = [];
  for (const relative of ROOT_IGNORE_FILES) {
    const patterns = await readIgnoreFile(join(rootPath, relative));
    if (patterns.length > 0) layers.push({ base: "", patterns });
  }
  return layers;
}

/** The `.gitignore` of one visited directory, or `null` if it has none. */
export async function loadDirectoryIgnoreLayer(
  absoluteDirectory: string,
  baseRelativePath: string,
): Promise<IgnoreLayer | null> {
  const patterns = await readIgnoreFile(
    join(absoluteDirectory, DIRECTORY_IGNORE_FILE),
  );
  if (patterns.length === 0) return null;
  return { base: baseRelativePath, patterns };
}

/**
 * A bounded, total read of one ignore file.
 *
 * At most `IGNORE_MAX_FILE_BYTES` are ever buffered — `readFile` on a 5 MiB
 * `.gitignore` is exactly the unbounded buffer this boundary exists to
 * refuse. When the file is longer than the bound the tail is simply not read,
 * and the partial final line is discarded rather than parsed: half a rule is
 * a rule nobody wrote, and honouring it could hide a file. Everything read
 * before the bound still applies, so the listing shows at most what a full
 * parse would have shown, and usually more.
 *
 * A missing, unreadable, or non-regular ignore file contributes no patterns
 * and never fails the listing.
 */
async function readIgnoreFile(absolutePath: string): Promise<IgnorePattern[]> {
  let handle;
  try {
    handle = await open(absolutePath, "r");
  } catch {
    return [];
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return [];
    const buffer = Buffer.alloc(IGNORE_MAX_FILE_BYTES);
    const result = await handle.read(buffer, 0, IGNORE_MAX_FILE_BYTES, 0);
    const bytes = buffer.subarray(0, result.bytesRead);
    // Not fatal: an ignore file with invalid UTF-8 still has readable lines,
    // and a replacement character only makes a pattern that matches nothing.
    let text = new TextDecoder("utf-8").decode(bytes);
    if (info.size > result.bytesRead) {
      const lastNewline = text.lastIndexOf("\n");
      text = lastNewline === -1 ? "" : text.slice(0, lastNewline);
    }
    return parseIgnoreFile(text);
  } catch {
    return [];
  } finally {
    await handle.close();
  }
}
