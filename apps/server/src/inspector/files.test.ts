import { execFile } from "node:child_process";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";

import {
  listProjectFiles,
  previewProjectFile,
  resolveContained,
} from "./files.js";
import { clearTrackedPathCache } from "./trackedFiles.js";

const exec = promisify(execFile);

beforeEach(() => {
  // Each fixture is a fresh temporary directory, so a cache entry from the
  // previous test can only be a false positive waiting to happen.
  clearTrackedPathCache();
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-files-"));
  roots.push(root);
  await mkdir(join(root, "src"));
  await mkdir(join(root, ".git"));
  await writeFile(
    join(root, "src", "hello.ts"),
    "export const hello = 'world';\n",
  );
  await writeFile(join(root, ".git", "secret"), "hidden");
  return root;
}

describe("project file boundary", () => {
  it("lists bounded project-relative entries and excludes .git", async () => {
    const root = await fixture();
    const tree = await listProjectFiles(root);
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      "src",
      "src/hello.ts",
    ]);
    expect(JSON.stringify(tree)).not.toContain(root);
  });

  it("previews UTF-8 files without exposing an absolute path", async () => {
    const root = await fixture();
    const preview = await previewProjectFile(root, "src/hello.ts");
    expect(preview.path).toBe("src/hello.ts");
    expect(preview.content).toContain("hello");
    expect(preview.binary).toBe(false);
  });

  it("rejects traversal and symlinks outside the project", async () => {
    const root = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "pi-web-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret"), "secret");
    await symlink(join(outside, "secret"), join(root, "escape"));
    await expect(resolveContained(root, "escape")).rejects.toThrow(
      "path_escape",
    );
    await expect(resolveContained(root, "../secret")).rejects.toThrow();
  });
});

/**
 * A working tree shaped like the one that produced the finding: a project
 * README beside a dependency directory full of them.
 */
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-tree-"));
  roots.push(root);
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "node_modules", "@babel"), { recursive: true });
  await mkdir(join(root, "src", "nested"), { recursive: true });
  await mkdir(join(root, "Docs"));
  await writeFile(join(root, ".gitignore"), "node_modules\n*.log\n");
  await writeFile(join(root, "README.md"), "# The project\n");
  await writeFile(join(root, "build.log"), "noise\n");
  await writeFile(join(root, "node_modules", "@babel", "README.md"), "dep\n");
  await writeFile(join(root, "src", "main.ts"), "export const a = 1;\n");
  await writeFile(
    join(root, "src", "nested", "deep.ts"),
    "export const b = 2;",
  );
  await writeFile(join(root, ".git", "secret"), "hidden");
  return root;
}

describe("directory-scoped listing", () => {
  it("lists one level when depth is 1", async () => {
    const root = await repository();
    const tree = await listProjectFiles(root, { depth: "1" });
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      "Docs",
      "src",
      ".gitignore",
      "README.md",
    ]);
  });

  it("orders directories first, then files, each case-insensitively", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-order-"));
    roots.push(root);
    await mkdir(join(root, "zeta"));
    await mkdir(join(root, "Alpha"));
    await writeFile(join(root, "beta.txt"), "");
    await writeFile(join(root, "Apple.txt"), "");

    const tree = await listProjectFiles(root, { depth: "1" });
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      "Alpha",
      "zeta",
      "Apple.txt",
      "beta.txt",
    ]);
  });

  it("keeps entry paths relative to the execution root, not the listed directory", async () => {
    const root = await repository();
    const tree = await listProjectFiles(root, { depth: "1", path: "src" });
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      "src/nested",
      "src/main.ts",
    ]);
    expect(tree.entries.map((entry) => entry.name)).toEqual([
      "nested",
      "main.ts",
    ]);
  });

  it("still returns the whole subtree by default", async () => {
    const root = await repository();
    const tree = await listProjectFiles(root);
    expect(tree.entries.map((entry) => entry.path)).toContain(
      "src/nested/deep.ts",
    );
  });

  it("refuses a listing path that escapes the root", async () => {
    const root = await repository();
    await expect(
      listProjectFiles(root, { depth: "1", path: "../elsewhere" }),
    ).rejects.toThrow();
  });

  it("does not follow a symlinked directory", async () => {
    const root = await repository();
    const outside = await mkdtemp(join(tmpdir(), "pi-web-outside-"));
    roots.push(outside);
    await mkdir(join(outside, "private"));
    await writeFile(join(outside, "private", "secret.txt"), "secret");
    await symlink(join(outside, "private"), join(root, "linked"));

    const tree = await listProjectFiles(root);
    // The link itself is displayable; what is behind it is not walked.
    expect(tree.entries.map((entry) => entry.path)).toContain("linked");
    expect(tree.entries.map((entry) => entry.path)).not.toContain(
      "linked/secret.txt",
    );
  });
});

