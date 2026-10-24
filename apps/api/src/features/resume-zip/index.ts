import type { Feature } from '../../core/feature';
import { createResumeZipService } from './registry';
import { createResumeZipRouter } from './router';

// "Build resumes" (work package WP11): a ZIP of each application's resume as {Company}/{Role}/{First_Last}_resume.{ext},
// built in the background (see ./build.ts and ./registry.ts). Registers `deps.services.resumeZip`. Listed before the
// tracker's feature, and mounted at its exact prefix, so the tracker's /api/applications/:id routes never take these.
// `start` clears the zips an earlier run left on disk and forgets expired ones every minute; its stop stops running
// builds (before the database and the PDF browser close: features stop in reverse order).

const SWEEP_EVERY_MS = 60_000;

export const resumeZipFeature: Feature = {
  name: 'resume-zip',
  services(deps) {
    deps.services.resumeZip = createResumeZipService(deps);
  },
  routes: [{ path: '/api/applications/resume-zip', router: createResumeZipRouter }],
  start(deps) {
    const service = deps.services.resumeZip;
    if (!service) return;
    service.clearLeftovers();
    const timer = setInterval(() => {
      service.sweep().catch((error: unknown) => deps.log.warn('[resume-zip] could not forget the expired zips', error));
    }, SWEEP_EVERY_MS);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await service.stop();
    };
  },
};
