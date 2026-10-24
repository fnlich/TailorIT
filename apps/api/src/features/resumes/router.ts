import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import {
  BulletsRequestSchema,
  bulletsBlocker,
  CreateResumeBodySchema,
  DuplicateResumeBodySchema,
  duplicateTitle,
  IdParam,
  normalizeResumeDocument,
  PatchResumeBodySchema,
  readResumeImport,
  ResumeBulkDeleteBodySchema,
  ResumeExportQuerySchema,
  ResumeImportJsonBodySchema,
  ResumeListQuerySchema,
  ResumePreviewRequestSchema,
  ResumeUploadQuerySchema,
  TECHNICAL_SKILLS_LAYOUTS,
  UpdateResumeBodySchema,
  type ResumeBulkDeleteResponse,
  type ResumeImportJsonResponse,
  type ResumePreviewResponse,
  type ResumeThumbnail,
  type ResumeUploadResponse,
} from '@tailorit/shared';
import { RENDER_ENGINE_VERSION, renderResumePreview } from '@tailorit/render';
import { requireAi, sendAccepted } from '../../ai/index';
import { requireUser, userOf } from '../../core/auth/guards';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { contentDisposition, getFileStore, MIME_BY_KIND, withExtension } from '../../core/files/index';
import { AppError, asyncHandler, notFound, validationFailed } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { currentResumeAnalyses, resumeAnalysisBrief, resumeAnalysisView } from './analysis/store';
import { getResumeEngine } from './engine';
import { exportBuiltResume } from './export';
import {
  assertRoomForResumes,
  defaultResumeId,
  deleteResumeRow,
  documentOf,
  findResume,
  insertResume,
  listResumeRows,
  RESUME_NOT_FOUND,
  requireResume,
  toDetail,
  toSummary,
  updateResumeDocument,
  type ResumeWithFile,
} from './repository';
import { readableForImport, readUpload, UNREADABLE_TEXT } from './upload';

// Resumes: CRUD, upload and import, the live preview and thumbnails, downloads, what TailorIT read from each resume
// (GET /:id/analysis and the list's line), and the two AI tasks (an editable copy of an upload, and Write with AI).
// Owned by work package R1 (the analysis parts: WP3). Every query is scoped to the signed-in account. An upload, once
// stored, is kept: nothing here deletes or changes one except the person's own Delete (and Rename of its title).

const UPLOAD_HAS_NO_DOCUMENT =
  'An uploaded resume has no editable content. Make an editable copy of it first, then edit the copy.';
const COPY_NOT_STARTED = 'The editable copy could not be started. Try again with "Make editable copy" on the uploaded resume.';

/** Parse a task's optional template choice leniently (a query string or a JSON body). */
const ImportChoiceSchema = z.object({
  templateId: z.string().trim().max(100).optional().catch(undefined),
  layout: z.enum(TECHNICAL_SKILLS_LAYOUTS).optional().catch(undefined),
});

function idOf(req: Request): string {
  return parseInput(IdParam, req.params.id, 'resume id');
}

function detailOf(deps: AppDeps, userId: string, id: string) {
  return toDetail(deps, requireResume(deps, userId, id), defaultResumeId(deps, userId));
}

function sendFile(res: Response, file: { buffer: Buffer; mime: string; fileName: string }, inline = false): void {
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', contentDisposition(file.fileName, inline ? 'inline' : 'attachment'));
  res.setHeader('Content-Length', String(file.buffer.length));
  res.send(file.buffer);
}

/** Thumbnails of built resumes, by resume version, template, the user's skills and the engine version. */
const THUMBNAIL_CACHE_SIZE = 300;
const thumbnails = new Map<string, Extract<ResumeThumbnail, { kind: 'html' }>>();

