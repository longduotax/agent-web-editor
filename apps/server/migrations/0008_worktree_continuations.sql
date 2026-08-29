DROP INDEX threads_worktree_unique;
CREATE INDEX threads_worktree_idx ON threads(worktree_id) WHERE worktree_id IS NOT NULL;

ALTER TABLE threads ADD COLUMN initial_title_pending INTEGER NOT NULL DEFAULT 0 CHECK (initial_title_pending IN (0, 1));

ALTER TABLE runs ADD COLUMN worktree_id TEXT REFERENCES worktrees(id);
UPDATE runs
SET worktree_id = (
  SELECT threads.worktree_id FROM threads WHERE threads.id = runs.thread_id
);
CREATE UNIQUE INDEX runs_one_running_per_worktree
ON runs(worktree_id)
WHERE state = 'running' AND worktree_id IS NOT NULL;

CREATE TABLE thread_continuation_operations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_thread_id TEXT NOT NULL REFERENCES threads(id),
  worktree_id TEXT NOT NULL REFERENCES worktrees(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('creating_session', 'session_created', 'thread_created', 'failed')),
  runtime_session_id TEXT,
  thread_id TEXT REFERENCES threads(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  UNIQUE(project_id, idempotency_key)
);
CREATE INDEX thread_continuation_project_state_idx
ON thread_continuation_operations(project_id, state);
