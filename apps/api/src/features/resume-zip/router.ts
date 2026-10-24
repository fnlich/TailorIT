import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Router, type Request } from 'express';
import { IdParam, ResumeZipBodySchema } from '@tailorit/shared';
import { requireUser, userOf } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { contentDisposition } from '../../core/files/names';
import { AppError, asyncHandler } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import type { ResumeZipService } from './registry';

// "Build resumes" (work package WP11), mounted at /api/applications/resume-zip ahead of the tracker's own router, so
// its /:id routes never see these paths. Every route needs a signed-in account and answers only about that account's
// builds (another account's is 404, as one that never existed); POST also needs the app's Origin (app-wide check).
//   POST /                  { ids?, tzOffsetMinutes? } -> 202 { buildId }
//   GET  /:buildId          the build's progress (ResumeZipBuild)
//   GET  /:buildId/file     the zip, with its Content-Length; removed once it was downloaded whole

const NOT_AVAILABLE = 'That zip is no longer available. Build your resumes again.';

function serviceOf(deps: AppDeps): ResumeZipService {
  const service = deps.services.resumeZip;
  if (!service) throw new AppError('internal', 'Building resumes is not set up on this server.');
  return service;
}

function buildIdOf(req: Request): string {
  return parseInput(IdParam, req.params.buildId, 'link');
}

export function createResumeZipRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  router.post('/', (req, res) => {
    const body = parseInput(ResumeZipBodySchema, req.body ?? {}, 'request');
    res.status(202).json(serviceOf(deps).start(userOf(req).id, body));
  });

  router.get('/:buildId', (req, res) => {
    res.json(serviceOf(deps).status(userOf(req).id, buildIdOf(req)));
  });

  router.get(
    '/:buildId/file',
    asyncHandler(async (req, res) => {
      const download = serviceOf(deps).download(userOf(req).id, buildIdOf(req));
      let complete = false;
      try {
        // Opened before any header is set: a file that is gone is a plain JSON 404, never a broken download.
        const handle = await open(download.path, 'r').catch(() => {
          throw new AppError('not_found', NOT_AVAILABLE);
        });
        const { size } = await handle.stat().catch(async (error: unknown) => {
          await handle.close();
          throw error;
        });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', contentDisposition(download.fileName));
        res.setHeader('Content-Length', String(size));
        if (req.method === 'HEAD') {
          await handle.close();
          res.end();
          return;
        }
        // A client that goes away mid-download closes the response: the read stops and the zip stays for a retry.
        await pipeline(handle.createReadStream(), res);
        complete = true;
      } catch (error) {
        if (!res.headersSent) {
          // Nothing was sent yet: the error goes out as JSON, not as an attachment named like the zip.
          for (const header of ['Content-Type', 'Content-Disposition', 'Content-Length']) res.removeHeader(header);
          throw error;
        }
        deps.log.info(`[resume-zip] a download of ${download.fileName} ended early`, error);
        res.destroy();
      } finally {
        download.finish(complete);
      }
    }),
  );

  return router;
}
