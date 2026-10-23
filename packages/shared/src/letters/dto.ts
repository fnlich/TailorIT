import { z } from 'zod';
import { IsoDateTime, listResponse } from '../core/list';
import { queryEnum, queryText } from '../format/params';
import {
  AI_PROMPT_MAX,
  CUSTOM_PROMPT_MAX,
  JOB_DESCRIPTION_MAX,
  LETTER_FONT_NAMES,
  LETTER_HTML_MAX,
  LETTER_TITLE_MAX,
  LETTER_TITLE_MESSAGE,
  LETTER_TITLE_MIN,
  TEMPLATE_NAME_MAX,
  TEMPLATE_NAME_MESSAGE,
  TEMPLATE_NAME_MIN,
} from './constants';

// Contracts of /api/cover-letters and /api/cover-letter-templates. Letter, template, resume and application ids are
// strings; job ids integers.

export const LETTER_ORIGINS = ['blank', 'generated', 'uploaded'] as const;
export type LetterOrigin = (typeof LETTER_ORIGINS)[number];
/** The table's badge; a blank letter has none. */
export const LETTER_ORIGIN_BADGE: Record<LetterOrigin, string | null> = {
  blank: null,
  generated: 'Generated',
  uploaded: 'Uploaded',
};

export const TEMPLATE_ORIGINS = ['blank', 'uploaded', 'duplicated', 'system'] as const;
export type TemplateOrigin = (typeof TEMPLATE_ORIGINS)[number];

const FontField = z.enum(LETTER_FONT_NAMES);
const HtmlField = z.string().max(LETTER_HTML_MAX);
const LetterTitleField = z.string().trim().min(LETTER_TITLE_MIN, LETTER_TITLE_MESSAGE).max(LETTER_TITLE_MAX);
const TemplateNameField = z.string().trim().min(TEMPLATE_NAME_MIN, TEMPLATE_NAME_MESSAGE).max(TEMPLATE_NAME_MAX);

/** One row of the Cover Letters table / grid. `lastEditedAt` is null ("-") until the content is edited. */
export const CoverLetterSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  origin: z.enum(LETTER_ORIGINS),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastEditedAt: IsoDateTime.nullable(),
  companyName: z.string(),
  jobTitle: z.string(),
});
export type CoverLetterSummary = z.infer<typeof CoverLetterSummarySchema>;

export const CoverLetterListResponseSchema = listResponse(CoverLetterSummarySchema);

/** GET /api/cover-letters?q= (title, company and job title). */
export const CoverLetterListQuerySchema = z.object({ q: queryText });

/** GET /api/cover-letters/:id: the editor. */
export const CoverLetterDetailSchema = CoverLetterSummarySchema.extend({
  contentHtml: z.string(),
  fontFamily: z.string(),
  applicationId: z.string().nullable(),
  jobId: z.number().int().nullable(),
  templateId: z.string().nullable(),
  resumeId: z.string().nullable(),
  jobDescription: z.string(),
  customPrompt: z.string(),
});
export type CoverLetterDetail = z.infer<typeof CoverLetterDetailSchema>;

/** POST /api/cover-letters ("New Cover Letter"; from the tracker with `applicationId`). Titled "Cover Letter M/D/YYYY". */
export const CreateCoverLetterBodySchema = z.object({
  applicationId: z.string().min(1).optional(),
  jobId: z.number().int().positive().optional(),
  templateId: z.string().min(1).optional(),
});
export type CreateCoverLetterBody = z.infer<typeof CreateCoverLetterBodySchema>;

/** PATCH /api/cover-letters/:id (autosave, rename, the generate dialog's fields). */
export const PatchCoverLetterBodySchema = z
  .object({
    title: LetterTitleField,
    contentHtml: HtmlField,
    fontFamily: FontField,
    companyName: z.string().trim().max(200),
    jobTitle: z.string().trim().max(200),
    jobDescription: z.string().max(JOB_DESCRIPTION_MAX),
    customPrompt: z.string().max(CUSTOM_PROMPT_MAX),
    templateId: z.string().nullable(),
    resumeId: z.string().nullable(),
    applicationId: z.string().nullable(),
  })
  .partial();
export type PatchCoverLetterBody = z.infer<typeof PatchCoverLetterBodySchema>;

/**
 * POST /api/cover-letters/:id/generate (202 { taskId }). Uses the default resume unless `resumeId` is given;
 * `templateId` null generates without a template.
 */
export const GenerateCoverLetterBodySchema = z.object({
  companyName: z.string().trim().min(1, 'Required').max(200),
  jobTitle: z.string().trim().min(1, 'Required').max(200),
  jobDescription: z.string().max(JOB_DESCRIPTION_MAX).default(''),
  templateId: z.string().nullable().default(null),
  customPrompt: z.string().max(CUSTOM_PROMPT_MAX).default(''),
  resumeId: z.string().optional(),
});
export type GenerateCoverLetterBody = z.infer<typeof GenerateCoverLetterBodySchema>;

