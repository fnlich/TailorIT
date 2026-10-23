import type { Feature } from '../../core/feature';
import { createCoverLetterTemplatesRouter } from './router';
import { seedSystemTemplates } from './seed';

// Cover letter templates (system + user). Owned by work package C. TailorIT's starter templates are seeded
// (upserted by system_key) when the services start, so they exist before any request and in every test database.
export const coverLetterTemplatesFeature: Feature = {
  name: 'cover-letter-templates',
  services: (deps) => {
    const written = seedSystemTemplates(deps);
    if (written > 0) deps.log.info(`[cover-letter-templates] seeded ${written} starter template(s)`);
  },
  routes: [{ path: '/api/cover-letter-templates', router: createCoverLetterTemplatesRouter }],
};
