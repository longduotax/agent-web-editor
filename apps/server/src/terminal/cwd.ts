import { execFile } from "node:child_process";
import { readlink } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";

import { WorkspaceDisplayPathSchema } from "@pi-web/contracts";

// A shell's working directory is state inside a process the server does not
// control: it changes because the user typed `cd`, and nothing tells us. So
// it is OBSERVED through a bounded platform probe rather than tracked, and
// where the platform cannot answer the browser is told so instead of being
// shown a stale directory as though it were current (WSP-07).

const exec = promisify(execFile);

/** The macOS probe, spelled as an argument array to an absolute binary. */
export const LSOF_PATH = "/usr/sbin/lsof";
/** A wedged `lsof` must not hold a poll open; the poll is once a second. */
export const LSOF_TIMEOUT_MS = 2000;
/** One directory's worth of output. Anything larger is not an answer. */
export const LSOF_MAX_BUFFER = 64 * 1024;

export function lsofArguments(pid: number): string[] {
  // `-a` ANDs the filters, `-p` selects the process, `-d cwd` selects the
  // one descriptor we want, and `-Fn` asks for field-per-line output whose
  // name records are prefixed `n` — a machine format, parsed as one, rather
  // than the human table.
  return ["-a", "-p", String(pid), "-d", "cwd", "-Fn"];
}

/**
 * The operating system, as this module uses it.
 *
 * Injected so every branch is reachable from a test on any one machine: the
 * whole point of the module is that it does three different things on three
 * platforms, and two of them cannot run where the third does.
 */
export interface CwdProbeSystem {
  platform: NodeJS.Platform;
  readProcessLink(pid: number): Promise<Buffer>;
  readLsofOutput(pid: number): Promise<Buffer>;
}

const nodeSystem: CwdProbeSystem = {
  platform: process.platform,
  readProcessLink: async (pid) =>
    // Bytes, not a string: Node would otherwise decode a path leniently and
    // hand back replacement characters, which is a directory that does not
    // exist. See decodePath.
    Buffer.from(await readlink(`/proc/${String(pid)}/cwd`, "buffer")),
  readLsofOutput: async (pid) => {
    const { stdout } = await exec(LSOF_PATH, lsofArguments(pid), {
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: LSOF_MAX_BUFFER,
      encoding: "buffer",
      // No shell: the pid is the only interpolated value and it is a number,
      // but a shell here would be a shell in the terminal subsystem.
      shell: false,
      windowsHide: true,
    });
    return stdout;
  },
};

/** Bytes from the operating system, decoded only if they really are UTF-8. */
function decodePath(bytes: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function absoluteOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.replace(/[\r\n]+$/, "");
  // Linux marks a working directory whose entry has been removed. The
  // process is still there, the directory is not, and the path is a lie.
  if (trimmed.endsWith(" (deleted)")) return null;
  return trimmed !== "" && isAbsolute(trimmed) ? trimmed : null;
}

/** The first `n`-prefixed record of `lsof -F` output, which is the path. */
function firstNameRecord(output: string | null): string | null {
  if (output === null) return null;
  for (const line of output.split(/\r?\n/))
    if (line.startsWith("n")) return line.slice(1);
  return null;
}

/**
 * The absolute working directory of a running process, or `null`.
 *
 * `null` is a first-class answer and by far the most common one: an
 * unsupported platform, a process id the adapter could not report, a process
 * that exited between the poll and the read, or output that will not decode.
 * Every failure lands here, because a terminal must not break over a
 * directory it could not look up.
 */
export async function probeCwd(
  pid: number,
  system: CwdProbeSystem = nodeSystem,
): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (system.platform === "linux")
      return absoluteOrNull(decodePath(await system.readProcessLink(pid)));
    if (system.platform === "darwin")
      return absoluteOrNull(
        firstNameRecord(decodePath(await system.readLsofOutput(pid))),
      );
  } catch {
    return null;
  }
  return null;
}

/**
 * An absolute directory reduced to what a browser may be told (WSP-07).
 *
 * The execution root becomes `""`, a descendant becomes its relative path
 * with `/` separators, and anything else — a shell that has `cd`'d out of
 * the worktree, or a name the display-path contract will not carry — becomes
 * `null`. Absolute server paths never appear in a browser DTO, so this runs
 * before the value leaves the server rather than in the frame that sends it.
 */
export function workspaceRelativeCwd(
  root: string,
  absolute: string | null,
): string | null {
  if (absolute === null) return null;
  if (absolute === root) return "";
  const within = relative(root, absolute);
  if (within === "") return "";
  if (within.startsWith("..") || isAbsolute(within)) return null;
  const display = within.split(sep).join("/");
  return WorkspaceDisplayPathSchema.safeParse(display).success ? display : null;
}
