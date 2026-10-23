import { Router } from 'express';
import {
  AI_PROMPT_MAX,
  CoverLetterExportQuerySchema,
  CreateLetterTemplateBodySchema,
  defaultTemplateName,
  duplicateTemplateName,
  DuplicateLetterTemplateBodySchema,
  LETTER_PAGE,
  LetterTemplateBulkDeleteBodySchema,
  PatchLetterTemplateBodySchema,
  TEMPLATE_NAME_MAX,
  TEMPLATE_NAME_MIN,
  type CoverLetterPreviewResponse,
} from '@tailorit/shared';
import type { z } from 'zod';
import { requireUser, userOf } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { asyncHandler } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { letterDocument } from '../cover-letters/document';
import { extractUploadHtml, titleFromFileName, uploadKind } from '../cover-letters/extract';
import { letterDocx, letterPdf } from '../cover-letters/export';
import { CONTENT_TOO_LONG, downloadName, DOCX_MIME, parseBody, sendFile, uploadFile } from '../cover-letters/http';
import { sanitizeLetterHtml } from '../cover-letters/sanitize';
import { createTemplateRepository, toTemplateDetail, toTemplateSummary } from './repository';

// /api/cover-letter-templates: the Templates tab and the template editor. System templates are visible to everyone
// and read-only (403 system_template_read_only); Duplicate makes an editable copy.

const AI_PROMPT_TOO_LONG = `The AI prompt can be at most ${AI_PROMPT_MAX.toLocaleString('en-US')} characters.`;

/** The exact sentences the editor shows. */
function explain(issue: z.core.$ZodIssue, key: string): string | undefined {
  if (key === 'aiPrompt' && issue.code === 'too_big') return AI_PROMPT_TOO_LONG;
  if (key === 'name' && issue.code === 'too_big') return `Template name must be at most ${TEMPLATE_NAME_MAX} characters long`;
  if (key === 'contentHtml' && issue.code === 'too_big') return CONTENT_TOO_LONG;
  return undefined;
}

/** Mounted at /api/cover-letter-templates. */
export function createCoverLetterTemplatesRouter(deps: AppDeps): Router {
  const router = Router();
  const templates = createTemplateRepository(deps);
  const upload = uploadFile(deps);

  router.use(requireUser);

  router.get('/', (req, res) => {
    const items = templates.list(userOf(req).id).map(toTemplateSummary);
    res.json({ items, total: items.length });
  });

  router.post('/', (req, res) => {
    const user = userOf(req);
    const body = parseBody(CreateLetterTemplateBodySchema, req.body, explain);
    const row = templates.create(user.id, {
      name: body.name ?? defaultTemplateName(deps.now()),
      origin: 'blank',
      contentHtml: body.contentHtml === undefined ? '' : sanitizeLetterHtml(body.contentHtml),
      fontFamily: body.fontFamily,
      aiPrompt: body.aiPrompt,
    });
    res.status(201).json(toTemplateDetail(row));
  });

  router.post('/bulk-delete', (req, res) => {
    const { ids } = parseBody(LetterTemplateBulkDeleteBodySchema, req.body);
    res.json(templates.removeMany(ids, userOf(req).id));
  });

  router.post(
    '/upload',
    upload,
    asyncHandler(async (req, res) => {
      const user = userOf(req);
      const file = req.file!;
      uploadKind(file.buffer);
      const { html } = await extractUploadHtml(file.buffer);
      const fromName = titleFromFileName(file.originalname);
      const row = templates.create(user.id, {
        name: fromName.length >= TEMPLATE_NAME_MIN ? fromName : defaultTemplateName(deps.now()),
        origin: 'uploaded',
        contentHtml: sanitizeLetterHtml(html),
      });
      res.status(201).json(toTemplateDetail(row));
    }),
  );

  router.get('/:id', (req, res) => {
    res.json(toTemplateDetail(templates.requireVisible(req.params.id!, userOf(req).id)));
  });

  router.patch('/:id', (req, res) => {
    const user = userOf(req);
    const current = templates.requireOwn(req.params.id!, user.id);
    const body = parseBody(PatchLetterTemplateBodySchema, req.body, explain);
    const contentHtml = body.contentHtml === undefined ? undefined : sanitizeLetterHtml(body.contentHtml);
    const contentChanged = contentHtml !== undefined && contentHtml !== current.content_html;
    const fontChanged = body.fontFamily !== undefined && body.fontFamily !== current.font_family;
    const row = templates.update(current.id, user.id, {
      name: body.name,
      contentHtml: contentChanged ? contentHtml : undefined,
      fontFamily: body.fontFamily,
      aiPrompt: body.aiPrompt,
      edited: contentChanged || fontChanged,
    });
    res.json(toTemplateDetail(row));
  });

  router.delete('/:id', (req, res) => {
    templates.remove(req.params.id!, userOf(req).id);
    res.status(204).end();
  });

  router.post('/:id/duplicate', (req, res) => {
    const user = userOf(req);
    const source = templates.requireVisible(req.params.id!, user.id);
    const body = parseBody(DuplicateLetterTemplateBodySchema, req.body, explain);
    const row = templates.create(user.id, {
      name: body.name ?? duplicateTemplateName(source.name).slice(0, TEMPLATE_NAME_MAX),
      origin: 'duplicated',
      contentHtml: source.content_html,
      fontFamily: source.font_family,
      aiPrompt: source.ai_prompt,
    });
    res.status(201).json(toTemplateDetail(row));
  });

  router.post(
    '/:id/import',
    upload,
    asyncHandler(async (req, res) => {
      const user = userOf(req);
      const current = templates.requireOwn(req.params.id!, user.id);
      const file = req.file!;
      uploadKind(file.buffer);
      const { html } = await extractUploadHtml(file.buffer);
      const row = templates.update(current.id, user.id, { contentHtml: sanitizeLetterHtml(html), edited: true });
      res.json(toTemplateDetail(row));
    }),
  );

  router.get('/:id/preview', (req, res) => {
    const row = templates.requireVisible(req.params.id!, userOf(req).id);
    const body: CoverLetterPreviewResponse = {
      html: letterDocument({ contentHtml: row.content_html, fontFamily: row.font_family, title: row.name, mode: 'preview' }),
      page: { widthPx: LETTER_PAGE.widthPx, heightPx: LETTER_PAGE.heightPx },
    };
    res.json(body);
  });

  router.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const row = templates.requireVisible(req.params.id!, userOf(req).id);
      const { format } = parseInput(CoverLetterExportQuerySchema, req.query, 'export');
      const printable = { title: row.name, contentHtml: row.content_html, fontFamily: row.font_family };
      if (format === 'docx') {
        sendFile(res, await letterDocx(printable), downloadName(row.name, 'docx', 'Template'), DOCX_MIME);
      } else {
        sendFile(res, await letterPdf(deps, printable), downloadName(row.name, 'pdf', 'Template'), 'application/pdf');
      }
    }),
  );

  return router;
}
