-- The add-time job AI backlog's walk (job-analysis/backlog.ts): live jobs, newest first_seen_at first and the highest
-- id first among jobs seen at the same time, with the posting's text hash at hand. A job row keeps `active` and
-- `content_hash` after its two description columns, where reading them walks the posting's overflow pages; through
-- this index the backlog checks texts against job_analyses and job_ai_attempts without opening a job row, and stops
-- at its limit instead of sorting every live job.
CREATE INDEX idx_jobs_ai_backlog ON jobs(active, first_seen_at DESC, id DESC, content_hash);
