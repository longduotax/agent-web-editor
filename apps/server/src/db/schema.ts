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

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    runtimeSessionId: text("runtime_session_id").notNull(),
    createdAt: text("created_at").notNull(),
    lastActivityAt: text("last_activity_at").notNull(),
    lastCompletedRunId: text("last_completed_run_id"),
    lastViewedCompletedRunId: text("last_viewed_completed_run_id"),
  },
  (table) => [
    uniqueIndex("threads_project_runtime_unique").on(
      table.projectId,
      table.runtimeSessionId,
    ),
    uniqueIndex("threads_id_project_unique").on(table.id, table.projectId),
    index("threads_project_activity_idx").on(
      table.projectId,
      table.lastActivityAt,
    ),
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
  },
  (table) => [
    index("runs_thread_started_idx").on(table.threadId, table.startedAt),
    uniqueIndex("runs_one_running_per_thread")
      .on(table.threadId)
      .where(sql`${table.state} = 'running'`),
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
