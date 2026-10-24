-- Adds the resume_analysis AI kind (Claude's reading of an uploaded resume: skills, roles, certifications, dates).
-- SQLite cannot change a CHECK in place, so ai_tasks is rebuilt with 0001's columns and indexes. No table references
-- ai_tasks, so dropping it touches nothing else.
CREATE TABLE ai_tasks_new(
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('resume_import','entry_bullets','job_analysis','cover_letter','template_fill',
    'resume_analysis')),
  status TEXT NOT NULL CHECK(status IN('queued','running','succeeded','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  input TEXT NOT NULL CHECK(json_valid(input)),
  result TEXT,
  error_code TEXT,
  error_message TEXT,
  model TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

-- Tasks of accounts that no longer exist (only a database edited with foreign keys off has them) are left behind:
-- copying one would fail its foreign key and refuse startup. ORDER BY rowid keeps the queue's FIFO tie order (queued
-- tasks run by priority, created_at, rowid).
INSERT INTO ai_tasks_new(id, user_id, kind, status, priority, input, result, error_code, error_message, model, attempts,
  dedupe_key, created_at, started_at, finished_at)
SELECT id, user_id, kind, status, priority, input, result, error_code, error_message, model, attempts, dedupe_key,
  created_at, started_at, finished_at
FROM ai_tasks
WHERE user_id IS NULL OR user_id IN (SELECT id FROM users)
ORDER BY rowid;

DROP TABLE ai_tasks;
ALTER TABLE ai_tasks_new RENAME TO ai_tasks;

CREATE INDEX idx_ai_queue ON ai_tasks(status, priority DESC, created_at);
CREATE INDEX idx_ai_user ON ai_tasks(user_id, kind, status);
CREATE UNIQUE INDEX idx_ai_dedupe ON ai_tasks(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN('queued','running');
