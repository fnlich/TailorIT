-- Editable copies asked for with several uploads at once (the Upload dialog's "Make an editable copy with AI" for
-- many files). Each row is written in the same transaction as its upload; the copy line
-- (features/resumes/copies/backlog.ts) starts its resume_import task while the account has no other one, so a copy
-- asked for alone always finds the account's second place. One row per upload; it goes when the upload is deleted.
-- The upload itself is never changed.
CREATE TABLE resume_copy_backlog(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_resume_id TEXT NOT NULL UNIQUE REFERENCES resumes(id) ON DELETE CASCADE,
  -- The Upload dialog's id for its runs of several files: one notice per batch.
  batch_id TEXT NOT NULL,
  -- The upload's label when the copy was asked for.
  label TEXT NOT NULL,
  template_id TEXT,
  state TEXT NOT NULL CHECK(state IN('waiting','making','ready','failed','stopped')),
  task_id TEXT,
  -- The copy made; NULL once that resume is deleted.
  resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  -- Times put back in line after a restart or an outage with no AI pause; the third time fails the copy.
  retries INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  -- 'unreadable' and 'gone' cannot be tried again; 'no_room', 'ai_off' and 'ai' can.
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_resume_copy_due ON resume_copy_backlog(state, next_attempt_at);
CREATE INDEX idx_resume_copy_user ON resume_copy_backlog(user_id, created_at);
CREATE INDEX idx_resume_copy_result ON resume_copy_backlog(resume_id);
