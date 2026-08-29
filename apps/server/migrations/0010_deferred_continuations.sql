ALTER TABLE thread_continuation_operations ADD COLUMN title TEXT;
ALTER TABLE thread_continuation_operations ADD COLUMN prompt_command_id TEXT;
ALTER TABLE thread_continuation_operations ADD COLUMN initial_prompt_dispatch_id TEXT;
ALTER TABLE thread_continuation_operations ADD COLUMN run_id TEXT REFERENCES runs(id);

CREATE UNIQUE INDEX thread_continuation_prompt_command_unique
ON thread_continuation_operations(project_id, prompt_command_id)
WHERE prompt_command_id IS NOT NULL;

CREATE UNIQUE INDEX thread_continuation_prompt_dispatch_unique
ON thread_continuation_operations(initial_prompt_dispatch_id)
WHERE initial_prompt_dispatch_id IS NOT NULL;
