import type { Db } from '../../core/db/connection';
import { DETERMINISTIC_VERSION } from '../job-analysis/deterministic';
import { applyAiFacts, fillFacets, refreshAnalysisLinks, saveAnalysis } from '../job-analysis/store';
import { normalizePosting, titleKeyOf, type NormalizedCompany, type NormalizedPosting } from './normalize';
import { SOURCE_PRECEDENCE, type RawPosting, type SourceKind, type SourceRecord } from './types';

// Writes normalised postings: companies (by normalised name), jobs, job_locations, job_source_links, jobs_fts and the
// postings' analyses, in the caller's transaction. A posting whose source hash has not changed only moves its
// last-seen and last-verified times. A job is live while any of its source links is not missing. After every write
// of a job, the facts Claude read from its text are put back where the write left them empty (`applyAiFacts`), so a
// rewrite (a changed listing, a NORMALIZE_VERSION bump) never loses them.

/** Postings per transaction. */
export const BATCH_SIZE = 200;

/** A description shorter than this is too thin to identify a posting by its text across sources. */
const MIN_TEXT_FOR_DEDUPE = 200;

export interface BatchItem {
  raw: RawPosting;
  sourceHash: string;
}

export interface UpsertCounts {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  deactivated: number;
  reactivated: number;
}

export const emptyCounts = (): UpsertCounts => ({ created: 0, updated: 0, unchanged: 0, failed: 0, deactivated: 0, reactivated: 0 });

export interface UpsertFailure {
  sourceJobId: string;
  title: string;
  message: string;
}

interface LinkRow {
  source_job_id: string;
  job_id: number;
  source_hash: string;
  missing_since: string | null;
}

interface JobRow {
  id: number;
  company_id: number;
  title: string;
  content_hash: string;
  link_key: string | null;
  active: number;
  salary_min: number | null;
  salary_max: number | null;
  salary_raw: string | null;
}

interface CompanyRow {
  id: number;
  name: string;
  tagline: string | null;
  about: string | null;
  website: string | null;
  size_bucket: string | null;
  industry: string | null;
  headquarters: string | null;
  founded_year: number | null;
  stage: string | null;
  funding: string | null;
  links: string;
  sponsors_h1b: number | null;
  logo_path: string | null;
}

const bool = (value: boolean | null) => (value === null ? null : value ? 1 : 0);

export interface IngestStore {
  /** Upserts one batch inside a transaction the caller opened. */
  upsertBatch(source: SourceRecord, items: BatchItem[], now: string): { counts: UpsertCounts; failures: UpsertFailure[] };
  /**
   * After a complete listing: every link of the source that the listing did not name is marked missing, and every
   * job left with no live link is closed. Returns how many jobs were closed.
   */
  markMissing(sourceId: number, seenIds: readonly string[], now: string): { missing: number; deactivated: number };
  /** Whether a posting of this source still needs its pay range checked (new, or never checked). */
  needsPayCheck(sourceId: number, sourceJobId: string): boolean;
}

