import type { Feature } from '../../core/feature';
import { createImportRouter, createReportsRouter, createRunsRouter, createSourcesRouter } from './router';
import { startIngestSchedule } from './scheduler';
import { seedDemoJobs, seedOnStartup } from './seed';
import { createIngestService, requireIngest } from './service';
import { createGoogleSheetsClient } from './sheets/client';

// Job ingestion: sources, runs, the daily schedule, CSV/JSON import, the one-time Google Sheet import, reports, the
// demo seed. Work package J1 (docs/ARCHITECTURE.md §8); the Sheet import is WP12.
export const ingestFeature: Feature = {
  name: 'ingest',
  services(deps) {
    deps.services.ingest = createIngestService(deps);
    // Reads the service account key only when an admin uses the Sheet import (nothing at startup).
    deps.services.sheets = createGoogleSheetsClient({
      keyFile: deps.config.ingest.googleServiceAccountKeyFile,
      userAgent: deps.config.ingest.userAgent,
      log: deps.log,
    });
  },
  routes: [
    { path: '/api/admin/sources', router: createSourcesRouter },
    { path: '/api/admin/runs', router: createRunsRouter },
    { path: '/api/admin/import', router: createImportRouter },
    { path: '/api/admin/reports', router: createReportsRouter },
  ],
  start(deps) {
    const service = requireIngest(deps);
    service.recoverInterrupted();
    const schedule = startIngestSchedule(deps, service);
    seedOnStartup(deps).catch((error) => deps.log.error('[ingest] SEED_DEMO: the demo jobs could not be loaded', error));
    return async () => {
      schedule.stop();
      await service.stop();
    };
  },
  commands: {
    /** `tsx src/cli.ts seed:jobs [--refresh]`: the demo companies and jobs (static/seed). */
    'seed:jobs': async (deps, args) => {
      const run = await seedDemoJobs(deps, { refresh: args.includes('--refresh') });
      console.log(
        `Demo jobs: ${run.status}. ${run.fetched} postings: ${run.created} new, ${run.updated} updated, ` +
          `${run.unchanged} unchanged, ${run.failed} failed.`,
      );
      if (run.error) console.log(run.error);
      if (run.status === 'failed') process.exitCode = 1;
    },
  },
};
