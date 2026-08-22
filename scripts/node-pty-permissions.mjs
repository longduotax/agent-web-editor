#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  findSpawnHelpers,
  restoreExecuteBits,
} from "./node-pty-permissions-lib.mjs";

// Run from the root package's `postinstall`. See node-pty-permissions-lib.mjs
// for the symptom this exists to prevent — "Terminal command was rejected."
// on every terminal launch, after a perfectly successful `pnpm install`.

// Windows ships winpty rather than a spawn helper, and has no execute bit to
// restore; there is nothing to do and nothing to warn about.
if (process.platform === "win32") process.exit(0);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { repaired, failed } = restoreExecuteBits(
  findSpawnHelpers(join(repositoryRoot, "node_modules")),
);

// Silent on success, including the far more common "already executable".
if (repaired.length > 0)
  process.stdout.write(
    `node-pty: restored the execute bit on ${String(repaired.length)} prebuilt spawn-helper(s).\n`,
  );

for (const { helper, message } of failed)
  process.stderr.write(
    `node-pty: could not make ${helper} executable (${message}). Terminals will report "Terminal command was rejected." until it is: chmod +x "${helper}"\n`,
  );

// Never fails the install: a terminal that cannot start is not a reason to
// leave the workspace uninstalled.
process.exit(0);
