import { SAVE_ALL_LIMIT, type JobsQuery, type SaveAllPreview, type SaveAllResponse } from '@tailorit/shared';
import { todayIso, type AppDeps } from '../../core/context';
import { conflict } from '../../core/http/errors';
import { resumeChooser } from '../applications/resume-choice';
import { assertValidDate, saveJobs } from '../applications/service';
import { countJobs, matchingJobIds, type SearchScope } from './search';

// Save all (work package WP7): the list header's "Save all" saves the jobs that match the list's filters as Saved
// applications, at most SAVE_ALL_LIMIT per click, in the order the list shows them. The matches are the list's own
// (`countJobs` / `matchingJobIds` over the same filters, joins and order). A match is saveable when the viewer does not
// track it: no application yet, or one un-saved earlier (archived while only Saved), which comes back. Jobs already
// tracked keep their status (an active application, or Applied and later even when archived). The writes are the
// tracker's (`saveJobs`): the single Save's prefill, the best-matched resume chosen within one budget per click (the
// rest are linked by the match worker within seconds), never an AI call. Undo is the tracker's bulk archive with
// `onlySaved`, over the application ids of the answer.

/** A second click while the first one still runs (one run per account at a time). */
export const SAVE_ALL_BUSY_MESSAGE = 'Save all is still working on your last request. Wait a moment and try again.';

export interface SaveAll {
  /** GET /api/jobs/save-all/preview: the numbers of the "Save N jobs?" confirm. */
  preview(userId: string, query: JobsQuery): SaveAllPreview;
  /**
   * POST /api/jobs/save-all: saves the first SAVE_ALL_LIMIT saveable matches on `occurredOn` (default today, UTC).
   * 400 for a day that is not real or is in the future; 409 while another run of the account is going.
   */
  run(userId: string, query: JobsQuery, occurredOn?: string): Promise<SaveAllResponse>;
}

type SaveAllDeps = Pick<AppDeps, 'db' | 'now' | 'services' | 'log'>;

/** The matches of the query, and those Save all can save, as one snapshot (two COUNTs, nothing in between). */
function counted(deps: SaveAllDeps, scope: SearchScope, query: JobsQuery): { matched: number; saveable: number } {
  const matched = countJobs(deps.db, query, scope);
  const saveable = countJobs(deps.db, query, scope, { untrackedOnly: true });
  return { matched, saveable: Math.min(saveable, matched) };
}

/** The service behind the routes. It remembers which accounts have a run going, so make one per app. */
export function createSaveAll(deps: SaveAllDeps): SaveAll {
  /** Accounts with a run going: their next click answers 409 until it ends. */
  const running = new Set<string>();
  const scopeOf = (userId: string): SearchScope => ({ userId, now: deps.now() });

  return {
    preview(userId, query) {
      const { matched, saveable } = counted(deps, scopeOf(userId), query);
      return { matched, saveable, willSave: Math.min(saveable, SAVE_ALL_LIMIT) };
    },

    async run(userId, query, occurredOn) {
      const date = occurredOn ?? todayIso(deps);
      assertValidDate(deps, date);
      // Taken before the try, so a refused second click never releases the first click's run.
      if (running.has(userId)) throw conflict(SAVE_ALL_BUSY_MESSAGE);
      running.add(userId);
      try {
        const scope = scopeOf(userId);
        const { matched, saveable } = counted(deps, scope, query);
        const jobIds = matchingJobIds(deps.db, query, scope, { untrackedOnly: true, limit: SAVE_ALL_LIMIT });
        // A first chunk that fails throws (nothing was saved: 500). A later one ends the run with what was saved.
        const result = await saveJobs(deps, userId, jobIds, {
          occurredOn: date,
          chooseResumes: resumeChooser(deps, userId),
        });
        const incomplete = result.error !== undefined;
        if (incomplete) {
          deps.log.error(
            `[jobs] Save all stopped part-way for account ${userId}: ${result.items.length} of ${jobIds.length} job(s) saved`,
            result.error,
          );
        }
        return {
          items: result.items,
          alreadyTracked: matched - saveable,
          // Jobs found tracked (or gone) when written are no longer saveable either.
          remaining: Math.max(0, saveable - result.items.length - result.skipped),
          pendingMatches: result.pendingMatches,
          incomplete,
        };
      } finally {
        running.delete(userId);
      }
    },
  };
}
