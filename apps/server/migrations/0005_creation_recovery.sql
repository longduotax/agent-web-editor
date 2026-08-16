ALTER TABLE thread_creation_operations ADD COLUMN session_creation_id TEXT;
UPDATE thread_creation_operations SET session_creation_id = id WHERE session_creation_id IS NULL;
CREATE UNIQUE INDEX thread_creation_operations_session_creation_id_unique ON thread_creation_operations(session_creation_id) WHERE session_creation_id IS NOT NULL;
