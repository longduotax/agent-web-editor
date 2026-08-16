import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readlink,
  realpath,
  symlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  WorkspacePreflightResponseSchema,
  type ProjectId,
  type WorkspacePreflightResponse,
} from "@pi-web/contracts";

import { parsePorcelainV2 } from "../inspector/git.js";

interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

async function git(
  cwd: string,
  args: string[],
  input?: Buffer,
  timeoutMs = 30_000,
): Promise<GitResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(
      "git",
      [
        "-c",
        "color.ui=false",
        "-c",
        "core.quotepath=false",
        "--no-pager",
        ...args,
      ],
      {
        cwd,
        shell: false,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: "C",
          LC_ALL: "C",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    const limit = 64 * 1024 * 1024;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("git_timeout"));
    }, timeoutMs);
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        child.kill("SIGKILL");
        reject(new Error("git_output_limit"));
        return;
      }
      target.push(chunk);
    };
    child.stdout?.on("data", collect(stdout));
    child.stderr?.on("data", collect(stderr));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolveResult({
        code: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  if (result.code !== 0) throw new Error("git_command_failed");
  return result.stdout.toString("utf8").trim();
}

function stateToken(head: string, status: Buffer): string {
  return createHash("sha256")
    .update(head)
    .update("\0")
    .update(status)
    .digest("hex");
}

function hasSubmoduleState(status: Buffer): boolean {
  return status
    .toString("utf8")
    .split("\0")
    .some((record) => {
      if (!/^[12u] /.test(record)) return false;
      return record.split(" ")[2]?.startsWith("S") === true;
    });
}

function safeContained(root: string, path: string): string {
  if (path === "" || isAbsolute(path) || path.includes("\0"))
    throw new Error("unsafe_git_path");
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new Error("unsafe_git_path");
  return target;
}

export function worktreeSlug(title: string): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return normalized || "thread";
}

export interface WorktreePlan {
  repoRoot: string;
  gitCommonDir: string;
  projectSubpath: string;
  baseBranch: string;
  baseCommit: string;
  branchName: string;
  worktreeRoot: string;
  executionRoot: string;
  sourceToken: string;
}

export class GitWorktreeManager {
  private readonly locks = new Map<string, Promise<void>>();

