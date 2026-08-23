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

  it("emits a combined `@@@` diff for a path in a real merge conflict", async () => {
    // The one shape the Diff tab refuses to render as hunks, and until now
    // the only one it had never seen from Git itself: every `@@@` case was
    // hand-shaped input to the parser. `git diff` on an unmerged path writes
    // one column per parent, in which "the old side" is not one file, so a
    // two-gutter rendering of it would be a confident lie — the tab shows it
    // as Git wrote it and says why.
    const root = await repository();
    const commit = async (message: string) => {
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
        message,
      ]);
    };
    await git(root, ["checkout", "-q", "-b", "theirs"]);
    await writeFile(join(root, "tracked.txt"), "one\nTHEIRS\nthree\n");
    await commit("theirs");
    await git(root, ["checkout", "-q", "main"]);
    await writeFile(join(root, "tracked.txt"), "one\nOURS\nthree\n");
    await commit("ours");
    // A merge that cannot be resolved automatically leaves the path
    // unmerged, which is the state that produces the combined diff. It
    // exits non-zero by design, so the failure is the expected outcome.
    await expect(
      git(root, [
        "-c",
        "user.name=Inspector test",
        "-c",
        "user.email=test@example.invalid",
        "merge",
        "--no-ff",
        "theirs",
      ]),
    ).rejects.toThrow();

    const status = await getGitStatus(root);
    expect(status.files.find((file) => file.path === "tracked.txt")?.kind).toBe(
      "conflicted",
    );

    const diff = await getGitDiff(root, "tracked.txt");

    // Git's own combined format: three `@` either side, and two prefix
    // columns rather than one.
    expect(diff.unstaged).toMatch(/^@@@ .+ @@@$/m);
    expect(diff.unstaged.split("\n")[0]).toBe("diff --cc tracked.txt");
    expect(diff.unstaged).toContain("++<<<<<<< HEAD");
    expect(diff.unstaged).toContain("++>>>>>>> theirs");
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