describe("ignore rules in the listing and the search", () => {
  it("hides ignored paths from the listing and says it did", async () => {
    const root = await repository();
    const tree = await listProjectFiles(root, { depth: "1" });
    const paths = tree.entries.map((entry) => entry.path);
    expect(paths).not.toContain("node_modules");
    expect(paths).not.toContain("build.log");
    expect(tree.ignoredHidden).toBe(true);
  });

  // The finding this milestone exists for: `README.md` returned 200 rows,
  // every one of them a dependency's copy.
  it("returns the project's own README rather than a dependency's", async () => {
    const root = await repository();
    const tree = await listProjectFiles(root, { search: "README.md" });
    expect(tree.entries.map((entry) => entry.path)).toEqual(["README.md"]);
  });

  it("reveals ignored paths only when asked, and says nothing is hidden then", async () => {
    const root = await repository();
    const tree = await listProjectFiles(root, {
      depth: "1",
      showIgnored: true,
    });
    expect(tree.entries.map((entry) => entry.path)).toContain("node_modules");
    expect(tree.ignoredHidden).toBe(false);
  });

  it("keeps .git out of both modes", async () => {
    const root = await repository();
    for (const showIgnored of [false, true]) {
      const tree = await listProjectFiles(root, { showIgnored });
      expect(tree.entries.map((entry) => entry.path)).not.toContain(".git");
      expect(tree.entries.some((entry) => entry.path.startsWith(".git/"))).toBe(
        false,
      );
    }
  });

  it("reports nothing hidden when no rule matched", async () => {
    const root = await fixture();
    const tree = await listProjectFiles(root);
    expect(tree.ignoredHidden).toBe(false);
  });

  it("honours a nested .gitignore under its own directory", async () => {
    const root = await repository();
    await writeFile(join(root, "src", ".gitignore"), "nested\n");
    const tree = await listProjectFiles(root, { depth: "1", path: "src" });
    expect(tree.entries.map((entry) => entry.path)).not.toContain("src/nested");
    expect(tree.ignoredHidden).toBe(true);
  });

  it("applies an ancestor's rules when listing a directory directly", async () => {
    const root = await repository();
    await writeFile(join(root, "src", ".gitignore"), "*.ts\n");
    const tree = await listProjectFiles(root, {
      depth: "1",
      path: "src/nested",
    });
    expect(tree.entries).toEqual([]);
    expect(tree.ignoredHidden).toBe(true);
  });

  it("keeps hiding an ignored path in a project that is not a Git repository", async () => {
    const root = await repository();
    const tree = await listProjectFiles(root, { depth: "1" });
    expect(tree.entries.map((entry) => entry.path)).not.toContain("build.log");
    expect(tree.ignoredHidden).toBe(true);
  });

  it("never fails a listing because an ignore file is unreadable", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-badignore-"));
    roots.push(root);
    await mkdir(join(root, ".gitignore"));
    await writeFile(join(root, "kept.txt"), "");
    const tree = await listProjectFiles(root, { depth: "1" });
    expect(tree.entries.map((entry) => entry.path)).toContain("kept.txt");
    expect(tree.ignoredHidden).toBe(false);
  });
});

/**
 * A real working tree, with a real index, shaped like the one that produced
 * the finding: a file that an ignore rule matches and that Git nonetheless
 * tracks, because it was committed before the rule existed or in spite of it.
 *
 * `backend/cert.pem` is the measured case — `backend/.gitignore` says
 * `*.pem`, and `git ls-files --error-unmatch backend/cert.pem` succeeds.
 * Git never ignores a tracked file; a pure pattern matcher always does.
 */
async function trackedRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-tracked-"));
  roots.push(root);
  await mkdir(join(root, "backend"));
  await mkdir(join(root, "node_modules", "dep"), { recursive: true });
  await mkdir(join(root, "dist"));
  await writeFile(join(root, ".gitignore"), "node_modules\ndist\n");
  await writeFile(join(root, "backend", ".gitignore"), "*.pem\n");
  await writeFile(join(root, "backend", "cert.pem"), "certificate\n");
  await writeFile(join(root, "backend", "key.pem"), "key\n");
  await writeFile(join(root, "backend", "scratch.pem"), "never committed\n");
  await writeFile(join(root, "backend", "server.ts"), "export const a = 1;\n");
  await writeFile(join(root, "node_modules", "dep", "index.js"), "module\n");
  await writeFile(join(root, "dist", "keep.js"), "committed anyway\n");
  await writeFile(join(root, "dist", "stale.js"), "never committed\n");
  await exec("git", ["init", "-q", "-b", "main"], { cwd: root });
  await exec(
    "git",
    [
      "add",
      "--force",
      ".gitignore",
      "backend/.gitignore",
      "backend/cert.pem",
      "backend/key.pem",
      "backend/server.ts",
      "dist/keep.js",
    ],
    { cwd: root },
  );
  return root;
}

