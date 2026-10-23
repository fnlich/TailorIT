-- TailorIT initial schema (docs/ARCHITECTURE.md, Appendix A).
-- Times are ISO-8601 UTC text; calendar dates are YYYY-MM-DD; booleans are 0/1; JSON columns are checked.
-- schema_migrations is created by the migration runner itself.

CREATE TABLE app_settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK(json_valid(value)),
  updated_at TEXT
);

-- ---------------------------------------------------------------------------------------------------------- auth --
CREATE TABLE users(
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  google_sub TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN('user','admin')),
  default_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_sign_in_at TEXT
);

CREATE TABLE user_sessions(
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_exp ON user_sessions(expires_at);

-- One live code per address.
CREATE TABLE login_codes(
  email TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE user_preferences(
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  experience_levels TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(experience_levels)),
  job_types TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(job_types)),
  work_arrangements TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(work_arrangements)),
  categories TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(categories)),
  locations TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(locations)),
  min_salary INTEGER,
  phone TEXT NOT NULL DEFAULT '',
  linkedin_url TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  portfolio_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- ----------------------------------------------------------------------------------------------------- documents --
CREATE TABLE stored_files(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN('resume','letter_import','template_import','job_import')),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  thumb_path TEXT,
  page_count INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_files_user ON stored_files(user_id, created_at DESC);

CREATE TABLE resumes(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('built','uploaded')),
  -- Custom display name (Rename). NULL = derive the label from the document (free_tailor's label rule).
  title TEXT,
  template_id TEXT,
  data TEXT CHECK(data IS NULL OR json_valid(data)),
  file_id TEXT REFERENCES stored_files(id) ON DELETE SET NULL,
  extracted_text TEXT,
  source_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_edited_at TEXT
);
CREATE INDEX idx_resumes_user ON resumes(user_id, updated_at DESC);

CREATE TABLE user_skills(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_key TEXT NOT NULL,
  skill TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'hard' CHECK(type IN('hard','soft')),
  category TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, type, skill_key)
);

CREATE TABLE cover_letters(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN('blank','generated','uploaded')),
  content_html TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  font_family TEXT NOT NULL DEFAULT 'Times New Roman',
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  job_description TEXT NOT NULL DEFAULT '',
  template_id TEXT REFERENCES cover_letter_templates(id) ON DELETE SET NULL,
  resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  custom_prompt TEXT NOT NULL DEFAULT '',
  file_id TEXT REFERENCES stored_files(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_edited_at TEXT
);
CREATE INDEX idx_letters_user ON cover_letters(user_id, updated_at DESC);

CREATE TABLE cover_letter_templates(
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  is_system INTEGER NOT NULL DEFAULT 0,
  system_key TEXT UNIQUE,
  name TEXT NOT NULL,
  -- Variables are stored as literal {{UPPER_SNAKE}} text.
  content_html TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  font_family TEXT NOT NULL DEFAULT 'Times New Roman',
  ai_prompt TEXT NOT NULL DEFAULT '' CHECK(length(ai_prompt) <= 1000),
  origin TEXT NOT NULL DEFAULT 'blank' CHECK(origin IN('blank','uploaded','duplicated','system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_edited_at TEXT,
  CHECK((is_system = 1 AND user_id IS NULL) OR (is_system = 0 AND user_id IS NOT NULL))
);
CREATE INDEX idx_cltpl_user ON cover_letter_templates(user_id, updated_at DESC);

-- ---------------------------------------------------------------------------------------------------------- jobs --
CREATE TABLE companies(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  website TEXT,
  logo_path TEXT,
  tagline TEXT,
  about TEXT,
  size_bucket TEXT,
  stage TEXT,
  funding TEXT,
  headquarters TEXT,
  founded_year INTEGER,
  industry TEXT,
  links TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(links)),
  sponsors_h1b INTEGER,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE job_sources(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN('greenhouse','lever','ashby','csv','json','ft_lake','seed')),
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config)),
  company_id INTEGER REFERENCES companies(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule TEXT NOT NULL DEFAULT 'daily',
  deactivate_missing INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_success_at TEXT,
  last_status TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(kind, name)
);

CREATE TABLE ingest_runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK(trigger IN('schedule','manual','upload','startup')),
  status TEXT NOT NULL CHECK(status IN('running','succeeded','failed','partial')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  fetched INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  deactivated INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  log TEXT
);
CREATE INDEX idx_runs_source ON ingest_runs(source_id, started_at DESC);

CREATE TABLE job_analyses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN('deterministic','ft_lake','ai')),
  version INTEGER NOT NULL,
  model TEXT,
  prompt_hash TEXT,
  requirements TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(requirements)),
  responsibilities TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(responsibilities)),
  desired TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(desired)),
  -- {"high":[{"term":"Kubernetes","synonyms":["k8s"]}],"low":[...]}
  keywords TEXT NOT NULL DEFAULT '{"high":[],"low":[]}' CHECK(json_valid(keywords)),
  experience_levels TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(experience_levels)),
  leadership TEXT,
  min_years INTEGER,
  category_id TEXT,
  subcategory_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(subcategory_ids)),
  extras TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extras)),
  created_at TEXT NOT NULL,
  UNIQUE(content_hash, source, version)
);

