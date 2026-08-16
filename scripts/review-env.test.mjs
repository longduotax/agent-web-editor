import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  REVIEW_ENV_MANIFEST_VERSION,
  allocateLoopbackPorts,
  createPrivateRuntimeDirectory,
  deriveReviewEnvironmentPaths,
  parsePackageIdentity,
  parseProcessIdentity,
  parseReviewEnvironmentManifest,
  parseWorktreePorcelain,
  removeReviewEnvironmentDirectory,
} from "./review-env-lib.mjs";

const worktreeRoot = "/tmp/example worktree";
const supervisorScript = "/tmp/example worktree/scripts/review-env-start.mjs";
const paths = deriveReviewEnvironmentPaths(worktreeRoot, "/tmp/review-tests");
const validManifest = {
  version: REVIEW_ENV_MANIFEST_VERSION,
  environmentId: "12345678-1234-4123-8123-123456789abc",
  worktreeRoot,
  runtimeDirectory: paths.runtimeDirectory,
  stateDirectory: paths.stateDirectory,
  logFile: paths.logFile,
  supervisorScript,
  pid: 1234,
  backendPort: 43101,
  webPort: 43102,
  createdAt: "2026-08-16T17:00:00.000Z",
};
const expectedManifest = { worktreeRoot, paths, supervisorScript };

function copyManifest() {
  return JSON.parse(JSON.stringify(validManifest));
}

test("parses the repository package identity", () => {
  assert.deepEqual(parsePackageIdentity('{"name":"pi-web-app"}'), {
    name: "pi-web-app",
  });
  assert.throws(
    () => parsePackageIdentity("not json"),
    /package\.json is not valid JSON/,
  );
  assert.throws(
    () => parsePackageIdentity('{"name":"another-app"}'),
    /only supported by pi-web-app/,
  );
});

test("parses NUL-delimited Git worktree output including spaces", () => {
  const raw =
    "worktree /Users/example/main checkout\0HEAD abc\0branch refs/heads/main\0\0" +
    "worktree /Users/example/linked\0HEAD def\0branch refs/heads/feature\0\0";
  assert.equal(parseWorktreePorcelain(raw), "/Users/example/main checkout");
  assert.throws(() => parseWorktreePorcelain("HEAD abc\0"), /main worktree/);
});

test("derives a stable isolated path for each worktree", () => {
  const first = deriveReviewEnvironmentPaths("/tmp/one", "/tmp/base");
  const repeated = deriveReviewEnvironmentPaths("/tmp/one", "/tmp/base");
  const second = deriveReviewEnvironmentPaths("/tmp/two", "/tmp/base");
  assert.deepEqual(first, repeated);
  assert.notEqual(first.environmentKey, second.environmentKey);
  assert.equal(first.stateDirectory, join(first.runtimeDirectory, "state"));
});

test("parses a complete environment manifest", () => {
  assert.deepEqual(
    parseReviewEnvironmentManifest(
      `${JSON.stringify(validManifest)}\n`,
      expectedManifest,
    ),
    validManifest,
  );
});

test("rejects malformed and mismatched environment manifests", () => {
  assert.throws(
    () => parseReviewEnvironmentManifest("not json", expectedManifest),
    /not valid JSON/,
  );

  const mutations = [
    ["version", 99, /unsupported version/],
    ["environmentId", "not-a-token", /UUID/],
    ["worktreeRoot", "/tmp/other", /does not match/],
    ["runtimeDirectory", "/tmp/other", /does not match/],
    ["stateDirectory", "relative", /normalized absolute path/],
    ["pid", 0, /positive integer/],
    ["backendPort", 65_536, /at most 65535/],
    ["webPort", 43_101, /must be distinct/],
    ["createdAt", "yesterday", /ISO timestamp/],
  ];
  for (const [field, value, message] of mutations) {
    const candidate = copyManifest();
    candidate[field] = value;
    assert.throws(
      () =>
        parseReviewEnvironmentManifest(
          JSON.stringify(candidate),
          expectedManifest,
        ),
      message,
    );
  }

  const missing = copyManifest();
  delete missing.pid;
  assert.throws(
    () =>
      parseReviewEnvironmentManifest(JSON.stringify(missing), expectedManifest),
    /positive integer/,
  );
});

test("proves supervisor ownership from process metadata", () => {
  assert.deepEqual(
    parseProcessIdentity({
      pid: validManifest.pid,
      processGroupText: ` ${String(validManifest.pid)} `,
      commandText: `node ${supervisorScript} --supervise ${validManifest.environmentId}`,
      supervisorScript,
      environmentId: validManifest.environmentId,
    }),
    { owned: true, reason: null },
  );
  assert.equal(
    parseProcessIdentity({
      pid: validManifest.pid,
      processGroupText: "9999",
      commandText: `node ${supervisorScript} --supervise ${validManifest.environmentId}`,
      supervisorScript,
      environmentId: validManifest.environmentId,
    }).owned,
    false,
  );
  assert.equal(
    parseProcessIdentity({
      pid: validManifest.pid,
      processGroupText: String(validManifest.pid),
      commandText: `node ${supervisorScript} --supervise wrong-token`,
      supervisorScript,
      environmentId: validManifest.environmentId,
    }).owned,
    false,
  );
});

test("allocates distinct loopback ports", async () => {
  const { backendPort, webPort } = await allocateLoopbackPorts();
  assert.ok(backendPort > 0 && backendPort <= 65_535);
  assert.ok(webPort > 0 && webPort <= 65_535);
  assert.notEqual(backendPort, webPort);
});

test("creates and removes only the derived private runtime directory", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "review-env-test-"));
  try {
    const temporaryPaths = deriveReviewEnvironmentPaths(
      "/tmp/test-worktree",
      temporaryRoot,
    );
    createPrivateRuntimeDirectory(temporaryPaths);
    removeReviewEnvironmentDirectory(temporaryPaths);
    assert.throws(
      () =>
        removeReviewEnvironmentDirectory({
          ...temporaryPaths,
          runtimeDirectory: temporaryRoot,
        }),
      /unexpected review environment path/,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
