import { join, sep } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  LSOF_MAX_BUFFER,
  LSOF_PATH,
  LSOF_TIMEOUT_MS,
  lsofArguments,
  probeCwd,
  workspaceRelativeCwd,
  type CwdProbeSystem,
} from "./cwd.js";

/**
 * A platform that answers however the test says, and records what it was
 * asked. Every branch of the probe is a different operating system, so the
 * only way to cover all three on one machine is to inject the system.
 */
function system(overrides: Partial<CwdProbeSystem>): CwdProbeSystem {
  return {
    platform: "linux",
    readProcessLink: () => Promise.reject(new Error("not stubbed")),
    readLsofOutput: () => Promise.reject(new Error("not stubbed")),
    ...overrides,
  };
}

describe("probeCwd", () => {
  it("reads the process's own cwd link on Linux", async () => {
    const readProcessLink = vi.fn(() =>
      Promise.resolve(Buffer.from("/srv/project/apps", "utf8")),
    );
    await expect(
      probeCwd(4321, system({ platform: "linux", readProcessLink })),
    ).resolves.toBe("/srv/project/apps");
    expect(readProcessLink).toHaveBeenCalledWith(4321);
  });

  // A shell whose directory has been removed keeps the link, and Linux marks
  // it. The honest answer is "cannot be observed", not a path that is gone.
  it("treats a deleted Linux working directory as unobservable", async () => {
    await expect(
      probeCwd(
        4321,
        system({
          readProcessLink: () =>
            Promise.resolve(Buffer.from("/srv/project/gone (deleted)", "utf8")),
        }),
      ),
    ).resolves.toBeNull();
  });

  // The process may have exited between the poll and the read; /proc may not
  // be mounted; the link may be unreadable. None of those is an error the
  // terminal should learn about — the directory is simply not observable.
  it("answers null when the Linux link cannot be read", async () => {
    await expect(
      probeCwd(
        4321,
        system({
          readProcessLink: () => Promise.reject(new Error("ESRCH")),
        }),
      ),
    ).resolves.toBeNull();
  });

  it("takes the first name record from lsof on macOS", async () => {
    const readLsofOutput = vi.fn(() =>
      Promise.resolve(
        Buffer.from("p4321\nfcwd\nn/Users/dev/project/apps/web\n", "utf8"),
      ),
    );
    await expect(
      probeCwd(4321, system({ platform: "darwin", readLsofOutput })),
    ).resolves.toBe("/Users/dev/project/apps/web");
    expect(readLsofOutput).toHaveBeenCalledWith(4321);
  });

  it("answers null when lsof reports no name record", async () => {
    await expect(
      probeCwd(
        4321,
        system({
          platform: "darwin",
          readLsofOutput: () => Promise.resolve(Buffer.from("p4321\nfcwd\n")),
        }),
      ),
    ).resolves.toBeNull();
  });

  // The bound that matters most: lsof's output is bytes from the operating
  // system, and a path is not required to be UTF-8. Decoding it leniently
  // would invent replacement characters and hand the terminal a directory
  // that does not exist, so an undecodable answer is no answer.
  it("refuses output that is not valid UTF-8", async () => {
    await expect(
      probeCwd(
        4321,
        system({
          platform: "darwin",
          readLsofOutput: () =>
            Promise.resolve(Buffer.from([0x6e, 0x2f, 0xff, 0xfe, 0x0a])),
        }),
      ),
    ).resolves.toBeNull();
  });

  it("refuses a name record that is not an absolute path", async () => {
    await expect(
      probeCwd(
        4321,
        system({
          platform: "darwin",
          readLsofOutput: () =>
            Promise.resolve(Buffer.from("n../elsewhere\n", "utf8")),
        }),
      ),
    ).resolves.toBeNull();
  });

  it("answers null when lsof fails or exceeds its bounds", async () => {
    await expect(
      probeCwd(
        4321,
        system({
          platform: "darwin",
          readLsofOutput: () => Promise.reject(new Error("ETIMEDOUT")),
        }),
      ),
    ).resolves.toBeNull();
  });

  // WSP-07: where the platform cannot observe a running shell's directory,
  // the tab shows the one it was started in. Nothing is spawned to find that
  // out — an unsupported platform costs no process at all.
  it("observes nothing, and runs nothing, on an unsupported platform", async () => {
    const readProcessLink = vi.fn();
    const readLsofOutput = vi.fn();
    await expect(
      probeCwd(
        4321,
        system({ platform: "win32", readProcessLink, readLsofOutput }),
      ),
    ).resolves.toBeNull();
    expect(readProcessLink).not.toHaveBeenCalled();
    expect(readLsofOutput).not.toHaveBeenCalled();
  });

  // The fake PTY has no pid, and neither does a process the adapter could
  // not report one for. Asking the operating system about pid 0 or -1 is
  // asking about something else entirely.
  it("observes nothing without a usable process id", async () => {
    const readProcessLink = vi.fn();
    for (const pid of [0, -1, 1.5, Number.NaN])
      await expect(
        probeCwd(pid, system({ readProcessLink })),
      ).resolves.toBeNull();
    expect(readProcessLink).not.toHaveBeenCalled();
  });

  // The command is spelled here rather than in a shell: an argument array to
  // an absolute binary, with a deadline and a small output buffer, so a
  // wedged or chatty lsof cannot hold or flood the server.
  it("spells the macOS command as a bounded argument array", () => {
    expect(LSOF_PATH).toBe("/usr/sbin/lsof");
    expect(lsofArguments(4321)).toEqual([
      "-a",
      "-p",
      "4321",
      "-d",
      "cwd",
      "-Fn",
    ]);
    expect(LSOF_TIMEOUT_MS).toBe(2000);
    expect(LSOF_MAX_BUFFER).toBe(64 * 1024);
  });
});

describe("workspaceRelativeCwd", () => {
  const root = join(sep, "srv", "project");

  it("reduces the execution root itself to the empty display path", () => {
    expect(workspaceRelativeCwd(root, root)).toBe("");
  });

  it("reduces a descendant to a workspace-relative path with / separators", () => {
    expect(workspaceRelativeCwd(root, join(root, "apps", "web"))).toBe(
      "apps/web",
    );
  });

  // WSP-07 and the read boundary alike: an absolute server path must never
  // reach the browser. A shell that has `cd`'d out of the worktree is
  // therefore reported as unobservable rather than as where it went.
  it("refuses a directory outside the execution root", () => {
    for (const outside of [
      join(sep, "srv", "other"),
      join(sep, "srv", "project-adjacent"),
      join(sep, "etc"),
    ])
      expect(workspaceRelativeCwd(root, outside)).toBeNull();
  });

  it("passes an unobservable directory straight through", () => {
    expect(workspaceRelativeCwd(root, null)).toBeNull();
  });

  // A directory name the display-path contract refuses — a backslash is a
  // legal POSIX filename character and an escape everywhere else — is
  // reduced to null rather than handed to a frame that would throw on it.
  it("refuses a name the display-path contract will not carry", () => {
    expect(workspaceRelativeCwd(root, join(root, "we\\ird"))).toBeNull();
  });
});
