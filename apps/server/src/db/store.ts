import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import {
  ProjectIdSchema,
  GitBranchSchema,
  RunIdSchema,
  RunStateSchema,
  ThreadIdSchema,
  TimestampSchema,
  WorktreeIdSchema,
  type ProjectId,
  type RunId,
  type RunState,
  type ThreadId,
  type WorktreeId,
} from "@pi-web/contracts";
import { z } from "zod";

import * as schema from "./schema.js";

const projectRowSchema = z.object({
  id: ProjectIdSchema,
  canonical_path: z.string().min(1),
  display_name: z.string().min(1).max(200),
  created_at: TimestampSchema,
  removed_at: TimestampSchema.nullable(),
  sidebar_expanded: z.union([z.literal(0), z.literal(1)]),
  last_opened_thread_id: ThreadIdSchema.nullable(),
});
const threadRowSchema = z.object({
  id: ThreadIdSchema,
  project_id: ProjectIdSchema,
  title: z.string().min(1).max(200),
  runtime_session_id: z.uuid(),
  created_at: TimestampSchema,
  last_activity_at: TimestampSchema,
  last_completed_run_id: RunIdSchema.nullable(),
  last_viewed_completed_run_id: RunIdSchema.nullable(),
  archived_at: TimestampSchema.nullable(),
  worktree_id: WorktreeIdSchema.nullable(),
});
const worktreeRowSchema = z.object({
  id: WorktreeIdSchema,
  project_id: ProjectIdSchema,
  state: z.enum(["provisioning", "ready", "failed"]),
  execution_root: z.string().min(1),
  worktree_root: z.string().min(1),
  git_common_dir: z.string().min(1),
  project_subpath: z.string(),
  base_branch: GitBranchSchema,
  base_commit: z.string().regex(/^[0-9a-f]{7,64}$/),
  branch_name: GitBranchSchema,
  transfer_token: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  failure_code: z.string().max(80).nullable(),
  failure_message: z.string().max(500).nullable(),
});
const creationRowSchema = z
  .object({
    id: z.uuid(),
    project_id: ProjectIdSchema,
    idempotency_key: z.uuid(),
    request_hash: z.string().length(64),
    state: z.enum([
      "naming",
      "provisioning",
      "session_created",
      "thread_created",
      "prompt_accepted",
      "failed",
    ]),
    workspace_mode: z.enum(["shared", "worktree"]),
    base_branch: GitBranchSchema.nullable(),
    source_changes: z.enum(["none", "tracked_and_untracked"]).nullable(),
    title: z.string().min(1).max(60).nullable(),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .nullable(),
    session_creation_id: z.uuid().nullable(),
    worktree_id: WorktreeIdSchema.nullable(),
    runtime_session_id: z.uuid().nullable(),
    thread_id: ThreadIdSchema.nullable(),
    run_id: RunIdSchema.nullable(),
    prompt_command_id: z.uuid(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
    failure_code: z.string().max(80).nullable(),
    failure_message: z.string().max(500).nullable(),
  })
  .superRefine((row, context) => {
    const named = row.state !== "naming";
    if (named !== (row.title !== null && row.slug !== null))
      context.addIssue({
        code: "custom",
        message: "creation naming state is inconsistent",
      });
    if (
      row.workspace_mode === "shared" &&
      (row.base_branch !== null ||
        row.source_changes !== null ||
        row.worktree_id !== null)
    )
      context.addIssue({
        code: "custom",
        message: "shared creation workspace state is inconsistent",
      });
    if (
      row.workspace_mode === "worktree" &&
      (row.base_branch === null || row.source_changes === null)
    )
      context.addIssue({
        code: "custom",
        message: "worktree creation workspace state is inconsistent",
      });
    const requiresSession = [
      "session_created",
      "thread_created",
      "prompt_accepted",
    ].includes(row.state);
    if (
      requiresSession !== (row.runtime_session_id !== null) ||
      (row.runtime_session_id !== null && row.session_creation_id === null)
    )
      context.addIssue({
        code: "custom",
        message: "creation session state is inconsistent",
      });
    const requiresThread = ["thread_created", "prompt_accepted"].includes(
      row.state,
    );
    if (requiresThread !== (row.thread_id !== null))
      context.addIssue({
        code: "custom",
        message: "creation thread state is inconsistent",
      });
    if ((row.state === "prompt_accepted") !== (row.run_id !== null))
      context.addIssue({
        code: "custom",
        message: "creation run state is inconsistent",
      });
  });
const runRowSchema = z.object({
  id: RunIdSchema,
  thread_id: ThreadIdSchema,
  project_id: ProjectIdSchema,
  state: RunStateSchema,
  started_at: TimestampSchema,
  ended_at: TimestampSchema.nullable(),
  failure_code: z.string().max(80).nullable(),
  failure_message: z.string().max(500).nullable(),
});
const receiptRowSchema = z.object({
  operation: z.string(),
  request_hash: z.string(),
  response_json: z.string(),
});
const sqliteAggregateCountSchema = z.object({
  count: z.number().int().nonnegative(),
});
const sqliteSchemaVersionSchema = z.number().int().nonnegative();

export type ProjectRecord = z.infer<typeof projectRowSchema>;
export type ThreadRecord = z.infer<typeof threadRowSchema>;
export type RunRecord = z.infer<typeof runRowSchema>;
export type WorktreeRecord = z.infer<typeof worktreeRowSchema>;
export type ThreadCreationRecord = z.infer<typeof creationRowSchema>;
export type ListReadResult<T> =
  | { readonly record: T; readonly diagnostic: null }
  | { readonly record: null; readonly diagnostic: string };

export class CorruptRecordError extends Error {
  public constructor(
    public readonly recordType: string,
    public readonly recordId: string,
    options?: ErrorOptions,
  ) {
    super(`Stored ${recordType} record is malformed.`, options);
    this.name = "CorruptRecordError";
  }
}

export class ReceiptConflictError extends Error {
  public constructor() {
    super("Idempotency key was reused for a different command.");
    this.name = "ReceiptConflictError";
  }
}

export function canonicalRequestHash(
  operation: string,
  value: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify([operation, value]))
    .digest("hex");
}

