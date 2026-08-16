import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MetadataStore } from "./store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function stateDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-state-"));
  roots.push(root);
  return root;
}

function ids() {
  let value = 1;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

describe("metadata persistence", () => {
  it("persists projects and restores soft-removed metadata", async () => {
    const state = await stateDirectory();
    let store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:00:00.000Z",
      id: ids(),
    });
    const project = store.registerProject("/tmp/example-project", "Example");
    const thread = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
      "Work",
    );
    store.setProjectExpanded(project.id, false);
    store.removeProject(project.id);
    expect(store.listProjects()).toHaveLength(0);
    store.close();

    store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:01:00.000Z",
      id: ids(),
    });
    const restored = store.registerProject("/tmp/example-project");
    expect(restored.id).toBe(project.id);
    expect(restored.sidebar_expanded).toBe(0);
    expect(store.listThreads(restored.id)[0]?.id).toBe(thread.id);
    store.close();
  });

  it("allows one running run per thread and derives unread state", async () => {
    const state = await stateDirectory();
    const store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:00:00.000Z",
      id: ids(),
    });
    const project = store.registerProject("/tmp/project");
    const first = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
    );
    const second = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000002",
    );
    const firstRun = store.createRun(
      project.id,
      first.id,
      "20000000-0000-4000-8000-000000000001",
    );
    const secondRun = store.createRun(
      project.id,
      second.id,
      "20000000-0000-4000-8000-000000000002",
    );
    expect(() =>
      store.createRun(
        project.id,
        first.id,
        "20000000-0000-4000-8000-000000000003",
      ),
    ).toThrow(/UNIQUE/);
    expect(store.runningRunForThread(first.id)?.id).toBe(firstRun.id);
    expect(store.runningRunForThread(second.id)?.id).toBe(secondRun.id);
    expect(store.runningRunsForProject(project.id)).toHaveLength(2);

    store.settleRun(firstRun.id, "completed");
    expect(store.unreadCount(project.id)).toBe(1);
    store.markViewed(project.id, first.id, firstRun.id);
    expect(store.unreadCount(project.id)).toBe(0);
    store.close();
  });

  it("archives inactive threads without deleting history and updates active navigation", async () => {
    const state = await stateDirectory();
    let now = "2026-08-15T12:00:00.000Z";
    const store = await MetadataStore.open({
      stateDirectory: state,
      now: () => now,
      id: ids(),
    });
    const project = store.registerProject("/tmp/project");
    const remaining = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
      "Remaining",
    );
    now = "2026-08-15T12:01:00.000Z";
    const archived = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000002",
      "Archive me",
    );
    const completed = store.createRun(
      project.id,
      archived.id,
      "20000000-0000-4000-8000-000000000001",
    );
    store.settleRun(completed.id, "completed");
    expect(store.unreadCount(project.id)).toBe(1);

    now = "2026-08-15T12:02:00.000Z";
    expect(store.archiveThread(project.id, archived.id)).toBe(true);
    expect(store.getThread(project.id, archived.id)).toBeNull();
    expect(
      store.getThread(project.id, archived.id, { includeArchived: true }),
    ).toMatchObject({ id: archived.id, archived_at: now });
    expect(store.listThreads(project.id).map((thread) => thread.id)).toEqual([
      remaining.id,
    ]);
    expect(
      store
        .listThreads(project.id, { includeArchived: true })
        .map((thread) => thread.id),
    ).toContain(archived.id);
    expect(store.unreadCount(project.id)).toBe(0);
    expect(store.getProject(project.id)?.last_opened_thread_id).toBe(
      remaining.id,
    );
    expect(store.latestRun(archived.id)?.id).toBe(completed.id);
    expect(store.archiveThread(project.id, archived.id)).toBe(true);
    store.close();
  });

  it("does not archive a thread with a persisted running run", async () => {
    const state = await stateDirectory();
    const store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:00:00.000Z",
      id: ids(),
    });
    const project = store.registerProject("/tmp/project");
    const thread = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
    );
    store.createRun(
      project.id,
      thread.id,
      "20000000-0000-4000-8000-000000000001",
    );

    expect(store.archiveThread(project.id, thread.id)).toBe(false);
    expect(store.getThread(project.id, thread.id)).not.toBeNull();
    store.close();
  });

  it("does not create a run after its project is soft-removed", async () => {
    const state = await stateDirectory();
    const store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:00:00.000Z",
      id: ids(),
    });
    const project = store.registerProject("/tmp/project");
    const thread = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
    );
    store.removeProject(project.id);

    expect(
      store.createRunIfProjectActive(
        project.id,
        thread.id,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).toBeNull();
    expect(store.runningRunForThread(thread.id)).toBeNull();
    store.close();
  });

  it("recovers and links a legacy unlinked deterministic worktree reservation", async () => {
    const state = await stateDirectory();
    const store = await MetadataStore.open({
      stateDirectory: state,
      id: ids(),
    });
    const project = store.registerProject("/tmp/project");
    const creation = store.beginThreadCreation({
      projectId: project.id,
      idempotencyKey: "10000000-0000-4000-8000-000000000010",
      requestHash: "a".repeat(64),
      workspaceMode: "worktree",
      baseBranch: "main",
      sourceChanges: "none",
    });
    store.nameThreadCreation(
      project.id,
      creation.idempotency_key,
      "Work",
      "work",
    );
    const worktreeRoot = join(
      store.stateDirectory,
      "worktrees",
      project.id,
      "work",
    );
    const reserved = store.reserveWorktree({
      id: creation.id,
      projectId: project.id,
      executionRoot: worktreeRoot,
      worktreeRoot,
      gitCommonDir: "/tmp/.git",
      projectSubpath: "",
      baseBranch: "main",
      baseCommit: "a".repeat(40),
      branchName: "pi/work",
      transferToken: null,
    });

    const recovered = store.reserveCreationWorktree({
      projectId: project.id,
      idempotencyKey: creation.idempotency_key,
      executionRoot: reserved.execution_root,
      worktreeRoot: reserved.worktree_root,
      gitCommonDir: reserved.git_common_dir,
      projectSubpath: reserved.project_subpath,
      baseBranch: reserved.base_branch,
      baseCommit: reserved.base_commit,
      branchName: reserved.branch_name,
      transferToken: reserved.transfer_token,
    });

    expect(recovered.worktree.id).toBe(reserved.id);
    expect(recovered.creation.worktree_id).toBe(reserved.id);
    expect(store.getWorktree(reserved.id)).toEqual(reserved);
    store.close();
  });

  it("quarantines malformed persisted worktree paths and identities", async () => {
    const state = await stateDirectory();
    let store = await MetadataStore.open({ stateDirectory: state, id: ids() });
    const project = store.registerProject("/tmp/project");
    const root = join(store.stateDirectory, "worktrees", project.id, "safe");
    const worktree = store.reserveWorktree({
      projectId: project.id,
      executionRoot: root,
      worktreeRoot: root,
      gitCommonDir: "/tmp/.git",
      projectSubpath: "",
      baseBranch: "main",
      baseCommit: "a".repeat(40),
      branchName: "pi/safe",
      transferToken: null,
    });
    store.close();

    const database = new Database(join(state, "metadata.sqlite"));
    database
      .prepare(
        "UPDATE worktrees SET execution_root = ?, base_branch = ? WHERE id = ?",
      )
      .run("/tmp/outside", "../unsafe", worktree.id);
    database.close();
    store = await MetadataStore.open({ stateDirectory: state });
    expect(() => store.getWorktree(worktree.id)).toThrow(
      "Stored worktree record is malformed.",
    );
    expect(store.listWorktreeDiagnostics()).toEqual([
      "A malformed stored worktree record was omitted.",
    ]);
    store.close();
  });

  it("migrates a populated v1 database through worktree metadata with backups", async () => {
    const state = await stateDirectory();
    let store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:00:00.000Z",
      id: ids(),
    });
    const project = store.registerProject("/tmp/project");
    const first = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
    );
    store.createThread(project.id, "10000000-0000-4000-8000-000000000002");
    const historical = store.createRun(
      project.id,
      first.id,
      "20000000-0000-4000-8000-000000000001",
    );
    store.settleRun(historical.id, "completed");
    store.close();

    const before = new Database(join(state, "metadata.sqlite"));
    before.exec(
      "DROP TABLE thread_creation_operations; DROP INDEX threads_worktree_unique; ALTER TABLE threads DROP COLUMN worktree_id; DROP TABLE worktrees; DROP INDEX threads_project_archive_activity_idx; ALTER TABLE threads DROP COLUMN archived_at; DROP INDEX runs_one_running_per_thread; CREATE UNIQUE INDEX runs_one_running_per_project ON runs(project_id) WHERE state = 'running'; PRAGMA user_version = 1;",
    );
    expect(before.pragma("user_version", { simple: true })).toBe(1);
    before.close();

    store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:01:00.000Z",
      id: ids(),
    });
    expect(store.latestRun(first.id)?.id).toBe(historical.id);
    store.close();

    const migrated = new Database(join(state, "metadata.sqlite"));
    expect(migrated.pragma("user_version", { simple: true })).toBe(6);
    expect(
      migrated
        .prepare(
          "SELECT session_creation_id FROM thread_creation_operations LIMIT 1",
        )
        .get(),
    ).toBeUndefined();
    expect(
      migrated.prepare("SELECT transfer_token FROM worktrees LIMIT 1").get(),
    ).toBeUndefined();
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .get("thread_creation_operations_session_creation_id_unique"),
    ).toEqual({
      name: "thread_creation_operations_session_creation_id_unique",
    });
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .get("runs_one_running_per_thread"),
    ).toEqual({ name: "runs_one_running_per_thread" });
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .get("runs_one_running_per_project"),
    ).toBeUndefined();
    migrated.close();

    expect(await readdir(state)).toContainEqual(
      expect.stringMatching(/^metadata-before-v2-\d+\.sqlite$/),
    );
  });

  it("rejects malformed SQLite metadata aggregate rows before migration", async () => {
    const state = await stateDirectory();
    const databasePath = join(state, "metadata.sqlite");
    const database = new Database(databasePath);
    database.exec(
      "CREATE TABLE legacy_data (id INTEGER); PRAGMA user_version = 1;",
    );
    database.close();

    const metadataCountQuery =
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'";
    // The original method is called with the intercepted database as `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPrepare = Database.prototype.prepare;
    const prepare = vi
      .spyOn(Database.prototype, "prepare")
      .mockImplementation(function (
        this: Database.Database,
        source: string,
      ): Database.Statement {
        if (source === metadataCountQuery)
          return {
            get: () => ({ count: -1 }),
          } as unknown as Database.Statement;
        return originalPrepare.call(this, source);
      });
    try {
      await expect(
        MetadataStore.open({ stateDirectory: state }),
      ).rejects.toThrow();
    } finally {
      prepare.mockRestore();
    }

    const unchanged = new Database(databasePath);
    expect(unchanged.pragma("user_version", { simple: true })).toBe(1);
    unchanged.close();
    expect(await readdir(state)).not.toContainEqual(
      expect.stringMatching(/^metadata-before-v2-\d+\.sqlite$/),
    );
  });

  it("rejects a negative persisted schema version before backup or migration", async () => {
    const state = await stateDirectory();
    const databasePath = join(state, "metadata.sqlite");
    const database = new Database(databasePath);
    database.exec(
      "CREATE TABLE legacy_data (id INTEGER); PRAGMA user_version = -1;",
    );
    database.close();

    await expect(
      MetadataStore.open({ stateDirectory: state }),
    ).rejects.toThrow();

    const unchanged = new Database(databasePath);
    expect(unchanged.pragma("user_version", { simple: true })).toBe(-1);
    unchanged.close();
    expect(await readdir(state)).not.toContainEqual(
      expect.stringMatching(/^metadata-before-v1-\d+\.sqlite$/),
    );
  });

  it("refuses a newer schema without changing its version", async () => {
    const state = await stateDirectory();
    const databasePath = join(state, "metadata.sqlite");
    const newer = new Database(databasePath);
    newer.pragma("user_version = 7");
    newer.close();

    await expect(MetadataStore.open({ stateDirectory: state })).rejects.toThrow(
      "newer Pi Web Workspace version",
    );

    const unchanged = new Database(databasePath);
    expect(unchanged.pragma("user_version", { simple: true })).toBe(7);
    unchanged.close();
  });

  it("upgrades a populated v3 archive schema without reviving archived threads", async () => {
    const state = await stateDirectory();
    const databasePath = join(state, "metadata.sqlite");
    const database = new Database(databasePath);
    const projectId = "00000000-0000-4000-8000-000000000001";
    const activeThreadId = "00000000-0000-4000-8000-000000000002";
    const archivedThreadId = "00000000-0000-4000-8000-000000000003";
    const timestamp = "2026-08-15T12:00:00.000Z";
    database.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        canonical_path TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        removed_at TEXT,
        sidebar_expanded INTEGER NOT NULL DEFAULT 1,
        last_opened_thread_id TEXT
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        runtime_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        last_completed_run_id TEXT,
        last_viewed_completed_run_id TEXT,
        archived_at TEXT,
        UNIQUE(project_id, runtime_session_id),
        UNIQUE(id, project_id)
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL REFERENCES threads(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        accepted_command_id TEXT NOT NULL UNIQUE,
        failure_code TEXT,
        failure_message TEXT
      );
      CREATE TABLE command_receipts (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(scope, key)
      );
      CREATE INDEX threads_project_activity_idx ON threads(project_id, last_activity_at DESC);
      CREATE INDEX threads_project_archive_activity_idx ON threads(project_id, archived_at, last_activity_at DESC);
      CREATE INDEX runs_thread_started_idx ON runs(thread_id, started_at DESC);
      CREATE UNIQUE INDEX runs_one_running_per_thread ON runs(thread_id) WHERE state = 'running';
    `);
    database
      .prepare("INSERT INTO projects VALUES (?, ?, ?, ?, NULL, 1, ?)")
      .run(projectId, "/tmp/project", "Project", timestamp, activeThreadId);
    const insertThread = database.prepare(
      "INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
    );
    insertThread.run(
      activeThreadId,
      projectId,
      "Active",
      "10000000-0000-4000-8000-000000000002",
      timestamp,
      timestamp,
      null,
    );
    insertThread.run(
      archivedThreadId,
      projectId,
      "Archived",
      "10000000-0000-4000-8000-000000000003",
      timestamp,
      timestamp,
      timestamp,
    );
    database.pragma("user_version = 3");
    database.close();

    const store = await MetadataStore.open({
      stateDirectory: state,
      id: ids(),
    });
    const project = store.getProject(projectId);
    if (project === null) throw new Error("project migration failed");
    const active = store.getThread(project.id, activeThreadId);
    const archived = store.getThread(project.id, archivedThreadId, {
      includeArchived: true,
    });
    if (active === null || archived === null)
      throw new Error("thread migration failed");
    expect(store.listThreads(project.id)).toMatchObject([
      { id: activeThreadId },
    ]);
    expect(store.getThread(project.id, archivedThreadId)).toBeNull();
    expect(archived).toMatchObject({ archived_at: timestamp });
    expect(
      store.createRunIfProjectActive(project.id, archived.id, ids()()),
    ).toBeNull();
    expect(() => store.createRun(project.id, archived.id, ids()())).toThrow(
      "thread_not_found",
    );
    expect(
      store.createRunIfProjectActive(project.id, active.id, ids()()),
    ).not.toBeNull();
    expect(
      store
        .listThreads(project.id, { includeArchived: true })
        .map((thread) => thread.id),
    ).toEqual([activeThreadId, archivedThreadId]);
    store.close();

    const migrated = new Database(databasePath);
    expect(migrated.pragma("user_version", { simple: true })).toBe(6);
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get("worktrees"),
    ).toEqual({ name: "worktrees" });
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get("thread_creation_operations"),
    ).toEqual({ name: "thread_creation_operations" });
    expect(
      migrated
        .prepare("SELECT name FROM pragma_table_info('threads') WHERE name = ?")
        .get("worktree_id"),
    ).toEqual({ name: "worktree_id" });
    migrated.close();
  });

  it("marks unfinished runs interrupted on restart", async () => {
    const state = await stateDirectory();
    let now = "2026-08-15T12:00:00.000Z";
    let store = await MetadataStore.open({
      stateDirectory: state,
      now: () => now,
      id: ids(),
    });
    const project = store.registerProject("/tmp/project");
    const thread = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000001",
    );
    const secondThread = store.createThread(
      project.id,
      "10000000-0000-4000-8000-000000000002",
    );
    const completed = store.createRun(
      project.id,
      thread.id,
      "20000000-0000-4000-8000-000000000001",
    );
    store.settleRun(completed.id, "completed");
    store.markViewed(project.id, thread.id, completed.id);
    now = "2026-08-15T12:00:01.000Z";
    const running = store.createRun(
      project.id,
      thread.id,
      "20000000-0000-4000-8000-000000000002",
    );
    const secondRunning = store.createRun(
      project.id,
      secondThread.id,
      "20000000-0000-4000-8000-000000000003",
    );
    store.close();
    store = await MetadataStore.open({
      stateDirectory: state,
      now: () => "2026-08-15T12:01:00.000Z",
      id: ids(),
    });
    expect(store.latestRun(thread.id)).toMatchObject({
      id: running.id,
      state: "interrupted",
    });
    expect(store.latestRun(secondThread.id)).toMatchObject({
      id: secondRunning.id,
      state: "interrupted",
    });
    const recoveredThread = store.getThread(project.id, thread.id);
    expect(recoveredThread).toMatchObject({
      last_completed_run_id: running.id,
      last_viewed_completed_run_id: completed.id,
    });
    if (recoveredThread === null) throw new Error("thread was not recovered");
    expect(store.isUnread(recoveredThread)).toBe(true);
    expect(store.unreadCount(project.id)).toBe(2);
    store.close();
  });
});
