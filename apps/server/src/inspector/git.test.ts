import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { getGitDiff, getGitStatus } from "./git.js";

// The diff boundary against a real repository, because the shapes the
// browser has to render are Git's and not this application's: an untracked
// file's `/dev/null` preview, a binary file that has no lines at all, and a
// path that has stopped being changed between the status call and the diff
// call. Every repository here is a temporary directory this file creates and
// removes; no command touches a repository of the user's.

const exec = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Git inside a fixture, with the developer's own configuration cut out. */
async function git(cwd: string, args: string[]): Promise<void> {
  await exec("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-git-diff-"));
  roots.push(root);
  await writeFile(join(root, "tracked.txt"), "one\ntwo\nthree\n");
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["add", "-A"]);
  await git(root, [
    "-c",
    "user.name=Inspector test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--no-verify",
    "-m",
    "fixture",
  ]);
  return root;
}

describe("the Git diff boundary", () => {
  it("labels a staged and an unstaged change of one file separately", async () => {
    const root = await repository();
    await writeFile(join(root, "tracked.txt"), "one\nTWO\nthree\n");
    await git(root, ["add", "tracked.txt"]);
    await writeFile(join(root, "tracked.txt"), "one\nTWO\nTHREE\n");

    const diff = await getGitDiff(root, "tracked.txt");

    expect(diff.staged).toContain("+TWO");
    expect(diff.unstaged).toContain("+THREE");
    expect(diff.truncated).toBe(false);
  });

  it("previews an untracked file against /dev/null", async () => {
    // The shape WSP-06's Diff tab renders as all-additions with no old side.
    const root = await repository();
    await writeFile(join(root, "new.txt"), "brand new\n");

    const diff = await getGitDiff(root, "new.txt");

    expect(diff.staged).toBe("");
    expect(diff.unstaged).toContain("--- /dev/null");
    expect(diff.unstaged).toContain("@@ -0,0 +1 @@");
    expect(diff.unstaged).toContain("+brand new");
  });

  it("reports a binary file as one rather than as text", async () => {
    const root = await repository();
    await writeFile(join(root, "blob.bin"), Buffer.from([0, 1, 2, 0, 3]));

    const diff = await getGitDiff(root, "blob.bin");

    expect(diff.unstaged).toContain("Binary files");
    expect(diff.unstaged).not.toContain("@@");
  });

  it("refuses a path that is not in the current change set", async () => {
    // The working tree is not stable between the status call that listed a
    // path and the diff call that asks for it, and this is the typed
    // rejection the browser turns into an ordinary state rather than an
    // error.
    const root = await repository();

    await expect(getGitDiff(root, "tracked.txt")).rejects.toThrow(
      "git_path_not_changed",
    );
  });

  it("represents a directory that is not a repository explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-git-plain-"));
    roots.push(root);
    await writeFile(join(root, "file.txt"), "");

    const status = await getGitStatus(root);

    expect(status.available).toBe(false);
    expect(status.files).toEqual([]);
    await expect(getGitDiff(root, "file.txt")).rejects.toThrow(
      "git_unavailable",
    );
  });
});
