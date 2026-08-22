import { chmodSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Restores the execute bit on node-pty's prebuilt `spawn-helper`.
 *
 * THE SYMPTOM THIS FIXES: every terminal launch fails with
 * "Terminal command was rejected." — the one untyped error
 * `apps/server/src/app.ts` collapses every terminal failure into. The cause
 * is not in this repository's code at all: pnpm extracts node-pty's prebuilt
 * `spawn-helper` without its execute bit on macOS, so `posix_spawnp` fails
 * with EACCES the moment the PTY is spawned, and node-pty surfaces it as a
 * spawn failure. `chmod +x` on the file fixes it immediately, and a fresh
 * `pnpm install` reintroduces it — which is why this runs from `postinstall`
 * rather than being fixed by hand.
 *
 * It is deliberately quiet: it prints nothing when there is nothing to do,
 * and it never fails an install. An install that cannot be repaired is
 * reported as a warning, because a broken terminal is not a reason to leave
 * the workspace uninstalled.
 */

/** Where a helper lives under any one package directory. */
const PREBUILDS = "prebuilds";
const HELPER = "spawn-helper";

/** Any of the execute bits: owner, group, or other. */
export function isExecutable(mode) {
  return (mode & 0o111) !== 0;
}

function directoriesIn(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // Absent or unreadable: there is nothing here to repair, which is the
    // normal case on a platform with no prebuilt helper.
    return [];
  }
}

function helpersUnderPackage(packageDirectory) {
  const prebuilds = join(packageDirectory, PREBUILDS);
  const found = [];
  for (const platform of directoriesIn(prebuilds)) {
    const helper = join(prebuilds, platform, HELPER);
    try {
      if (statSync(helper).isFile()) found.push(helper);
    } catch {
      // Not every prebuild ships one — Windows ships winpty instead.
    }
  }
  return found;
}

/**
 * Every `spawn-helper` a node-pty install has put on disk, under both
 * layouts pnpm can produce: the hoisted `node_modules/node-pty` and the
 * content-addressed `node_modules/.pnpm/node-pty@*\/node_modules/node-pty`.
 */
export function findSpawnHelpers(nodeModulesDirectory) {
  const helpers = [
    ...helpersUnderPackage(join(nodeModulesDirectory, "node-pty")),
  ];
  const store = join(nodeModulesDirectory, ".pnpm");
  for (const entry of directoriesIn(store)) {
    if (!entry.startsWith("node-pty@")) continue;
    helpers.push(
      ...helpersUnderPackage(join(store, entry, "node_modules", "node-pty")),
    );
  }
  return helpers;
}

/**
 * Adds the execute bit wherever it is missing. Returns what it changed and
 * what it could not, so the caller decides how loud to be; a helper that is
 * already executable is neither changed nor reported.
 */
export function restoreExecuteBits(helpers) {
  const repaired = [];
  const failed = [];
  for (const helper of helpers) {
    try {
      const { mode } = statSync(helper);
      if (isExecutable(mode)) continue;
      chmodSync(helper, mode | 0o111);
      repaired.push(helper);
    } catch (error) {
      failed.push({ helper, message: String(error) });
    }
  }
  return { repaired, failed };
}
