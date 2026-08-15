import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";

import {
  listProjectFiles,
  previewProjectFile,
  resolveContained,
} from "./files.js";

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
