DROP INDEX runs_one_running_per_project;
CREATE UNIQUE INDEX runs_one_running_per_thread ON runs(thread_id) WHERE state = 'running';
