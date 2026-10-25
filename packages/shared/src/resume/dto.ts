import { z } from 'zod';
import { IsoDateTime, listResponse } from '../core/list';
import { queryBoolean, queryEnum } from '../format/params';
import { ResumeAnalysisBriefSchema } from './analysis';
import { ENTRY_BULLETS_KINDS } from './catalogue';
import { MAX_AI_BULLETS, MAX_BULLET_LENGTH, MAX_BULLETS_NOTE_LENGTH } from './display';
import { ResumeDocumentInputSchema, ResumeDocumentSchema, TECHNICAL_SKILLS_LAYOUTS } from './document';

// Contracts of the resume endpoints (/api/resumes, /api/resume-templates, /api/skills, /api/ai/resume-bullets).
// Resume ids are strings. A resume is `built` (a document edited in TailorIT) or `uploaded` (a stored PDF/DOCX).

export const RESUME_KINDS = ['built', 'uploaded'] as const;
export type ResumeKind = (typeof RESUME_KINDS)[number];

/** The Resumes tab's source filter: All / Created / Uploaded. */
export const RESUME_SOURCES = ['all', 'built', 'uploaded'] as const;
export type ResumeSource = (typeof RESUME_SOURCES)[number];
export const RESUME_SOURCE_LABEL: Record<ResumeSource, string> = { all: 'All', built: 'Created', uploaded: 'Uploaded' };

export const RESUME_FILE_KINDS = ['pdf', 'docx'] as const;
export type ResumeFileKind = (typeof RESUME_FILE_KINDS)[number];

/** A custom title (Rename): at most this long. */
export const MAX_RESUME_TITLE_LENGTH = 120;

/** The most resumes one account keeps, built and uploaded together; adding one more is refused. */
export const MAX_RESUMES_PER_ACCOUNT = 500;

/** GET /api/resumes?source= */
export const ResumeListQuerySchema = z.object({
  source: queryEnum(RESUME_SOURCES).transform((value) => value ?? 'all'),
});
export type ResumeListQuery = z.infer<typeof ResumeListQuerySchema>;

/** One row / card of the Resumes tab. `label` is already decided (`resumeLabel`). */
export const ResumeSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(RESUME_KINDS),
  label: z.string(),
  /** The custom title, or null for the label rule. */
  title: z.string().nullable(),
  templateId: z.string().nullable(),
  templateName: z.string().nullable().optional(),
  isDefault: z.boolean(),
  /** Uploaded files only. */
  fileKind: z.enum(RESUME_FILE_KINDS).nullable(),
  /** "Name on resume" column; '' for uploads. */
  nameOnResume: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** The last content edit (null until one). */
  lastEditedAt: IsoDateTime.nullable(),
  /** What TailorIT read from it, for the list's line (GET /api/resumes only); null when it has not been read yet. */
  analysis: ResumeAnalysisBriefSchema.nullable().optional(),
});
export type ResumeSummary = z.infer<typeof ResumeSummarySchema>;

export const ResumeListResponseSchema = listResponse(ResumeSummarySchema);
export type ResumeListResponse = z.infer<typeof ResumeListResponseSchema>;

export const StoredFileInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  pageCount: z.number().int().positive().nullable(),
});
export type StoredFileInfo = z.infer<typeof StoredFileInfoSchema>;

/** GET /api/resumes/:id. `document` is null for an uploaded resume. */
export const ResumeDetailSchema = ResumeSummarySchema.extend({
  document: ResumeDocumentSchema.nullable(),
  file: StoredFileInfoSchema.nullable(),
  /** An uploaded file whose text could be read (it can be matched and turned into an editable copy). */
  hasExtractedText: z.boolean(),
});
export type ResumeDetail = z.infer<typeof ResumeDetailSchema>;

const ResumeTitleField = z
  .string()
  .trim()
  .max(MAX_RESUME_TITLE_LENGTH)
  .transform((value) => value || null)
  .nullable();

