CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  canonical_path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  sidebar_expanded INTEGER NOT NULL DEFAULT 1 CHECK (sidebar_expanded IN (0, 1)),
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
  UNIQUE(project_id, runtime_session_id),
  UNIQUE(id, project_id)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed', 'interrupted')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  accepted_command_id TEXT NOT NULL UNIQUE,
  failure_code TEXT,
  failure_message TEXT,
  FOREIGN KEY(thread_id, project_id) REFERENCES threads(id, project_id)
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
CREATE INDEX runs_thread_started_idx ON runs(thread_id, started_at DESC);
CREATE UNIQUE INDEX runs_one_running_per_project ON runs(project_id) WHERE state = 'running';
