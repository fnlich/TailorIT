import {
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVEL_SHORT,
  formatLocation,
  formatLocationLine,
  formatSalaryRange,
  relativeTime,
  type DateInput,
  type ExperienceLevel,
  type JobAnalysisView,
  type JobLocation,
  type JobSort,
  type JobSummary,
} from '@tailorit/shared';

/* Wording of the Jobs page that is more than one shared formatter. Pure: `now` is always passed in. */

/** "Found 17,480 jobs", "Found 1 job". */
export function foundJobsLabel(total: number): string {
  return `Found ${total.toLocaleString('en-US')} ${total === 1 ? 'job' : 'jobs'}`;
}

/** The card's place line: "Fremont, CA, USA · In Person", "San Francisco, CA, USA + 2 more · Hybrid". */
export function cardLocationLine(job: Pick<JobSummary, 'primaryLocation' | 'locationCount' | 'workArrangement'>): string {
  return formatLocationLine(job.primaryLocation, job.locationCount, job.workArrangement);
}

/** The card's salary, '' when the posting names none ("£325k - £390k/yr"). */
export function cardSalary(job: Pick<JobSummary, 'salary'>): string {
  const salary = job.salary;
  return salary ? formatSalaryRange(salary.min, salary.max, salary.currency, salary.period) : '';
}

/**
 * The card's age: "5 months ago" (when it was posted), or "Updated 3 days ago" while the list is sorted by
 * "Recently updated".
 */
export function cardAge(job: Pick<JobSummary, 'postedAt' | 'updatedAt'>, sort: JobSort, now: DateInput): string {
  if (sort === 'updated') {
    const when = relativeTime(job.updatedAt ?? job.postedAt, now);
    return when ? `Updated ${when}` : '';
  }
  return relativeTime(job.postedAt, now);
}

/** The card's last line: salary and age joined with " · ". */
export function cardMetaLine(job: Pick<JobSummary, 'salary' | 'postedAt' | 'updatedAt'>, sort: JobSort, now: DateInput): string {
  return [cardSalary(job), cardAge(job, sort, now)].filter(Boolean).join(' · ');
}

/** The facts grid's level: "Senior", "Mid, Senior" (Simplify's short labels, in level order). */
export function levelsLabel(levels: readonly ExperienceLevel[]): string {
  const set = new Set(levels);
  return EXPERIENCE_LEVELS.filter((level) => set.has(level))
    .map((level) => EXPERIENCE_LEVEL_SHORT[level])
    .join(', ');
}

/** The facts grid's place and the others behind "+N more". */
export function placesOf(primary: string, locations: readonly JobLocation[]): { first: string; others: string[] } {
  const formatted = locations.map(formatLocation).filter(Boolean);
  const first = primary || formatted[0] || '';
  const others = formatted.filter((place, index) => place !== first && formatted.indexOf(place) === index);
  return { first, others };
}

/** "Show 8 more" / "Show less". */
export function showMoreLabel(hidden: number, expanded: boolean): string {
  return expanded ? 'Show less' : `Show ${hidden} more`;
}

/** The levels a job asks for: its own, else what its analysis read from the posting. */
export function jobLevelsOf(own: readonly ExperienceLevel[], analysis: Pick<JobAnalysisView, 'experienceLevels'> | undefined): ExperienceLevel[] {
  if (own.length > 0) return [...own];
  return [...(analysis?.experienceLevels ?? [])];
}
