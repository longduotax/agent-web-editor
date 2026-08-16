import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  symlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  WorkspacePreflightResponseSchema,
  GitBranchSchema,
  type GitBranch,
  type GitFileStatus,
  type ProjectId,
  RelativePathSchema,
  type WorkspacePreflightResponse,
} from "@pi-web/contracts";

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

function gitLine(stdout: Buffer): string {
  if (stdout.includes(0)) throw new Error("malformed_git_output");
  const value = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
  if (!value.endsWith("\n") || value.slice(0, -1).includes("\n"))
    throw new Error("malformed_git_output");
  return value.slice(0, -1);
}

export function parseGitPath(stdout: Buffer): string {
  const value = gitLine(stdout);
  if (value === "" || value.includes("\0"))
    throw new Error("malformed_git_path");
  return value;
}

export function parseGitObjectId(stdout: Buffer): string {
  const value = gitLine(stdout);
  if (!/^[0-9a-f]{40,64}$/.test(value)) throw new Error("malformed_git_oid");
  return value;
}

export function parseGitBranch(stdout: Buffer): GitBranch {
  const value = gitLine(stdout);
  const parsed = GitBranchSchema.safeParse(value);
  if (!parsed.success) throw new Error("malformed_git_ref");
  return parsed.data;
}

export function parseGitBranchList(stdout: Buffer): string[] {
  if (stdout.includes(0)) throw new Error("malformed_git_output");
  const value = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
  if (value === "") return [];
  if (!value.endsWith("\n")) throw new Error("malformed_git_output");
  return value
    .slice(0, -1)
    .split("\n")
    .map((entry) => parseGitBranch(Buffer.from(`${entry}\n`)));
}

export interface WorktreeStatusEntry {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  kind: GitFileStatus["kind"];
  hasSubmoduleState: boolean;
}

const statusCode = "[.MTADRCU]";
const ordinaryRecord = new RegExp(
  `^1 (${statusCode}{2}) ((?:N\\.{3}|S[.C][.M][.U])) ([0-7]{6}) ([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) (.+)$`,
);
const renameRecord = new RegExp(
  `^2 (${statusCode}{2}) ((?:N\\.{3}|S[.C][.M][.U])) ([0-7]{6}) ([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([RC][0-9]{3}) (.+)$`,
);
const unmergedRecord = new RegExp(
  `^u (${statusCode}{2}) ((?:N\\.{3}|S[.C][.M][.U])) ([0-7]{6}) ([0-7]{6}) ([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) (.+)$`,
);

function statusKind(
  index: string,
  worktree: string,
  recordType: "1" | "2" | "u" | "?",
): GitFileStatus["kind"] {
  if (recordType === "?") return "untracked";
  if (
    index === "U" ||
    worktree === "U" ||
    (index === "A" && worktree === "A") ||
    (index === "D" && worktree === "D")
  )
    return "conflicted";
  if (index === "R" || worktree === "R") return "renamed";
  if (index === "C" || worktree === "C") return "copied";
  if (index === "D" || worktree === "D") return "deleted";
  if (index === "A" || worktree === "A") return "added";
  return "modified";
}