CREATE TABLE jobs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL,
  description_html TEXT NOT NULL DEFAULT '',
  description_text TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL DEFAULT '',
  link_key TEXT,
  content_hash TEXT NOT NULL,
  employment_type TEXT CHECK(employment_type IN('internship','full_time','part_time','contract')),
  work_arrangement TEXT CHECK(work_arrangement IN('remote','hybrid','onsite')),
  experience_levels TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(experience_levels)),
  leadership TEXT CHECK(leadership IN('ic','manager')),
  category_id TEXT,
  subcategory_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(subcategory_ids)),
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  salary_period TEXT CHECK(salary_period IN('year','month','week','day','hour')),
  salary_annual_usd_min REAL,
  salary_annual_usd_max REAL,
  salary_raw TEXT,
  sponsors_h1b INTEGER,
  requires_clearance INTEGER,
  degree TEXT,
  industry TEXT,
  locations_text TEXT NOT NULL DEFAULT '',
  primary_location TEXT NOT NULL DEFAULT '',
  location_count INTEGER NOT NULL DEFAULT 0,
  posted_at TEXT,
  source_updated_at TEXT,
  last_verified_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  closed_at TEXT,
  analysis_id INTEGER REFERENCES job_analyses(id) ON DELETE SET NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_posted ON jobs(active, posted_at DESC);
CREATE INDEX idx_jobs_updated ON jobs(active, source_updated_at DESC);
CREATE INDEX idx_jobs_salary ON jobs(active, salary_annual_usd_max DESC);
CREATE INDEX idx_jobs_category ON jobs(active, category_id);
CREATE INDEX idx_jobs_company ON jobs(company_id, active);
CREATE INDEX idx_jobs_hash ON jobs(content_hash);
CREATE UNIQUE INDEX idx_jobs_link ON jobs(link_key) WHERE link_key IS NOT NULL;

CREATE TABLE job_locations(
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  raw TEXT NOT NULL,
  city TEXT,
  region TEXT,
  country_code TEXT,
  is_remote INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(job_id, position)
);
CREATE INDEX idx_job_loc ON job_locations(country_code, region, city);

CREATE TABLE job_source_links(
  source_id INTEGER NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
  source_job_id TEXT NOT NULL,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missing_since TEXT,
  PRIMARY KEY(source_id, source_job_id)
);
CREATE INDEX idx_jsl_job ON job_source_links(job_id);

-- Contentless FTS index; rowid = jobs.id. Written in the same transaction as the jobs row.
CREATE VIRTUAL TABLE jobs_fts USING fts5(
  title, company_name, locations_text, description_text,
  content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);

-- ---------------------------------------------------------------------------------------------------- user x job --
CREATE TABLE user_job_state(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  hidden_at TEXT,
  viewed_at TEXT,
  PRIMARY KEY(user_id, job_id)
);

CREATE TABLE user_hidden_companies(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TEXT,
  PRIMARY KEY(user_id, company_id)
);

CREATE TABLE job_reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN('inactive','spam','inaccurate','duplicate','other')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved','dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX idx_reports_status ON job_reports(status, created_at DESC);

CREATE TABLE saved_searches(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query TEXT NOT NULL CHECK(json_valid(query)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_saved_searches_user ON saved_searches(user_id, created_at DESC);

-- ------------------------------------------------------------------------------------------------------- tracker --
CREATE TABLE applications(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  company_id INTEGER REFERENCES companies(id),
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL CHECK(employment_type IN('internship','full_time','part_time','contract')),
  posting_url TEXT NOT NULL DEFAULT '',
  description_html TEXT NOT NULL DEFAULT '',
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  salary_period TEXT CHECK(salary_period IN('year','month','week','day','hour')),
  -- Denormalized max(application_status_events.status), maintained in the same transaction.
  current_status INTEGER NOT NULL DEFAULT 1,
  favorite INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  cover_letter_id TEXT REFERENCES cover_letters(id) ON DELETE SET NULL,
  notes_html TEXT NOT NULL DEFAULT '',
  tracked_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_app_user_job ON applications(user_id, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_app_board ON applications(user_id, archived_at, current_status, tracked_on DESC);

CREATE TABLE application_status_events(
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status INTEGER NOT NULL CHECK(status IN(1,2,11,12,13,21,22,23,24)),
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(application_id, status)
);

CREATE TABLE application_questions(
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX idx_app_questions ON application_questions(application_id, position);

-- ------------------------------------------------------------------------------------------------------------ AI --
CREATE TABLE ai_tasks(
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('resume_import','entry_bullets','job_analysis','cover_letter','template_fill')),
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
CREATE INDEX idx_ai_queue ON ai_tasks(status, priority DESC, created_at);
CREATE INDEX idx_ai_user ON ai_tasks(user_id, kind, status);
CREATE UNIQUE INDEX idx_ai_dedupe ON ai_tasks(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN('queued','running');
