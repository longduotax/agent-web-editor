CREATE TABLE worktrees (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  state TEXT NOT NULL CHECK (state IN ('provisioning', 'ready', 'failed')),
  execution_root TEXT NOT NULL UNIQUE,
  worktree_root TEXT NOT NULL UNIQUE,
  git_common_dir TEXT NOT NULL,
  project_subpath TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  UNIQUE(id, project_id),
  UNIQUE(git_common_dir, branch_name)
);

CREATE TABLE thread_creation_operations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('naming', 'provisioning', 'session_created', 'thread_created', 'prompt_accepted', 'failed')),
  workspace_mode TEXT NOT NULL CHECK (workspace_mode IN ('shared', 'worktree')),
  base_branch TEXT,
  source_changes TEXT CHECK (source_changes IS NULL OR source_changes IN ('none', 'tracked_and_untracked')),
  title TEXT,
  slug TEXT,
  worktree_id TEXT REFERENCES worktrees(id),
  runtime_session_id TEXT,
  thread_id TEXT REFERENCES threads(id),
  run_id TEXT REFERENCES runs(id),
  prompt_command_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  UNIQUE(project_id, idempotency_key)
);

ALTER TABLE threads ADD COLUMN worktree_id TEXT REFERENCES worktrees(id);
CREATE UNIQUE INDEX threads_worktree_unique ON threads(worktree_id) WHERE worktree_id IS NOT NULL;
CREATE INDEX worktrees_project_state_idx ON worktrees(project_id, state);
CREATE INDEX thread_creation_operations_project_state_idx ON thread_creation_operations(project_id, state);