async function secureStateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("State directory must be a real directory");
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(
      "State directory permissions must allow only the current user",
    );
  }
  await chmod(path, 0o700);
}

function parseRow<T>(
  parser: z.ZodType<T>,
  row: unknown,
  type: string,
  fallbackId: string,
): T {
  const result = parser.safeParse(row);
  if (!result.success)
    throw new CorruptRecordError(type, fallbackId, { cause: result.error });
  return result.data;
}

function parseListRows<T>(
  parser: z.ZodType<T>,
  rows: unknown[],
  type: string,
): ListReadResult<T>[] {
  return rows.map((row) => {
    const parsed = parser.safeParse(row);
    return parsed.success
      ? { record: parsed.data, diagnostic: null }
      : {
          record: null,
          diagnostic: `A malformed stored ${type} record was omitted.`,
        };
  });
}

function isNormalizedAbsolutePath(value: string): boolean {
  return isAbsolute(value) && value === resolve(value) && !value.includes("\0");
}

function isSafeProjectSubpath(value: string): boolean {
  if (value === "") return true;
  if (
    isAbsolute(value) ||
    value.includes("\0") ||
    value !== relative("/", `/${value}`)
  )
    return false;
  return value
    .split(sep)
    .every((part) => part !== "" && part !== "." && part !== "..");
}

function parseWorktreeRecord(
  row: unknown,
  stateDirectory: string,
  fallbackId: string,
): WorktreeRecord {
  const record = parseRow(worktreeRowSchema, row, "worktree", fallbackId);
  const expectedParent = join(stateDirectory, "worktrees", record.project_id);
  const rootRelative = relative(expectedParent, record.worktree_root);
  if (
    !isNormalizedAbsolutePath(stateDirectory) ||
    !isNormalizedAbsolutePath(record.worktree_root) ||
    !isNormalizedAbsolutePath(record.execution_root) ||
    !isNormalizedAbsolutePath(record.git_common_dir) ||
    rootRelative === "" ||
    rootRelative.startsWith(`..${sep}`) ||
    rootRelative === ".." ||
    isAbsolute(rootRelative) ||
    rootRelative.includes(sep) ||
    !isSafeProjectSubpath(record.project_subpath) ||
    record.execution_root !==
      (record.project_subpath === ""
        ? record.worktree_root
        : join(record.worktree_root, record.project_subpath))
  )
    throw new CorruptRecordError("worktree", fallbackId);
  return record;
}

function parseWorktreeListRows(
  rows: unknown[],
  stateDirectory: string,
): ListReadResult<WorktreeRecord>[] {
  return rows.map((row, index) => {
    try {
      return {
        record: parseWorktreeRecord(row, stateDirectory, String(index)),
        diagnostic: null,
      };
    } catch {
      return {
        record: null,
        diagnostic: "A malformed stored worktree record was omitted.",
      };
    }
  });
}

function requireRecord<T>(value: T | null, message: string): T {
  if (value === null) throw new Error(message);
  return value;
}

export interface MetadataStoreOptions {
  stateDirectory: string;
  now?: () => string;
  id?: () => string;
}

export class MetadataStore {
  public readonly orm: BetterSQLite3Database<typeof schema>;
  private constructor(
    private readonly sqlite: Database.Database,
    public readonly stateDirectory: string,
    private readonly now: () => string,
    private readonly id: () => string,
  ) {
    this.orm = drizzle(sqlite, { schema });
  }

