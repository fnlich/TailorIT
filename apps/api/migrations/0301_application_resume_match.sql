-- The resume linked to an application, and who chose it: 'auto' = TailorIT's best match (chosen again while the
-- application is Saved), 'user' = picked or cleared by the person (never changed automatically), NULL = not chosen
-- yet. resume_match_due = 1 asks the match worker to choose again: the triggers below set it in the same transaction
-- as the change that calls for it, and the writers that create or restore Saved applications set it themselves.
ALTER TABLE applications ADD COLUMN resume_origin TEXT CHECK(resume_origin IS NULL OR resume_origin IN('auto','user'));
ALTER TABLE applications ADD COLUMN resume_matched_at TEXT;
ALTER TABLE applications ADD COLUMN resume_match_due INTEGER NOT NULL DEFAULT 0 CHECK(resume_match_due IN (0,1));

-- Resumes linked before automatic matching existed were linked by hand.
UPDATE applications SET resume_origin = 'user' WHERE resume_id IS NOT NULL;
-- Saved jobs with no resume get their best match.
UPDATE applications SET resume_match_due = 1
WHERE resume_id IS NULL AND job_id IS NOT NULL AND current_status = 1 AND archived_at IS NULL;

-- Saved, active applications by job. SQLite uses a partial index only for queries that spell out its condition:
-- write `current_status = 1 AND archived_at IS NULL` literally.
CREATE INDEX idx_app_saved_job ON applications(job_id, user_id) WHERE current_status = 1 AND archived_at IS NULL;
-- The applications of a resume (deleting one scans nothing).
CREATE INDEX idx_app_resume ON applications(resume_id) WHERE resume_id IS NOT NULL;
-- The match worker's queue.
CREATE INDEX idx_app_match_due ON applications(user_id) WHERE resume_match_due = 1;

-- The triggers below mark due only applications TailorIT may choose for: linked to a job, Saved, not archived, not
-- already due, and chosen automatically (or not yet).

-- A deleted resume lets go of its applications before the foreign key clears resume_id: the choice is undone, and the
-- Saved ones get a new best match.
CREATE TRIGGER trg_resumes_release_matches BEFORE DELETE ON resumes
BEGIN
  UPDATE applications
  SET resume_origin = NULL,
      resume_matched_at = NULL,
      resume_match_due = CASE WHEN job_id IS NOT NULL AND current_status = 1 AND archived_at IS NULL THEN 1 ELSE 0 END
  WHERE resume_id = OLD.id;
END;

-- What TailorIT read from a resume changed (a new resume, an edit, Claude's reading): the owner's choices may change.
-- An update counts only when the reading really changed (an upsert of the same reading sets these columns too).
CREATE TRIGGER trg_resume_analyses_due_insert AFTER INSERT ON resume_analyses
BEGIN
  UPDATE applications SET resume_match_due = 1
  WHERE user_id = (SELECT user_id FROM resumes WHERE id = NEW.resume_id)
    AND job_id IS NOT NULL AND current_status = 1 AND archived_at IS NULL
    AND resume_match_due = 0 AND (resume_origin IS NULL OR resume_origin = 'auto');
END;

CREATE TRIGGER trg_resume_analyses_due_update AFTER UPDATE OF content_hash, version ON resume_analyses
WHEN NEW.content_hash IS NOT OLD.content_hash OR NEW.version IS NOT OLD.version
BEGIN
  UPDATE applications SET resume_match_due = 1
  WHERE user_id = (SELECT user_id FROM resumes WHERE id = NEW.resume_id)
    AND job_id IS NOT NULL AND current_status = 1 AND archived_at IS NULL
    AND resume_match_due = 0 AND (resume_origin IS NULL OR resume_origin = 'auto');
END;

-- The default resume breaks ties (deleting it clears the column through its foreign key, which fires this too).
CREATE TRIGGER trg_users_default_resume_due AFTER UPDATE OF default_resume_id ON users
WHEN NEW.default_resume_id IS NOT OLD.default_resume_id
BEGIN
  UPDATE applications SET resume_match_due = 1
  WHERE user_id = NEW.id
    AND job_id IS NOT NULL AND current_status = 1 AND archived_at IS NULL
    AND resume_match_due = 0 AND (resume_origin IS NULL OR resume_origin = 'auto');
END;

-- The posting's text changed (ingest rewrote it).
CREATE TRIGGER trg_jobs_text_due AFTER UPDATE OF content_hash ON jobs
WHEN NEW.content_hash IS NOT OLD.content_hash
BEGIN
  UPDATE applications SET resume_match_due = 1
  WHERE job_id = NEW.id
    AND current_status = 1 AND archived_at IS NULL
    AND resume_match_due = 0 AND (resume_origin IS NULL OR resume_origin = 'auto');
END;

-- A closer reading of the posting landed: Claude's, or one from free_tailor's job lake.
CREATE TRIGGER trg_job_analyses_due_insert AFTER INSERT ON job_analyses
WHEN NEW.source IN ('ai', 'ft_lake')
BEGIN
  UPDATE applications SET resume_match_due = 1
  WHERE job_id IN (SELECT id FROM jobs WHERE content_hash = NEW.content_hash)
    AND current_status = 1 AND archived_at IS NULL
    AND resume_match_due = 0 AND (resume_origin IS NULL OR resume_origin = 'auto');
END;

CREATE TRIGGER trg_job_analyses_due_update AFTER UPDATE ON job_analyses
WHEN NEW.source IN ('ai', 'ft_lake') AND (NEW.keywords IS NOT OLD.keywords OR NEW.version IS NOT OLD.version)
BEGIN
  UPDATE applications SET resume_match_due = 1
  WHERE job_id IN (SELECT id FROM jobs WHERE content_hash = NEW.content_hash)
    AND current_status = 1 AND archived_at IS NULL
    AND resume_match_due = 0 AND (resume_origin IS NULL OR resume_origin = 'auto');
END;
