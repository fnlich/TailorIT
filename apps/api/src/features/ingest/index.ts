import type { Feature } from '../../core/feature';
import { createIngestRouter1, createIngestRouter2, createIngestRouter3, createIngestRouter4 } from './router';

// Job ingestion: sources, runs, scheduler, CSV/JSON import, reports. Owned by work package J1.
export const ingestFeature: Feature = {
  name: 'ingest',
  routes: [
    { path: '/api/admin/sources', router: createIngestRouter1 },
    { path: '/api/admin/runs', router: createIngestRouter2 },
    { path: '/api/admin/import', router: createIngestRouter3 },
    { path: '/api/admin/reports', router: createIngestRouter4 },
  ],
};
