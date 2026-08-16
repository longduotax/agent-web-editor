#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

import {
  createPrivateRuntimeDirectory,
  deriveReviewEnvironmentPaths,
  inspectSupervisor,
  parseReviewEnvironmentManifest,
  removeReviewEnvironmentDirectory,
  resolveReviewRepository,
  terminateProcessGroup,
} from "./review-env-lib.mjs";

const supervisorScript = fileURLToPath(
  new URL("./review-env-start.mjs", import.meta.url),
);

async function closeReviewEnvironment() {
  const { worktreeRoot } = resolveReviewRepository();
  const paths = deriveReviewEnvironmentPaths(worktreeRoot);
  if (!existsSync(paths.runtimeDirectory)) {
    process.stdout.write(
      `No isolated review environment exists for ${worktreeRoot}.\n`,
    );
    return;
  }

  createPrivateRuntimeDirectory(paths);
  if (!existsSync(paths.manifestFile))
    throw new Error(
      `review environment state exists without a manifest at ${paths.runtimeDirectory}`,
    );
  const manifest = parseReviewEnvironmentManifest(
    readFileSync(paths.manifestFile, "utf8"),
    { worktreeRoot, paths, supervisorScript },
  );
  const identity = inspectSupervisor(manifest);
  if (identity.alive && !identity.owned)
    throw new Error(
      `refusing to terminate PID ${String(manifest.pid)}: ${identity.reason}`,
    );
  if (identity.alive) await terminateProcessGroup(manifest.pid);
  removeReviewEnvironmentDirectory(paths);
  process.stdout.write(
    `Stopped the isolated review environment and removed its SQLite state and logs for ${worktreeRoot}.\n`,
  );
}

try {
  await closeReviewEnvironment();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`Unable to close review environment: ${message}\n`);
  process.exitCode = 1;
}
