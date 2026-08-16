import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ProjectIdSchema } from "@pi-web/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  GitWorktreeManager,
  parseGitBranch,
  parseGitObjectId,
  parseGitPath,
} from "./manager.js";

const exec = promisify(execFile);
const roots: string[] = [];
const mainBranch = parseGitBranch(Buffer.from("main\n"));

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
      baseBranch: mainBranch,
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
      baseBranch: mainBranch,
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

  it("rejects an untracked content change after preflight", async () => {
    const { source, state } = await fixture();
    await writeFile(join(source, "untracked.txt"), "reviewed\n");
    const manager = new GitWorktreeManager();
    const preflight = await manager.preflight(source);
    if (preflight.changes === null) throw new Error("Expected Git changes");
    const plan = await manager.plan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "40000000-0000-4000-8000-000000000001",
      title: "Review untracked file",
      baseBranch: mainBranch,
      expectedToken: preflight.changes.token,
      includeChanges: true,
    });
    await writeFile(join(source, "untracked.txt"), "not reviewed\n");
    await expect(manager.provision(plan, true)).rejects.toThrow(
      "source_changed",
    );
  });

  it("rejects an untracked mode change after preflight", async () => {
    const { source, state } = await fixture();
    const path = join(source, "script.sh");
    await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
    const manager = new GitWorktreeManager();
    const preflight = await manager.preflight(source);
    if (preflight.changes === null) throw new Error("Expected Git changes");
    const plan = await manager.plan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "45000000-0000-4000-8000-000000000001",
      title: "Review untracked mode",
      baseBranch: mainBranch,
      expectedToken: preflight.changes.token,
      includeChanges: true,
    });
    await chmod(path, 0o755);
    await expect(manager.provision(plan, true)).rejects.toThrow(
      "source_changed",
    );
  });

  it("rejects a tracked content change after preflight", async () => {
    const { source, state } = await fixture();
    await writeFile(join(source, "tracked.txt"), "reviewed\n");
    const manager = new GitWorktreeManager();
    const preflight = await manager.preflight(source);
    if (preflight.changes === null) throw new Error("Expected Git changes");
    const plan = await manager.plan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "50000000-0000-4000-8000-000000000001",
      title: "Review tracked file",
      baseBranch: mainBranch,
      expectedToken: preflight.changes.token,
      includeChanges: true,
    });
    await writeFile(join(source, "tracked.txt"), "not reviewed\n");
    await expect(manager.provision(plan, true)).rejects.toThrow(
      "source_changed",
    );
    await expect(
      readFile(join(plan.executionRoot, "tracked.txt"), "utf8"),
    ).rejects.toThrow();
  });

  it("recovers a reserved clean worktree at its stored commit after branch advance", async () => {
    const { source, state } = await fixture();
    const manager = new GitWorktreeManager();
    const plan = await manager.plan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "60000000-0000-4000-8000-000000000001",
      title: "Recover stored worktree",
      baseBranch: mainBranch,
      includeChanges: false,
    });
    await writeFile(join(source, "tracked.txt"), "advanced\n");
    await exec("git", ["add", "tracked.txt"], { cwd: source });
    await exec("git", ["commit", "-m", "advance main"], { cwd: source });

    const recovered = await manager.recoveryPlan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "60000000-0000-4000-8000-000000000001",
      title: "Recover stored worktree",
      record: {
        execution_root: plan.executionRoot,
        worktree_root: plan.worktreeRoot,
        git_common_dir: plan.gitCommonDir,
        project_subpath: plan.projectSubpath,
        base_branch: plan.baseBranch,
        base_commit: plan.baseCommit,
        branch_name: plan.branchName,
        transfer_token: null,
      },
      includeChanges: false,
    });
    await manager.provision(recovered, false);
    expect(
      await readFile(join(recovered.executionRoot, "tracked.txt"), "utf8"),
    ).toBe("committed\n");
  });

  it("rejects a clean target worktree on another branch at the base commit", async () => {
    const { source, state } = await fixture();
    const manager = new GitWorktreeManager();
    const plan = await manager.plan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "65000000-0000-4000-8000-000000000001",
      title: "Reject foreign worktree",
      baseBranch: mainBranch,
      includeChanges: false,
    });
    await mkdir(
      join(state, "worktrees", "10000000-0000-4000-8000-000000000001"),
      {
        recursive: true,
      },
    );
    await exec(
      "git",
      [
        "worktree",
        "add",
        "--no-track",
        "-b",
        "foreign",
        plan.worktreeRoot,
        plan.baseCommit,
      ],
      { cwd: source },
    );

    await expect(manager.provision(plan, false)).rejects.toThrow(
      "worktree_identity_failed",
    );
  });

  it("recovers a transferred worktree after its source changes during a crash", async () => {
    const { source, state } = await fixture();
    await writeFile(join(source, "tracked.txt"), "reviewed\n");
    const manager = new GitWorktreeManager();
    const preflight = await manager.preflight(source);
    if (preflight.changes === null) throw new Error("Expected Git changes");
    const plan = await manager.plan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "70000000-0000-4000-8000-000000000001",
      title: "Recover transferred worktree",
      baseBranch: mainBranch,
      expectedToken: preflight.changes.token,
      includeChanges: true,
    });
    await manager.provision(plan, true);
    await writeFile(join(source, "tracked.txt"), "changed after crash\n");

    const recovered = await manager.recoveryPlan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "70000000-0000-4000-8000-000000000001",
      title: "Recover transferred worktree",
      record: {
        execution_root: plan.executionRoot,
        worktree_root: plan.worktreeRoot,
        git_common_dir: plan.gitCommonDir,
        project_subpath: plan.projectSubpath,
        base_branch: plan.baseBranch,
        base_commit: plan.baseCommit,
        branch_name: plan.branchName,
        transfer_token: plan.sourceToken,
      },
      expectedToken: plan.sourceToken,
      includeChanges: true,
    });
    await manager.provision(recovered, true);
    expect(
      await readFile(join(recovered.executionRoot, "tracked.txt"), "utf8"),
    ).toBe("reviewed\n");
  });

  it("rejects recovery of an unproven partial transfer after source changes", async () => {
    const { source, state } = await fixture();
    await writeFile(join(source, "tracked.txt"), "reviewed\n");
    const manager = new GitWorktreeManager();
    const preflight = await manager.preflight(source);
    if (preflight.changes === null) throw new Error("Expected Git changes");
    const plan = await manager.plan({
      projectRoot: source,
      stateDirectory: state,
      projectId: ProjectIdSchema.parse("10000000-0000-4000-8000-000000000001"),
      worktreeId: "80000000-0000-4000-8000-000000000001",
      title: "Recover partial worktree",
      baseBranch: mainBranch,
      expectedToken: preflight.changes.token,
      includeChanges: true,
    });
    await manager.provision(plan, false);
    await writeFile(join(source, "tracked.txt"), "changed after crash\n");

    await expect(
      manager.recoveryPlan({
        projectRoot: source,
        stateDirectory: state,
        projectId: ProjectIdSchema.parse(
          "10000000-0000-4000-8000-000000000001",
        ),
        worktreeId: "80000000-0000-4000-8000-000000000001",
        title: "Recover partial worktree",
        record: {
          execution_root: plan.executionRoot,
          worktree_root: plan.worktreeRoot,
          git_common_dir: plan.gitCommonDir,
          project_subpath: plan.projectSubpath,
          base_branch: plan.baseBranch,
          base_commit: plan.baseCommit,
          branch_name: plan.branchName,
          transfer_token: plan.sourceToken,
        },
        expectedToken: plan.sourceToken,
        includeChanges: true,
      }),
    ).rejects.toThrow("source_changed");
  });

  it("parses only canonical Git command output", () => {
    expect(parseGitPath(Buffer.from("/repo\n"))).toBe("/repo");
    expect(parseGitObjectId(Buffer.from(`${"a".repeat(40)}\n`))).toBe(
      "a".repeat(40),
    );
    expect(parseGitBranch(Buffer.from("main/topic\n"))).toBe("main/topic");
    for (const output of [
      Buffer.from([0xff]),
      Buffer.from("main\nnext\n"),
      Buffer.from("bad\0\n"),
    ])
      expect(() => parseGitPath(output)).toThrow();
    expect(() => parseGitObjectId(Buffer.from("not-an-oid\n"))).toThrow();
    expect(() => parseGitBranch(Buffer.from("../unsafe\n"))).toThrow();
  });
});
