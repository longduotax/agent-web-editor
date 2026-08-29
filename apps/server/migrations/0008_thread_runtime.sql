-- A chat's agent backend becomes an explicit, durable, immutable property.
-- Every chat that predates this column ran on Pi, so 'pi' is both the column
-- default and the backfill for existing rows. New chats are given their backend
-- explicitly by the application; the default exists only to make this migration
-- total over rows written before the column existed.
ALTER TABLE threads ADD COLUMN runtime TEXT NOT NULL DEFAULT 'pi' CHECK (runtime IN ('pi', 'codex'));
ALTER TABLE thread_creation_operations ADD COLUMN runtime TEXT NOT NULL DEFAULT 'pi' CHECK (runtime IN ('pi', 'codex'));

-- A session identifier is only unique *within* a backend: Pi and Codex mint ids
-- from independent namespaces, so the key must include the backend or a Codex
-- session could be mistaken for a Pi one. That key is a table UNIQUE constraint,
-- backed by an autoindex SQLite refuses to drop, so widening it requires the
-- documented rebuild-and-rename procedure rather than DROP INDEX. The runner
-- disables foreign keys around this file and verifies foreign_key_check before
-- committing.
CREATE TABLE threads_rebuilt (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  runtime TEXT NOT NULL DEFAULT 'pi' CHECK (runtime IN ('pi', 'codex')),
  runtime_session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  last_completed_run_id TEXT,
  last_viewed_completed_run_id TEXT,
  archived_at TEXT,
  worktree_id TEXT REFERENCES worktrees(id),
  UNIQUE(project_id, runtime, runtime_session_id),
  UNIQUE(id, project_id)
);

INSERT INTO threads_rebuilt (
  id, project_id, title, runtime, runtime_session_id, created_at,
  last_activity_at, last_completed_run_id, last_viewed_completed_run_id,
  archived_at, worktree_id
)
SELECT
  id, project_id, title, runtime, runtime_session_id, created_at,
  last_activity_at, last_completed_run_id, last_viewed_completed_run_id,
  archived_at, worktree_id
FROM threads;

DROP TABLE threads;
ALTER TABLE threads_rebuilt RENAME TO threads;

-- Dropping the old table dropped its indexes; recreate them unchanged.
CREATE INDEX threads_project_activity_idx ON threads(project_id, last_activity_at DESC);
CREATE INDEX threads_project_archive_activity_idx ON threads(project_id, archived_at, last_activity_at DESC);
CREATE UNIQUE INDEX threads_worktree_unique ON threads(worktree_id) WHERE worktree_id IS NOT NULL;