/** POST /api/resumes. */
export const CreateResumeBodySchema = z.object({
  document: ResumeDocumentInputSchema,
  title: ResumeTitleField.optional(),
});
export type CreateResumeBody = z.infer<typeof CreateResumeBodySchema>;

/** PUT /api/resumes/:id: the document laid over the stored one (omitted fields keep their value). */
export const UpdateResumeBodySchema = z.object({
  document: ResumeDocumentInputSchema,
  title: ResumeTitleField.optional(),
});
export type UpdateResumeBody = z.infer<typeof UpdateResumeBodySchema>;

/** PATCH /api/resumes/:id (Rename, "Change resume name"). '' or null goes back to the label rule. */
export const PatchResumeBodySchema = z.object({ title: ResumeTitleField });
export type PatchResumeBody = z.infer<typeof PatchResumeBodySchema>;

/** DELETE /api/resumes/:id. Deleting the default resume moves the default to the newest other resume (or none). */
export const ResumeDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  defaultResumeId: z.string().nullable(),
});

/** POST /api/resumes/:id/duplicate. The title defaults to "{label} (Copy)". */
export const DuplicateResumeBodySchema = z.object({ title: ResumeTitleField.optional() });

/** POST /api/resumes/bulk-delete. The default resume is skipped ("1 default resume will be skipped"). */
export const ResumeBulkDeleteBodySchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) });
export const ResumeBulkDeleteResponseSchema = z.object({
  deleted: z.number().int().nonnegative(),
  skippedIds: z.array(z.string()),
});
export type ResumeBulkDeleteResponse = z.infer<typeof ResumeBulkDeleteResponseSchema>;

/**
 * POST /api/resumes/upload?parse=1: `parse` also asks for an AI import ("Make an editable copy"). The router also reads
 * `templateId`, `layout` and `batch` leniently: `batch` (ResumeCopyBatchIdSchema) marks one of several files of one
 * Upload dialog, whose copy waits in the copy line instead of starting at once.
 */
export const ResumeUploadQuerySchema = z.object({ parse: queryBoolean });
export const ResumeUploadResponseSchema = z.object({
  resume: ResumeSummarySchema,
  /**
   * The import task when `parse` was asked for (poll GET /api/ai/tasks/:id). Always null with `batch`: GET
   * /api/resumes/copies follows those copies.
   */
  taskId: z.string().nullable(),
  /**
   * Why the editable copy asked for could not start (AI busy or off, text that cannot be read), as a sentence to show.
   * The upload is kept either way. Null or absent when the copy started or was not asked for. With `batch`, a copy
   * refused when asked is a failed row of GET /api/resumes/copies instead: this is set only when the copy could not be
   * put in line at all.
   */
  copyError: z.string().nullable().optional(),
});
export type ResumeUploadResponse = z.infer<typeof ResumeUploadResponseSchema>;

/** One Upload dialog's id for its runs of several files (the browser makes it): their copies share one notice. */
export const ResumeCopyBatchIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

/** An editable copy of one upload in the line of several: waiting, being made, made, not made, or stopped. */
export const RESUME_COPY_STATES = ['waiting', 'making', 'ready', 'failed', 'stopped'] as const;
export type ResumeCopyState = (typeof RESUME_COPY_STATES)[number];

export const ResumeCopySchema = z.object({
  id: z.string(),
  batchId: z.string(),
  /** The upload's label when the copy was asked for. */
  label: z.string(),
  state: z.enum(RESUME_COPY_STATES),
  /** The copy made (a built resume); null until ready, and once that resume is deleted. */
  resumeId: z.string().nullable(),
  /** Why it was not made (failed only), as a sentence to show. */
  error: z.string().nullable(),
  /** Try again may make it: stopped, or failed for any reason but unreadable text or a deleted upload. */
  retryable: z.boolean(),
});
export type ResumeCopy = z.infer<typeof ResumeCopySchema>;