describe("a tracked file is never ignored", () => {
  it("lists a tracked file that an ignore rule matches", async () => {
    const root = await trackedRepository();
    const tree = await listProjectFiles(root, { depth: "1", path: "backend" });
    const paths = tree.entries.map((entry) => entry.path);
    expect(paths).toContain("backend/cert.pem");
    expect(paths).toContain("backend/key.pem");
    // The rule still holds for everything the index does not know about.
    expect(paths).not.toContain("backend/scratch.pem");
    expect(tree.ignoredHidden).toBe(true);
  });

  it("finds a tracked ignored file by search, which is where it was missed", async () => {
    const root = await trackedRepository();
    const tree = await listProjectFiles(root, { search: "cert.pem" });
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      "backend/cert.pem",
    ]);
  });

  it("shows only the tracked children of an ignored directory", async () => {
    const root = await trackedRepository();
    const tree = await listProjectFiles(root, { depth: "1" });
    // `dist` is ignored and holds a tracked file, so Git shows the directory
    // and that one file — and nothing else in it, because a path under an
    // excluded directory cannot be re-included.
    expect(tree.entries.map((entry) => entry.path)).toContain("dist");
    const inside = await listProjectFiles(root, { depth: "1", path: "dist" });
    expect(inside.entries.map((entry) => entry.path)).toEqual(["dist/keep.js"]);
    expect(inside.ignoredHidden).toBe(true);
  });

  it("still hides an ignored directory that holds nothing tracked", async () => {
    const root = await trackedRepository();
    const tree = await listProjectFiles(root, { depth: "1" });
    expect(tree.entries.map((entry) => entry.path)).not.toContain(
      "node_modules",
    );
    expect(tree.ignoredHidden).toBe(true);
  });

  it("counts what Git counts: the listing and `git ls-files` agree", async () => {
    const root = await trackedRepository();
    const tree = await listProjectFiles(root);
    const listed = new Set(
      tree.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.path),
    );
    const tracked = (
      await exec("git", ["ls-files"], { cwd: root })
    ).stdout.split("\n");
    for (const path of tracked) {
      if (path === "") continue;
      expect(listed.has(path)).toBe(true);
    }
  });

  it("reveals everything under the explicit opt-in, tracked or not", async () => {
    const root = await trackedRepository();
    const tree = await listProjectFiles(root, {
      depth: "1",
      path: "backend",
      showIgnored: true,
    });
    expect(tree.entries.map((entry) => entry.path)).toContain(
      "backend/scratch.pem",
    );
    expect(tree.ignoredHidden).toBe(false);
  });
});

describe("the requested root obeys the same rules as any entry", () => {
  it("refuses `.git` outright, in both modes", async () => {
    const root = await repository();
    await mkdir(join(root, ".git", "refs"), { recursive: true });
    for (const showIgnored of [false, true]) {
      await expect(
        listProjectFiles(root, { depth: "1", path: ".git", showIgnored }),
      ).rejects.toThrow("path_excluded");
      await expect(
        listProjectFiles(root, { depth: "1", path: ".git/refs", showIgnored }),
      ).rejects.toThrow("path_excluded");
    }
    await expect(previewProjectFile(root, ".git/secret")).rejects.toThrow(
      "path_excluded",
    );
  });

  it("refuses an ignored directory unless ignored paths were asked for", async () => {
    const root = await repository();
    await expect(
      listProjectFiles(root, { depth: "1", path: "node_modules" }),
    ).rejects.toThrow("path_ignored");
    const revealed = await listProjectFiles(root, {
      depth: "1",
      path: "node_modules",
      showIgnored: true,
    });
    expect(revealed.entries.map((entry) => entry.path)).toContain(
      "node_modules/@babel",
    );
  });

  it("opens an ignored directory that holds something tracked", async () => {
    const root = await trackedRepository();
    const tree = await listProjectFiles(root, { depth: "1", path: "dist" });
    expect(tree.entries.map((entry) => entry.path)).toEqual(["dist/keep.js"]);
  });
});
