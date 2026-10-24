import {
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVEL_SHORT,
  SAVE_ALL_LIMIT,
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
  type SaveAllPreview,
  type SaveAllResponse,
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

// ------------------------------------------------------------------------------------------------- Save all

/** The Save all button's tooltip. */
export const SAVE_ALL_HINT = `Save the jobs that match your filters, up to ${SAVE_ALL_LIMIT} at a time`;
/** Toast titles of Save all's failures; the server's sentence follows. */
export const SAVE_ALL_FAILED = 'The jobs could not be saved';
export const UNDO_SAVE_ALL_FAILED = 'The jobs could not be removed from saved jobs';

/** A toast's two lines. */
export interface ToastCopy {
  title: string;
  description: string;
}

const number = (count: number) => count.toLocaleString('en-US');
/** "1 job", "1,250 jobs". */
const jobCount = (count: number) => `${number(count)} ${count === 1 ? 'job' : 'jobs'}`;

/** Save all found nothing to save: the matches are all in the Job Tracker already, or nothing matches any more. */
export function nothingToSaveCopy(matched: number): ToastCopy {
  let description = `All ${number(matched)} jobs are already in your Job Tracker.`;
  if (matched === 0) description = 'No jobs match these filters any more.';
  else if (matched === 1) description = 'This job is already in your Job Tracker.';
  return { title: 'Nothing new to save', description };
}

export interface SaveAllConfirmCopy {
  title: string;
  description: string;
  /** The matches left as they are (in the Job Tracker already), or null when there are none. */
  note: string | null;
  confirmLabel: string;
  busyLabel: string;
}

/** The "Save N jobs?" confirm, for the preview's numbers. */
export function saveAllConfirmCopy(preview: SaveAllPreview): SaveAllConfirmCopy {
  const count = preview.willSave;
  const tracked = Math.max(0, preview.matched - preview.saveable);
  let description = count === 1 ? 'It goes to your Job Tracker under Saved.' : 'They go to your Job Tracker under Saved.';
  if (preview.saveable > SAVE_ALL_LIMIT) {
    description =
      `You can save up to ${number(SAVE_ALL_LIMIT)} jobs at a time. These are the first ${number(count)} of ` +
      `${number(preview.saveable)} jobs you haven't saved, in the order the list shows them.`;
  }
  let note: string | null = null;
  if (tracked === 1) note = '1 matching job is already in your Job Tracker and keeps its status.';
  else if (tracked > 1) note = `${number(tracked)} matching jobs are already in your Job Tracker and keep their status.`;
  return { title: `Save ${jobCount(count)}?`, description, note, confirmLabel: `Save ${jobCount(count)}`, busyLabel: 'Saving...' };
}

/** The toast after Save all. Saved none (the jobs were saved meanwhile): "Nothing new to save". */
export function saveAllResultCopy(result: Pick<SaveAllResponse, 'items' | 'remaining' | 'incomplete'>): ToastCopy {
  const saved = result.items.length;
  if (saved === 0) return { title: 'Nothing new to save', description: 'These jobs are already in your Job Tracker.' };
  let description = saved === 1 ? 'Find it in your Job Tracker under Saved.' : 'Find them in your Job Tracker under Saved.';
  if (result.incomplete) description += ' Some jobs could not be saved. Click Save all to try the rest.';
  else if (result.remaining > 0) description += ` ${number(result.remaining)} more can be saved with Save all.`;
  return { title: `Saved ${jobCount(saved)}`, description };
}

/** The toast after Save all's Undo, for how many applications it archived. */
export function saveAllUndoneCopy(removed: number): ToastCopy {
  if (removed === 0) {
    return { title: 'Nothing was removed from saved jobs', description: 'These jobs have moved past Saved in your Job Tracker.' };
  }
  return {
    title: `Removed ${jobCount(removed)} from saved jobs`,
    description: removed === 1 ? 'It is archived in your Job Tracker.' : 'They are archived in your Job Tracker.',
  };
}