  public async preflight(
    projectRoot: string,
  ): Promise<WorkspacePreflightResponse> {
    try {
      const repoRoot = await realpath(
        await gitText(projectRoot, ["rev-parse", "--show-toplevel"]),
      );
      const head = await gitText(repoRoot, [
        "rev-parse",
        "--verify",
        "HEAD^{commit}",
      ]);
      const branchResult = await git(repoRoot, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]);
      const currentBranch =
        branchResult.code === 0
          ? branchResult.stdout.toString("utf8").trim()
          : null;
      const branchesText = await gitText(repoRoot, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
      ]);
      const status = await git(repoRoot, [
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
      ]);
      if (status.code !== 0) throw new Error("git_status_failed");
      const files = parsePorcelainV2(status.stdout);
      return WorkspacePreflightResponseSchema.parse({
        worktreeAvailable: true,
        unavailableReason: null,
        currentBranch,
        branches: branchesText === "" ? [] : branchesText.split("\n"),
        headCommit: head,
        changes: {
          staged: files.filter(
            (file) => file.indexStatus !== "." && file.indexStatus !== "?",
          ).length,
          modified: files.filter((file) => file.kind === "modified").length,
          deleted: files.filter((file) => file.kind === "deleted").length,
          renamed: files.filter((file) => file.kind === "renamed").length,
          untracked: files.filter((file) => file.kind === "untracked").length,
          files: files.map((file) => file.path),
          token: stateToken(head, status.stdout),
        },
      });
    } catch {
      return WorkspacePreflightResponseSchema.parse({
        worktreeAvailable: false,
        unavailableReason:
          "This project is not a supported Git working tree with a committed HEAD.",
        currentBranch: null,
        branches: [],
        headCommit: null,
        changes: null,
      });
    }
  }

  public async plan(input: {
    projectRoot: string;
    stateDirectory: string;
    projectId: ProjectId;
    worktreeId: string;
    title: string;
    baseBranch: string;
    expectedToken?: string;
    includeChanges: boolean;
  }): Promise<WorktreePlan> {
    const repoRoot = await realpath(
      await gitText(input.projectRoot, ["rev-parse", "--show-toplevel"]),
    );
    const commonRaw = await gitText(repoRoot, [
      "rev-parse",
      "--git-common-dir",
    ]);
    const gitCommonDir = await realpath(
      isAbsolute(commonRaw) ? commonRaw : resolve(repoRoot, commonRaw),
    );
    const projectSubpath = relative(
      repoRoot,
      await realpath(input.projectRoot),
    );
    if (projectSubpath.startsWith("..") || isAbsolute(projectSubpath))
      throw new Error("project_repository_mismatch");
    const baseCommit = await gitText(repoRoot, [
      "rev-parse",
      "--verify",
      `refs/heads/${input.baseBranch}^{commit}`,
    ]);
    const head = await gitText(repoRoot, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ]);
    const status = await git(repoRoot, [
      "status",
      "--porcelain=v2",
      "-z",
      "--untracked-files=all",
    ]);
    if (status.code !== 0) throw new Error("git_status_failed");
    const token = stateToken(head, status.stdout);
    if (input.includeChanges) {
      const current = await gitText(repoRoot, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]);
      if (
        current !== input.baseBranch ||
        baseCommit !== head ||
        input.expectedToken === undefined ||
        input.expectedToken !== token
      )
        throw new Error("source_changed");
      if (
        parsePorcelainV2(status.stdout).some(
          (file) => file.kind === "conflicted",
        ) ||
        hasSubmoduleState(status.stdout)
      )
        throw new Error("source_changes_unsupported");
    }
    const slug = worktreeSlug(input.title);
    const suffix = input.worktreeId.replaceAll("-", "").slice(0, 8);
    const leaf = `${slug}-${suffix}`;
    const canonicalStateDirectory = await realpath(input.stateDirectory);
    const worktreeRoot = join(
      canonicalStateDirectory,
      "worktrees",
      input.projectId,
      leaf,
    );
    return {
      repoRoot,
      gitCommonDir,
      projectSubpath,
      baseBranch: input.baseBranch,
      baseCommit,
      branchName: `pi/${leaf}`,
      worktreeRoot,
      executionRoot:
        projectSubpath === ""
          ? worktreeRoot
          : join(worktreeRoot, projectSubpath),
      sourceToken: token,
    };
  }

  public async provision(
    plan: WorktreePlan,
    includeChanges: boolean,
  ): Promise<void> {
    const previous = this.locks.get(plan.gitCommonDir) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = previous.then(() => current);
    this.locks.set(plan.gitCommonDir, queued);
    await previous;
    try {
      let targetExists = false;
      try {
        targetExists = (await lstat(plan.worktreeRoot)).isDirectory();
      } catch {
        targetExists = false;
      }
      if (targetExists) {
        if (
          (await gitText(plan.worktreeRoot, ["rev-parse", "HEAD^{commit}"])) !==
          plan.baseCommit
        )
          throw new Error("worktree_identity_failed");
        const existingStatus = await git(plan.worktreeRoot, [
          "status",
          "--porcelain=v2",
          "-z",
          "--untracked-files=all",
        ]);
        if (existingStatus.code !== 0)
          throw new Error("worktree_identity_failed");
        if (!includeChanges && existingStatus.stdout.length === 0) return;
        if (
          includeChanges &&
          stateToken(plan.baseCommit, existingStatus.stdout) ===
            plan.sourceToken
        )
          return;
        if (existingStatus.stdout.length !== 0)
          throw new Error("worktree_recovery_required");
      }
      let staged: Buffer = Buffer.alloc(0);
      let unstaged: Buffer = Buffer.alloc(0);
      let untracked: string[] = [];
      if (includeChanges) {
        const before = await git(plan.repoRoot, [
          "status",
          "--porcelain=v2",
          "-z",
          "--untracked-files=all",
        ]);
        const head = await gitText(plan.repoRoot, [
          "rev-parse",
          "HEAD^{commit}",
        ]);
        if (stateToken(head, before.stdout) !== plan.sourceToken)
          throw new Error("source_changed");
        staged = (
          await git(plan.repoRoot, [
            "diff",
            "--cached",
            "--binary",
            "--full-index",
            "HEAD",
          ])
        ).stdout;
        unstaged = (
          await git(plan.repoRoot, ["diff", "--binary", "--full-index"])
        ).stdout;
        untracked = parsePorcelainV2(before.stdout)
          .filter((file) => file.kind === "untracked")
          .map((file) => file.path);
        const after = await git(plan.repoRoot, [
          "status",
          "--porcelain=v2",
          "-z",
          "--untracked-files=all",
        ]);
        if (stateToken(head, after.stdout) !== plan.sourceToken)
          throw new Error("source_changed");
      }
      if (!targetExists) {
        await mkdir(dirname(plan.worktreeRoot), {
          recursive: true,
          mode: 0o700,
        });
        const added = await git(
          plan.repoRoot,
          [
            "worktree",
            "add",
            "--no-track",
            "-b",
            plan.branchName,
            plan.worktreeRoot,
            plan.baseCommit,
          ],
          undefined,
          120_000,
        );
        if (added.code !== 0) throw new Error("worktree_create_failed");
      }
      if (
        (await gitText(plan.worktreeRoot, ["rev-parse", "HEAD^{commit}"])) !==
        plan.baseCommit
      )
        throw new Error("worktree_identity_failed");
      if (staged.length > 0) {
        const applied = await git(
          plan.worktreeRoot,
          ["apply", "--index", "--binary", "-"],
          staged,
        );
        if (applied.code !== 0) throw new Error("source_transfer_failed");
      }
      if (unstaged.length > 0) {
        const applied = await git(
          plan.worktreeRoot,
          ["apply", "--binary", "-"],
          unstaged,
        );
        if (applied.code !== 0) throw new Error("source_transfer_failed");
      }
      for (const path of untracked) {
        const source = safeContained(plan.repoRoot, path);
        const target = safeContained(plan.worktreeRoot, path);
        await mkdir(dirname(target), { recursive: true });
        const info = await lstat(source);
        if (info.isSymbolicLink())
          await symlink(await readlink(source), target);
        else if (info.isFile()) await copyFile(source, target);
        else throw new Error("source_changes_unsupported");
      }
      await realpath(plan.executionRoot);
      const finalStatus = await git(plan.worktreeRoot, [
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
      ]);
      if (finalStatus.code !== 0) throw new Error("worktree_verify_failed");
      if (!includeChanges && finalStatus.stdout.length !== 0)
        throw new Error("worktree_not_clean");
      if (
        includeChanges &&
        stateToken(plan.baseCommit, finalStatus.stdout) !== plan.sourceToken
      )
        throw new Error("source_transfer_mismatch");
    } finally {
      release();
      if (this.locks.get(plan.gitCommonDir) === queued)
        this.locks.delete(plan.gitCommonDir);
    }
  }
}