/** Parses trusted, project-relative file states from Git porcelain v2 output. */
export function parseWorktreePorcelainV2(bytes: Buffer): WorktreeStatusEntry[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text === "") return [];
  if (!text.endsWith("\0")) throw new Error("malformed_git_status");
  const records = text.slice(0, -1).split("\0");
  const files: WorktreeStatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record === "")
      throw new Error("malformed_git_status");
    if (record.startsWith("? ")) {
      const path = RelativePathSchema.parse(record.slice(2));
      files.push({
        path,
        originalPath: null,
        indexStatus: "?",
        worktreeStatus: "?",
        kind: "untracked",
        hasSubmoduleState: false,
      });
      continue;
    }
    const recordType = record[0];
    if (recordType === "1") {
      const match = ordinaryRecord.exec(record);
      if (match === null) throw new Error("malformed_git_status");
      const [, xy, submodule, , , , , , rawPath] = match;
      if (xy === undefined || submodule === undefined || rawPath === undefined)
        throw new Error("malformed_git_status");
      const path = RelativePathSchema.parse(rawPath);
      files.push({
        path,
        originalPath: null,
        indexStatus: xy[0] ?? ".",
        worktreeStatus: xy[1] ?? ".",
        kind: statusKind(xy[0] ?? ".", xy[1] ?? ".", "1"),
        hasSubmoduleState: submodule.startsWith("S"),
      });
      continue;
    }
    if (recordType === "2") {
      const match = renameRecord.exec(record);
      const originalPath = records[index + 1];
      if (match === null || originalPath === undefined || originalPath === "")
        throw new Error("malformed_git_status");
      const [, xy, submodule, , , , , , , rawPath] = match;
      if (xy === undefined || submodule === undefined || rawPath === undefined)
        throw new Error("malformed_git_status");
      const path = RelativePathSchema.parse(rawPath);
      files.push({
        path,
        originalPath: RelativePathSchema.parse(originalPath),
        indexStatus: xy[0] ?? ".",
        worktreeStatus: xy[1] ?? ".",
        kind: statusKind(xy[0] ?? ".", xy[1] ?? ".", "2"),
        hasSubmoduleState: submodule.startsWith("S"),
      });
      index += 1;
      continue;
    }
    if (recordType === "u") {
      const match = unmergedRecord.exec(record);
      if (match === null) throw new Error("malformed_git_status");
      const [, xy, submodule, , , , , , , , rawPath] = match;
      if (xy === undefined || submodule === undefined || rawPath === undefined)
        throw new Error("malformed_git_status");
      const path = RelativePathSchema.parse(rawPath);
      files.push({
        path,
        originalPath: null,
        indexStatus: xy[0] ?? ".",
        worktreeStatus: xy[1] ?? ".",
        kind: statusKind(xy[0] ?? ".", xy[1] ?? ".", "u"),
        hasSubmoduleState: submodule.startsWith("S"),
      });
      continue;
    }
    throw new Error("malformed_git_status");
  }
  return files;
}

async function gitOutput(cwd: string, args: string[]): Promise<Buffer> {
  const result = await git(cwd, args);
  if (result.code !== 0) throw new Error("git_command_failed");
  return result.stdout;
}

async function untrackedManifest(
  root: string,
  status: Buffer,
): Promise<Buffer> {
  const entries: string[] = [];
  for (const file of parseWorktreePorcelainV2(status).filter(
    (entry) => entry.kind === "untracked",
  )) {
    const source = safeContained(root, file.path);
    const info = await lstat(source);
    if (info.isFile()) {
      const content = await readFile(source);
      entries.push(
        `${file.path}\0file\0${(info.mode & 0o777).toString(8).padStart(3, "0")}\0${createHash("sha256").update(content).digest("hex")}`,
      );
    } else if (info.isSymbolicLink()) {
      entries.push(
        `${file.path}\0symlink\0${createHash("sha256")
          .update(await readlink(source))
          .digest("hex")}`,
      );
    } else throw new Error("source_changes_unsupported");
  }
  return Buffer.from(entries.sort().join("\n"), "utf8");
}

async function stateToken(
  root: string,
  head: string,
  status: Buffer,
): Promise<string> {
  const [staged, unstaged] = await Promise.all([
    gitOutput(root, ["diff", "--cached", "--binary", "--full-index", "HEAD"]),
    gitOutput(root, ["diff", "--binary", "--full-index"]),
  ]);
  return (
    createHash("sha256")
      .update(head)
      .update("\0")
      .update(status)
      .update("\0")
      // Porcelain records only a tracked file's state.  Hash the exact binary
      // patch inputs too, so a reviewed modification cannot be replaced before
      // transfer without changing this token.
      .update(createHash("sha256").update(staged).digest())
      .update(createHash("sha256").update(unstaged).digest())
      .update("\0")
      .update(await untrackedManifest(root, status))
      .digest("hex")
  );
}

