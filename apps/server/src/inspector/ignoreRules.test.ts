import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  IGNORE_MAX_FILE_BYTES,
  IGNORE_MAX_LINE_BYTES,
  IGNORE_MAX_PATTERNS,
  isIgnored,
  loadDirectoryIgnoreLayer,
  loadRootIgnoreLayers,
  parseIgnoreFile,
  type IgnoreLayer,
} from "./ignoreRules.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-ignore-"));
  roots.push(root);
  return root;
}

/** One root-based layer, the shape a walk holds while listing the root. */
function rootLayer(text: string): IgnoreLayer[] {
  return [{ base: "", patterns: parseIgnoreFile(text) }];
}

function ignores(text: string, path: string, isDirectory = false): boolean {
  return isIgnored(rootLayer(text), path, isDirectory);
}

describe("parseIgnoreFile", () => {
  it("drops blank lines, comments, and trailing whitespace", () => {
    const patterns = parseIgnoreFile(
      ["", "   ", "# a comment", "dist   "].join("\n"),
    );
    expect(patterns).toHaveLength(1);
    expect(ignores("dist   ", "dist", true)).toBe(true);
    // The trailing spaces were stripped, so the directory named with them is
    // NOT what the rule addresses.
    expect(ignores("dist   ", "dist   ", true)).toBe(false);
  });

  // Git's own rule: only a line whose FIRST character is `#` is a comment.
  // An indented one is a pattern, and pretending otherwise would drop a rule
  // the user wrote — the one direction a bound here may not degrade in.
  it("treats an indented # as a pattern, not a comment", () => {
    expect(parseIgnoreFile("  #notes")).toHaveLength(1);
  });

  it("keeps a trailing space that was escaped", () => {
    expect(ignores("dist\\ ", "dist ")).toBe(true);
    expect(ignores("dist\\ ", "dist")).toBe(false);
  });

  it("treats an escaped # or ! as a literal first character", () => {
    expect(ignores("\\#notes.md", "#notes.md")).toBe(true);
    expect(ignores("\\!urgent.md", "!urgent.md")).toBe(true);
    // Unescaped, the same two lines are a comment and a negation.
    expect(parseIgnoreFile("#notes.md")).toHaveLength(0);
    expect(parseIgnoreFile("!urgent.md")).toHaveLength(1);
  });

  it("accepts CRLF line endings", () => {
    const patterns = parseIgnoreFile("node_modules\r\nbuild\r\n");
    expect(patterns).toHaveLength(2);
    expect(isIgnored([{ base: "", patterns }], "node_modules", true)).toBe(
      true,
    );
    expect(isIgnored([{ base: "", patterns }], "build", true)).toBe(true);
  });

  it("discards a line it cannot represent rather than approximating it", () => {
    // An unterminated character class has no meaning we can honour, and
    // guessing one would hide a file the user never asked to hide.
    expect(parseIgnoreFile("src/[abc")).toHaveLength(0);
    // An empty path segment is not a pattern.
    expect(parseIgnoreFile("src//main.ts")).toHaveLength(0);
    expect(parseIgnoreFile("/")).toHaveLength(0);
    expect(parseIgnoreFile("!")).toHaveLength(0);
  });
});

describe("pattern forms", () => {
  it("matches a bare name at any depth", () => {
    expect(ignores("node_modules", "node_modules", true)).toBe(true);
    expect(ignores("node_modules", "frontend/node_modules", true)).toBe(true);
    expect(ignores("*.log", "server/logs/error.log")).toBe(true);
    expect(ignores("*.log", "server/logs/error.txt")).toBe(false);
  });

  it("anchors a pattern that starts with a slash", () => {
    expect(ignores("/build", "build", true)).toBe(true);
    expect(ignores("/build", "apps/build", true)).toBe(false);
  });

  it("anchors a pattern that contains a slash", () => {
    expect(ignores("apps/build", "apps/build", true)).toBe(true);
    expect(ignores("apps/build", "web/apps/build", true)).toBe(false);
  });

  it("honours a trailing slash as directory-only", () => {
    expect(ignores("build/", "build", true)).toBe(true);
    expect(ignores("build/", "build", false)).toBe(false);
    expect(ignores("build", "build", false)).toBe(true);
  });

  it("keeps * and ? inside one path segment", () => {
    expect(ignores("src/*.ts", "src/main.ts")).toBe(true);
    expect(ignores("src/*.ts", "src/deep/main.ts")).toBe(false);
    expect(ignores("file?.txt", "file1.txt")).toBe(true);
    expect(ignores("file?.txt", "file10.txt")).toBe(false);
  });

  it("spans directories with **", () => {
    expect(ignores("src/**/generated", "src/generated", true)).toBe(true);
    expect(ignores("src/**/generated", "src/a/b/generated", true)).toBe(true);
    expect(ignores("logs/**", "logs/a/b.txt")).toBe(true);
    expect(ignores("logs/**", "logs", true)).toBe(false);
    expect(ignores("**/temp", "a/b/temp", true)).toBe(true);
  });

  it("matches a character class and its negation", () => {
    expect(ignores("file[0-9].txt", "file7.txt")).toBe(true);
    expect(ignores("file[0-9].txt", "filex.txt")).toBe(false);
    expect(ignores("file[!0-9].txt", "filex.txt")).toBe(true);
    expect(ignores("file[!0-9].txt", "file7.txt")).toBe(false);
  });

  it("treats an escaped wildcard as a literal", () => {
    expect(ignores("star\\*.txt", "star*.txt")).toBe(true);
    expect(ignores("star\\*.txt", "starry.txt")).toBe(false);
  });
});