/** Why copies in line wait: AI off, an AI pause (usage limit, or another), or a usage warning (the gate). */
export const RESUME_COPY_PAUSES = ['off', 'limit', 'hold', 'warning'] as const;
export const ResumeCopiesPauseSchema = z.object({ reason: z.enum(RESUME_COPY_PAUSES), until: IsoDateTime.nullable() });
export type ResumeCopiesPause = z.infer<typeof ResumeCopiesPauseSchema>;

/** GET /api/resumes/copies, and the answer of POST /api/resumes/copies/:batchId/{stop,retry,dismiss}. */
export const ResumeCopiesResponseSchema = z.object({
  items: z.array(ResumeCopySchema),
  paused: ResumeCopiesPauseSchema.nullable(),
});
export type ResumeCopiesResponse = z.infer<typeof ResumeCopiesResponseSchema>;

/** POST /api/resumes/import-json: a file downloaded from TailorIT (or free_tailor), already parsed by the browser. */
export const ResumeImportJsonBodySchema = z.object({
  data: z.unknown(),
  fileName: z.string().max(255).optional(),
});
export const ResumeImportJsonResponseSchema = z.object({
  resumes: z.array(ResumeSummarySchema),
  imported: z.number().int().nonnegative(),
});
export type ResumeImportJsonResponse = z.infer<typeof ResumeImportJsonResponseSchema>;

/** The result of a `resume_import` AI task (POST /api/resumes/:id/parse, or upload with parse=1). */
export const ResumeImportTaskResultSchema = z.object({ resumeId: z.string() });
export type ResumeImportTaskResult = z.infer<typeof ResumeImportTaskResultSchema>;

export const PageBoxSchema = z.object({
  widthPx: z.number().positive(),
  heightPx: z.number().positive(),
  contentHeightPx: z.number().positive(),
});
export type PageBox = z.infer<typeof PageBoxSchema>;

/**
 * POST /api/resumes/preview: a draft drawn as HTML (no browser needed). The draft is laid over the stored resume
 * (`resumeId`) by the normaliser's rules. `sample` (default on) fills empty fields with the sample person.
 */
export const ResumePreviewRequestSchema = z.object({
  document: ResumeDocumentInputSchema.optional(),
  resumeId: z.string().optional(),
  templateId: z.string().optional(),
  sample: z.boolean().optional(),
});
export type ResumePreviewRequest = z.infer<typeof ResumePreviewRequestSchema>;

export const ResumePreviewResponseSchema = z.object({
  html: z.string(),
  /** The template actually drawn (it differs when the chosen one is no longer offered). */
  templateId: z.string(),
  page: PageBoxSchema,
  /** The fields filled from the sample person (`sampledNotice`). */
  sampled: z.array(z.string()),
});
export type ResumePreviewResponse = z.infer<typeof ResumePreviewResponseSchema>;

/** GET /api/resumes/:id/thumbnail: the first page as HTML (built) or as an image (uploads). */
export const ResumeThumbnailSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('html'), html: z.string(), page: PageBoxSchema }),
  z.object({ kind: z.literal('image'), url: z.string() }),
]);
export type ResumeThumbnail = z.infer<typeof ResumeThumbnailSchema>;

export const RESUME_EXPORT_FORMATS = ['pdf', 'docx', 'json'] as const;
export type ResumeExportFormat = (typeof RESUME_EXPORT_FORMATS)[number];
/** GET /api/resumes/:id/export?format= */
export const ResumeExportQuerySchema = z.object({
  format: queryEnum(RESUME_EXPORT_FORMATS).transform((value) => value ?? 'pdf'),
});

export const TEMPLATE_CATEGORIES = ['simple', 'modern', 'creative', 'ats'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
/** The chooser's filter pills (after "All Templates"). */
export const TEMPLATE_CATEGORY_LABEL: Record<TemplateCategory, string> = {
  simple: 'Simple',
  modern: 'Modern',
  creative: 'Creative',
  ats: 'ATS',
};

/** GET /api/resume-templates: the light list (no markup). The capability fields are read off each template's markup. */
export const ResumeTemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(TEMPLATE_CATEGORIES),
  supportsSoftSkills: z.boolean(),
  supportsStrengths: z.boolean(),
  /** Section kinds the template prints. ATS templates have no extra-sections block, so no projects and the like. */
  printsSections: z.array(z.string()),
  /** The template's own section order (kind ids). */
  nativeSectionOrder: z.array(z.string()),
});
export type ResumeTemplateSummary = z.infer<typeof ResumeTemplateSummarySchema>;
export const ResumeTemplateListResponseSchema = listResponse(ResumeTemplateSummarySchema);

