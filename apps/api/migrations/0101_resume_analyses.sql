-- What TailorIT read from each resume: main (hard) and soft skills, keywords (roles, certifications, industry ids),
-- the experience it shows and the person's name. One rule-based ('deterministic') row per resume; Claude adds an 'ai'
-- row for uploads. An upload itself is never changed: its reading lives here, beside it.
-- content_hash is of what the reading used (never the custom title), so a rename reads nothing again. A row whose
-- version is not RESUME_ANALYSIS_VERSION (packages/shared/src/resume/analysis.ts) is stale.
CREATE TABLE resume_analyses(
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN('deterministic','ai')),
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  hard_skills TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(hard_skills)),
  soft_skills TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(soft_skills)),
  -- {"roles":[],"certifications":[],"domains":[]}; domains are INDUSTRIES ids
  keywords TEXT NOT NULL DEFAULT '{"roles":[],"certifications":[],"domains":[]}' CHECK(json_valid(keywords)),
  -- [[startMonth, endMonth|null], ...] as written on the resume (month = year * 12 + month - 1; null = Present).
  -- Future dates are skipped and ends clamped to this month only when the years are worked out, on read.
  experience TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(experience)),
  years_stated REAL CHECK(years_stated IS NULL OR (years_stated >= 0 AND years_stated <= 80)),
  years_stated_basis TEXT CHECK(years_stated_basis IS NULL OR years_stated_basis IN('field','stated')),
  -- The name the resume gives (the resume ZIP's First_Last); NULL when none was found.
  person_name TEXT,
  model TEXT,
  prompt_hash TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(resume_id, source)
);
-- A duplicate or a re-upload of the same text copies the AI reading instead of asking Claude again.
CREATE INDEX idx_resume_analyses_hash ON resume_analyses(content_hash, source, version);

-- Uploads waiting for (or done with) Claude's reading. The worker keeps one in flight server-wide, owned by the
-- uploader. A row starts over when its (content_hash, version) changes.
CREATE TABLE resume_analysis_backlog(
  resume_id TEXT PRIMARY KEY REFERENCES resumes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN('waiting','queued','done','failed','skipped')),
  -- AI failures so far (an outage is not one)
  attempts INTEGER NOT NULL DEFAULT 0,
  task_id TEXT,
  next_attempt_at TEXT NOT NULL,
  started_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_resume_backlog_next ON resume_analysis_backlog(state, next_attempt_at);
CREATE INDEX idx_resume_backlog_user ON resume_analysis_backlog(user_id, started_at);
