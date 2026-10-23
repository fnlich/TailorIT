import {
  CLEARANCE_FILTER_LABEL,
  COMPANY_SIZES,
  EMPLOYMENT_TYPE_LABEL,
  EXPERIENCE_LEVEL_LABEL,
  LEADERSHIP_LABEL,
  SALARY_PERIOD_SUFFIX,
  UPDATED_WITHIN_LABEL,
  WORK_ARRANGEMENT_LABEL,
  countryDisplayName,
  formatSalaryRange,
  industryLabel,
  jobCategoryLabel,
  jobSubcategoryLabel,
  type JobsQuery,
} from '@tailorit/shared';

/* The active filters as removable chips ("Only 3 jobs match your filters. Remove one of these filters…"). */

export interface ActiveFilter {
  key: string;
  label: string;
  /** The change that removes this one value. */
  remove: Partial<JobsQuery>;
}

function without<T>(list: readonly T[], value: T): T[] {
  return list.filter((item) => item !== value);
}

const SIZE_LABEL = new Map<string, string>(COMPANY_SIZES.map((size) => [size.id, size.label]));

/** Yearly salary floor as Simplify writes it: "$120k+/yr". */
export function minSalaryLabel(amount: number, period: JobsQuery['payPeriod']): string {
  const range = formatSalaryRange(amount, null, 'USD', period ?? 'year');
  return range || `$${amount}${SALARY_PERIOD_SUFFIX[period ?? 'year']}`;
}

/** Every value the query filters on, in toolbar order. `companyNames` labels company ids when known. */
export function activeFilters(query: JobsQuery, companyNames: ReadonlyMap<string, string> = new Map()): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (query.q) out.push({ key: 'q', label: `"${query.q}"`, remove: { q: undefined } });
  for (const place of query.locations) {
    out.push({ key: `location:${place}`, label: place, remove: { locations: without(query.locations, place) } });
  }
  if (query.remote) out.push({ key: 'remote', label: `Remote in ${countryDisplayName(query.remote)}`, remove: { remote: undefined } });
  for (const arrangement of query.arrangements) {
    out.push({
      key: `arrangement:${arrangement}`,
      label: WORK_ARRANGEMENT_LABEL[arrangement],
      remove: { arrangements: without(query.arrangements, arrangement) },
    });
  }
  for (const type of query.jobTypes) {
    out.push({ key: `type:${type}`, label: EMPLOYMENT_TYPE_LABEL[type], remove: { jobTypes: without(query.jobTypes, type) } });
  }
  for (const level of query.levels) {
    out.push({ key: `level:${level}`, label: EXPERIENCE_LEVEL_LABEL[level], remove: { levels: without(query.levels, level) } });
  }
  for (const category of query.categories) {
    out.push({
      key: `category:${category}`,
      label: jobCategoryLabel(category),
      remove: { categories: without(query.categories, category) },
    });
  }
  for (const subcategory of query.subcategories) {
    out.push({
      key: `subcategory:${subcategory}`,
      label: jobSubcategoryLabel(subcategory),
      remove: { subcategories: without(query.subcategories, subcategory) },
    });
  }
  for (const leadership of query.leadership) {
    out.push({
      key: `leadership:${leadership}`,
      label: LEADERSHIP_LABEL[leadership],
      remove: { leadership: without(query.leadership, leadership) },
    });
  }
  if (query.minSalary) {
    out.push({
      key: 'minSalary',
      label: `Min ${minSalaryLabel(query.minSalary, query.payPeriod)}`,
      remove: { minSalary: undefined, payPeriod: undefined },
    });
  }
  if (query.h1b) out.push({ key: 'h1b', label: 'Sponsors H1B', remove: { h1b: undefined } });
  for (const industry of query.industries) {
    out.push({ key: `industry:${industry}`, label: industryLabel(industry), remove: { industries: without(query.industries, industry) } });
  }
  for (const size of query.companySizes) {
    out.push({
      key: `size:${size}`,
      label: `${SIZE_LABEL.get(size) ?? size} employees`,
      remove: { companySizes: without(query.companySizes, size) },
    });
  }
  for (const company of query.companies) {
    out.push({
      key: `company:${company}`,
      label: companyNames.get(company) ?? 'Selected company',
      remove: { companies: without(query.companies, company) },
    });
  }
  if (query.clearance) out.push({ key: 'clearance', label: CLEARANCE_FILTER_LABEL[query.clearance], remove: { clearance: undefined } });
  if (query.hideApplied) out.push({ key: 'hideApplied', label: 'Hiding applied jobs', remove: { hideApplied: undefined } });
  if (query.updatedWithin) {
    out.push({ key: 'updated', label: `Updated in the ${UPDATED_WITHIN_LABEL[query.updatedWithin].replace(/^Past /, 'past ')}`, remove: { updatedWithin: undefined } });
  }
  return out;
}

/** The query with every filter and the search removed; the sort stays. */
export function clearedQuery(query: JobsQuery): JobsQuery {
  return {
    q: undefined,
    locations: [],
    remote: undefined,
    jobTypes: [],
    levels: [],
    categories: [],
    subcategories: [],
    leadership: [],
    arrangements: [],
    minSalary: undefined,
    payPeriod: undefined,
    h1b: undefined,
    industries: [],
    companySizes: [],
    companies: [],
    clearance: undefined,
    hideApplied: undefined,
    updatedWithin: undefined,
    sort: query.sort,
    cursor: undefined,
  };
}

/** Adds or removes one value of a list filter. */
export function toggled<T>(list: readonly T[], value: T, on: boolean): T[] {
  const rest = list.filter((item) => item !== value);
  return on ? [...rest, value] : rest;
}

/** A name to start a saved search from: the first few filters ("engineer, Full-Time, Remote in USA +2"). */
export function suggestedSearchName(query: JobsQuery): string {
  const labels = activeFilters(query).map((filter) => filter.label.replace(/^"(.*)"$/, '$1'));
  const name = labels.slice(0, 3).join(', ');
  return (labels.length > 3 ? `${name} +${labels.length - 3}` : name).slice(0, 100) || 'My search';
}
