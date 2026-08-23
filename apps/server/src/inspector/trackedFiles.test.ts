import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearTrackedPathCache,
  isTracked,
  loadTrackedPaths,
} from "./trackedFiles.js";

const exec = promisify(execFile);
const roots: string[] = [];

beforeEach(() => {
  clearTrackedPathCache();
});
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function repository(): Promise<string> {
  const root = await temporaryDirectory("pi-web-tracked-unit-");
  await mkdir(join(root, "backend"));
  await writeFile(join(root, "backend", "cert.pem"), "certificate\n");
  await writeFile(join(root, "backend", "loose.pem"), "not committed\n");
  await writeFile(join(root, "top.txt"), "top\n");
  await exec("git", ["init", "-q", "-b", "main"], { cwd: root });
  await exec("git", ["add", "--force", "backend/cert.pem", "top.txt"], {
    cwd: root,
  });
  return root;
}

describe("the tracked-path index", () => {
  it("holds every tracked file and every directory above one", async () => {
    const index = await loadTrackedPaths(await repository());
    expect(index).not.toBeNull();
    expect(isTracked(index, "backend/cert.pem")).toBe(true);
    expect(isTracked(index, "top.txt")).toBe(true);
    // A directory counts as tracked when anything under it is, because Git
    // descends into it for exactly that reason.
    expect(isTracked(index, "backend")).toBe(true);
    expect(isTracked(index, "backend/loose.pem")).toBe(false);
  });

  it("degrades to nothing outside a Git working tree", async () => {
    const root = await temporaryDirectory("pi-web-tracked-plain-");
    await writeFile(join(root, "file.txt"), "");
    expect(await loadTrackedPaths(root)).toBeNull();
    // And a null index exempts nothing, which is what keeps a non-Git
    // project behaving exactly as it did before this module existed.
    expect(isTracked(null, "file.txt")).toBe(false);
  });

  it("serves a second listing from memory and re-reads once the index changes", async () => {
    const root = await repository();
    const first = await loadTrackedPaths(root);
    expect(await loadTrackedPaths(root)).toBe(first);

    await writeFile(join(root, "backend", "loose.pem"), "still not committed");
    // A working-tree write is not an index write: the cached answer stands.
    expect(await loadTrackedPaths(root)).toBe(first);

    await exec("git", ["add", "--force", "backend/loose.pem"], { cwd: root });
    const second = await loadTrackedPaths(root);
    expect(second).not.toBe(first);
    expect(isTracked(second, "backend/loose.pem")).toBe(true);
  });

  it("holds a path containing a newline, which is why the read is NUL-separated", async () => {
    const root = await temporaryDirectory("pi-web-tracked-newline-");
    await exec("git", ["init", "-q", "-b", "main"], { cwd: root });
    const awkward = "two\nlines.txt";
    await writeFile(join(root, awkward), "");
    await exec("git", ["add", "--force", awkward], { cwd: root });
    const index = await loadTrackedPaths(root);
    expect(isTracked(index, awkward)).toBe(true);
  });
});