/** The `cover_letter` / `template_fill` task result the editor loads: the letter HTML and what is left to fill. */
export const CoverLetterGenerateResultSchema = z.object({
  html: z.string(),
  placeholders: z.array(z.string()),
});
export type CoverLetterGenerateResult = z.infer<typeof CoverLetterGenerateResultSchema>;

/** What the cover_letter prompt answers (no template): the body paragraphs. */
export const CoverLetterParagraphsSchema = z.object({
  paragraphs: z.array(z.string().min(1).max(3000)).min(3).max(4),
});
export type CoverLetterParagraphs = z.infer<typeof CoverLetterParagraphsSchema>;

/** What the template_fill prompt answers: a value for each AI variable of the template. */
export const TemplateFillValuesSchema = z.object({
  values: z.record(z.string(), z.string().max(10_000)),
});
export type TemplateFillValues = z.infer<typeof TemplateFillValuesSchema>;

/** US Letter at 96 px per inch: the editor's paper and the print. */
export const LETTER_PAGE = { widthPx: 816, heightPx: 1056 } as const;

/** GET /api/cover-letters/:id/preview: the letter as a print-ready page (thumbnails, View). */
export const CoverLetterPreviewResponseSchema = z.object({
  html: z.string(),
  page: z.object({ widthPx: z.number().positive(), heightPx: z.number().positive() }),
});
export type CoverLetterPreviewResponse = z.infer<typeof CoverLetterPreviewResponseSchema>;

export const LETTER_EXPORT_FORMATS = ['pdf', 'docx'] as const;
/** GET /api/cover-letters/:id/export?format= */
export const CoverLetterExportQuerySchema = z.object({
  format: queryEnum(LETTER_EXPORT_FORMATS).transform((value) => value ?? 'pdf'),
});

/** POST /api/cover-letters/upload and POST /api/cover-letters/:id/import answer the letter (text split into paragraphs). */
export const CoverLetterUploadResponseSchema = CoverLetterDetailSchema;

/** POST /api/cover-letters/bulk-delete. */
export const CoverLetterBulkDeleteBodySchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) });
export const CoverLetterBulkDeleteResponseSchema = z.object({ deleted: z.number().int().nonnegative() });

/** One row of the Templates table. `preview` is the first 80 characters of the text. */
export const LetterTemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  preview: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastEditedAt: IsoDateTime.nullable(),
});
export type LetterTemplateSummary = z.infer<typeof LetterTemplateSummarySchema>;

export const LetterTemplateListResponseSchema = listResponse(LetterTemplateSummarySchema);

/** GET /api/cover-letter-templates/:id. System templates are read-only (403 `system_template_read_only`). */
export const LetterTemplateDetailSchema = LetterTemplateSummarySchema.extend({
  contentHtml: z.string(),
  fontFamily: z.string(),
  /** "Copilot AI Prompt": extra context for generating from this template. */
  aiPrompt: z.string(),
});
export type LetterTemplateDetail = z.infer<typeof LetterTemplateDetailSchema>;

/** POST /api/cover-letter-templates ("New Template"). The name defaults to "Template {date, time}". */
export const CreateLetterTemplateBodySchema = z.object({
  name: TemplateNameField.optional(),
  contentHtml: HtmlField.optional(),
  fontFamily: FontField.optional(),
  aiPrompt: z.string().max(AI_PROMPT_MAX).optional(),
});
export type CreateLetterTemplateBody = z.infer<typeof CreateLetterTemplateBodySchema>;

/** PATCH /api/cover-letter-templates/:id. */
export const PatchLetterTemplateBodySchema = z
  .object({
    name: TemplateNameField,
    contentHtml: HtmlField,
    fontFamily: FontField,
    aiPrompt: z.string().max(AI_PROMPT_MAX),
  })
  .partial();
export type PatchLetterTemplateBody = z.infer<typeof PatchLetterTemplateBodySchema>;

/** POST /api/cover-letter-templates/upload answers the new template. */
export const LetterTemplateUploadResponseSchema = LetterTemplateDetailSchema;

/** POST /api/cover-letter-templates/:id/duplicate. The name defaults to "{name} (Copy)". */
export const DuplicateLetterTemplateBodySchema = z.object({ name: TemplateNameField.optional() });

/** POST /api/cover-letter-templates/bulk-delete. System templates are skipped. */
export const LetterTemplateBulkDeleteBodySchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) });
export const LetterTemplateBulkDeleteResponseSchema = z.object({
  deleted: z.number().int().nonnegative(),
  skippedIds: z.array(z.string()),
});
