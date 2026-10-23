import { Cron } from 'croner';
import type { AppDeps } from '../../core/context';
import type { IngestService } from './service';

// The daily ingest (croner): every enabled daily source at INGEST_DAILY_AT, in INGEST_TIMEZONE (server local time when
// unset), when INGEST_ENABLED. A tick that finds the previous one still running is skipped (croner's `protect`).

/** "03:30" as a cron pattern: "30 3 * * *". Throws on a time that is not HH:MM. */
export function dailyPattern(dailyAt: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(dailyAt.trim());
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) throw new Error(`INGEST_DAILY_AT must be HH:MM, not "${dailyAt}".`);
  return `${minute} ${hour} * * *`;
}

export interface IngestSchedule {
  /** When the next run starts, or null when the schedule is off. */
  nextRun(): Date | null;
  stop(): void;
}

export function startIngestSchedule(deps: AppDeps, service: Pick<IngestService, 'runScheduled'>): IngestSchedule {
  const { ingest } = deps.config;
  if (!ingest.enabled) {
    deps.log.info('[ingest] the daily job ingest is off (INGEST_ENABLED=false); run sources from Admin > Sources.');
    return { nextRun: () => null, stop: () => {} };
  }
  const job = new Cron(
    dailyPattern(ingest.dailyAt),
    {
      name: 'tailorit-ingest',
      timezone: ingest.timezone ?? undefined,
      protect: true,
      unref: true,
      catch: (error) => deps.log.error('[ingest] the scheduled run failed', error),
    },
    async () => {
      await service.runScheduled('schedule');
    },
  );
  deps.log.info(`[ingest] daily job ingest at ${ingest.dailyAt}${ingest.timezone ? ` ${ingest.timezone}` : ''}; next ${job.nextRun()?.toISOString() ?? 'never'}`);
  return { nextRun: () => job.nextRun(), stop: () => job.stop() };
}
