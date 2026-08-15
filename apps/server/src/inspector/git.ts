import { spawn } from "node:child_process";

import {
  GitDiffResponseSchema,
  GitStatusResponseSchema,
  RelativePathSchema,
  type GitFileStatus,
} from "@pi-web/contracts";

const OUTPUT_LIMIT = 5 * 1024 * 1024;

interface ProcessResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
  truncated: boolean;
}

async function runGit(cwd: string, args: string[]): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
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
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let truncated = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("git_timeout"));
    }, 10_000);
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      if (size >= OUTPUT_LIMIT) {
        truncated = true;
        child.kill("SIGKILL");
        return;
      }
      const remaining = OUTPUT_LIMIT - size;
      const bounded = chunk.subarray(0, remaining);
      target.push(bounded);
      size += bounded.length;
      if (bounded.length < chunk.length) {
        truncated = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        truncated,
      });
    });
  });
}

function statusKind(
  index: string,
  worktree: string,
  recordType: string,
): GitFileStatus["kind"] {
  if (recordType === "?" || index === "?" || worktree === "?")
    return "untracked";
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

export function parsePorcelainV2(bytes: Buffer): GitFileStatus[] {
  const records = bytes.toString("utf8").split("\0");
  const files: GitFileStatus[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (
      record === undefined ||
      record === "" ||
      record.startsWith("# ") ||
      record.startsWith("! ")
    )
      continue;
    if (record.startsWith("? ")) {
      files.push({
        path: record.slice(2),
        originalPath: null,
        indexStatus: "?",
        worktreeStatus: "?",
        kind: "untracked",
      });
      continue;
    }
    const type = record[0];
    if (type !== "1" && type !== "2" && type !== "u")
      throw new Error("malformed_git_status");
    const fields = record.split(" ");
    const xy = fields[1];
    if (xy?.length !== 2) throw new Error("malformed_git_status");
    const pathStart = type === "1" ? 8 : type === "2" ? 9 : 10;
    const path = fields.slice(pathStart).join(" ");
    if (path === "") throw new Error("malformed_git_status");
    let originalPath: string | null = null;
    if (type === "2") {
      originalPath = records[index + 1] ?? null;
      if (originalPath === null || originalPath === "")
        throw new Error("malformed_git_status");
      index += 1;
    }
    files.push({
      path,
      originalPath,
      indexStatus: xy[0] ?? ".",
      worktreeStatus: xy[1] ?? ".",
      kind: statusKind(xy[0] ?? ".", xy[1] ?? ".", type),
    });
  }
  return files;
}

export async function getGitStatus(cwd: string) {
  const detection = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (
    detection.code !== 0 ||
    detection.stdout.toString("utf8").trim() !== "true"
  ) {
    return GitStatusResponseSchema.parse({
      available: false,
      files: [],
      message: "This project is not a Git working tree.",
    });
  }
  const status = await runGit(cwd, [
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.code !== 0 || status.truncated)
    throw new Error(
      status.truncated ? "git_output_limit" : "git_status_failed",
    );
  return GitStatusResponseSchema.parse({
    available: true,
    files: parsePorcelainV2(status.stdout),
    message: null,
  });
}

function boundedText(result: ProcessResult): {
  text: string;
  truncated: boolean;
} {
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(result.stdout),
    truncated: result.truncated,
  };
}

export async function getGitDiff(cwd: string, rawPath: unknown) {
  const path = RelativePathSchema.parse(rawPath);
  const status = await getGitStatus(cwd);
  if (!status.available) throw new Error("git_unavailable");
  const file = status.files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error("git_path_not_changed");
  const stagedResult = await runGit(cwd, [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--",
    path,
  ]);
  const unstagedResult =
    file.kind === "untracked"
      ? await runGit(cwd, ["diff", "--no-index", "--", "/dev/null", path])
      : await runGit(cwd, ["diff", "--no-ext-diff", "--", path]);
  if (stagedResult.code !== 0 && stagedResult.code !== 1)
    throw new Error("git_diff_failed");
  if (unstagedResult.code !== 0 && unstagedResult.code !== 1)
    throw new Error("git_diff_failed");
  const staged = boundedText(stagedResult);
  const unstaged = boundedText(unstagedResult);
  return GitDiffResponseSchema.parse({
    path,
    staged: staged.text,
    unstaged: unstaged.text,
    truncated: staged.truncated || unstaged.truncated,
  });
}
