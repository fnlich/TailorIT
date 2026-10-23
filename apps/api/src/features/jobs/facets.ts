import {
  CA_PROVINCES,
  COMPANY_SIZES,
  US_STATES,
  countryDisplayName,
  formatLocation,
  industryLabel,
  jobCategoryLabel,
  jobSubcategoryLabel,
  subcategoryParent,
  type JobFacet,
  type JobFacetItem,
  type JobFacetsSummary,
} from '@tailorit/shared';
import type { Db } from '../../core/db/connection';

// The value lists the filters offer, with how many active jobs carry each value ("Category [2]" menu counts, the
// Location suggestions, "Remote in USA"). Counts are over every active job, not the current search.

interface Counted {
  value: string;
  count: number;
}

function matches(label: string, q: string | undefined): boolean {
  if (!q) return true;
  return label.toLocaleLowerCase('en-US').includes(q.toLocaleLowerCase('en-US'));
}

function top(items: JobFacetItem[], q: string | undefined, limit: number): JobFacetItem[] {
  return items
    .filter((item) => matches(item.label, q))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function categories(db: Db): JobFacetItem[] {
  const rows = db
    .prepare(
      `SELECT category_id AS value, COUNT(*) AS count FROM jobs
       WHERE active = 1 AND category_id IS NOT NULL AND category_id <> '' GROUP BY category_id`,
    )
    .all() as Counted[];
  return rows
    .map((row) => ({ value: row.value, label: jobCategoryLabel(row.value), count: row.count }))
    .filter((item) => item.label);
}

function subcategories(db: Db): JobFacetItem[] {
  const rows = db
    .prepare(
      `SELECT sc.value AS value, COUNT(DISTINCT j.id) AS count FROM jobs j, json_each(j.subcategory_ids) sc
       WHERE j.active = 1 AND sc.type = 'text' GROUP BY sc.value`,
    )
    .all() as Counted[];
  const out: JobFacetItem[] = [];
  for (const row of rows) {
    const label = jobSubcategoryLabel(row.value);
    const parent = subcategoryParent(row.value);
    if (label && parent) out.push({ value: row.value, label, count: row.count, parent });
  }
  return out;
}

function industries(db: Db): JobFacetItem[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(j.industry, ''), NULLIF(c.industry, ''), 'not_specified') AS value, COUNT(*) AS count
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.active = 1 GROUP BY 1`,
    )
    .all() as Counted[];
  return rows
    .map((row) => ({ value: row.value, label: industryLabel(row.value), count: row.count }))
    .filter((item) => item.label);
}

function companySizes(db: Db): JobFacetItem[] {
  const rows = db
    .prepare(
      `SELECT c.size_bucket AS value, COUNT(*) AS count FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.active = 1 AND c.size_bucket IS NOT NULL GROUP BY c.size_bucket`,
    )
    .all() as Counted[];
  const counts = new Map(rows.map((row) => [row.value, row.count]));
  // Size order, not count order.
  return COMPANY_SIZES.filter((size) => counts.has(size.id)).map((size) => ({
    value: size.id,
    label: size.label,
    count: counts.get(size.id) ?? 0,
  }));
}

function companies(db: Db, q: string | undefined, limit: number): JobFacetItem[] {
  const like = q ? `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  const rows = db
    .prepare(
      `SELECT CAST(c.id AS TEXT) AS value, c.name AS label, COUNT(*) AS count
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.active = 1 ${like ? "AND c.name LIKE @like ESCAPE '\\'" : ''}
       GROUP BY c.id ORDER BY count DESC, c.name COLLATE NOCASE LIMIT @limit`,
    )
    .all({ limit, ...(like ? { like } : {}) }) as Array<Counted & { label: string }>;
  return rows.map((row) => ({ value: row.value, label: row.label, count: row.count }));
}

interface PlaceRow {
  city: string | null;
  region: string | null;
  country_code: string | null;
  count: number;
}

const REGION_NAMES: Record<string, Readonly<Record<string, string>>> = { US: US_STATES, CA: CA_PROVINCES };

