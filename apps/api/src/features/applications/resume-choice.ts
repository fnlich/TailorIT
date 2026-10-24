import type { AppDeps } from '../../core/context';
import type { ResumeChoice } from '../resume-match/types';

// Which resume a saved job gets (work package WP6). Both save paths ask here: the single Save (POST /api/applications,
// see router.ts) and Save all (`saveJobs` in service.ts, called by the Jobs feature). Asking is read-only: the resume
// match service (deps.services.resumeMatch, WP5) scores the account's resumes against each job, writes nothing and
// never queues AI work. The save then writes the choice itself, through the full guard (`writeAutoChoice`).
//
// Nothing here ever fails a save: with no match service, or when it fails (logged), every job is left unfinished,
// and the save writes it due (resume_match_due = 1) for the match worker. service.ts imports only types from this
// file, so the tracker's service keeps its narrow dependencies (the database and the clock).

export type { ResumeChoice } from '../resume-match/types';

/** What the chooser answered for some jobs. */
export interface ResumeChoices {
  /** The best resume of each job it reached (`resumeId` null: the account has no resume). Unknown jobs are left out. */
  choices: Map<number, ResumeChoice>;
  /** Jobs it did not reach within the budget, or could not choose for: save them due, the worker chooses. */
  unfinished: number[];
}

/** How long the single Save waits for its choice before it saves the job due instead. */
export const SINGLE_SAVE_MATCH_BUDGET_MS = 300;
/** How long one Save all click spends choosing, over all of its chunks (see `resumeChooser`). */
export const SAVE_ALL_MATCH_BUDGET_MS = 2_000;

function uniqueJobIds(jobIds: readonly number[]): number[] {
  return [...new Set(jobIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
}

/**
 * The best resume of the account for each job, chosen within `budgetMs`. Read-only, and never throws: with no match
 * service, or when choosing fails (logged), every job is unfinished.
 */
export async function bestResumes(
  deps: Pick<AppDeps, 'services' | 'log'>,
  userId: string,
  jobIds: readonly number[],
  budgetMs: number,
): Promise<ResumeChoices> {
  const ids = uniqueJobIds(jobIds);
  if (ids.length === 0) return { choices: new Map(), unfinished: [] };
  try {
    const service = deps.services.resumeMatch;
    if (!service) return { choices: new Map(), unfinished: ids };
    const { choices, unfinished } = await service.chooseForJobs(userId, ids, {
      budgetMs: Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : 0,
    });
    return { choices, unfinished };
  } catch (error) {
    deps.log.warn(
      `[applications] could not choose resumes for ${ids.length} saved job(s) of account ${userId}; the match worker chooses them`,
      error,
    );
    return { choices: new Map(), unfinished: ids };
  }
}

/**
 * A `chooseResumes` for `saveJobs` whose calls share one budget, counted from now (Save all's 2 s per click). Once
 * it is spent, the jobs asked about are unfinished without asking the match service.
 */
export function resumeChooser(
  deps: Pick<AppDeps, 'services' | 'log'>,
  userId: string,
  totalBudgetMs: number = SAVE_ALL_MATCH_BUDGET_MS,
): (jobIds: readonly number[]) => Promise<ResumeChoices> {
  const deadline = performance.now() + (Number.isFinite(totalBudgetMs) ? Math.max(0, totalBudgetMs) : 0);
  return (jobIds) => {
    const left = deadline - performance.now();
    if (left <= 0) return Promise.resolve({ choices: new Map(), unfinished: uniqueJobIds(jobIds) });
    return bestResumes(deps, userId, jobIds, left);
  };
}