/** GET /api/resume-templates/:id/preview?layout=&softSkills=&strengths= (HTML with the sample person). */
export const ResumeTemplatePreviewQuerySchema = z.object({
  layout: queryEnum(TECHNICAL_SKILLS_LAYOUTS).transform((value) => value ?? 'categorized'),
  softSkills: queryBoolean,
  strengths: queryBoolean,
});

export const SKILL_TYPES = ['hard', 'soft'] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

/**
 * GET /api/skills?type= : the library (skills.json) overlaid with the user's own. Hard skills are the main skills only;
 * `aliases` gives each one's other spellings ("ASP.NET Core" of ".NET"), so a picker can find a main skill by them. An
 * alias is still a known skill when typed (POST /api/skills answers it in its own spelling).
 */
export const SkillsQuerySchema = z.object({ type: queryEnum(SKILL_TYPES).transform((value) => value ?? 'hard') });
export const SkillsResponseSchema = z.object({
  type: z.enum(SKILL_TYPES),
  skills: z.array(z.string()),
  aliases: z.record(z.string(), z.array(z.string())).optional(),
});
export type SkillsResponse = z.infer<typeof SkillsResponseSchema>;

/** POST /api/skills: a skill the library lacks, kept for this user only. */
export const AddSkillBodySchema = z.object({
  type: z.enum(SKILL_TYPES),
  skill: z.string().trim().min(1).max(100),
  category: z.string().trim().max(100).optional(),
});
export const AddSkillResponseSchema = z.object({
  added: z.boolean(),
  skill: z.string(),
  type: z.enum(SKILL_TYPES),
  category: z.string().nullable(),
});
export type AddSkillResponse = z.infer<typeof AddSkillResponseSchema>;

export const BULLETS_TASKS = ['write', 'improve'] as const;
export type BulletsTask = (typeof BULLETS_TASKS)[number];

const shortText = z.string().max(500).optional();

/** The entry Write with AI works on: the fields that name it, its dates, location, description, bullets and skills. */
export const BulletsEntrySchema = z.object({
  title: shortText,
  company: shortText,
  name: shortText,
  role: shortText,
  organization: shortText,
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  location: shortText,
  description: z.string().max(5000).optional(),
  achievements: z.array(z.string().max(1000)).max(50).optional(),
  skills: z.array(z.string().max(100)).max(100).optional(),
});

/** Five facts about the person (never contact details). */
export const BulletsResumeContextSchema = z.object({
  name: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  totalYearsExperience: z.number().nonnegative().max(80).optional(),
  summary: z.string().max(5000).optional(),
  skills: z.array(z.string().max(100)).max(200).optional(),
});

/** POST /api/ai/resume-bullets (202 { taskId }). */
export const BulletsRequestSchema = z.object({
  kind: z.enum(ENTRY_BULLETS_KINDS),
  entry: BulletsEntrySchema,
  resume: BulletsResumeContextSchema.optional(),
  task: z.enum(BULLETS_TASKS),
  instructions: z.string().trim().max(MAX_BULLETS_NOTE_LENGTH).optional(),
});
export type BulletsRequest = z.infer<typeof BulletsRequestSchema>;

/** The `entry_bullets` task result: 1-8 one-line bullets of at most 300 characters. */
export const BulletsResultSchema = z.object({
  bullets: z.array(z.string().min(1).max(MAX_BULLET_LENGTH)).min(1).max(MAX_AI_BULLETS),
});
export type BulletsResult = z.infer<typeof BulletsResultSchema>;