/** Places to suggest in the Location filter: cities, then states/provinces and countries, each with its job count. */
function locations(db: Db): JobFacetItem[] {
  const out = new Map<string, JobFacetItem>();
  const add = (label: string, count: number) => {
    if (!label) return;
    const existing = out.get(label.toLowerCase());
    if (existing) existing.count = Math.max(existing.count, count);
    else out.set(label.toLowerCase(), { value: label, label, count });
  };
  const cities = db
    .prepare(
      `SELECT jl.city, jl.region, jl.country_code, COUNT(DISTINCT jl.job_id) AS count
       FROM job_locations jl JOIN jobs j ON j.id = jl.job_id
       WHERE j.active = 1 AND jl.is_remote = 0 AND jl.city IS NOT NULL AND jl.city <> ''
       GROUP BY jl.city COLLATE NOCASE, jl.region, jl.country_code`,
    )
    .all() as PlaceRow[];
  for (const row of cities) {
    add(formatLocation({ raw: row.city ?? '', city: row.city, region: row.region, countryCode: row.country_code, isRemote: false }), row.count);
  }
  const regions = db
    .prepare(
      `SELECT NULL AS city, jl.region, jl.country_code, COUNT(DISTINCT jl.job_id) AS count
       FROM job_locations jl JOIN jobs j ON j.id = jl.job_id
       WHERE j.active = 1 AND jl.region IS NOT NULL AND jl.country_code IN ('US', 'CA')
       GROUP BY jl.region, jl.country_code`,
    )
    .all() as PlaceRow[];
  for (const row of regions) {
    const name = row.country_code && row.region ? REGION_NAMES[row.country_code]?.[row.region.toUpperCase()] : undefined;
    if (name) add(name, row.count);
  }
  const countries = db
    .prepare(
      `SELECT NULL AS city, NULL AS region, jl.country_code, COUNT(DISTINCT jl.job_id) AS count
       FROM job_locations jl JOIN jobs j ON j.id = jl.job_id
       WHERE j.active = 1 AND jl.country_code IS NOT NULL GROUP BY jl.country_code`,
    )
    .all() as PlaceRow[];
  for (const row of countries) add(countryDisplayName(row.country_code), row.count);
  return [...out.values()];
}

/** "Remote in USA", "Remote in Canada", ...: countries with remote postings. */
function remoteCountries(db: Db): JobFacetItem[] {
  const rows = db
    .prepare(
      `SELECT jl.country_code AS value, COUNT(DISTINCT jl.job_id) AS count
       FROM job_locations jl JOIN jobs j ON j.id = jl.job_id
       WHERE j.active = 1 AND jl.country_code IS NOT NULL AND (jl.is_remote = 1 OR j.work_arrangement = 'remote')
       GROUP BY jl.country_code`,
    )
    .all() as Counted[];
  return rows.map((row) => ({ value: row.value, label: `Remote in ${countryDisplayName(row.value)}`, count: row.count }));
}

/** One facet list, filtered by `q` (case-insensitive, on the label) and cut to `limit`, most jobs first. */
export function facetItems(db: Db, facet: JobFacet, q: string | undefined, limit: number): JobFacetItem[] {
  switch (facet) {
    case 'categories':
      return top(categories(db), q, limit);
    case 'subcategories':
      return top(subcategories(db), q, limit);
    case 'industries':
      return top(industries(db), q, limit);
    case 'companySizes':
      return companySizes(db).filter((item) => matches(item.label, q)).slice(0, limit);
    case 'companies':
      return companies(db, q, limit);
    case 'locations':
      return top(locations(db), q, limit);
    case 'remoteCountries':
      return top(remoteCountries(db), q, limit);
  }
}

/** Which filters the data can answer, with the small lists inline (GET /api/jobs/facets/summary). */
export function facetsSummary(db: Db): JobFacetsSummary {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
         COALESCE(MAX(j.salary_annual_usd_max IS NOT NULL OR j.salary_annual_usd_min IS NOT NULL), 0) AS salary,
         COALESCE(MAX(j.sponsors_h1b = 1 OR c.sponsors_h1b = 1), 0) AS h1b,
         COALESCE(MAX(j.requires_clearance IS NOT NULL), 0) AS clearance,
         COALESCE(MAX(j.leadership IS NOT NULL), 0) AS leadership,
         COALESCE(MAX(COALESCE(NULLIF(j.industry, ''), NULLIF(c.industry, '')) IS NOT NULL), 0) AS industries,
         COALESCE(MAX(c.size_bucket IS NOT NULL), 0) AS company_sizes,
         COALESCE(MAX(j.work_arrangement IS NOT NULL), 0) AS arrangements,
         COALESCE(MAX(j.experience_levels NOT IN ('', '[]')), 0) AS levels
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.active = 1`,
    )
    .get() as Record<string, number>;
  const yes = (key: string) => Number(row[key] ?? 0) === 1;
  return {
    total: Number(row.total ?? 0),
    available: {
      salary: yes('salary'),
      h1b: yes('h1b'),
      clearance: yes('clearance'),
      leadership: yes('leadership'),
      industries: yes('industries'),
      companySizes: yes('company_sizes'),
      arrangements: yes('arrangements'),
      levels: yes('levels'),
    },
    categories: top(categories(db), undefined, 50),
    remoteCountries: top(remoteCountries(db), undefined, 50),
  };
}
