import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  findSpawnHelpers,
  isExecutable,
  restoreExecuteBits,
} from "./node-pty-permissions-lib.mjs";

// A node_modules tree in both layouts pnpm can produce, with the helper
// written the way pnpm writes it on macOS: readable, not executable.
function buildTree() {
  const root = mkdtempSync(join(tmpdir(), "node-pty-permissions-"));
  const nodeModules = join(root, "node_modules");

  const store = join(
    nodeModules,
    ".pnpm",
    "node-pty@1.1.0",
    "node_modules",
    "node-pty",
    "prebuilds",
  );
  mkdirSync(join(store, "darwin-arm64"), { recursive: true });
  mkdirSync(join(store, "win32-x64"), { recursive: true });
  const stored = join(store, "darwin-arm64", "spawn-helper");
  writeFileSync(stored, "binary");
  chmodSync(stored, 0o644);
  // Windows prebuilds ship no helper at all, so this directory must simply
  // be skipped rather than reported as a failure.
  writeFileSync(join(store, "win32-x64", "winpty.dll"), "binary");

  const hoisted = join(nodeModules, "node-pty", "prebuilds", "darwin-x64");
  mkdirSync(hoisted, { recursive: true });
  const hoistedHelper = join(hoisted, "spawn-helper");
  writeFileSync(hoistedHelper, "binary");
  chmodSync(hoistedHelper, 0o644);

  return { root, nodeModules, stored, hoistedHelper };
}

test("finds every prebuilt spawn-helper under both pnpm layouts", () => {
  const { root, nodeModules, stored, hoistedHelper } = buildTree();
  try {
    const found = findSpawnHelpers(nodeModules).sort();
    assert.deepEqual(found, [hoistedHelper, stored].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("finds nothing, and does not throw, where node-pty is not installed", () => {
  const root = mkdtempSync(join(tmpdir(), "node-pty-permissions-"));
  try {
    assert.deepEqual(findSpawnHelpers(join(root, "node_modules")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restores the execute bit, and reports only what it changed", () => {
  const { root, nodeModules, stored, hoistedHelper } = buildTree();
  try {
    const helpers = findSpawnHelpers(nodeModules);
    const first = restoreExecuteBits(helpers);

    assert.deepEqual(first.repaired.sort(), [hoistedHelper, stored].sort());
    assert.deepEqual(first.failed, []);
    assert.ok(isExecutable(statSync(stored).mode));
    assert.ok(isExecutable(statSync(hoistedHelper).mode));
    // The read and write bits it arrived with are not disturbed.
    assert.equal(statSync(stored).mode & 0o666, 0o644 & 0o666);

    // A second run is a no-op: nothing to repair, nothing to report, which
    // is what makes this safe to run from `postinstall` on every install.
    const second = restoreExecuteBits(helpers);
    assert.deepEqual(second.repaired, []);
    assert.deepEqual(second.failed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports a helper it cannot repair rather than throwing", () => {
  const { root, nodeModules } = buildTree();
  try {
    const missing = join(
      nodeModules,
      "node-pty",
      "prebuilds",
      "gone",
      "spawn-helper",
    );
    const { repaired, failed } = restoreExecuteBits([missing]);

    assert.deepEqual(repaired, []);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].helper, missing);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