describe("negation and precedence", () => {
  it("lets a later negation win inside one file", () => {
    const text = ["*.log", "!keep.log"].join("\n");
    expect(ignores(text, "keep.log")).toBe(false);
    expect(ignores(text, "drop.log")).toBe(true);
  });

  it("lets a later rule re-ignore what an earlier one re-included", () => {
    const text = ["*.log", "!keep.log", "keep.log"].join("\n");
    expect(ignores(text, "keep.log")).toBe(true);
  });

  it("lets a nearer ignore file win over the root one", () => {
    const layers: IgnoreLayer[] = [
      { base: "", patterns: parseIgnoreFile("*.log") },
      { base: "apps", patterns: parseIgnoreFile("!server.log") },
    ];
    expect(isIgnored(layers, "apps/server.log", false)).toBe(false);
    expect(isIgnored(layers, "apps/other.log", false)).toBe(true);
  });

  it("applies a nested layer only under its own directory", () => {
    const layers: IgnoreLayer[] = [
      { base: "apps", patterns: parseIgnoreFile("secret.txt") },
    ];
    expect(isIgnored(layers, "apps/secret.txt", false)).toBe(true);
    expect(isIgnored(layers, "other/secret.txt", false)).toBe(false);
  });

  it("resolves a nested pattern relative to its own directory", () => {
    const layers: IgnoreLayer[] = [
      { base: "apps/web", patterns: parseIgnoreFile("/dist") },
    ];
    expect(isIgnored(layers, "apps/web/dist", true)).toBe(true);
    expect(isIgnored(layers, "apps/web/src/dist", true)).toBe(false);
  });
});

describe("bounds — every one degrades to showing MORE", () => {
  it("drops a line longer than the line bound and keeps the rest", () => {
    const long = `${"a".repeat(IGNORE_MAX_LINE_BYTES)}.txt`;
    const patterns = parseIgnoreFile([long, "kept.txt"].join("\n"));
    expect(patterns).toHaveLength(1);
    // The over-long rule hides nothing: the file it named is still listed.
    expect(isIgnored([{ base: "", patterns }], long, false)).toBe(false);
    expect(isIgnored([{ base: "", patterns }], "kept.txt", false)).toBe(true);
  });

  it("keeps a line exactly at the line bound", () => {
    const exact = "a".repeat(IGNORE_MAX_LINE_BYTES);
    expect(parseIgnoreFile(exact)).toHaveLength(1);
  });

  it("measures the line bound in bytes, not code units", () => {
    // Two bytes per character, so half the bound in characters is the limit.
    const wide = "é".repeat(IGNORE_MAX_LINE_BYTES / 2 + 1);
    expect(parseIgnoreFile(wide)).toHaveLength(0);
  });

  it("stops at the pattern bound and keeps everything before it", () => {
    const lines = Array.from(
      { length: IGNORE_MAX_PATTERNS + 500 },
      (_, index) => `p${String(index)}.txt`,
    );
    const patterns = parseIgnoreFile(lines.join("\n"));
    expect(patterns).toHaveLength(IGNORE_MAX_PATTERNS);
    expect(isIgnored([{ base: "", patterns }], "p0.txt", false)).toBe(true);
    // Everything past the bound is simply not a rule, so those files show.
    expect(
      isIgnored(
        [{ base: "", patterns }],
        `p${String(IGNORE_MAX_PATTERNS + 1)}.txt`,
        false,
      ),
    ).toBe(false);
  });

  it("parses a 100,000-line file totally and within the pattern bound", () => {
    const text = Array.from(
      { length: 100_000 },
      (_, index) => `line-${String(index)}.tmp`,
    ).join("\n");
    const patterns = parseIgnoreFile(text);
    expect(patterns).toHaveLength(IGNORE_MAX_PATTERNS);
  });

  it("parses a 1 MiB single line without keeping it", () => {
    const patterns = parseIgnoreFile("x".repeat(1024 * 1024));
    expect(patterns).toHaveLength(0);
  });
});

