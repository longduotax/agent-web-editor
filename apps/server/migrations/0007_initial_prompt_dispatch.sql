ALTER TABLE thread_creation_operations ADD COLUMN initial_prompt_dispatch_id TEXT;
ALTER TABLE thread_creation_operations ADD COLUMN initial_prompt_dispatch_state TEXT NOT NULL DEFAULT 'none' CHECK (initial_prompt_dispatch_state IN ('none', 'prepared', 'accepted', 'rejected'));
