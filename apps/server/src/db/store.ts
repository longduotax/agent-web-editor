import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import {
  ProjectIdSchema,
  RunIdSchema,
  RunStateSchema,
  ThreadIdSchema,
  TimestampSchema,
  type ProjectId,
  type RunId,
  type RunState,
  type ThreadId,
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

export type ProjectRecord = z.infer<typeof projectRowSchema>;
export type ThreadRecord = z.infer<typeof threadRowSchema>;
export type RunRecord = z.infer<typeof runRowSchema>;

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
      const versionValue = sqlite.pragma("user_version", { simple: true });
      if (typeof versionValue !== "number" || !Number.isInteger(versionValue))
        throw new Error("Database schema version is malformed");
      if (versionValue > 1)
        throw new Error(
          "Database was created by a newer Pi Web Workspace version",
        );
      if (versionValue < 1) {
        if (existed) {
          const count = sqlite
            .prepare(
              "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'",
            )
            .get();
          if (
            typeof count === "object" &&
            count !== null &&
            "count" in count &&
            typeof count.count === "number" &&
            count.count > 0
          ) {
            const backup = join(
              options.stateDirectory,
              `metadata-before-v1-${String(Date.now())}.sqlite`,
            );
            await sqlite.backup(backup);
          }
        }
        const migrationPath = new URL(
          "../../migrations/0001_initial.sql",
          import.meta.url,
        );
        const sql = await readFile(migrationPath, "utf8");
        sqlite.transaction(() => {
          sqlite.exec(sql);
          sqlite.pragma("user_version = 1");
        })();
      }
      if (process.platform !== "win32") await chmod(databasePath, 0o600);
      const store = new MetadataStore(
        sqlite,
        options.stateDirectory,
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
          .prepare("UPDATE threads SET last_activity_at = ? WHERE id = ?")
          .run(endedAt, value.thread_id);
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

  public listThreads(projectId?: ProjectId): ThreadRecord[] {
    const rows =
      projectId === undefined
        ? this.sqlite
            .prepare(
              "SELECT t.* FROM threads t JOIN projects p ON p.id = t.project_id WHERE p.removed_at IS NULL ORDER BY t.last_activity_at DESC",
            )
            .all()
        : this.sqlite
            .prepare(
              "SELECT * FROM threads WHERE project_id = ? ORDER BY last_activity_at DESC",
            )
            .all(projectId);
    return rows.map((row, index) =>
      parseRow(threadRowSchema, row, "thread", String(index)),
    );
  }

  public getThread(projectId: string, threadId: string): ThreadRecord | null {
    const row = this.sqlite
      .prepare(
        "SELECT t.* FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND t.project_id = ? AND p.removed_at IS NULL",
      )
      .get(threadId, projectId);
    return row === undefined
      ? null
      : parseRow(threadRowSchema, row, "thread", threadId);
  }

  public getThreadById(threadId: string): ThreadRecord | null {
    const row = this.sqlite
      .prepare(
        "SELECT t.* FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.removed_at IS NULL",
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
  ): ThreadRecord {
    const id = ThreadIdSchema.parse(this.id());
    const now = this.now();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          "INSERT INTO threads (id, project_id, title, runtime_session_id, created_at, last_activity_at, last_completed_run_id, last_viewed_completed_run_id) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
        )
        .run(id, projectId, title ?? "New thread", runtimeSessionId, now, now);
      this.sqlite
        .prepare("UPDATE projects SET last_opened_thread_id = ? WHERE id = ?")
        .run(id, projectId);
    })();
    return requireRecord(this.getThread(projectId, id), "thread_insert_failed");
  }

  public renameThread(
    projectId: ProjectId,
    threadId: ThreadId,
    title: string,
  ): ThreadRecord {
    this.sqlite
      .prepare(
        "UPDATE threads SET title = ?, last_activity_at = ? WHERE id = ? AND project_id = ?",
      )
      .run(title, this.now(), threadId, projectId);
    const thread = this.getThread(projectId, threadId);
    if (thread === null) throw new Error("thread_not_found");
    return thread;
  }

  public setLastOpenedThread(projectId: ProjectId, threadId: ThreadId): void {
    this.sqlite
      .prepare(
        "UPDATE projects SET last_opened_thread_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM threads WHERE id = ? AND project_id = ?)",
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

  public runningRunForProject(projectId: ProjectId): RunRecord | null {
    const row = this.sqlite
      .prepare(
        "SELECT id, thread_id, project_id, state, started_at, ended_at, failure_code, failure_message FROM runs WHERE project_id = ? AND state = 'running'",
      )
      .get(projectId);
    return row === undefined
      ? null
      : parseRow(runRowSchema, row, "run", projectId);
  }

  public createRun(
    projectId: ProjectId,
    threadId: ThreadId,
    acceptedCommandId: string,
  ): RunRecord {
    const id = RunIdSchema.parse(this.id());
    const now = this.now();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          "INSERT INTO runs (id, thread_id, project_id, state, started_at, ended_at, accepted_command_id, failure_code, failure_message) VALUES (?, ?, ?, 'running', ?, NULL, ?, NULL, NULL)",
        )
        .run(id, threadId, projectId, now, acceptedCommandId);
      this.sqlite
        .prepare(
          "UPDATE threads SET last_activity_at = ? WHERE id = ? AND project_id = ?",
        )
        .run(now, threadId, projectId);
    })();
    return requireRecord(this.latestRun(threadId), "run_insert_failed");
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
        "UPDATE threads SET last_viewed_completed_run_id = ? WHERE id = ? AND project_id = ? AND last_completed_run_id = ?",
      )
      .run(runId, threadId, projectId, runId);
  }

  public unreadCount(projectId: ProjectId): number {
    const row = this.sqlite
      .prepare(
        "SELECT count(*) AS count FROM threads WHERE project_id = ? AND last_completed_run_id IS NOT NULL AND (last_viewed_completed_run_id IS NULL OR last_viewed_completed_run_id <> last_completed_run_id)",
      )
      .get(projectId);
    return z.object({ count: z.number().int().nonnegative() }).parse(row).count;
  }

  public isUnread(thread: ThreadRecord): boolean {
    return (
      thread.last_completed_run_id !== null &&
      thread.last_completed_run_id !== thread.last_viewed_completed_run_id
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
