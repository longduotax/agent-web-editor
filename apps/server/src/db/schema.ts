import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    canonicalPath: text("canonical_path").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at").notNull(),
    removedAt: text("removed_at"),
    sidebarExpanded: integer("sidebar_expanded").notNull().default(1),
    lastOpenedThreadId: text("last_opened_thread_id"),
  },
  (table) => [
    uniqueIndex("projects_canonical_path_unique").on(table.canonicalPath),
  ],
);

export const worktrees = sqliteTable(
  "worktrees",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    state: text("state", {
      enum: ["provisioning", "ready", "failed"],
    }).notNull(),
    executionRoot: text("execution_root").notNull(),
    worktreeRoot: text("worktree_root").notNull(),
    gitCommonDir: text("git_common_dir").notNull(),
    projectSubpath: text("project_subpath").notNull(),
    baseBranch: text("base_branch").notNull(),
    baseCommit: text("base_commit").notNull(),
    branchName: text("branch_name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
  },
  (table) => [
    uniqueIndex("worktrees_execution_root_unique").on(table.executionRoot),
    uniqueIndex("worktrees_worktree_root_unique").on(table.worktreeRoot),
    uniqueIndex("worktrees_common_branch_unique").on(
      table.gitCommonDir,
      table.branchName,
    ),
    index("worktrees_project_state_idx").on(table.projectId, table.state),
  ],
);

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    runtime: text("runtime", { enum: ["pi", "codex"] })
      .notNull()
      .default("pi"),
    runtimeSessionId: text("runtime_session_id").notNull(),
    createdAt: text("created_at").notNull(),
    lastActivityAt: text("last_activity_at").notNull(),
    lastCompletedRunId: text("last_completed_run_id"),
    lastViewedCompletedRunId: text("last_viewed_completed_run_id"),
    archivedAt: text("archived_at"),
    worktreeId: text("worktree_id").references(() => worktrees.id),
    initialTitlePending: integer("initial_title_pending").notNull().default(0),
  },
  (table) => [
    uniqueIndex("threads_project_runtime_unique").on(
      table.projectId,
      table.runtime,
      table.runtimeSessionId,
    ),
    uniqueIndex("threads_id_project_unique").on(table.id, table.projectId),
    index("threads_project_activity_idx").on(
      table.projectId,
      table.lastActivityAt,
    ),
    index("threads_project_archive_activity_idx").on(
      table.projectId,
      table.archivedAt,
      table.lastActivityAt,
    ),
    index("threads_worktree_idx")
      .on(table.worktreeId)
      .where(sql`${table.worktreeId} IS NOT NULL`),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    state: text("state", {
      enum: ["running", "completed", "failed", "interrupted"],
    }).notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    acceptedCommandId: text("accepted_command_id").notNull().unique(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    worktreeId: text("worktree_id").references(() => worktrees.id),
  },
  (table) => [
    index("runs_thread_started_idx").on(table.threadId, table.startedAt),
    uniqueIndex("runs_one_running_per_thread")
      .on(table.threadId)
      .where(sql`${table.state} = 'running'`),
    uniqueIndex("runs_one_running_per_worktree")
      .on(table.worktreeId)
      .where(
        sql`${table.state} = 'running' AND ${table.worktreeId} IS NOT NULL`,
      ),
  ],
);

export const threadContinuationOperations = sqliteTable(
  "thread_continuation_operations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    sourceThreadId: text("source_thread_id")
      .notNull()
      .references(() => threads.id),
    worktreeId: text("worktree_id")
      .notNull()
      .references(() => worktrees.id),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    state: text("state", {
      enum: ["creating_session", "session_created", "thread_created", "failed"],
    }).notNull(),
    runtimeSessionId: text("runtime_session_id"),
    threadId: text("thread_id").references(() => threads.id),
    title: text("title"),
    promptCommandId: text("prompt_command_id"),
    initialPromptDispatchId: text("initial_prompt_dispatch_id"),
    runId: text("run_id").references(() => runs.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
  },
  (table) => [
    uniqueIndex("thread_continuation_project_key_unique").on(
      table.projectId,
      table.idempotencyKey,
    ),
    index("thread_continuation_project_state_idx").on(
      table.projectId,
      table.state,
    ),
    uniqueIndex("thread_continuation_prompt_command_unique")
      .on(table.projectId, table.promptCommandId)
      .where(sql`${table.promptCommandId} IS NOT NULL`),
    uniqueIndex("thread_continuation_prompt_dispatch_unique")
      .on(table.initialPromptDispatchId)
      .where(sql`${table.initialPromptDispatchId} IS NOT NULL`),
  ],
);

export const threadCreationOperations = sqliteTable(
  "thread_creation_operations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    state: text("state", {
      enum: [
        "naming",
        "provisioning",
        "session_created",
        "thread_created",
        "prompt_accepted",
        "failed",
      ],
    }).notNull(),
    workspaceMode: text("workspace_mode", {
      enum: ["shared", "worktree"],
    }).notNull(),
    runtime: text("runtime", { enum: ["pi", "codex"] })
      .notNull()
      .default("pi"),
    baseBranch: text("base_branch"),
    sourceChanges: text("source_changes", {
      enum: ["none", "tracked_and_untracked"],
    }),
    title: text("title"),
    slug: text("slug"),
    worktreeId: text("worktree_id").references(() => worktrees.id),
    runtimeSessionId: text("runtime_session_id"),
    threadId: text("thread_id").references(() => threads.id),
    runId: text("run_id").references(() => runs.id),
    promptCommandId: text("prompt_command_id").notNull(),
    initialPromptDispatchId: text("initial_prompt_dispatch_id"),
    initialPromptDispatchState: text("initial_prompt_dispatch_state", {
      enum: ["none", "prepared", "accepted", "rejected"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
  },
  (table) => [
    uniqueIndex("thread_creation_project_key_unique").on(
      table.projectId,
      table.idempotencyKey,
    ),
    index("thread_creation_project_state_idx").on(table.projectId, table.state),
  ],
);

export const commandReceipts = sqliteTable(
  "command_receipts",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key] })],
);
