import { nowIso, type AppDeps } from '../../core/context';
import { requireIngest } from './service';
import { findSourceRecord, insertSource, type AdminRunDetail } from './sources';
import type { RunTrigger } from './types';

// The demo jobs: one `seed` source over static/seed/*.json. Used by `npm run seed:jobs` (`tsx src/cli.ts seed:jobs`),
// by SEED_DEMO=true on the first start of an empty database, and by the integration package's seed:demo.

export const SEED_SOURCE_NAME = 'Demo jobs';

export interface SeedOptions {
  /** Re-date every posting from now (the anchor moves), so "posted this week" is true again. */
  refresh?: boolean;
  trigger?: RunTrigger;
}

/** Creates the seed source when needed and runs it to the end. */
export async function seedDemoJobs(deps: AppDeps, options: SeedOptions = {}): Promise<AdminRunDetail> {
  const service = requireIngest(deps);
  const now = nowIso(deps);
  let source = findSourceRecord(deps.db, 'seed', SEED_SOURCE_NAME);
  if (!source) {
    source = insertSource(deps.db, { kind: 'seed', name: SEED_SOURCE_NAME, config: { anchor: now } }, now);
  } else if (options.refresh || typeof source.config.anchor !== 'string') {
    deps.db
      .prepare('UPDATE job_sources SET config = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify({ ...source.config, anchor: now }), now, source.id);
  }
  const { done } = service.run(source.id, options.trigger ?? 'manual', { bypassSlots: true });
  return done;
}

/** SEED_DEMO=true: the demo jobs, once, into a database that has no jobs at all. */
export async function seedOnStartup(deps: AppDeps): Promise<void> {
  if (!deps.config.seedDemo) return;
  const jobs = deps.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM jobs').get()?.n ?? 0;
  if (jobs > 0) return;
  const run = await seedDemoJobs(deps, { trigger: 'startup' });
  deps.log.info(`[ingest] SEED_DEMO: demo jobs ${run.status} (${run.created} new).`);
}