  public static async open(
    options: MetadataStoreOptions,
  ): Promise<MetadataStore> {
    await secureStateDirectory(options.stateDirectory);
    const databasePath = join(options.stateDirectory, "metadata.sqlite");
    const existed = await stat(databasePath).then(
      () => true,
      () => false,
    );
    const sqlite = new Database(databasePath);
    try {
      sqlite.pragma("foreign_keys = ON");
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("busy_timeout = 5000");
      const schemaVersion = sqliteSchemaVersionSchema.parse(
        sqlite.pragma("user_version", { simple: true }),
      );
      if (schemaVersion > 6)
        throw new Error(
          "Database was created by a newer Pi Web Workspace version",
        );
      const backupBefore = async (version: number): Promise<void> => {
        if (!existed) return;
        const count = sqliteAggregateCountSchema.parse(
          sqlite
            .prepare(
              "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'",
            )
            .get(),
        );
        if (count.count === 0) return;
        const backup = join(
          options.stateDirectory,
          `metadata-before-v${String(version)}-${String(Date.now())}.sqlite`,
        );
        await sqlite.backup(backup);
      };
      let migratedSchemaVersion = schemaVersion;
      if (migratedSchemaVersion < 1) {
        await backupBefore(1);
        const migrationPath = new URL(
          "../../migrations/0001_initial.sql",
          import.meta.url,
        );
        const sql = await readFile(migrationPath, "utf8");
        sqlite.transaction(() => {
          sqlite.exec(sql);
          sqlite.pragma("user_version = 1");
        })();
        migratedSchemaVersion = 1;
      }
      if (migratedSchemaVersion < 2) {
        if (schemaVersion >= 1) await backupBefore(2);
        const migrationPath = new URL(
          "../../migrations/0002_thread_run_lease.sql",
          import.meta.url,
        );
        const sql = await readFile(migrationPath, "utf8");
        sqlite.transaction(() => {
          sqlite.exec(sql);
          sqlite.pragma("user_version = 2");
        })();
        migratedSchemaVersion = 2;
      }
      if (migratedSchemaVersion < 3) {
        if (schemaVersion >= 2) await backupBefore(3);
        const migrationPath = new URL(
          "../../migrations/0003_thread_archives.sql",
          import.meta.url,
        );
        const sql = await readFile(migrationPath, "utf8");
        sqlite.transaction(() => {
          sqlite.exec(sql);
          sqlite.pragma("user_version = 3");
        })();
        migratedSchemaVersion = 3;
      }
      if (migratedSchemaVersion < 4) {
        if (schemaVersion >= 3) await backupBefore(4);
        const migrationPath = new URL(
          "../../migrations/0004_thread_workspaces.sql",
          import.meta.url,
        );
        const sql = await readFile(migrationPath, "utf8");
        sqlite.transaction(() => {
          sqlite.exec(sql);
          sqlite.pragma("user_version = 4");
        })();
        migratedSchemaVersion = 4;
      }
      if (migratedSchemaVersion < 5) {
        if (schemaVersion >= 4) await backupBefore(5);
        const migrationPath = new URL(
          "../../migrations/0005_creation_recovery.sql",
          import.meta.url,
        );
        const sql = await readFile(migrationPath, "utf8");
        sqlite.transaction(() => {
          sqlite.exec(sql);
          sqlite.pragma("user_version = 5");
        })();
        migratedSchemaVersion = 5;
      }
      if (migratedSchemaVersion < 6) {
        if (schemaVersion >= 5) await backupBefore(6);
        const migrationPath = new URL(
          "../../migrations/0006_worktree_transfer_token.sql",
          import.meta.url,
        );
        const sql = await readFile(migrationPath, "utf8");
        sqlite.transaction(() => {
          sqlite.exec(sql);
          sqlite.pragma("user_version = 6");
        })();
      }
      if (process.platform !== "win32") await chmod(databasePath, 0o600);
      const store = new MetadataStore(
        sqlite,
        await realpath(options.stateDirectory),
        options.now ?? (() => new Date().toISOString()),
        options.id ?? randomUUID,
      );
      store.interruptRunningRuns();
      return store;
    } catch (error) {
      sqlite.close();
      throw error;
    }
  }

  public close(): void {
    if (!this.sqlite.open) return;
    this.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    this.sqlite.close();
  }

  private interruptRunningRuns(): void {
    const endedAt = this.now();
    this.sqlite.transaction(() => {
      const rows = this.sqlite
        .prepare("SELECT id, thread_id FROM runs WHERE state = 'running'")
        .all();
      for (const raw of rows) {
        const value = z
          .object({ id: RunIdSchema, thread_id: ThreadIdSchema })
          .parse(raw);
        this.sqlite
          .prepare(
            "UPDATE runs SET state = 'interrupted', ended_at = ?, failure_code = 'server_restart', failure_message = 'The server restarted while this run was active.' WHERE id = ? AND state = 'running'",
          )
          .run(endedAt, value.id);
        this.sqlite
          .prepare(
            "UPDATE threads SET last_activity_at = ?, last_completed_run_id = ? WHERE id = ?",
          )
          .run(endedAt, value.id, value.thread_id);
      }
    })();
  }