function rememberThumbnail(key: string, value: Extract<ResumeThumbnail, { kind: 'html' }>): void {
  thumbnails.set(key, value);
  if (thumbnails.size > THUMBNAIL_CACHE_SIZE) {
    const oldest = thumbnails.keys().next().value;
    if (oldest !== undefined) thumbnails.delete(oldest);
  }
}

/** Starts the `resume_import` task for an upload whose text is readable, when the account has room for the copy. */
function enqueueImport(deps: AppDeps, userId: string, row: ResumeWithFile, choice: z.infer<typeof ImportChoiceSchema>) {
  if (!readableForImport(row.extracted_text)) throw validationFailed(UNREADABLE_TEXT);
  assertRoomForResumes(deps, userId, 1);
  return requireAi(deps).enqueue({
    kind: 'resume_import',
    userId,
    input: { sourceResumeId: row.id, ...(choice.templateId ? { templateId: choice.templateId } : {}), ...(choice.layout ? { layout: choice.layout } : {}) },
    dedupeKey: `resume_import:${row.id}`,
  });
}

/** Deletes a resume and its uploaded file; null when it is not the account's. */
function deleteOne(deps: AppDeps, userId: string, id: string) {
  const outcome = deleteResumeRow(deps, userId, id);
  if (outcome?.fileId) {
    try {
      getFileStore(deps).remove(outcome.fileId, userId);
    } catch (error) {
      deps.log.warn(`[resumes] could not remove the file of deleted resume ${id}`, error);
    }
  }
  return outcome;
}

/** Write with AI / Improve with AI: validates the entry, then 202 { taskId }. Also mounted at /api/ai/resume-bullets. */
export function bulletsHandler(deps: AppDeps) {
  return (req: Request, res: Response) => {
    const body = parseInput(BulletsRequestSchema, req.body);
    const blocker = bulletsBlocker(body.kind, body.entry);
    if (blocker) throw validationFailed(blocker, { entry: blocker });
    if (body.task === 'improve' && !(body.entry.achievements ?? []).some((line) => line.trim())) {
      throw validationFailed('The entry has no bullets to improve yet. Choose Write with AI instead.', { task: 'nothing-to-improve' });
    }
    sendAccepted(res, requireAi(deps).enqueue({ kind: 'entry_bullets', userId: userOf(req).id, input: body }));
  };
}

