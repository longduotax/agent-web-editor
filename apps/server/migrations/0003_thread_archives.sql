ALTER TABLE threads ADD COLUMN archived_at TEXT;
CREATE INDEX threads_project_archive_activity_idx
  ON threads(project_id, archived_at, last_activity_at DESC);
