-- More of what a posting asks for: soft skills, terms ({"certifications":[],"domains":[]}; domains are INDUSTRIES ids)
-- and the years of experience its requirements ask for. soft_skills and terms NULL = not read: rows from before this
-- migration (filled when the posting is next ingested or analysed) and AI or lake rows that did not say.
-- required_years NULL = the posting does not say (or it was not read yet: see soft_skills).
ALTER TABLE job_analyses ADD COLUMN soft_skills TEXT CHECK(soft_skills IS NULL OR json_valid(soft_skills));
ALTER TABLE job_analyses ADD COLUMN terms TEXT CHECK(terms IS NULL OR json_valid(terms));
ALTER TABLE job_analyses ADD COLUMN required_years INTEGER
  CHECK(required_years IS NULL OR (required_years >= 0 AND required_years <= 30));
