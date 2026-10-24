-- The add-time job AI backlog's memory, per posting text and prompt version: how many times Claude failed on it (an
-- outage is not a failure) and when it may be tried again. Survives restarts. No foreign key, like job_analyses: it is
-- keyed by the text, which several jobs can share.
CREATE TABLE job_ai_attempts(
  content_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(content_hash, version)
);