describe("the matcher does not backtrack exponentially", () => {
  // The shape that hangs a regex-compiled glob: many stars, and a name that
  // matches every prefix but fails at the end. The linear walk answers in
  // O(pattern x name) steps and constant memory.
  it("answers a pathological pattern in bounded time", () => {
    const pattern = `${"*a".repeat(200)}b`;
    const name = `${"a".repeat(600)}c`;
    const start = performance.now();
    expect(ignores(pattern, name)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it("answers a deep globstar pattern in bounded time", () => {
    const pattern = Array.from({ length: 120 }, () => "**/a").join("/");
    const path = Array.from({ length: 200 }, () => "a").join("/");
    const start = performance.now();
    expect(ignores(pattern, `${path}/b`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

describe("loading ignore files from a working tree", () => {
  it("reads the root .gitignore and .git/info/exclude, root file last", async () => {
    const root = await tempRoot();
    await mkdir(join(root, ".git", "info"), { recursive: true });
    await writeFile(join(root, ".git", "info", "exclude"), "scratch\n");
    await writeFile(join(root, ".gitignore"), "node_modules\n!scratch\n");

    const layers = await loadRootIgnoreLayers(root);
    expect(layers).toHaveLength(2);
    expect(isIgnored(layers, "node_modules", true)).toBe(true);
    // The root .gitignore is consulted after the exclude file, so its
    // negation re-includes what the exclude file dropped.
    expect(isIgnored(layers, "scratch", true)).toBe(false);
  });

  it("contributes nothing when no ignore file exists", async () => {
    const root = await tempRoot();
    expect(await loadRootIgnoreLayers(root)).toEqual([]);
    expect(await loadDirectoryIgnoreLayer(root, "")).toBeNull();
  });

  it("contributes nothing when the ignore file is a directory", async () => {
    const root = await tempRoot();
    await mkdir(join(root, ".gitignore"));
    expect(await loadRootIgnoreLayers(root)).toEqual([]);
  });

  it("contributes nothing when the ignore file cannot be read", async () => {
    const root = await tempRoot();
    await writeFile(join(root, ".gitignore"), "node_modules\n", {
      mode: 0o000,
    });
    const layers = await loadRootIgnoreLayers(root);
    // Root can read a 0o000 file, so accept either outcome; what must hold
    // is that the load neither throws nor invents a pattern.
    expect(layers.length).toBeLessThanOrEqual(1);
  });

  it("reads only the first 256 KiB of an oversized ignore file", async () => {
    const root = await tempRoot();
    const filler = Array.from(
      { length: 20_000 },
      (_, index) => `early-${String(index)}.tmp`,
    ).join("\n");
    // 5 MiB, with a rule past the byte bound that must NOT take effect.
    await writeFile(
      join(root, ".gitignore"),
      `${filler}\n${"# padding padding padding padding padding\n".repeat(120_000)}late.tmp\n`,
    );

    const layers = await loadRootIgnoreLayers(root);
    expect(layers).toHaveLength(1);
    expect(isIgnored(layers, "early-0.tmp", false)).toBe(true);
    // Past the bound the file is not read at all, so it shows MORE.
    expect(isIgnored(layers, "late.tmp", false)).toBe(false);
  });

  it("never keeps a rule split in half by the byte bound", async () => {
    const root = await tempRoot();
    // One line straddles the bound: its first half must not become a rule.
    const head = "a".repeat(IGNORE_MAX_FILE_BYTES - 4);
    await writeFile(join(root, ".gitignore"), `${head}\nsplitrule.tmp`);
    const layers = await loadRootIgnoreLayers(root);
    expect(isIgnored(layers, "spl", false)).toBe(false);
    expect(isIgnored(layers, "splitrule.tmp", false)).toBe(false);
  });

  it("loads a nested directory's own .gitignore under its own base", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "apps"));
    await writeFile(join(root, "apps", ".gitignore"), "dist\n");

    const layer = await loadDirectoryIgnoreLayer(join(root, "apps"), "apps");
    expect(layer).not.toBeNull();
    expect(layer === null ? [] : [layer]).toHaveLength(1);
    expect(isIgnored(layer === null ? [] : [layer], "apps/dist", true)).toBe(
      true,
    );
  });
});

describe("the matcher is pure", () => {
  it("never touches the filesystem, so it cannot follow a symlink", () => {
    // A pattern naming an absolute path is not a relative path at all; the
    // matcher answers about the string it was handed and nothing else.
    const layers = rootLayer("etc/passwd");
    expect(isIgnored(layers, "/etc/passwd", false)).toBe(false);
    expect(isIgnored(layers, "etc/passwd", false)).toBe(true);
  });

  it("answers false for a path outside every layer's base", () => {
    const layers: IgnoreLayer[] = [
      { base: "apps", patterns: parseIgnoreFile("*") },
    ];
    expect(isIgnored(layers, "docs/readme.md", false)).toBe(false);
    expect(isIgnored(layers, "", true)).toBe(false);
  });
});