export function createIngestStore(db: Db): IngestStore {
  const sql = {
    link: db.prepare<[number, string], LinkRow>(
      'SELECT source_job_id, job_id, source_hash, missing_since FROM job_source_links WHERE source_id = ? AND source_job_id = ?',
    ),
    job: db.prepare<[number], JobRow>(
      'SELECT id, company_id, title, content_hash, link_key, active, salary_min, salary_max, salary_raw FROM jobs WHERE id = ?',
    ),
    jobByLink: db.prepare<[string], { id: number }>('SELECT id FROM jobs WHERE link_key = ?'),
    jobsByText: db.prepare<[number, string, number], { id: number; title: string }>(
      'SELECT id, title FROM jobs WHERE company_id = ? AND content_hash = ? AND NOT EXISTS ' +
        '(SELECT 1 FROM job_source_links l WHERE l.job_id = jobs.id AND l.source_id = ?) ORDER BY id',
    ),
    company: db.prepare<[string], CompanyRow>('SELECT * FROM companies WHERE name_key = ?'),
    insertCompany: db.prepare(
      'INSERT INTO companies(name, name_key, website, logo_path, tagline, about, size_bucket, stage, funding, headquarters, ' +
        'founded_year, industry, links, sponsors_h1b, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    fillCompany: db.prepare(
      'UPDATE companies SET website = COALESCE(website, ?), logo_path = COALESCE(logo_path, ?), tagline = COALESCE(tagline, ?), ' +
        'about = COALESCE(about, ?), size_bucket = COALESCE(size_bucket, ?), stage = COALESCE(stage, ?), funding = COALESCE(funding, ?), ' +
        'headquarters = COALESCE(headquarters, ?), founded_year = COALESCE(founded_year, ?), industry = COALESCE(industry, ?), ' +
        "links = CASE WHEN links = '[]' THEN ? ELSE links END, sponsors_h1b = COALESCE(sponsors_h1b, ?), updated_at = ? WHERE id = ?",
    ),
    linkKinds: db.prepare<[number, number], { kind: SourceKind }>(
      'SELECT DISTINCT s.kind FROM job_source_links l JOIN job_sources s ON s.id = l.source_id ' +
        'WHERE l.job_id = ? AND l.source_id <> ? AND l.missing_since IS NULL',
    ),
    linkTaken: db.prepare<[string, number], { id: number }>('SELECT id FROM jobs WHERE link_key = ? AND id <> ?'),
    insertJob: db.prepare(
      'INSERT INTO jobs(company_id, title, description_html, description_text, apply_url, link_key, content_hash, employment_type, ' +
        'work_arrangement, experience_levels, leadership, category_id, subcategory_ids, salary_min, salary_max, salary_currency, ' +
        'salary_period, salary_annual_usd_min, salary_annual_usd_max, salary_raw, sponsors_h1b, requires_clearance, degree, industry, ' +
        'locations_text, primary_location, location_count, posted_at, source_updated_at, last_verified_at, first_seen_at, last_seen_at, ' +
        'active, closed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    updateJob: db.prepare(
      'UPDATE jobs SET company_id = ?, title = ?, description_html = ?, description_text = ?, apply_url = ?, link_key = ?, ' +
        'content_hash = ?, employment_type = ?, work_arrangement = ?, experience_levels = ?, leadership = ?, category_id = ?, ' +
        'subcategory_ids = ?, sponsors_h1b = ?, requires_clearance = ?, degree = ?, industry = ?, locations_text = ?, ' +
        'primary_location = ?, location_count = ?, posted_at = COALESCE(?, posted_at), source_updated_at = COALESCE(?, source_updated_at), ' +
        'last_verified_at = CASE WHEN ? = 1 THEN ? ELSE last_verified_at END, last_seen_at = ?, updated_at = ? WHERE id = ?',
    ),
    updateSalary: db.prepare(
      'UPDATE jobs SET salary_min = ?, salary_max = ?, salary_currency = ?, salary_period = ?, salary_annual_usd_min = ?, ' +
        'salary_annual_usd_max = ?, salary_raw = ?, updated_at = ? WHERE id = ?',
    ),
    fillJob: db.prepare(
      "UPDATE jobs SET experience_levels = CASE WHEN experience_levels = '[]' THEN ? ELSE experience_levels END, " +
        'work_arrangement = COALESCE(work_arrangement, ?), leadership = COALESCE(leadership, ?), industry = COALESCE(industry, ?), ' +
        'sponsors_h1b = COALESCE(sponsors_h1b, ?), requires_clearance = COALESCE(requires_clearance, ?), degree = COALESCE(degree, ?), ' +
        "category_id = CASE WHEN category_id IS NULL OR category_id = 'other' THEN COALESCE(?, category_id) ELSE category_id END, " +
        "subcategory_ids = CASE WHEN subcategory_ids = '[]' AND (category_id IS NULL OR category_id = 'other' OR category_id = ?) THEN ? ELSE subcategory_ids END, " +
        'last_seen_at = ?, posted_at = COALESCE(posted_at, ?) WHERE id = ?',
    ),
    touchJob: db.prepare(
      'UPDATE jobs SET last_seen_at = ?, last_verified_at = CASE WHEN ? = 1 THEN ? ELSE last_verified_at END WHERE id = ?',
    ),
    deleteLocations: db.prepare('DELETE FROM job_locations WHERE job_id = ?'),
    insertLocation: db.prepare(
      'INSERT INTO job_locations(job_id, position, raw, city, region, country_code, is_remote) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    deleteFts: db.prepare('DELETE FROM jobs_fts WHERE rowid = ?'),
    insertFts: db.prepare(
      'INSERT INTO jobs_fts(rowid, title, company_name, locations_text, description_text) VALUES (?, ?, ?, ?, ?)',
    ),
    insertLink: db.prepare(
      'INSERT INTO job_source_links(source_id, source_job_id, job_id, source_hash, first_seen_at, last_seen_at, missing_since) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    updateLink: db.prepare(
      'UPDATE job_source_links SET job_id = ?, source_hash = ?, last_seen_at = ?, missing_since = ? WHERE source_id = ? AND source_job_id = ?',
    ),
    touchLink: db.prepare(
      'UPDATE job_source_links SET last_seen_at = ?, missing_since = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(missing_since, ?) END ' +
        'WHERE source_id = ? AND source_job_id = ?',
    ),
    liveness: db.prepare<[number], { active: number; live: number }>(
      'SELECT active, EXISTS(SELECT 1 FROM job_source_links l WHERE l.job_id = jobs.id AND l.missing_since IS NULL) AS live FROM jobs WHERE id = ?',
    ),
    setActive: db.prepare('UPDATE jobs SET active = ?, closed_at = ?, updated_at = ? WHERE id = ?'),
    markMissing: db.prepare(
      'UPDATE job_source_links SET missing_since = ? WHERE source_id = ? AND missing_since IS NULL ' +
        'AND source_job_id NOT IN (SELECT value FROM json_each(?))',
    ),
    closeOrphans: db.prepare(
      'UPDATE jobs SET active = 0, closed_at = ?, updated_at = ? WHERE active = 1 ' +
        'AND id IN (SELECT job_id FROM job_source_links WHERE source_id = ?) ' +
        'AND NOT EXISTS (SELECT 1 FROM job_source_links l WHERE l.job_id = jobs.id AND l.missing_since IS NULL)',
    ),
    payState: db.prepare<[number, string], { salary_min: number | null; salary_max: number | null; salary_raw: string | null }>(
      'SELECT j.salary_min, j.salary_max, j.salary_raw FROM job_source_links l JOIN jobs j ON j.id = l.job_id ' +
        'WHERE l.source_id = ? AND l.source_job_id = ?',
    ),
  };

  function upsertCompany(company: NormalizedCompany, now: string): number {
    const existing = sql.company.get(company.nameKey);
    const links = JSON.stringify(company.links);
    if (!existing) {
      const result = sql.insertCompany.run(
        company.name,
        company.nameKey,
        company.website,
        company.logoPath,
        company.tagline,
        company.about,
        company.sizeBucket,
        company.stage,
        company.funding,
        company.headquarters,
        company.foundedYear,
        company.industry,
        links,
        bool(company.sponsorsH1b),
        now,
        now,
      );
      return Number(result.lastInsertRowid);
    }
    const missing =
      (!existing.website && company.website) ||
      (!existing.logo_path && company.logoPath) ||
      (!existing.tagline && company.tagline) ||
      (!existing.about && company.about) ||
      (!existing.size_bucket && company.sizeBucket) ||
      (!existing.stage && company.stage) ||
      (!existing.funding && company.funding) ||
      (!existing.headquarters && company.headquarters) ||
      (existing.founded_year === null && company.foundedYear !== null) ||
      (!existing.industry && company.industry) ||
      (existing.links === '[]' && company.links.length > 0) ||
      (existing.sponsors_h1b === null && company.sponsorsH1b !== null);
    if (missing) {
      sql.fillCompany.run(
        company.website,
        company.logoPath,
        company.tagline,
        company.about,
        company.sizeBucket,
        company.stage,
        company.funding,
        company.headquarters,
        company.foundedYear,
        company.industry,
        links,
        bool(company.sponsorsH1b),
        now,
        existing.id,
      );
    }
    return existing.id;
  }

  function writeLocations(jobId: number, posting: NormalizedPosting): void {
    sql.deleteLocations.run(jobId);
    posting.locations.slice(0, 200).forEach((place, position) => {
      sql.insertLocation.run(jobId, position, place.raw.slice(0, 300), place.city, place.region, place.countryCode, place.isRemote ? 1 : 0);
    });
  }

  function writeFts(jobId: number, posting: NormalizedPosting): void {
    sql.deleteFts.run(jobId);
    sql.insertFts.run(jobId, posting.title, posting.company.name, posting.locationsText, posting.descriptionText);
  }

  function writeSalary(jobId: number, posting: NormalizedPosting, now: string): void {
    const salary = posting.salary;
    if (salary === undefined) return;
    if (salary === null) {
      // "Checked, none": '' tells the pay check not to ask again; NULL means never checked.
      sql.updateSalary.run(null, null, null, null, null, null, posting.payChecked ? '' : null, now, jobId);
      return;
    }
    sql.updateSalary.run(
      salary.min,
      salary.max,
      salary.currency,
      salary.period,
      salary.annualUsdMin,
      salary.annualUsdMax,
      salary.raw ?? (posting.payChecked ? '' : null),
      now,
      jobId,
    );
  }

  /** The posting's analyses (deterministic, the lake's), then the AI facts of its text back on its jobs. */
  function writeAnalyses(contentHash: string, posting: NormalizedPosting, now: string): void {
    const draft = posting.deterministic;
    // An existing deterministic row is kept as it is, except for facets it was stored without (before they were
    // read), which this posting supplies when it is that text.
    const deterministicId = saveAnalysis(db, { ...draft, contentHash, source: 'deterministic', version: DETERMINISTIC_VERSION }, now);
    if (draft.softSkills && posting.contentHash === contentHash) {
      fillFacets(db, deterministicId, {
        softSkills: draft.softSkills,
        terms: draft.terms ?? { certifications: [], domains: [] },
        requiredYears: draft.requiredYears ?? null,
      });
    }
    const provided = posting.provided;
    if (provided) {
      // The lake has keywords but no display bullets: the posting's own sections come first, its phrases fill gaps.
      const found = posting.deterministic;
      saveAnalysis(
        db,
        {
          contentHash,
          source: 'ft_lake',
          version: provided.version,
          model: provided.model ?? null,
          requirements: found.requirements.length ? found.requirements : (provided.requirements ?? []),
          responsibilities: found.responsibilities.length ? found.responsibilities : (provided.responsibilities ?? []),
          desired: found.desired.length ? found.desired : (provided.desired ?? []),
          keywords: provided.keywords,
          experienceLevels: provided.experienceLevels?.length ? provided.experienceLevels : posting.experienceLevels,
          leadership: provided.leadership ?? posting.leadership,
          minYears: provided.minYears ?? posting.deterministic.minYears,
          categoryId: provided.categoryId ?? posting.categoryId,
          subcategoryIds: provided.subcategoryIds ?? posting.subcategoryIds,
          extras: provided.extras ?? {},
        },
        now,
      );
    }
    refreshAnalysisLinks(db, contentHash);
    applyAiFacts(db, contentHash);
  }

  function jobValues(posting: NormalizedPosting, companyId: number, linkKeyValue: string | null) {
    return [
      companyId,
      posting.title,
      posting.descriptionHtml,
      posting.descriptionText,
      posting.applyUrl,
      linkKeyValue,
      posting.contentHash,
      posting.employmentType,
      posting.workArrangement,
      JSON.stringify(posting.experienceLevels),
      posting.leadership,
      posting.categoryId,
      JSON.stringify(posting.subcategoryIds),
    ] as const;
  }

  function insertJob(posting: NormalizedPosting, companyId: number, now: string): number {
    const salary = posting.salary ?? null;
    const linkKeyValue = posting.linkKey && !sql.jobByLink.get(posting.linkKey) ? posting.linkKey : null;
    const result = sql.insertJob.run(
      ...jobValues(posting, companyId, linkKeyValue),
      salary?.min ?? null,
      salary?.max ?? null,
      salary?.currency ?? null,
      salary?.period ?? null,
      salary?.annualUsdMin ?? null,
      salary?.annualUsdMax ?? null,
      salary ? (salary.raw ?? (posting.payChecked ? '' : null)) : posting.payChecked ? '' : null,
      bool(posting.sponsorsH1b),
      bool(posting.requiresClearance),
      posting.degree,
      posting.industry,
      posting.locationsText,
      posting.primaryLocation,
      posting.locationCount,
      posting.postedAt,
      posting.sourceUpdatedAt,
      posting.verified ? now : null,
      now,
      now,
      posting.active ? 1 : 0,
      posting.active ? null : now,
      now,
      now,
    );
    const jobId = Number(result.lastInsertRowid);
    writeLocations(jobId, posting);
    writeFts(jobId, posting);
    writeAnalyses(posting.contentHash, posting, now);
    return jobId;
  }

  function rewriteJob(job: JobRow, posting: NormalizedPosting, companyId: number, now: string): void {
    // Keep the old link key when the new one already names another job (the unique index would refuse it).
    const linkKeyValue = posting.linkKey && !sql.linkTaken.get(posting.linkKey, job.id) ? posting.linkKey : job.link_key;
    sql.updateJob.run(
      ...jobValues(posting, companyId, linkKeyValue),
      bool(posting.sponsorsH1b),
      bool(posting.requiresClearance),
      posting.degree,
      posting.industry,
      posting.locationsText,
      posting.primaryLocation,
      posting.locationCount,
      posting.postedAt,
      posting.sourceUpdatedAt,
      posting.verified ? 1 : 0,
      now,
      now,
      now,
      job.id,
    );
    writeSalary(job.id, posting, now);
    writeLocations(job.id, posting);
    writeFts(job.id, posting);
    writeAnalyses(posting.contentHash, posting, now);
  }

  /** A lower-precedence source fills what the job's own source left empty, and adds its analysis. */
  function fillJob(job: JobRow, posting: NormalizedPosting, now: string): void {
    sql.fillJob.run(
      JSON.stringify(posting.experienceLevels),
      posting.workArrangement,
      posting.leadership,
      posting.industry,
      bool(posting.sponsorsH1b),
      bool(posting.requiresClearance),
      posting.degree,
      posting.categoryId,
      posting.categoryId,
      JSON.stringify(posting.subcategoryIds),
      now,
      posting.postedAt,
      job.id,
    );
    if (posting.salary && job.salary_min === null && job.salary_max === null) writeSalary(job.id, posting, now);
    if (posting.verified) sql.touchJob.run(now, 1, now, job.id);
    // Its analysis reads the same posting (same link or same text): file it under the job's text.
    if (posting.provided) writeAnalyses(job.content_hash, posting, now);
    else applyAiFacts(db, job.content_hash);
  }

  function outranks(source: SourceRecord, jobId: number): boolean {
    const others = sql.linkKinds.all(jobId, source.id).map((row) => SOURCE_PRECEDENCE[row.kind] ?? 0);
    return others.length === 0 || SOURCE_PRECEDENCE[source.kind] >= Math.max(...others);
  }

  function findDuplicate(posting: NormalizedPosting, companyId: number, sourceId: number): JobRow | null {
    if (posting.linkKey) {
      const byLink = sql.jobByLink.get(posting.linkKey);
      if (byLink) return sql.job.get(byLink.id) ?? null;
    }
    if (posting.descriptionText.length < MIN_TEXT_FOR_DEDUPE) return null;
    const match = sql.jobsByText.all(companyId, posting.contentHash, sourceId).find((row) => titleKeyOf(row.title) === posting.titleKey);
    return match ? (sql.job.get(match.id) ?? null) : null;
  }

  /** Brings jobs.active in line with its links; counts the change. */
  function settleLiveness(jobId: number, now: string, counts: UpsertCounts): void {
    const state = sql.liveness.get(jobId);
    if (!state) return;
    if (state.active === 1 && state.live === 0) {
      sql.setActive.run(0, now, now, jobId);
      counts.deactivated += 1;
    } else if (state.active === 0 && state.live === 1) {
      sql.setActive.run(1, null, now, jobId);
      counts.reactivated += 1;
    }
  }

  function upsertOne(source: SourceRecord, item: BatchItem, now: string, counts: UpsertCounts): void {
    const { raw, sourceHash } = item;
    const live = raw.active !== false;
    const link = sql.link.get(source.id, String(raw.sourceJobId));

    if (link && link.source_hash === sourceHash) {
      sql.touchLink.run(now, live ? 1 : 0, now, source.id, link.source_job_id);
      sql.touchJob.run(now, raw.verified !== false ? 1 : 0, now, link.job_id);
      const supplied = raw.supplement?.salary;
      if (supplied !== undefined) {
        // A pay range fetched for a posting that had none checked: store it without rewriting the rest.
        const posting = normalizePosting(raw);
        const job = sql.job.get(link.job_id);
        if (job && job.salary_min === null && job.salary_max === null && outranks(source, job.id)) writeSalary(job.id, posting, now);
      }
      settleLiveness(link.job_id, now, counts);
      counts.unchanged += 1;
      return;
    }

    const posting = normalizePosting(raw);
    const companyId = upsertCompany(posting.company, now);
    const missingSince = live ? null : now;

    if (link) {
      const job = sql.job.get(link.job_id);
      if (job) {
        if (outranks(source, job.id)) rewriteJob(job, posting, companyId, now);
        else fillJob(job, posting, now);
        sql.updateLink.run(job.id, sourceHash, now, missingSince, source.id, link.source_job_id);
        settleLiveness(job.id, now, counts);
        counts.updated += 1;
        return;
      }
    }

    const duplicate = findDuplicate(posting, companyId, source.id);
    let jobId: number;
    if (duplicate) {
      jobId = duplicate.id;
      if (outranks(source, duplicate.id)) {
        rewriteJob(duplicate, posting, companyId, now);
        counts.updated += 1;
      } else {
        fillJob(duplicate, posting, now);
        counts.unchanged += 1;
      }
    } else {
      jobId = insertJob(posting, companyId, now);
      counts.created += 1;
    }
    if (link) sql.updateLink.run(jobId, sourceHash, now, missingSince, source.id, link.source_job_id);
    else sql.insertLink.run(source.id, posting.sourceJobId, jobId, sourceHash, now, now, missingSince);
    settleLiveness(jobId, now, counts);
  }

  return {
    upsertBatch(source, items, now) {
      const counts = emptyCounts();
      const failures: UpsertFailure[] = [];
      for (const item of items) {
        // A savepoint per posting: one bad posting fails alone, the rest of the batch commits. Its counts join the
        // batch's only once it committed, so a rolled-back posting is counted as failed and nothing else.
        const own = emptyCounts();
        const savepoint = db.transaction(() => upsertOne(source, item, now, own));
        try {
          savepoint();
          for (const key of Object.keys(counts) as Array<keyof UpsertCounts>) counts[key] += own[key];
        } catch (error) {
          counts.failed += 1;
          failures.push({
            sourceJobId: String(item.raw.sourceJobId ?? ''),
            title: String(item.raw.title ?? ''),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { counts, failures };
    },

    markMissing(sourceId, seenIds, now) {
      const missing = sql.markMissing.run(now, sourceId, JSON.stringify(seenIds)).changes;
      const deactivated = sql.closeOrphans.run(now, now, sourceId).changes;
      return { missing, deactivated };
    },

    needsPayCheck(sourceId, sourceJobId) {
      const state = sql.payState.get(sourceId, sourceJobId);
      if (!state) return true;
      return state.salary_min === null && state.salary_max === null && state.salary_raw === null;
    },
  };
}
