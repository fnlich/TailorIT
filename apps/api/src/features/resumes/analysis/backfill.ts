import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { RESUME_ANALYSIS_VERSION } from '@tailorit/shared';
import type { AppDeps } from '../../../core/context';
import { readingFailedRecently, refreshStoredResume } from './store';

// The backfill of rule-based readings: resumes with no reading or one of another version (from before this feature,
// after a RESUME_ANALYSIS_VERSION bump, or after a write whose reading broke), and uploads whose place in Claude's
// backlog is missing or outdated. One resume per step, in cooperative slices: the event loop gets a turn between
// steps, every step is try / log / continue, and a resume whose reading broke waits an hour before it is tried again.
// Disabled accounts wait. No timer runs before start(); its stop function ends the running slice and waits for it.

/** Steps in one slice before the worker steps back for a moment. */
const SLICE_STEPS = 25;
const FIRST_SLICE_MS = 5_000;
/** Between slices while there is more to read. */
const BUSY_PAUSE_MS = 250;
/** Between passes once everything is read (new resumes are read when they are written). */
const IDLE_PAUSE_MS = 5 * 60_000;
const NUDGE_MS = 1_000;
const BATCH = 20;

export interface ResumeAnalysisBackfill {
  /** Reads the next resume that needs it (in id order from where the last step stopped); its id, or null at the end. */
  step(): string | null;
  /** Steps through every resume that needs it (at most `maxSteps`), the event loop running between steps. */
  drain(options?: { maxSteps?: number }): Promise<number>;
  /** A slice soon (a read path found readings it could not compute). Only once started. */
  nudge(): void;
  /** Starts the timer; returns the stop function (it ends a running slice and waits for it). */
  start(): () => Promise<void>;
}

export function createResumeAnalysisBackfill(deps: AppDeps): ResumeAnalysisBackfill {
  const { db, log } = deps;
  // Resumes are walked by id and a pass ends at the last one, so one that keeps failing never blocks the others.
  let cursor = '';
  let halted = false;
  let schedule: ((delayMs: number) => void) | null = null;

  const candidates = db.prepare<[string, number, number], { id: string }>(
    `SELECT r.id FROM resumes r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN resume_analyses d ON d.resume_id = r.id AND d.source = 'deterministic'
     LEFT JOIN resume_analysis_backlog b ON b.resume_id = r.id
     WHERE r.id > ? AND u.disabled_at IS NULL
       AND (d.resume_id IS NULL OR d.version <> ?
         OR (r.kind = 'uploaded' AND (b.resume_id IS NULL OR b.version <> ? OR b.content_hash <> d.content_hash)))
     ORDER BY r.id LIMIT ${BATCH}`,
  );

  const step = (): string | null => {
    for (;;) {
      const batch = candidates.all(cursor, RESUME_ANALYSIS_VERSION, RESUME_ANALYSIS_VERSION);
      for (const { id } of batch) {
        cursor = id;
        if (readingFailedRecently(deps, id)) continue;
        refreshStoredResume(deps, id);
        return id;
      }
      if (batch.length < BATCH) {
        // The end of the resumes: the next step starts again from the first.
        cursor = '';
        return null;
      }
    }
  };

  const drain = async ({ maxSteps = Number.POSITIVE_INFINITY }: { maxSteps?: number } = {}): Promise<number> => {
    let taken = 0;
    // Started part-way through: one more pass from the first resume covers those before the starting point.
    let lastPass = cursor === '';
    while (taken < maxSteps && !halted) {
      let id: string | null = null;
      try {
        id = step();
      } catch (error) {
        log.warn('[resume-analysis] a backfill step failed', error);
        break;
      }
      if (!id) {
        if (lastPass) break;
        lastPass = true;
        continue;
      }
      taken += 1;
      await yieldToEventLoop();
    }
    return taken;
  };

  return {
    step,
    drain,
    nudge() {
      schedule?.(NUDGE_MS);
    },
    start() {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let dueAt = Number.POSITIVE_INFINITY;
      let slice: Promise<void> | null = null;
      const run = () => {
        timer = null;
        dueAt = Number.POSITIVE_INFINITY;
        if (halted || slice) return;
        slice = (async () => {
          let more = false;
          try {
            more = (await drain({ maxSteps: SLICE_STEPS })) >= SLICE_STEPS;
          } catch (error) {
            log.warn('[resume-analysis] a backfill slice failed', error);
          } finally {
            slice = null;
            schedule?.(more ? BUSY_PAUSE_MS : IDLE_PAUSE_MS);
          }
        })();
      };
      // Timers use the wall clock (the app's clock is frozen in tests); the logic reads deps.now().
      schedule = (delayMs) => {
        if (halted) return;
        const at = Date.now() + delayMs;
        if (timer && dueAt <= at) return;
        if (timer) clearTimeout(timer);
        dueAt = at;
        timer = setTimeout(run, delayMs);
        timer.unref?.();
      };
      schedule(FIRST_SLICE_MS);
      return async () => {
        halted = true;
        schedule = null;
        if (timer) clearTimeout(timer);
        timer = null;
        await slice;
      };
    },
  };
}
