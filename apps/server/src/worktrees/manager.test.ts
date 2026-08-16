import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ProjectIdSchema } from "@pi-web/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { GitWorktreeManager } from "./manager.js";

const exec = promisify(execFile);
const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-web-worktree-"));
  roots.push(root);
  const source = join(root, "source");
  const state = join(root, "state");
  await mkdir(source);
  await mkdir(state);
  await exec("git", ["init", "-b", "main"], { cwd: source });
  await exec("git", ["config", "user.email", "test@example.invalid"], {
    cwd: source,
  });
  await exec("git", ["config", "user.name", "Test"], { cwd: source });
  await writeFile(join(source, ".gitignore"), "ignored.txt\n");
  await writeFile(join(source, "tracked.txt"), "committed\n");
  await exec("git", ["add", "."], { cwd: source });
  await exec("git", ["commit", "-m", "initial"], { cwd: source });
  return { root, source, state };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

describe("GitWorktreeManager", () => {
  it("creates a clean worktree without bringing source changes", async () => {
    const { source, state } = await fixture();
    await writeFile(join(source, "tracked.txt"), "dirty\n");
    await writeFile(join(source, "untracked.txt"), "local\n");
    await writeFile(join(source, "ignored.txt"), "ignored\n");
    const manager = new GitWorktreeManager();
    const preflight = await manager.preflight(source);
    expect(preflight.worktreeAvailable).toBe(true);
    expect(preflight.changes?.untracked).toBe(1);
    const plan = await manager.plan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "20000000-0000-4000-8000-000000000001",
      title: "Implement thread worktrees",
      baseBranch: "main",
      includeChanges: false,
    });
    await manager.provision(plan, false);
    expect(
      await readFile(join(plan.executionRoot, "tracked.txt"), "utf8"),
    ).toBe("committed\n");
    await expect(
      readFile(join(plan.executionRoot, "untracked.txt"), "utf8"),
    ).rejects.toThrow();
    expect(await readFile(join(source, "tracked.txt"), "utf8")).toBe("dirty\n");
    expect(plan.branchName).toMatch(/^pi\/implement-thread-worktrees-/);
  });

  it("copies explicitly reviewed staged, unstaged, and untracked changes but not ignored files", async () => {
    const { source, state } = await fixture();
    await writeFile(join(source, "staged.txt"), "staged\n");
    await exec("git", ["add", "staged.txt"], { cwd: source });
    await writeFile(join(source, "tracked.txt"), "unstaged\n");
    await writeFile(join(source, "untracked.txt"), "local\n");
    await writeFile(join(source, "ignored.txt"), "ignored\n");
    const manager = new GitWorktreeManager();
    const preflight = await manager.preflight(source);
    if (preflight.changes === null) throw new Error("Expected Git changes");
    const plan = await manager.plan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "30000000-0000-4000-8000-000000000001",
      title: "Carry local changes",
      baseBranch: "main",
      expectedToken: preflight.changes.token,
      includeChanges: true,
    });
    await manager.provision(plan, true);
    expect(await readFile(join(plan.executionRoot, "staged.txt"), "utf8")).toBe(
      "staged\n",
    );
    expect(
      await readFile(join(plan.executionRoot, "tracked.txt"), "utf8"),
    ).toBe("unstaged\n");
    expect(
      await readFile(join(plan.executionRoot, "untracked.txt"), "utf8"),
    ).toBe("local\n");
    await expect(
      readFile(join(plan.executionRoot, "ignored.txt"), "utf8"),
    ).rejects.toThrow();
    const status = await exec("git", ["status", "--short"], {
      cwd: plan.worktreeRoot,
    });
    expect(status.stdout).toContain("A  staged.txt");
    expect(status.stdout).toContain(" M tracked.txt");
    expect(status.stdout).toContain("?? untracked.txt");
  });
});