  public listProjects(includeRemoved = false): ProjectRecord[] {
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM projects ${includeRemoved ? "" : "WHERE removed_at IS NULL"} ORDER BY created_at`,
      )
      .all();
    return rows.map((row, index) =>
      parseRow(projectRowSchema, row, "project", String(index)),
    );
  }

  public listProjectResults(
    includeRemoved = false,
  ): ListReadResult<ProjectRecord>[] {
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM projects ${includeRemoved ? "" : "WHERE removed_at IS NULL"} ORDER BY created_at`,
      )
      .all();
    return parseListRows(projectRowSchema, rows, "project");
  }

  public getProject(id: string, includeRemoved = false): ProjectRecord | null {
    const row = this.sqlite
      .prepare(
        `SELECT * FROM projects WHERE id = ? ${includeRemoved ? "" : "AND removed_at IS NULL"}`,
      )
      .get(id);
    return row === undefined
      ? null
      : parseRow(projectRowSchema, row, "project", id);
  }

  public getProjectByPath(canonicalPath: string): ProjectRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM projects WHERE canonical_path = ?")
      .get(canonicalPath);
    return row === undefined
      ? null
      : parseRow(projectRowSchema, row, "project", canonicalPath);
  }

  public registerProject(
    canonicalPath: string,
    displayName?: string,
  ): ProjectRecord {
    const existing = this.getProjectByPath(canonicalPath);
    const now = this.now();
    if (existing !== null) {
      if (existing.removed_at === null)
        throw new Error("project_already_registered");
      this.sqlite
        .prepare(
          "UPDATE projects SET removed_at = NULL, display_name = ? WHERE id = ?",
        )
        .run(displayName ?? existing.display_name, existing.id);
      return this.getProject(existing.id) ?? existing;
    }
    const id = ProjectIdSchema.parse(this.id());
    this.sqlite
      .prepare(
        "INSERT INTO projects (id, canonical_path, display_name, created_at, removed_at, sidebar_expanded, last_opened_thread_id) VALUES (?, ?, ?, ?, NULL, 1, NULL)",
      )
      .run(id, canonicalPath, displayName ?? basename(canonicalPath), now);
    return requireRecord(this.getProject(id), "project_insert_failed");
  }

  public removeProject(id: ProjectId): void {
    this.sqlite
      .prepare(
        "UPDATE projects SET removed_at = ? WHERE id = ? AND removed_at IS NULL",
      )
      .run(this.now(), id);
  }

  public setProjectExpanded(id: ProjectId, expanded: boolean): void {
    this.sqlite
      .prepare(
        "UPDATE projects SET sidebar_expanded = ? WHERE id = ? AND removed_at IS NULL",
      )
      .run(expanded ? 1 : 0, id);
  }

  public listThreads(
    projectId?: ProjectId,
    options: { includeArchived?: boolean } = {},
  ): ThreadRecord[] {
    const archiveFilter = options.includeArchived
      ? ""
      : " AND t.archived_at IS NULL";
    const rows =
      projectId === undefined
        ? this.sqlite
            .prepare(
              `SELECT t.* FROM threads t JOIN projects p ON p.id = t.project_id WHERE p.removed_at IS NULL${archiveFilter} ORDER BY t.last_activity_at DESC`,
            )
            .all()
        : this.sqlite
            .prepare(
              `SELECT t.* FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.project_id = ? AND p.removed_at IS NULL${archiveFilter} ORDER BY t.last_activity_at DESC`,
            )
            .all(projectId);
    return rows.map((row, index) =>
      parseRow(threadRowSchema, row, "thread", String(index)),
    );
  }

  public listThreadResults(
    projectId?: ProjectId,
    options: { includeArchived?: boolean } = {},
  ): ListReadResult<ThreadRecord>[] {
    const archiveFilter = options.includeArchived
      ? ""
      : " AND t.archived_at IS NULL";
    const rows =
      projectId === undefined
        ? this.sqlite
            .prepare(
              `SELECT t.* FROM threads t JOIN projects p ON p.id = t.project_id WHERE p.removed_at IS NULL${archiveFilter} ORDER BY t.last_activity_at DESC`,
            )
            .all()
        : this.sqlite
            .prepare(
              `SELECT t.* FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.project_id = ? AND p.removed_at IS NULL${archiveFilter} ORDER BY t.last_activity_at DESC`,
            )
            .all(projectId);
    return parseListRows(threadRowSchema, rows, "thread");
  }

  public getThread(
    projectId: string,
    threadId: string,
    options: { includeArchived?: boolean } = {},
  ): ThreadRecord | null {
    const row = this.sqlite
      .prepare(
        `SELECT t.* FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND t.project_id = ? AND p.removed_at IS NULL${options.includeArchived ? "" : " AND t.archived_at IS NULL"}`,
      )
      .get(threadId, projectId);
    return row === undefined
      ? null
      : parseRow(threadRowSchema, row, "thread", threadId);
  }

  public getThreadById(
    threadId: string,
    options: { includeArchived?: boolean } = {},
  ): ThreadRecord | null {
    const row = this.sqlite
      .prepare(
        `SELECT t.* FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.removed_at IS NULL${options.includeArchived ? "" : " AND t.archived_at IS NULL"}`,
      )
      .get(threadId);
    return row === undefined
      ? null
      : parseRow(threadRowSchema, row, "thread", threadId);
  }

  public createThread(
    projectId: ProjectId,
    runtimeSessionId: string,
    title?: string,
    worktreeId: WorktreeId | null = null,
  ): ThreadRecord {
    const id = ThreadIdSchema.parse(this.id());
    const now = this.now();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          "INSERT INTO threads (id, project_id, title, runtime_session_id, created_at, last_activity_at, last_completed_run_id, last_viewed_completed_run_id, worktree_id) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
        )
        .run(
          id,
          projectId,
          title ?? "New thread",
          runtimeSessionId,
          now,
          now,
          worktreeId,
        );
      this.sqlite
        .prepare("UPDATE projects SET last_opened_thread_id = ? WHERE id = ?")
        .run(id, projectId);
    })();
    return requireRecord(this.getThread(projectId, id), "thread_insert_failed");
  }

  public getThreadByRuntimeSession(
    projectId: ProjectId,
    runtimeSessionId: string,
    options: { includeArchived?: boolean } = {},
  ): ThreadRecord | null {
    const row = this.sqlite
      .prepare(
        `SELECT * FROM threads WHERE project_id = ? AND runtime_session_id = ?${options.includeArchived ? "" : " AND archived_at IS NULL"}`,
      )
      .get(projectId, runtimeSessionId);
    return row === undefined
      ? null
      : parseRow(threadRowSchema, row, "thread", runtimeSessionId);
  }

  public renameThread(
    projectId: ProjectId,
    threadId: ThreadId,
    title: string,
  ): ThreadRecord {
    this.sqlite
      .prepare(
        "UPDATE threads SET title = ?, last_activity_at = ? WHERE id = ? AND project_id = ? AND archived_at IS NULL",
      )
      .run(title, this.now(), threadId, projectId);
    const thread = this.getThread(projectId, threadId);
    if (thread === null) throw new Error("thread_not_found");
    return thread;
  }

  public setLastOpenedThread(projectId: ProjectId, threadId: ThreadId): void {
    this.sqlite
      .prepare(
        "UPDATE projects SET last_opened_thread_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM threads WHERE id = ? AND project_id = ? AND archived_at IS NULL)",
      )
      .run(threadId, projectId, threadId, projectId);
  }

  public latestRun(threadId: ThreadId): RunRecord | null {
    const row = this.sqlite
      .prepare(
        "SELECT id, thread_id, project_id, state, started_at, ended_at, failure_code, failure_message FROM runs WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1",
      )
      .get(threadId);
    return row === undefined
      ? null
      : parseRow(runRowSchema, row, "run", threadId);
  }

  public getRun(id: string): RunRecord | null {
    const parsedId = RunIdSchema.parse(id);
    const row = this.sqlite
      .prepare(
        "SELECT id, thread_id, project_id, state, started_at, ended_at, failure_code, failure_message FROM runs WHERE id = ?",
      )
      .get(parsedId);
    return row === undefined
      ? null
      : parseRow(runRowSchema, row, "run", parsedId);
  }

  public runningRunForThread(threadId: ThreadId): RunRecord | null {
    const row = this.sqlite
      .prepare(
        "SELECT id, thread_id, project_id, state, started_at, ended_at, failure_code, failure_message FROM runs WHERE thread_id = ? AND state = 'running'",
      )
      .get(threadId);
    return row === undefined
      ? null
      : parseRow(runRowSchema, row, "run", threadId);
  }

  public runningRunsForProject(projectId: ProjectId): RunRecord[] {
    const rows = this.sqlite
      .prepare(
        "SELECT id, thread_id, project_id, state, started_at, ended_at, failure_code, failure_message FROM runs WHERE project_id = ? AND state = 'running' ORDER BY started_at, id",
      )
      .all(projectId);
    return rows.map((row, index) =>
      parseRow(runRowSchema, row, "run", `${projectId}:${String(index)}`),
    );
  }

  public createRun(
    projectId: ProjectId,
    threadId: ThreadId,
    acceptedCommandId: string,
  ): RunRecord {
    return requireRecord(
      this.createRunIfProjectActive(projectId, threadId, acceptedCommandId),
      "thread_not_found",
    );
  }

  public createRunIfProjectActive(
    projectId: ProjectId,
    threadId: ThreadId,
    acceptedCommandId: string,
  ): RunRecord | null {
    const id = RunIdSchema.parse(this.id());
    const now = this.now();
    return this.sqlite.transaction((): RunRecord | null => {
      const inserted = this.sqlite
        .prepare(
          "INSERT INTO runs (id, thread_id, project_id, state, started_at, ended_at, accepted_command_id, failure_code, failure_message) SELECT ?, t.id, p.id, 'running', ?, NULL, ?, NULL, NULL FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND t.project_id = ? AND p.removed_at IS NULL AND t.archived_at IS NULL",
        )
        .run(id, now, acceptedCommandId, threadId, projectId);
      if (inserted.changes === 0) return null;
      this.sqlite
        .prepare(
          "UPDATE threads SET last_activity_at = ? WHERE id = ? AND project_id = ?",
        )
        .run(now, threadId, projectId);
      const row = this.sqlite
        .prepare(
          "SELECT id, thread_id, project_id, state, started_at, ended_at, failure_code, failure_message FROM runs WHERE id = ?",
        )
        .get(id);
      return parseRow(runRowSchema, row, "run", id);
    })();
  }

  public settleRun(
    runId: RunId,
    state: Exclude<RunState, "running">,
    failureCode: string | null = null,
    failureMessage: string | null = null,
  ): RunRecord {
    const endedAt = this.now();
    this.sqlite.transaction(() => {
      const changed = this.sqlite
        .prepare(
          "UPDATE runs SET state = ?, ended_at = ?, failure_code = ?, failure_message = ? WHERE id = ? AND state = 'running'",
        )
        .run(state, endedAt, failureCode, failureMessage, runId);
      if (changed.changes === 0) return;
      const owner = z
        .object({ thread_id: ThreadIdSchema })
        .parse(
          this.sqlite
            .prepare("SELECT thread_id FROM runs WHERE id = ?")
            .get(runId),
        );
      this.sqlite
        .prepare(
          "UPDATE threads SET last_activity_at = ?, last_completed_run_id = ? WHERE id = ?",
        )
        .run(endedAt, runId, owner.thread_id);
    })();
    const row = this.sqlite
      .prepare(
        "SELECT id, thread_id, project_id, state, started_at, ended_at, failure_code, failure_message FROM runs WHERE id = ?",
      )
      .get(runId);
    return parseRow(runRowSchema, row, "run", runId);
  }

  public markViewed(
    projectId: ProjectId,
    threadId: ThreadId,
    runId: RunId,
  ): void {
    this.sqlite
      .prepare(
        "UPDATE threads SET last_viewed_completed_run_id = ? WHERE id = ? AND project_id = ? AND last_completed_run_id = ? AND archived_at IS NULL",
      )
      .run(runId, threadId, projectId, runId);
  }

  public unreadCount(projectId: ProjectId): number {
    const row = this.sqlite
      .prepare(
        "SELECT count(*) AS count FROM threads WHERE project_id = ? AND archived_at IS NULL AND last_completed_run_id IS NOT NULL AND (last_viewed_completed_run_id IS NULL OR last_viewed_completed_run_id <> last_completed_run_id)",
      )
      .get(projectId);
    return sqliteAggregateCountSchema.parse(row).count;
  }

  public isUnread(thread: ThreadRecord): boolean {
    return (
      thread.last_completed_run_id !== null &&
      thread.last_completed_run_id !== thread.last_viewed_completed_run_id
    );
  }

  public listWorktreeDiagnostics(): string[] {
    const rows = this.sqlite
      .prepare(
        "SELECT w.* FROM worktrees w JOIN projects p ON p.id = w.project_id WHERE p.removed_at IS NULL AND w.state <> 'ready' ORDER BY w.created_at",
      )
      .all();
    return parseWorktreeListRows(rows, this.stateDirectory)
      .slice(0, 100)
      .map((result) => {
        if (result.record === null) return result.diagnostic;
        return result.record.state === "failed"
          ? `Worktree ${result.record.branch_name} needs recovery after setup failed.`
          : `Worktree ${result.record.branch_name} has incomplete setup.`;
      });
  }

  public getWorktree(id: string): WorktreeRecord | null {
    const parsedId = WorktreeIdSchema.parse(id);
    const row = this.sqlite
      .prepare("SELECT * FROM worktrees WHERE id = ?")
      .get(parsedId);
    return row === undefined
      ? null
      : parseWorktreeRecord(row, this.stateDirectory, parsedId);
  }

  public reserveWorktree(input: {
    id?: string;
    projectId: ProjectId;
    executionRoot: string;
    worktreeRoot: string;
    gitCommonDir: string;
    projectSubpath: string;
    baseBranch: string;
    baseCommit: string;
    branchName: string;
    transferToken: string | null;
  }): WorktreeRecord {
    const id = WorktreeIdSchema.parse(input.id ?? this.id());
    const now = this.now();
    this.sqlite
      .prepare(
        "INSERT INTO worktrees (id, project_id, state, execution_root, worktree_root, git_common_dir, project_subpath, base_branch, base_commit, branch_name, transfer_token, created_at, updated_at, failure_code, failure_message) VALUES (?, ?, 'provisioning', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
      )
      .run(
        id,
        input.projectId,
        input.executionRoot,
        input.worktreeRoot,
        input.gitCommonDir,
        input.projectSubpath,
        input.baseBranch,
        input.baseCommit,
        input.branchName,
        input.transferToken,
        now,
        now,
      );
    return requireRecord(this.getWorktree(id), "worktree_insert_failed");
  }

  public setWorktreeState(
    id: WorktreeId,
    state: "ready" | "failed",
    failureCode: string | null = null,
    failureMessage: string | null = null,
  ): WorktreeRecord {
    this.sqlite
      .prepare(
        "UPDATE worktrees SET state = ?, updated_at = ?, failure_code = ?, failure_message = ? WHERE id = ?",
      )
      .run(state, this.now(), failureCode, failureMessage, id);
    return requireRecord(this.getWorktree(id), "worktree_not_found");
  }

  public getThreadCreation(
    projectId: ProjectId,
    idempotencyKey: string,
  ): ThreadCreationRecord | null {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM thread_creation_operations WHERE project_id = ? AND idempotency_key = ?",
      )
      .get(projectId, idempotencyKey);
    return row === undefined
      ? null
      : parseRow(creationRowSchema, row, "thread creation", idempotencyKey);
  }

  public beginThreadCreation(input: {
    projectId: ProjectId;
    idempotencyKey: string;
    requestHash: string;
    workspaceMode: "shared" | "worktree";
    baseBranch: string | null;
    sourceChanges: "none" | "tracked_and_untracked" | null;
  }): ThreadCreationRecord {
    const existing = this.getThreadCreation(
      input.projectId,
      input.idempotencyKey,
    );
    if (existing !== null) {
      if (existing.request_hash !== input.requestHash)
        throw new ReceiptConflictError();
      return existing;
    }
    const id = z.uuid().parse(this.id());
    const promptCommandId = z.uuid().parse(this.id());
    const now = this.now();
    this.sqlite
      .prepare(
        "INSERT INTO thread_creation_operations (id, project_id, idempotency_key, request_hash, state, workspace_mode, base_branch, source_changes, title, slug, worktree_id, runtime_session_id, thread_id, run_id, prompt_command_id, created_at, updated_at, failure_code, failure_message) VALUES (?, ?, ?, ?, 'naming', ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL)",
      )
      .run(
        id,
        input.projectId,
        input.idempotencyKey,
        input.requestHash,
        input.workspaceMode,
        input.baseBranch,
        input.sourceChanges,
        promptCommandId,
        now,
        now,
      );
    return requireRecord(
      this.getThreadCreation(input.projectId, input.idempotencyKey),
      "thread_creation_insert_failed",
    );
  }

  private updateThreadCreation(
    projectId: ProjectId,
    key: string,
    assignments: string,
    values: unknown[],
  ): ThreadCreationRecord {
    this.sqlite
      .prepare(
        `UPDATE thread_creation_operations SET ${assignments}, updated_at = ? WHERE project_id = ? AND idempotency_key = ?`,
      )
      .run(...values, this.now(), projectId, key);
    return requireRecord(
      this.getThreadCreation(projectId, key),
      "thread_creation_not_found",
    );
  }

  public nameThreadCreation(
    projectId: ProjectId,
    key: string,
    title: string,
    slug: string,
  ): ThreadCreationRecord {
    return this.updateThreadCreation(
      projectId,
      key,
      "title = ?, slug = ?, state = 'provisioning'",
      [title, slug],
    );
  }

  public attachCreationWorktree(
    projectId: ProjectId,
    key: string,
    worktreeId: WorktreeId,
  ): ThreadCreationRecord {
    return this.updateThreadCreation(projectId, key, "worktree_id = ?", [
      worktreeId,
    ]);
  }

  public reserveCreationWorktree(input: {
    projectId: ProjectId;
    idempotencyKey: string;
    executionRoot: string;
    worktreeRoot: string;
    gitCommonDir: string;
    projectSubpath: string;
    baseBranch: string;
    baseCommit: string;
    branchName: string;
    transferToken: string | null;
  }): { creation: ThreadCreationRecord; worktree: WorktreeRecord } {
    return this.sqlite.transaction(() => {
      const creation = requireRecord(
        this.getThreadCreation(input.projectId, input.idempotencyKey),
        "thread_creation_not_found",
      );
      const worktree = this.getWorktree(creation.id);
      if (worktree !== null) {
        const linked =
          creation.worktree_id === null
            ? this.attachCreationWorktree(
                input.projectId,
                input.idempotencyKey,
                worktree.id,
              )
            : creation;
        if (linked.worktree_id !== worktree.id)
          throw new Error("worktree_identity_failed");
        return { creation: linked, worktree };
      }
      if (creation.worktree_id !== null) throw new Error("worktree_not_found");
      const reserved = this.reserveWorktree({
        id: creation.id,
        projectId: input.projectId,
        executionRoot: input.executionRoot,
        worktreeRoot: input.worktreeRoot,
        gitCommonDir: input.gitCommonDir,
        projectSubpath: input.projectSubpath,
        baseBranch: input.baseBranch,
        baseCommit: input.baseCommit,
        branchName: input.branchName,
        transferToken: input.transferToken,
      });
      return {
        creation: this.attachCreationWorktree(
          input.projectId,
          input.idempotencyKey,
          reserved.id,
        ),
        worktree: reserved,
      };
    })();
  }

  public resumeFailedCreationWorktree(
    projectId: ProjectId,
    key: string,
  ): { creation: ThreadCreationRecord; worktree: WorktreeRecord } {
    return this.sqlite.transaction(() => {
      const creation = requireRecord(
        this.getThreadCreation(projectId, key),
        "thread_creation_not_found",
      );
      if (
        creation.state !== "failed" ||
        creation.workspace_mode !== "worktree" ||
        creation.worktree_id === null ||
        creation.runtime_session_id !== null ||
        creation.thread_id !== null ||
        creation.run_id !== null
      )
        throw new Error("thread_creation_not_recoverable");
      const worktree = requireRecord(
        this.getWorktree(creation.worktree_id),
        "worktree_not_found",
      );
      if (worktree.id !== creation.worktree_id || worktree.state !== "failed")
        throw new Error("worktree_not_recoverable");
      const now = this.now();
      const resumedWorktree = this.sqlite
        .prepare(
          "UPDATE worktrees SET state = 'provisioning', updated_at = ?, failure_code = NULL, failure_message = NULL WHERE id = ? AND project_id = ? AND state = 'failed'",
        )
        .run(now, worktree.id, projectId);
      const resumedCreation = this.sqlite
        .prepare(
          "UPDATE thread_creation_operations SET state = 'provisioning', updated_at = ?, failure_code = NULL, failure_message = NULL WHERE project_id = ? AND idempotency_key = ? AND state = 'failed' AND worktree_id = ?",
        )
        .run(now, projectId, key, worktree.id);
      if (resumedWorktree.changes !== 1 || resumedCreation.changes !== 1)
        throw new Error("worktree_not_recoverable");
      return {
        creation: requireRecord(
          this.getThreadCreation(projectId, key),
          "thread_creation_not_found",
        ),
        worktree: requireRecord(
          this.getWorktree(worktree.id),
          "worktree_not_found",
        ),
      };
    })();
  }

  public attachCreationSession(
    projectId: ProjectId,
    key: string,
    sessionId: string,
  ): ThreadCreationRecord {
    return this.updateThreadCreation(
      projectId,
      key,
      "runtime_session_id = ?, state = 'session_created'",
      [sessionId],
    );
  }

  public reserveCreationSession(
    projectId: ProjectId,
    key: string,
  ): ThreadCreationRecord {
    const creation = requireRecord(
      this.getThreadCreation(projectId, key),
      "thread_creation_not_found",
    );
    if (creation.session_creation_id !== null) return creation;
    return this.updateThreadCreation(
      projectId,
      key,
      "session_creation_id = ?",
      [creation.id],
    );
  }

  public createThreadForCreation(
    projectId: ProjectId,
    key: string,
    runtimeSessionId: string,
    title: string,
    worktreeId: WorktreeId | null,
  ): ThreadRecord {
    return this.sqlite.transaction(() => {
      const creation = requireRecord(
        this.getThreadCreation(projectId, key),
        "thread_creation_not_found",
      );
      if (creation.thread_id !== null)
        return requireRecord(
          this.getThread(projectId, creation.thread_id),
          "thread_not_found",
        );
      const existing = this.getThreadByRuntimeSession(
        projectId,
        runtimeSessionId,
        { includeArchived: true },
      );
      const thread =
        existing ??
        this.createThread(projectId, runtimeSessionId, title, worktreeId);
      this.sqlite
        .prepare(
          "UPDATE thread_creation_operations SET thread_id = ?, state = 'thread_created', updated_at = ? WHERE project_id = ? AND idempotency_key = ?",
        )
        .run(thread.id, this.now(), projectId, key);
      return thread;
    })();
  }

  public attachCreationThread(
    projectId: ProjectId,
    key: string,
    threadId: ThreadId,
  ): ThreadCreationRecord {
    return this.updateThreadCreation(
      projectId,
      key,
      "thread_id = ?, state = 'thread_created'",
      [threadId],
    );
  }

  public attachCreationRun(
    projectId: ProjectId,
    key: string,
    runId: RunId,
  ): ThreadCreationRecord {
    return this.updateThreadCreation(
      projectId,
      key,
      "run_id = ?, state = 'prompt_accepted'",
      [runId],
    );
  }

  public failThreadCreation(
    projectId: ProjectId,
    key: string,
    code: string,
    message: string,
  ): ThreadCreationRecord {
    return this.updateThreadCreation(
      projectId,
      key,
      "state = 'failed', failure_code = ?, failure_message = ?",
      [code, message],
    );
  }

  public readReceipt<T>(
    scope: string,
    key: string,
    operation: string,
    requestHash: string,
    parser: z.ZodType<T>,
  ): T | null {
    const raw = this.sqlite
      .prepare(
        "SELECT operation, request_hash, response_json FROM command_receipts WHERE scope = ? AND key = ?",
      )
      .get(scope, key);
    if (raw === undefined) return null;
    const receipt = parseRow(receiptRowSchema, raw, "command receipt", key);
    if (receipt.operation !== operation || receipt.request_hash !== requestHash)
      throw new ReceiptConflictError();
    let value: unknown;
    try {
      value = JSON.parse(receipt.response_json);
    } catch (error) {
      throw new CorruptRecordError("command receipt", key, { cause: error });
    }
    return parseRow(parser, value, "command receipt", key);
  }

  public withReceipt<T>(
    scope: string,
    key: string,
    operation: string,
    requestHash: string,
    parser: z.ZodType<T>,
    action: () => T,
  ): { response: T; replayed: boolean } {
    return this.sqlite.transaction(() => {
      const prior = this.readReceipt(
        scope,
        key,
        operation,
        requestHash,
        parser,
      );
      if (prior !== null) return { response: prior, replayed: true };
      const response = parser.parse(action());
      this.sqlite
        .prepare(
          "INSERT INTO command_receipts (scope, key, operation, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          scope,
          key,
          operation,
          requestHash,
          JSON.stringify(response),
          this.now(),
        );
      return { response, replayed: false };
    })();
  }
}