function hasSubmoduleState(entries: WorktreeStatusEntry[]): boolean {
  return entries.some((entry) => entry.hasSubmoduleState);
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
  baseBranch: GitBranch;
  baseCommit: string;
  branchName: GitBranch;
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
        parseGitPath(
          await gitOutput(projectRoot, ["rev-parse", "--show-toplevel"]),
        ),
      );
      const head = parseGitObjectId(
        await gitOutput(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]),
      );
      const branchResult = await git(repoRoot, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]);
      const currentBranch =
        branchResult.code === 0 ? parseGitBranch(branchResult.stdout) : null;
      const branches = parseGitBranchList(
        await gitOutput(repoRoot, [
          "for-each-ref",
          "--format=%(refname:short)",
          "refs/heads",
        ]),
      );
      const status = await git(repoRoot, [
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
      ]);
      if (status.code !== 0) throw new Error("git_status_failed");
      const files = parseWorktreePorcelainV2(status.stdout);
      return WorkspacePreflightResponseSchema.parse({
        worktreeAvailable: true,
        unavailableReason: null,
        currentBranch,
        branches,
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
          token: await stateToken(repoRoot, head, status.stdout),
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

  /** Authorizes a parsed branch against this repository's local heads. */
  public async authorizeBaseBranch(
    projectRoot: string,
    branch: GitBranch,
  ): Promise<void> {
    const repoRoot = await realpath(
      parseGitPath(
        await gitOutput(projectRoot, ["rev-parse", "--show-toplevel"]),
      ),
    );
    const branches = parseGitBranchList(
      await gitOutput(repoRoot, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
      ]),
    );
    if (!branches.includes(branch)) throw new Error("base_branch_unavailable");
  }

  public async plan(input: {
    projectRoot: string;
    stateDirectory: string;
    projectId: ProjectId;
    worktreeId: string;
    title: string;
    baseBranch: GitBranch;
    expectedToken?: string;
    includeChanges: boolean;
  }): Promise<WorktreePlan> {
    const repoRoot = await realpath(
      parseGitPath(
        await gitOutput(input.projectRoot, ["rev-parse", "--show-toplevel"]),
      ),
    );
    const commonRaw = parseGitPath(
      await gitOutput(repoRoot, ["rev-parse", "--git-common-dir"]),
    );
    const gitCommonDir = await realpath(
      isAbsolute(commonRaw) ? commonRaw : resolve(repoRoot, commonRaw),
    );
    const projectSubpath = relative(
      repoRoot,
      await realpath(input.projectRoot),
    );
    if (projectSubpath.startsWith("..") || isAbsolute(projectSubpath))
      throw new Error("project_repository_mismatch");
    const branches = parseGitBranchList(
      await gitOutput(repoRoot, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
      ]),
    );
    if (!branches.includes(input.baseBranch))
      throw new Error("base_branch_unavailable");
    const baseCommit = parseGitObjectId(
      await gitOutput(repoRoot, [
        "rev-parse",
        "--verify",
        `refs/heads/${input.baseBranch}^{commit}`,
      ]),
    );
    const head = parseGitObjectId(
      await gitOutput(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]),
    );
    const status = await git(repoRoot, [
      "status",
      "--porcelain=v2",
      "-z",
      "--untracked-files=all",
    ]);
    if (status.code !== 0) throw new Error("git_status_failed");
    const files = parseWorktreePorcelainV2(status.stdout);
    const token = await stateToken(repoRoot, head, status.stdout);
    if (input.includeChanges) {
      const current = parseGitBranch(
        await gitOutput(repoRoot, [
          "symbolic-ref",
          "--quiet",
          "--short",
          "HEAD",
        ]),
      );
      if (
        current !== input.baseBranch ||
        baseCommit !== head ||
        input.expectedToken === undefined ||
        input.expectedToken !== token
      )
        throw new Error("source_changed");
      if (
        files.some((file) => file.kind === "conflicted") ||
        hasSubmoduleState(files)
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
      branchName: GitBranchSchema.parse(`pi/${leaf}`),
      worktreeRoot,
      executionRoot:
        projectSubpath === ""
          ? worktreeRoot
          : join(worktreeRoot, projectSubpath),
      sourceToken: token,
    };
  }

  /** Rebuilds a provisioning plan from the immutable identity already stored. */
  public async recoveryPlan(input: {
    projectRoot: string;
    stateDirectory: string;
    projectId: ProjectId;
    worktreeId: string;
    title: string;
    record: {
      execution_root: string;
      worktree_root: string;
      git_common_dir: string;
      project_subpath: string;
      base_branch: GitBranch;
      base_commit: string;
      branch_name: GitBranch;
      transfer_token: string | null;
    };
    expectedToken?: string;
    includeChanges: boolean;
  }): Promise<WorktreePlan> {
    const repoRoot = await realpath(
      parseGitPath(
        await gitOutput(input.projectRoot, ["rev-parse", "--show-toplevel"]),
      ),
    );
    const commonRaw = parseGitPath(
      await gitOutput(repoRoot, ["rev-parse", "--git-common-dir"]),
    );
    const gitCommonDir = await realpath(
      isAbsolute(commonRaw) ? commonRaw : resolve(repoRoot, commonRaw),
    );
    const projectSubpath = relative(
      repoRoot,
      await realpath(input.projectRoot),
    );
    if (projectSubpath.startsWith("..") || isAbsolute(projectSubpath))
      throw new Error("project_repository_mismatch");
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
    const executionRoot =
      projectSubpath === "" ? worktreeRoot : join(worktreeRoot, projectSubpath);
    const { record } = input;
    if (
      gitCommonDir !== record.git_common_dir ||
      projectSubpath !== record.project_subpath ||
      worktreeRoot !== record.worktree_root ||
      executionRoot !== record.execution_root ||
      `pi/${leaf}` !== record.branch_name
    )
      throw new Error("worktree_identity_failed");
    if (input.includeChanges && record.transfer_token !== null) {
      try {
        if (
          (await lstat(worktreeRoot)).isDirectory() &&
          parseGitObjectId(
            await gitOutput(worktreeRoot, ["rev-parse", "HEAD^{commit}"]),
          ) === record.base_commit
        ) {
          const targetStatus = await git(worktreeRoot, [
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
          ]);
          if (
            targetStatus.code === 0 &&
            (await stateToken(
              worktreeRoot,
              record.base_commit,
              targetStatus.stdout,
            )) === record.transfer_token
          )
            return {
              repoRoot,
              gitCommonDir,
              projectSubpath,
              baseBranch: record.base_branch,
              baseCommit: record.base_commit,
              branchName: record.branch_name,
              worktreeRoot,
              executionRoot,
              sourceToken: record.transfer_token,
            };
        }
      } catch {
        // An absent or malformed target is unproven and must use normal recovery.
      }
    }
    const head = parseGitObjectId(
      await gitOutput(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]),
    );
    const status = await git(repoRoot, [
      "status",
      "--porcelain=v2",
      "-z",
      "--untracked-files=all",
    ]);
    if (status.code !== 0) throw new Error("git_status_failed");
    const files = parseWorktreePorcelainV2(status.stdout);
    const sourceToken = await stateToken(repoRoot, head, status.stdout);
    if (
      input.includeChanges &&
      (input.expectedToken === undefined || input.expectedToken !== sourceToken)
    )
      throw new Error("source_changed");
    if (input.includeChanges) {
      const current = parseGitBranch(
        await gitOutput(repoRoot, [
          "symbolic-ref",
          "--quiet",
          "--short",
          "HEAD",
        ]),
      );
      if (
        current !== input.record.base_branch ||
        head !== input.record.base_commit
      )
        throw new Error("source_changed");
    }
    if (
      input.includeChanges &&
      (files.some((file) => file.kind === "conflicted") ||
        hasSubmoduleState(files))
    )
      throw new Error("source_changes_unsupported");
    return {
      repoRoot,
      gitCommonDir,
      projectSubpath,
      baseBranch: record.base_branch,
      baseCommit: record.base_commit,
      branchName: record.branch_name,
      worktreeRoot,
      executionRoot,
      sourceToken,
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
        try {
          const commonRaw = parseGitPath(
            await gitOutput(plan.worktreeRoot, [
              "rev-parse",
              "--git-common-dir",
            ]),
          );
          const commonDir = await realpath(
            isAbsolute(commonRaw)
              ? commonRaw
              : resolve(plan.worktreeRoot, commonRaw),
          );
          const branch = parseGitBranch(
            await gitOutput(plan.worktreeRoot, [
              "symbolic-ref",
              "--short",
              "HEAD",
            ]),
          );
          const head = parseGitObjectId(
            await gitOutput(plan.worktreeRoot, ["rev-parse", "HEAD^{commit}"]),
          );
          if (
            commonDir !== plan.gitCommonDir ||
            branch !== plan.branchName ||
            head !== plan.baseCommit
          )
            throw new Error("worktree_identity_failed");
        } catch {
          throw new Error("worktree_identity_failed");
        }
        const existingStatus = await git(plan.worktreeRoot, [
          "status",
          "--porcelain=v2",
          "-z",
          "--untracked-files=all",
        ]);
        if (existingStatus.code !== 0)
          throw new Error("worktree_identity_failed");
        const existingFiles = parseWorktreePorcelainV2(existingStatus.stdout);
        if (!includeChanges && existingFiles.length === 0) return;
        if (
          includeChanges &&
          (await stateToken(
            plan.worktreeRoot,
            plan.baseCommit,
            existingStatus.stdout,
          )) === plan.sourceToken
        )
          return;
        if (existingFiles.length !== 0)
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
        const head = parseGitObjectId(
          await gitOutput(plan.repoRoot, ["rev-parse", "HEAD^{commit}"]),
        );
        if (
          (await stateToken(plan.repoRoot, head, before.stdout)) !==
          plan.sourceToken
        )
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
        untracked = parseWorktreePorcelainV2(before.stdout)
          .filter((file) => file.kind === "untracked")
          .map((file) => file.path);
        const after = await git(plan.repoRoot, [
          "status",
          "--porcelain=v2",
          "-z",
          "--untracked-files=all",
        ]);
        if (
          (await stateToken(plan.repoRoot, head, after.stdout)) !==
          plan.sourceToken
        )
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
        parseGitObjectId(
          await gitOutput(plan.worktreeRoot, ["rev-parse", "HEAD^{commit}"]),
        ) !== plan.baseCommit
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
      if (includeChanges) {
        const afterCopy = await git(plan.repoRoot, [
          "status",
          "--porcelain=v2",
          "-z",
          "--untracked-files=all",
        ]);
        const currentHead = parseGitObjectId(
          await gitOutput(plan.repoRoot, ["rev-parse", "HEAD^{commit}"]),
        );
        if (
          afterCopy.code !== 0 ||
          (await stateToken(plan.repoRoot, currentHead, afterCopy.stdout)) !==
            plan.sourceToken
        )
          throw new Error("source_changed");
      }
      await realpath(plan.executionRoot);
      const finalStatus = await git(plan.worktreeRoot, [
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
      ]);
      if (finalStatus.code !== 0) throw new Error("worktree_verify_failed");
      const finalFiles = parseWorktreePorcelainV2(finalStatus.stdout);
      if (!includeChanges && finalFiles.length !== 0)
        throw new Error("worktree_not_clean");
      if (
        includeChanges &&
        (await stateToken(
          plan.worktreeRoot,
          plan.baseCommit,
          finalStatus.stdout,
        )) !== plan.sourceToken
      )
        throw new Error("source_transfer_mismatch");
    } finally {
      release();
      if (this.locks.get(plan.gitCommonDir) === queued)
        this.locks.delete(plan.gitCommonDir);
    }
  }
}
