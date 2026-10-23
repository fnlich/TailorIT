import { Router } from 'express';
import { requireUser, userOf } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { contentDisposition, getFileStore, MIME_BY_KIND, withExtension } from '../../core/files/index';
import { notFound } from '../../core/http/errors';

// Uploaded file storage, downloads and thumbnails. Owned by work package F3 (see docs/ARCHITECTURE.md).

/** Mounted at /api/files. Owner only: anyone else's file is "not found". */
export function createFilesRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  // The original upload (at most UPLOAD_MAX_MB, so it is read whole). `?inline=1` shows a PDF in the browser's own
  // viewer instead of downloading it; other kinds always download.
  router.get('/:id', (req, res) => {
    const { file, buffer } = getFileStore(deps).read(req.params.id, userOf(req).id);
    const inline = req.query.inline === '1' && file.mime === MIME_BY_KIND.pdf;
    const name = withExtension(file.originalName, file.kind);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', contentDisposition(name, inline ? 'inline' : 'attachment'));
    res.send(buffer);
  });

  router.get('/:id/thumbnail', (req, res) => {
    const png = getFileStore(deps).readThumbnail(req.params.id, userOf(req).id);
    if (!png) throw notFound('That thumbnail');
    res.type('png').send(png);
  });

  return router;
}
