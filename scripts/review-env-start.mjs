#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import {
  allocateLoopbackPorts,
  createPrivateRuntimeDirectory,
  createReviewEnvironmentId,
  createReviewEnvironmentManifest,
  deriveReviewEnvironmentPaths,
  inspectSupervisor,
  isReviewEnvironmentReady,
  parseReviewEnvironmentManifest,
  removeReviewEnvironmentDirectory,
  resolveReviewRepository,
  terminateProcessGroup,
  waitForReviewEnvironment,
} from "./review-env-lib.mjs";

const supervisorScript = fileURLToPath(import.meta.url);

function runSupervisor(environmentId) {
  if (
    process.argv.length !== 4 ||
    environmentId !== process.env.PI_WEB_REVIEW_ENV_ID
  ) {
    throw new Error("invalid review environment supervisor invocation");
  }
  const child = spawn("pnpm", ["dev"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    process.stderr.write(`Unable to start pnpm dev: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal !== null)
      process.stderr.write(`pnpm dev exited from signal ${signal}.\n`);
    process.exitCode = code ?? 1;
  });
}

function outputEnvironment(manifest, reused) {
  if (reused)
    process.stdout.write(
      "An isolated review environment is already running for this worktree.\n",
    );
  else process.stdout.write("Isolated review environment is ready.\n");
  process.stdout.write(`URL=http://127.0.0.1:${String(manifest.webPort)}/\n`);
  process.stdout.write(
    `BACKEND=http://127.0.0.1:${String(manifest.backendPort)}/\n`,
  );
  process.stdout.write(
    `STATE=${join(manifest.stateDirectory, "metadata.sqlite")}\n`,
  );
  process.stdout.write(`LOG=${manifest.logFile}\n`);
}

function installDependencies(worktreeRoot) {
  if (existsSync(join(worktreeRoot, "node_modules"))) return;
  process.stdout.write(
    "Dependencies are missing; running pnpm install --frozen-lockfile…\n",
  );
  const installation = spawnSync("pnpm", ["install", "--frozen-lockfile"], {
    cwd: worktreeRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (installation.error !== undefined) throw installation.error;
  if (installation.status !== 0)
    throw new Error("pnpm install --frozen-lockfile failed");
  if (!existsSync(join(worktreeRoot, "node_modules")))
    throw new Error("pnpm install completed without creating node_modules");
}

function writeManifest(paths, manifest) {
  const temporaryFile = `${paths.manifestFile}.tmp-${String(process.pid)}`;
  writeFileSync(temporaryFile, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryFile, paths.manifestFile);
}

function logTail(logFile) {
  if (!existsSync(logFile)) return "No development log was created.";
  const lines = readFileSync(logFile, "utf8").split(/\r?\n/);
  return lines.slice(-40).join("\n");
}

async function waitForSupervisor(manifest) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const identity = inspectSupervisor(manifest);
    if (identity.alive && identity.owned) return true;
    if (!identity.alive) return false;
    await delay(100);
  }
  return false;
}

async function startReviewEnvironment() {
  const { worktreeRoot, mainWorktreeRoot } = resolveReviewRepository();
  if (worktreeRoot === mainWorktreeRoot)
    throw new Error(
      "review environments are disabled in the main worktree; use a linked worktree",
    );

  const paths = deriveReviewEnvironmentPaths(worktreeRoot);
  const runtimeExisted = existsSync(paths.runtimeDirectory);
  createPrivateRuntimeDirectory(paths);

  if (runtimeExisted) {
    if (!existsSync(paths.manifestFile))
      throw new Error(
        `review environment state exists without a manifest at ${paths.runtimeDirectory}`,
      );
    const existing = parseReviewEnvironmentManifest(
      readFileSync(paths.manifestFile, "utf8"),
      { worktreeRoot, paths, supervisorScript },
    );
    const identity = inspectSupervisor(existing);
    if (identity.alive && !identity.owned)
      throw new Error(
        `refusing to reuse PID ${String(existing.pid)}: ${identity.reason}`,
      );
    if (
      identity.alive &&
      existsSync(join(paths.stateDirectory, "metadata.sqlite")) &&
      (await isReviewEnvironmentReady(existing))
    ) {
      outputEnvironment(existing, true);
      return;
    }
    if (identity.alive) await terminateProcessGroup(existing.pid);
    removeReviewEnvironmentDirectory(paths);
    createPrivateRuntimeDirectory(paths);
  }

  let launchedPid = null;
  try {
    installDependencies(worktreeRoot);
    const { backendPort, webPort } = await allocateLoopbackPorts();
    const environmentId = createReviewEnvironmentId();
    const environment = {
      ...process.env,
      NODE_ENV: "development",
      PI_WEB_STATE_DIR: paths.stateDirectory,
      PI_WEB_PORT: String(backendPort),
      PI_WEB_DEV_PORT: String(webPort),
      PI_WEB_REVIEW_ENV_ID: environmentId,
    };
    const logDescriptor = openSync(paths.logFile, "a", 0o600);
    let supervisor;
    try {
      supervisor = spawn(
        process.execPath,
        [supervisorScript, "--supervise", environmentId],
        {
          cwd: worktreeRoot,
          env: environment,
          detached: true,
          stdio: ["ignore", logDescriptor, logDescriptor],
        },
      );
    } finally {
      closeSync(logDescriptor);
    }
    let supervisorSpawnError = null;
    supervisor.once("error", (error) => {
      supervisorSpawnError = error;
    });
    if (supervisor.pid === undefined)
      throw new Error("the review environment supervisor did not return a PID");
    launchedPid = supervisor.pid;
    supervisor.unref();

    const manifest = createReviewEnvironmentManifest({
      environmentId,
      worktreeRoot,
      paths,
      supervisorScript,
      pid: supervisor.pid,
      backendPort,
      webPort,
    });
    writeManifest(paths, manifest);

    if (!(await waitForSupervisor(manifest)))
      throw (
        supervisorSpawnError ??
        new Error("the review environment supervisor exited during startup")
      );
    const databaseFile = join(paths.stateDirectory, "metadata.sqlite");
    if (!(await waitForReviewEnvironment(manifest, databaseFile)))
      throw new Error(
        "the review environment did not become ready within 90 seconds",
      );
    outputEnvironment(manifest, false);
  } catch (error) {
    const details = logTail(paths.logFile);
    if (launchedPid !== null) {
      try {
        await terminateProcessGroup(launchedPid);
      } catch (terminationError) {
        throw new Error(
          `startup failed and PID ${String(launchedPid)} could not be stopped; generated state was preserved at ${paths.runtimeDirectory}`,
          { cause: terminationError },
        );
      }
    }
    removeReviewEnvironmentDirectory(paths);
    const message = error instanceof Error ? error.message : "startup failed";
    throw new Error(`${message}\n\nRecent development log:\n${details}`, {
      cause: error,
    });
  }
}

if (process.argv[2] === "--supervise") runSupervisor(process.argv[3]);
else {
  try {
    await startReviewEnvironment();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    process.stderr.write(`Unable to start review environment: ${message}\n`);
    process.exitCode = 1;
  }
}
