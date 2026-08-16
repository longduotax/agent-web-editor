import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export const REVIEW_ENV_MANIFEST_VERSION = 1;
const TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${name} must be a non-empty string`);
  return value;
}

function parseAbsolutePath(value, name) {
  const parsed = parseNonEmptyString(value, name);
  if (!isAbsolute(parsed) || resolve(parsed) !== parsed)
    throw new Error(`${name} must be a normalized absolute path`);
  return parsed;
}

function parsePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function parsePort(value, name) {
  const parsed = parsePositiveInteger(value, name);
  if (parsed > 65_535) throw new Error(`${name} must be at most 65535`);
  return parsed;
}

export function parsePackageIdentity(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("package.json is not valid JSON");
  }
  if (!isRecord(value) || value.name !== "pi-web-app")
    throw new Error("review environments are only supported by pi-web-app");
  return { name: value.name };
}

export function parseWorktreePorcelain(raw) {
  if (typeof raw !== "string")
    throw new Error("Git worktree output is invalid");
  const first = raw.split("\0").find((field) => field.startsWith("worktree "));
  if (first === undefined)
    throw new Error("Git did not report a main worktree");
  return parseNonEmptyString(first.slice("worktree ".length), "main worktree");
}

function gitOutput(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "the current directory is not inside an accessible Git worktree",
    );
  }
}

export function resolveReviewRepository(startDirectory = process.cwd()) {
  const discovered = gitOutput(startDirectory, [
    "rev-parse",
    "--show-toplevel",
  ]).trim();
  const worktreeRoot = realpathSync(discovered);
  parsePackageIdentity(
    readFileSync(join(worktreeRoot, "package.json"), "utf8"),
  );
  const worktrees = gitOutput(worktreeRoot, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  const mainWorktreeRoot = realpathSync(parseWorktreePorcelain(worktrees));
  return { worktreeRoot, mainWorktreeRoot };
}

export function deriveReviewEnvironmentPaths(
  worktreeRoot,
  temporaryRoot = tmpdir(),
) {
  const canonicalRoot = parseAbsolutePath(worktreeRoot, "worktreeRoot");
  const environmentKey = createHash("sha256")
    .update(canonicalRoot)
    .digest("hex")
    .slice(0, 20);
  const baseDirectory = resolve(temporaryRoot, "pi-web-review-environments");
  const runtimeDirectory = join(baseDirectory, environmentKey);
  return {
    environmentKey,
    baseDirectory,
    runtimeDirectory,
    stateDirectory: join(runtimeDirectory, "state"),
    manifestFile: join(runtimeDirectory, "environment.json"),
    logFile: join(runtimeDirectory, "development.log"),
  };
}

export function createPrivateRuntimeDirectory(paths) {
  mkdirSync(paths.baseDirectory, { recursive: true, mode: 0o700 });
  const baseStats = lstatSync(paths.baseDirectory);
  if (!baseStats.isDirectory() || baseStats.isSymbolicLink())
    throw new Error("review environment base path must be a real directory");
  chmodSync(paths.baseDirectory, 0o700);
  if (existsSync(paths.runtimeDirectory)) {
    const runtimeStats = lstatSync(paths.runtimeDirectory);
    if (!runtimeStats.isDirectory() || runtimeStats.isSymbolicLink())
      throw new Error("review environment path must be a real directory");
  } else {
    mkdirSync(paths.runtimeDirectory, { mode: 0o700 });
  }
  chmodSync(paths.runtimeDirectory, 0o700);
  if (existsSync(paths.stateDirectory)) {
    const stateStats = lstatSync(paths.stateDirectory);
    if (!stateStats.isDirectory() || stateStats.isSymbolicLink())
      throw new Error("review environment state path must be a real directory");
  } else {
    mkdirSync(paths.stateDirectory, { mode: 0o700 });
  }
  chmodSync(paths.stateDirectory, 0o700);
}

export function removeReviewEnvironmentDirectory(paths) {
  const expected = join(paths.baseDirectory, paths.environmentKey);
  if (paths.runtimeDirectory !== expected)
    throw new Error("refusing to remove an unexpected review environment path");
  if (!existsSync(paths.runtimeDirectory)) return;
  const stats = lstatSync(paths.runtimeDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error(
      "refusing to remove a non-directory review environment path",
    );
  rmSync(paths.runtimeDirectory, { recursive: true, force: true });
}

export function createReviewEnvironmentId() {
  return randomUUID();
}

export function createReviewEnvironmentManifest({
  environmentId,
  worktreeRoot,
  paths,
  supervisorScript,
  pid,
  backendPort,
  webPort,
}) {
  if (!TOKEN_PATTERN.test(environmentId))
    throw new Error("environmentId must be a UUID");
  return {
    version: REVIEW_ENV_MANIFEST_VERSION,
    environmentId,
    worktreeRoot,
    runtimeDirectory: paths.runtimeDirectory,
    stateDirectory: paths.stateDirectory,
    logFile: paths.logFile,
    supervisorScript,
    pid,
    backendPort,
    webPort,
    createdAt: new Date().toISOString(),
  };
}

export function parseReviewEnvironmentManifest(raw, expected) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("review environment manifest is not valid JSON");
  }
  if (!isRecord(value))
    throw new Error("review environment manifest must be an object");
  if (value.version !== REVIEW_ENV_MANIFEST_VERSION)
    throw new Error("review environment manifest has an unsupported version");

  const environmentId = parseNonEmptyString(
    value.environmentId,
    "environmentId",
  );
  if (!TOKEN_PATTERN.test(environmentId))
    throw new Error("environmentId must be a UUID");
  const worktreeRoot = parseAbsolutePath(value.worktreeRoot, "worktreeRoot");
  const runtimeDirectory = parseAbsolutePath(
    value.runtimeDirectory,
    "runtimeDirectory",
  );
  const stateDirectory = parseAbsolutePath(
    value.stateDirectory,
    "stateDirectory",
  );
  const logFile = parseAbsolutePath(value.logFile, "logFile");
  const supervisorScript = parseAbsolutePath(
    value.supervisorScript,
    "supervisorScript",
  );
  const pid = parsePositiveInteger(value.pid, "pid");
  const backendPort = parsePort(value.backendPort, "backendPort");
  const webPort = parsePort(value.webPort, "webPort");
  if (backendPort === webPort)
    throw new Error("backendPort and webPort must be distinct");
  const createdAt = parseNonEmptyString(value.createdAt, "createdAt");
  const createdDate = new Date(createdAt);
  if (
    Number.isNaN(createdDate.getTime()) ||
    createdDate.toISOString() !== createdAt
  )
    throw new Error("createdAt must be an ISO timestamp");

  const manifest = {
    version: REVIEW_ENV_MANIFEST_VERSION,
    environmentId,
    worktreeRoot,
    runtimeDirectory,
    stateDirectory,
    logFile,
    supervisorScript,
    pid,
    backendPort,
    webPort,
    createdAt,
  };
  if (
    manifest.worktreeRoot !== expected.worktreeRoot ||
    manifest.runtimeDirectory !== expected.paths.runtimeDirectory ||
    manifest.stateDirectory !== expected.paths.stateDirectory ||
    manifest.logFile !== expected.paths.logFile ||
    manifest.supervisorScript !== expected.supervisorScript
  )
    throw new Error("review environment manifest does not match this worktree");
  return manifest;
}

function listenRandomPort(server) {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (
        address === null ||
        typeof address === "string" ||
        !Number.isInteger(address.port) ||
        address.port <= 0 ||
        address.port > 65_535
      ) {
        reject(new Error("the operating system returned an invalid port"));
        return;
      }
      resolvePromise(address.port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error === undefined) resolvePromise();
      else reject(error);
    });
  });
}

export async function allocateLoopbackPorts() {
  const backend = createServer();
  const web = createServer();
  try {
    const [backendPort, webPort] = await Promise.all([
      listenRandomPort(backend),
      listenRandomPort(web),
    ]);
    if (backendPort === webPort)
      throw new Error("the operating system returned duplicate ports");
    return { backendPort, webPort };
  } finally {
    await Promise.allSettled([closeServer(backend), closeServer(web)]);
  }
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM")
      return true;
    return false;
  }
}

function psOutput(pid, field) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

export function parseProcessIdentity({
  pid,
  processGroupText,
  commandText,
  supervisorScript,
  environmentId,
}) {
  const processGroup = Number(processGroupText.trim());
  if (!Number.isSafeInteger(processGroup) || processGroup <= 0)
    return { owned: false, reason: "invalid process group" };
  if (processGroup !== pid)
    return {
      owned: false,
      reason: "supervisor is not the process-group leader",
    };
  if (
    !commandText.includes(supervisorScript) ||
    !commandText.includes("--supervise") ||
    !commandText.includes(environmentId)
  )
    return {
      owned: false,
      reason: "supervisor command identity does not match",
    };
  return { owned: true, reason: null };
}

export function inspectSupervisor(manifest) {
  if (!isProcessAlive(manifest.pid))
    return { alive: false, owned: false, reason: "process is not running" };
  const identity = parseProcessIdentity({
    pid: manifest.pid,
    processGroupText: psOutput(manifest.pid, "pgid"),
    commandText: psOutput(manifest.pid, "command"),
    supervisorScript: manifest.supervisorScript,
    environmentId: manifest.environmentId,
  });
  return { alive: true, ...identity };
}

function processGroupAlive(processGroup) {
  try {
    process.kill(-processGroup, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM")
      return true;
    return false;
  }
}

export async function terminateProcessGroup(processGroup) {
  if (!processGroupAlive(processGroup)) return;
  try {
    process.kill(-processGroup, "SIGTERM");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return;
    throw error;
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!processGroupAlive(processGroup)) return;
    await delay(100);
  }
  try {
    process.kill(-processGroup, "SIGKILL");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return;
    throw error;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!processGroupAlive(processGroup)) return;
    await delay(100);
  }
  throw new Error("review environment process group did not exit");
}

function requestStatus(port, path) {
  return new Promise((resolvePromise) => {
    const client = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        timeout: 1_000,
      },
      (response) => {
        response.resume();
        resolvePromise(response.statusCode ?? 0);
      },
    );
    client.once("timeout", () => {
      client.destroy();
      resolvePromise(0);
    });
    client.once("error", () => resolvePromise(0));
    client.end();
  });
}

export async function isReviewEnvironmentReady(manifest) {
  const [backendReady, proxyReady, webReady] = await Promise.all([
    requestStatus(manifest.backendPort, "/api/ready"),
    requestStatus(manifest.webPort, "/api/ready"),
    requestStatus(manifest.webPort, "/"),
  ]);
  return backendReady === 200 && proxyReady === 200 && webReady === 200;
}

export async function waitForReviewEnvironment(
  manifest,
  databaseFile,
  timeoutMilliseconds = 90_000,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (!isProcessAlive(manifest.pid)) return false;
    if (existsSync(databaseFile) && (await isReviewEnvironmentReady(manifest)))
      return true;
    await delay(250);
  }
  return false;
}