/** Mounted at /api/resumes. */
export function createResumesRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  // ------------------------------------------------------------------------------------------------- list, create

  router.get('/', (req, res) => {
    const { source } = parseInput(ResumeListQuerySchema, req.query, 'query');
    const userId = userOf(req).id;
    const defaultId = defaultResumeId(deps, userId);
    const rows = listResumeRows(deps, userId, source);
    // What TailorIT read from each: at most READ_COMPUTE_LIMIT missing readings are made now, the backfill the rest.
    const readings = currentResumeAnalyses(deps, userId, { resumeIds: rows.map((row) => row.id) });
    const now = deps.now();
    const items = rows.map((row) => {
      const reading = readings.get(row.id);
      return toSummary(deps, row, defaultId, reading ? resumeAnalysisBrief(reading, now) : null);
    });
    res.json({ items, total: items.length });
  });

  router.post('/', (req, res) => {
    const body = parseInput(CreateResumeBodySchema, req.body);
    const userId = userOf(req).id;
    const id = insertResume(deps, userId, {
      kind: 'built',
      title: body.title ?? null,
      document: normalizeResumeDocument(body.document),
    });
    res.status(201).json(detailOf(deps, userId, id));
  });

  // -------------------------------------------------------------------------------------- preview, bulk, import

  router.post('/preview', (req, res) => {
    const body = parseInput(ResumePreviewRequestSchema, req.body);
    const userId = userOf(req).id;
    const engine = getResumeEngine(deps);
    let stored = null;
    if (body.resumeId) {
      const row = requireResume(deps, userId, parseInput(IdParam, body.resumeId, 'resume id'));
      stored = documentOf(row);
      if (!stored) throw validationFailed(UPLOAD_HAS_NO_DOCUMENT);
    }
    const templateId = body.templateId?.trim() || null;
    if (templateId && !engine.templates.get(templateId)) {
      throw new AppError('not_found', 'That resume template was not found. Choose another template.');
    }
    const preview: ResumePreviewResponse = renderResumePreview({
      document: normalizeResumeDocument(body.document ?? {}, stored),
      templates: engine.templates,
      templateId,
      skills: engine.skillsFor(userId),
      sample: body.sample === false ? null : engine.sample,
    });
    res.json(preview);
  });

  router.post('/bulk-delete', (req, res) => {
    const { ids } = parseInput(ResumeBulkDeleteBodySchema, req.body);
    const userId = userOf(req).id;
    const defaultId = defaultResumeId(deps, userId);
    let deleted = 0;
    const skippedIds: string[] = [];
    for (const id of [...new Set(ids)]) {
      if (id === defaultId) {
        skippedIds.push(id);
        continue;
      }
      if (deleteOne(deps, userId, id)) deleted += 1;
    }
    const body: ResumeBulkDeleteResponse = { deleted, skippedIds };
    res.json(body);
  });

  // multer for the `file` field, made on first use (the file store is created by the files feature).
  let receiveFile: RequestHandler | null = null;
  const fileField: RequestHandler = (req, res, next) => {
    receiveFile ??= getFileStore(deps).uploadSingle('file');
    receiveFile(req, res, next);
  };

  router.post(
    '/upload',
    fileField,
    asyncHandler(async (req, res) => {
      const userId = userOf(req).id;
      const { parse } = parseInput(ResumeUploadQuerySchema, req.query, 'query');
      const choice = ImportChoiceSchema.parse({ templateId: req.query.templateId, layout: req.query.layout });
      const titleField = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
      const upload = req.file!;
      const store = getFileStore(deps);
      // A full account is told so before anything is stored.
      assertRoomForResumes(deps, userId, 1);
      // The store checks the size and what the bytes are (PDF or DOCX; a .doc is refused with a hint).
      const stored = store.save({ userId, purpose: 'resume', buffer: upload.buffer, originalName: upload.originalname });
      let reading: Awaited<ReturnType<typeof readUpload>>;
      try {
        reading = await readUpload(deps, upload.buffer, stored.kind);
      } catch (error) {
        // The reader refused the file (too large unpacked, damaged, timed out) or is busy: no resume exists yet, so
        // nothing is kept.
        store.remove(stored.id, userId);
        throw error;
      }
      if (reading.thumbnail) {
        try {
          store.saveThumbnail(stored.id, reading.thumbnail);
        } catch (error) {
          deps.log.warn('[resumes] could not store an upload thumbnail', error);
        }
      }
      if (reading.pageCount) store.setPageCount(stored.id, reading.pageCount);
      let id: string;
      try {
        id = insertResume(deps, userId, {
          kind: 'uploaded',
          title: titleField || null,
          fileId: stored.id,
          extractedText: reading.text,
        });
      } catch (error) {
        // Not stored as a resume (the account filled up meanwhile): its file goes too.
        store.remove(stored.id, userId);
        throw error;
      }
      let taskId: string | null = null;
      let copyError: string | null = null;
      if (parse) {
        try {
          taskId = enqueueImport(deps, userId, requireResume(deps, userId, id), choice).taskId;
        } catch (error) {
          // The upload is kept either way; only the editable copy could not start (its text cannot be read, the AI is
          // busy or off, or the account has no room for the copy).
          if (!(error instanceof AppError)) deps.log.error('[resumes] could not start an editable copy', error);
          copyError = error instanceof AppError ? error.message : COPY_NOT_STARTED;
        }
      }
      const body: ResumeUploadResponse = {
        resume: toSummary(deps, requireResume(deps, userId, id), defaultResumeId(deps, userId)),
        taskId,
        copyError,
      };
      res.status(201).json(body);
    }),
  );

  router.post('/import-json', (req, res) => {
    const body = parseInput(ResumeImportJsonBodySchema, req.body);
    const userId = userOf(req).id;
    const read = readResumeImport(body.data);
    if (!read.ok) throw validationFailed(read.message);
    assertRoomForResumes(deps, userId, read.resumes.length);
    const ids = transaction(deps.db, () =>
      read.resumes.map((resume) => {
        const preferred = resume.document.preferredTemplate || resume.templateId || '';
        const document = preferred === resume.document.preferredTemplate ? resume.document : { ...resume.document, preferredTemplate: preferred };
        return insertResume(deps, userId, { kind: 'built', title: resume.title, document });
      }),
    );
    const defaultId = defaultResumeId(deps, userId);
    const response: ResumeImportJsonResponse = {
      resumes: ids.map((id) => toSummary(deps, requireResume(deps, userId, id), defaultId)),
      imported: ids.length,
    };
    res.status(201).json(response);
  });

  router.post('/bullets', bulletsHandler(deps));

  // --------------------------------------------------------------------------------------------------- one resume

  router.get('/:id', (req, res) => {
    res.json(detailOf(deps, userOf(req).id, idOf(req)));
  });

  /** "What TailorIT read from this resume" (ResumeAnalysisView). */
  router.get('/:id/analysis', (req, res) => {
    const view = resumeAnalysisView(deps, userOf(req).id, idOf(req));
    if (!view) throw notFound(RESUME_NOT_FOUND);
    res.json(view);
  });

  router.put('/:id', (req, res) => {
    const userId = userOf(req).id;
    const id = idOf(req);
    const body = parseInput(UpdateResumeBodySchema, req.body);
    const row = requireResume(deps, userId, id);
    const stored = documentOf(row);
    if (!stored) throw validationFailed(UPLOAD_HAS_NO_DOCUMENT);
    updateResumeDocument(deps, userId, id, normalizeResumeDocument(body.document, stored), body.title);
    res.json(detailOf(deps, userId, id));
  });

  router.patch('/:id', (req, res) => {
    const userId = userOf(req).id;
    const id = idOf(req);
    const { title } = parseInput(PatchResumeBodySchema, req.body);
    requireResume(deps, userId, id);
    deps.db.prepare('UPDATE resumes SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(title, nowIso(deps), id, userId);
    res.json(detailOf(deps, userId, id));
  });

  router.delete('/:id', (req, res) => {
    const userId = userOf(req).id;
    const outcome = deleteOne(deps, userId, idOf(req));
    if (!outcome) throw notFound('That resume');
    res.json({ deleted: true, defaultResumeId: outcome.defaultResumeId });
  });

  router.post('/:id/duplicate', (req, res) => {
    const userId = userOf(req).id;
    const row = requireResume(deps, userId, idOf(req));
    const { title } = parseInput(DuplicateResumeBodySchema, req.body ?? {});
    const label = toSummary(deps, row, null).label;
    const copyTitle = title ?? duplicateTitle(label);
    assertRoomForResumes(deps, userId, 1);
    let id: string;
    if (row.kind === 'built') {
      id = insertResume(deps, userId, { kind: 'built', title: copyTitle, document: documentOf(row) });
    } else {
      // A byte copy of the file and its text (the person asked for a copy); Claude's reading of the same text is
      // copied too, so it is not asked for again.
      const store = getFileStore(deps);
      if (!row.file_id) throw notFound('That resume file');
      const { file, buffer } = store.read(row.file_id, userId);
      const copy = store.save({ userId, purpose: 'resume', buffer, originalName: file.originalName });
      try {
        const thumbnail = store.readThumbnail(file.id, userId);
        if (thumbnail) store.saveThumbnail(copy.id, thumbnail);
        if (file.pageCount) store.setPageCount(copy.id, file.pageCount);
        id = insertResume(deps, userId, { kind: 'uploaded', title: copyTitle, fileId: copy.id, extractedText: row.extracted_text });
      } catch (error) {
        store.remove(copy.id, userId);
        throw error;
      }
    }
    res.status(201).json(detailOf(deps, userId, id));
  });

  router.post('/:id/parse', (req, res) => {
    const userId = userOf(req).id;
    const row = requireResume(deps, userId, idOf(req));
    if (row.kind !== 'uploaded') {
      throw validationFailed('Only an uploaded resume can be turned into an editable copy; this one is editable already.');
    }
    const choice = ImportChoiceSchema.parse(req.body && typeof req.body === 'object' ? req.body : {});
    sendAccepted(res, enqueueImport(deps, userId, row, choice));
  });

  router.get('/:id/thumbnail', (req, res) => {
    const userId = userOf(req).id;
    const row = requireResume(deps, userId, idOf(req));
    if (row.kind === 'uploaded') {
      if (!row.file_id || !row.file_thumb) {
        throw new AppError('not_found', 'No picture of this upload could be made. Open the file to see it.');
      }
      const image: ResumeThumbnail = { kind: 'image', url: `/api/files/${encodeURIComponent(row.file_id)}/thumbnail` };
      res.json(image);
      return;
    }
    const engine = getResumeEngine(deps);
    const document = documentOf(row)!;
    const template = engine.templates.resolve(null, document.preferredTemplate);
    const key = [userId, row.id, row.updated_at, template?.id ?? '', engine.skillsStamp(userId), RENDER_ENGINE_VERSION].join('|');
    let thumbnail = thumbnails.get(key);
    if (thumbnail) {
      thumbnails.delete(key);
      thumbnails.set(key, thumbnail);
    } else {
      const preview = renderResumePreview({ document, templates: engine.templates, skills: engine.skillsFor(userId), sample: null });
      thumbnail = { kind: 'html', html: preview.html, page: preview.page };
      rememberThumbnail(key, thumbnail);
    }
    res.json(thumbnail);
  });

  router.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const userId = userOf(req).id;
      const row = requireResume(deps, userId, idOf(req));
      const { format } = parseInput(ResumeExportQuerySchema, req.query, 'query');
      const summary = toSummary(deps, row, null);
      if (row.kind === 'uploaded') {
        // An upload downloads as itself, in its own format.
        if (!row.file_id || format === 'json' || summary.fileKind !== format) {
          const kind = summary.fileKind ? summary.fileKind.toUpperCase() : 'file';
          throw validationFailed(`This uploaded resume is a ${kind}: download the original file instead.`);
        }
        const { file, buffer } = getFileStore(deps).read(row.file_id, userId);
        sendFile(res, { buffer, mime: file.mime, fileName: withExtension(file.originalName, file.kind) });
        return;
      }
      const document = documentOf(row)!;
      const exported = await exportBuiltResume(
        deps,
        userId,
        { label: summary.label, title: summary.title, templateId: document.preferredTemplate || null, document },
        format,
      );
      sendFile(res, exported);
    }),
  );

  router.get('/:id/file', (req, res) => {
    const userId = userOf(req).id;
    const row = findResume(deps, userId, idOf(req));
    if (!row) throw notFound('That resume');
    if (row.kind !== 'uploaded' || !row.file_id) {
      throw new AppError('not_found', 'This resume was built in TailorIT and has no uploaded file. Download it as PDF or Word instead.');
    }
    const { file, buffer } = getFileStore(deps).read(row.file_id, userId);
    const inline = req.query.inline === '1' && file.mime === MIME_BY_KIND.pdf;
    sendFile(res, { buffer, mime: file.mime, fileName: withExtension(file.originalName, file.kind) }, inline);
  });

  return router;
}

/** Mounted at /api/ai/resume-bullets (the route the shared contract names). */
export function createResumeBulletsRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);
  router.post('/', bulletsHandler(deps));
  return router;
}
