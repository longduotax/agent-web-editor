import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import type { ProjectId, ThreadId, WorktreeId } from "@pi-web/contracts";

import {
  MetadataStore,
  type ThreadRecord,
  type WorktreeRecord,
} from "../db/store.js";

const exec = promisify(execFile);

export interface ThreadExecutionContext {
  projectId: ProjectId;
  threadId: ThreadId;
  scopeId: ProjectId | WorktreeId;
  mode: "shared" | "worktree";
  executionRoot: string;
  worktree: WorktreeRecord | null;
}

export class ThreadExecutionContextResolver {
  public constructor(private readonly store: MetadataStore) {}

  public async resolve(thread: ThreadRecord): Promise<ThreadExecutionContext> {
    if (thread.worktree_id === null) {
      const project = this.store.getProject(thread.project_id);
      if (project === null) throw new Error("project_not_found");
      let executionRoot: string;
      try {
        executionRoot = await realpath(project.canonical_path);
      } catch {
        throw new Error("project_unavailable");
      }
      return {
        projectId: thread.project_id,
        threadId: thread.id,
        scopeId: thread.project_id,
        mode: "shared",
        executionRoot,
        worktree: null,
      };
    }
    const worktree = this.store.getWorktree(thread.worktree_id);
    if (
      worktree?.project_id !== thread.project_id ||
      worktree.state !== "ready"
    )
      throw new Error("worktree_unavailable");
    let executionRoot: string;
    try {
      executionRoot = await realpath(worktree.execution_root);
    } catch {
      throw new Error("worktree_unavailable");
    }
    if (executionRoot !== worktree.execution_root)
      throw new Error("worktree_unavailable");
    try {
      const commonResult = await exec(
        "git",
        ["-C", worktree.worktree_root, "rev-parse", "--git-common-dir"],
        { timeout: 10_000 },
      );
      const commonText = commonResult.stdout.trim();
      const common = await realpath(
        isAbsolute(commonText)
          ? commonText
          : resolve(worktree.worktree_root, commonText),
      );
      const branchResult = await exec(
        "git",
        ["-C", worktree.worktree_root, "symbolic-ref", "--short", "HEAD"],
        { timeout: 10_000 },
      );
      if (
        common !== worktree.git_common_dir ||
        branchResult.stdout.trim() !== worktree.branch_name
      )
        throw new Error("worktree_unavailable");
    } catch {
      throw new Error("worktree_unavailable");
    }
    return {
      projectId: thread.project_id,
      threadId: thread.id,
      scopeId: worktree.id,
      mode: "worktree",
      executionRoot,
      worktree,
    };
  }
}
