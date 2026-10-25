import { SetDefaultResumeBodySchema, type Account } from '@tailorit/shared/auth';
import {
  RESUME_FILE_KINDS,
  ResumeDetailSchema,
  ResumePreviewResponseSchema,
  ResumeSummarySchema,
  ResumeTemplateSummarySchema,
  TEMPLATE_CATEGORIES,
  normalizeResumeDocument,
  resumeLabel,
  type BulletsRequest,
  type PageBox,
  type ResumeAnalysisBrief,
  type ResumeDocument,
  type ResumeFileKind,
  type ResumeSummary,
  type SkillType,
  type StoredFileInfo,
  type TechnicalSkillsLayout,
  type TemplateCategory,
} from '@tailorit/shared/resume';
import type { ZodType } from 'zod';
import { ApiError, api } from '../../lib/api';

/*
 * The resume endpoints as the editor and the Resumes tab call them. Answers are read leniently: the shared zod
 * contract first, and when an answer differs from it (the API is built alongside), the fields this page needs are
 * picked out by hand and the difference is reported once in the console, so a small mismatch never blanks the page.
 */

export const resumeKeys = {
  all: ['resumes'] as const,
  list: () => ['resumes', 'list'] as const,
  detail: (id: string) => ['resumes', 'detail', id] as const,
  /** What TailorIT read from one resume (under `all`, so `invalidateResumes` reads it again). */
  analysis: (id: string) => ['resumes', 'analysis', id] as const,
  templates: () => ['resume-templates'] as const,
  skills: (type: SkillType) => ['skills', type] as const,
};

// ------------------------------------------------------------------------------------------- lenient reading

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {};
}

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const strOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const bool = (value: unknown): boolean => value === true;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const reported = new Set<string>();

/** Says once per answer kind that the API's answer differs from the shared contract (the integration report reads it). */
export function noteMismatch(where: string, detail: unknown): void {
  if (reported.has(where)) return;
  reported.add(where);
  console.warn(`[resumes] The answer of ${where} differs from the shared contract; reading it leniently.`, detail);
}

function readWith<T>(schema: ZodType<T>, raw: unknown, where: string, lenient: (raw: unknown) => T | null): T | null {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  noteMismatch(where, parsed.error.issues.slice(0, 5));
  return lenient(raw);
}

function readPage(value: unknown): PageBox | null {
  const page = rec(value);
  const widthPx = Number(page.widthPx);
  const heightPx = Number(page.heightPx);
  if (!(widthPx > 0) || !(heightPx > 0)) return null;
  const contentHeightPx = Number(page.contentHeightPx);
  return { widthPx, heightPx, contentHeightPx: contentHeightPx > 0 ? contentHeightPx : heightPx };
}

function readFileKind(value: unknown): ResumeFileKind | null {
  return (RESUME_FILE_KINDS as readonly unknown[]).includes(value) ? (value as ResumeFileKind) : null;
}

/** Years read off a resume (0 to 80), or null. */
export function readYears(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 80 ? value : null;
}

/** A list row's reading by hand: undefined when the answer has none, null when it says "not read yet". */
function leniBrief(value: unknown): ResumeAnalysisBrief | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = rec(value);
  const softSkillCount = Number(r.softSkillCount);
  return {
    yearsExperience: readYears(r.yearsExperience),
    hardSkills: strings(r.hardSkills),
    softSkillCount: Number.isInteger(softSkillCount) && softSkillCount >= 0 ? softSkillCount : 0,
    refining: bool(r.refining),
    aiWaiting: bool(r.aiWaiting),
  };
}

function leniSummary(raw: unknown): ResumeSummary | null {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  const kind = r.kind === 'uploaded' ? 'uploaded' : 'built';
  const document = rec(r.document);
  const title = strOrNull(r.title);
  const createdAt = str(r.createdAt);
  const analysis = leniBrief(r.analysis);
  return {
    id,
    kind,
    label: str(r.label) || resumeLabel({ name: str(document.name), title: str(document.title) }, title),
    title,
    templateId: strOrNull(r.templateId),
    templateName: strOrNull(r.templateName),
    isDefault: bool(r.isDefault),
    fileKind: readFileKind(r.fileKind),
    nameOnResume: str(r.nameOnResume) || str(document.name),
    createdAt,
    updatedAt: str(r.updatedAt) || createdAt,
    lastEditedAt: strOrNull(r.lastEditedAt),
    ...(analysis !== undefined ? { analysis } : {}),
  };
}

export function readResumeSummary(raw: unknown): ResumeSummary | null {
  return readWith(ResumeSummarySchema, raw, 'a resume summary', leniSummary);
}

/** `{ items: [...] }` (or a bare list) as summaries; entries that cannot be read are skipped. */
export function readResumeList(raw: unknown): ResumeSummary[] {
  const items = Array.isArray(raw) ? raw : Array.isArray(rec(raw).items) ? (rec(raw).items as unknown[]) : [];
  return items.map(readResumeSummary).filter((item): item is ResumeSummary => item !== null);
}

/** One resume as the editor opens it: its summary, its document (built) or file (uploaded). */
export interface ResumeView extends ResumeSummary {
  document: ResumeDocument | null;
  file: StoredFileInfo | null;
  hasExtractedText: boolean;
}

function leniFile(value: unknown): StoredFileInfo | null {
  const file = rec(value);
  const id = str(file.id);
  if (!id) return null;
  const pageCount = Number(file.pageCount);
  return {
    id,
    name: str(file.name),
    mime: str(file.mime),
    sizeBytes: Number(file.sizeBytes) >= 0 ? Number(file.sizeBytes) : 0,
    pageCount: Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null,
  };
}

export function readResumeView(raw: unknown): ResumeView | null {
  const parsed = ResumeDetailSchema.safeParse(raw);
  if (!parsed.success) noteMismatch('GET /api/resumes/:id', parsed.error.issues.slice(0, 5));
  const summary = parsed.success ? parsed.data : leniSummary(raw);
  if (!summary) return null;
  const r = rec(raw);
  const document = r.document && typeof r.document === 'object' ? normalizeResumeDocument(r.document) : null;
  return {
    ...summary,
    document: summary.kind === 'built' ? (document ?? normalizeResumeDocument({})) : document,
    file: leniFile(r.file),
    hasExtractedText: bool(r.hasExtractedText),
  };
}

/** A template as the chooser and the Customize tab need it. `category` is null when the API files it under none. */
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory | null;
  supportsSoftSkills: boolean;
  supportsStrengths: boolean;
  printsSections: string[];
  nativeSectionOrder: string[];
}

function leniTemplate(raw: unknown): TemplateInfo | null {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    name: str(r.name) || id,
    description: str(r.description),
    category: (TEMPLATE_CATEGORIES as readonly unknown[]).includes(r.category) ? (r.category as TemplateCategory) : null,
    supportsSoftSkills: bool(r.supportsSoftSkills),
    supportsStrengths: bool(r.supportsStrengths),
    printsSections: strings(r.printsSections),
    nativeSectionOrder: strings(r.nativeSectionOrder),
  };
}

export function readTemplateList(raw: unknown): TemplateInfo[] {
  const items = Array.isArray(raw) ? raw : Array.isArray(rec(raw).items) ? (rec(raw).items as unknown[]) : [];
  return items
    .map((item) => {
      const parsed = ResumeTemplateSummarySchema.safeParse(item);
      if (parsed.success) return { ...parsed.data };
      noteMismatch('GET /api/resume-templates', parsed.error.issues.slice(0, 5));
      return leniTemplate(item);
    })
    .filter((item): item is TemplateInfo => item !== null);
}

/** POST /api/resumes/preview's answer. */
export interface PreviewAnswer {
  html: string;
  templateId: string;
  page: PageBox;
  sampled: string[];
}

export function readPreview(raw: unknown): PreviewAnswer {
  const parsed = ResumePreviewResponseSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  noteMismatch('POST /api/resumes/preview', parsed.error.issues.slice(0, 5));
  const r = rec(raw);
  if (typeof r.html !== 'string') throw invalidAnswer('/api/resumes/preview');
  return {
    html: r.html,
    templateId: str(r.templateId),
    page: readPage(r.page) ?? { widthPx: 794, heightPx: 1123, contentHeightPx: 1123 },
    sampled: strings(r.sampled),
  };
}

/** A first page: HTML (a built resume) or an image (an upload's PNG). */
export type ThumbAnswer = { kind: 'html'; html: string; page: PageBox | null } | { kind: 'image'; url: string };

/** GET /api/resumes/:id/thumbnail: `{kind:'html', html, page}`, `{kind:'image', url}`, or a bare `{html, page}`. */
export function readThumbnail(raw: unknown): ThumbAnswer | null {
  const r = rec(raw);
  if (typeof r.html === 'string' && r.kind !== 'image') return { kind: 'html', html: r.html, page: readPage(r.page) };
  if (typeof r.url === 'string' && r.url) return { kind: 'image', url: r.url };
  return null;
}

/** POST /api/resumes/bulk-delete: `{deleted, skippedIds}` (the contract) or `{deleted, skipped}`. */
export function readBulkDelete(raw: unknown, asked: number): { deleted: number; skipped: number; skippedIds: string[] } {
  const r = rec(raw);
  const deleted = Number(r.deleted);
  const skippedIds = strings(Array.isArray(r.skippedIds) ? r.skippedIds : r.skipped);
  const skipped = skippedIds.length || (Number.isFinite(Number(r.skipped)) ? Number(r.skipped) : 0);
  return { deleted: Number.isFinite(deleted) ? deleted : Math.max(0, asked - skipped), skipped, skippedIds };
}

function invalidAnswer(path: string): ApiError {
  return new ApiError({
    status: 200,
    code: 'internal',
    message: 'The server sent an answer this page does not understand. Please reload and try again.',
    path,
  });
}

/** The id a create, duplicate or import answered with (a detail, a summary, or `{ resume }`). */
export function readCreatedId(raw: unknown): string {
  const r = rec(raw);
  return str(r.id) || str(rec(r.resume).id);
}

/** An AI endpoint's `202 { taskId }`. */
export function readTaskId(raw: unknown, path: string): string {
  const id = str(rec(raw).taskId);
  if (!id) throw invalidAnswer(path);
  return id;
}

/** A finished `resume_import` task's `{ resumeId }`. */
export function readImportResult(result: unknown): string | null {
  return strOrNull(rec(result).resumeId);
}

// ------------------------------------------------------------------------------------------------- the calls

const enc = encodeURIComponent;

export async function fetchResumes(signal?: AbortSignal): Promise<ResumeSummary[]> {
  return readResumeList(await api.get('/api/resumes', { query: { source: 'all' }, signal }));
}

export async function fetchResume(id: string, signal?: AbortSignal): Promise<ResumeView> {
  const view = readResumeView(await api.get(`/api/resumes/${enc(id)}`, { signal }));
  if (!view) throw invalidAnswer(`/api/resumes/${id}`);
  return view;
}

export async function fetchTemplates(signal?: AbortSignal): Promise<TemplateInfo[]> {
  return readTemplateList(await api.get('/api/resume-templates', { signal }));
}

/** POST /api/resumes → the new resume's id. */
/** A change's answer: the resume as it now stands (null when the answer does not say). */
export interface SavedResume {
  id: string;
  summary: ResumeSummary | null;
}

function savedFrom(raw: unknown, fallbackId = ''): SavedResume {
  const summary = rec(raw).id ? readResumeSummary(raw) : null;
  return { id: summary?.id ?? (readCreatedId(raw) || fallbackId), summary };
}

/** POST /api/resumes → the new resume. */
export async function createResume(document: Record<string, unknown>, title?: string | null): Promise<SavedResume> {
  return savedFrom(await api.post('/api/resumes', title === undefined ? { document } : { document, title }));
}

/** PUT /api/resumes/:id: the document laid over the stored one. */
export async function updateResume(id: string, document: Record<string, unknown>): Promise<SavedResume> {
  return savedFrom(await api.put(`/api/resumes/${enc(id)}`, { document }), id);
}

/** PATCH /api/resumes/:id (Rename): '' or null goes back to the label rule. */
export async function renameResume(id: string, title: string | null): Promise<SavedResume> {
  return savedFrom(await api.patch(`/api/resumes/${enc(id)}`, { title }), id);
}

/** DELETE /api/resumes/:id → the default resume after it (the server moves it off a deleted default). */
export async function deleteResume(id: string): Promise<{ defaultResumeId: string | null | undefined }> {
  const answer = rec(await api.delete(`/api/resumes/${enc(id)}`));
  return { defaultResumeId: 'defaultResumeId' in answer ? strOrNull(answer.defaultResumeId) : undefined };
}

export async function duplicateResume(id: string): Promise<SavedResume> {
  return savedFrom(await api.post(`/api/resumes/${enc(id)}/duplicate`, {}));
}

export async function bulkDeleteResumes(ids: readonly string[]): Promise<{ deleted: number; skipped: number; skippedIds: string[] }> {
  return readBulkDelete(await api.post('/api/resumes/bulk-delete', { ids }), ids.length);
}

/** PUT /api/me/default-resume → the account as it now stands. */
export async function setDefaultResume(resumeId: string | null): Promise<Account | null> {
  const body = SetDefaultResumeBodySchema.parse({ resumeId });
  const answer = rec(await api.put('/api/me/default-resume', body));
  return answer.id ? (answer as unknown as Account) : null;
}

/**
 * POST /api/resumes/upload (multipart `file`, optional `title`). `parse` also starts the AI import (an editable copy),
 * made on `templateId` and `layout` when they are given. The upload is kept even when that copy cannot start:
 * `copyError` then says why.
 */
export async function uploadResume(
  file: File,
  options: { title?: string; parse?: boolean; templateId?: string; layout?: TechnicalSkillsLayout } = {},
): Promise<{ resume: ResumeSummary | null; taskId: string | null; copyError: string | null }> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (options.title?.trim()) form.append('title', options.title.trim());
  const query = {
    parse: options.parse ? 1 : undefined,
    templateId: options.parse && options.templateId ? options.templateId : undefined,
    layout: options.parse && options.layout ? options.layout : undefined,
  };
  const answer = rec(await api.post('/api/resumes/upload', form, { query }));
  return {
    resume: readResumeSummary(answer.resume ?? answer),
    taskId: strOrNull(answer.taskId),
    copyError: strOrNull(answer.copyError),
  };
}

/** POST /api/resumes/import-json with a file the browser already parsed. */
export async function importResumeJson(data: unknown, fileName: string): Promise<{ ids: string[]; imported: number }> {
  const answer = rec(await api.post('/api/resumes/import-json', { data, fileName: fileName.slice(0, 255) }));
  const ids = Array.isArray(answer.resumes) ? answer.resumes.map((item) => readCreatedId(item)).filter(Boolean) : [];
  const imported = Number(answer.imported);
  return { ids, imported: Number.isFinite(imported) ? imported : ids.length };
}

/** POST /api/resumes/:id/parse (202): an editable copy of an uploaded file. */
export async function startEditableCopy(id: string): Promise<string> {
  const path = `/api/resumes/${enc(id)}/parse`;
  return readTaskId(await api.post(path, {}), path);
}

export interface PreviewBody {
  document?: Record<string, unknown>;
  resumeId?: string;
  templateId?: string;
  sample?: boolean;
}

export async function previewResume(body: PreviewBody, signal?: AbortSignal): Promise<PreviewAnswer> {
  return readPreview(await api.post('/api/resumes/preview', body, { signal }));
}

/**
 * A resume's first page. GET /api/resumes/:id/thumbnail; for a built resume that cannot answer it (an older API),
 * the preview route draws the stored resume with nothing filled in from the sample person.
 */
export async function fetchThumbnail(id: string, kind: 'built' | 'uploaded', signal?: AbortSignal): Promise<ThumbAnswer> {
  try {
    const answer = readThumbnail(await api.get(`/api/resumes/${enc(id)}/thumbnail`, { signal }));
    if (answer) return answer;
    noteMismatch('GET /api/resumes/:id/thumbnail', 'neither html nor url');
  } catch (error) {
    // An upload with no picture answers 404: there is nothing else to draw it from.
    if (!(error instanceof ApiError) || error.status !== 404 || kind === 'uploaded') throw error;
  }
  if (kind === 'uploaded') throw new ApiError({ status: 404, code: 'not_found', message: 'No preview', path: '' });
  const preview = await previewResume({ resumeId: id, sample: false }, signal);
  return { kind: 'html', html: preview.html, page: preview.page };
}

/** The library a skill box suggests from: the main skills, and each one's other spellings (aliases). */
export interface SkillLibraryList {
  skills: string[];
  /** Main skill -> its other spellings ("ASP.NET Core" of ".NET"). Empty for soft skills. */
  aliases: Record<string, string[]>;
}

export async function fetchSkills(type: SkillType, signal?: AbortSignal): Promise<SkillLibraryList> {
  const answer = await api.get('/api/skills', { query: { type }, signal });
  if (Array.isArray(answer)) return { skills: strings(answer), aliases: {} };
  const aliases: Record<string, string[]> = {};
  for (const [skill, spellings] of Object.entries(rec(rec(answer).aliases))) aliases[skill] = strings(spellings);
  return { skills: strings(rec(answer).skills), aliases };
}

/** POST /api/skills: a skill the library lacks, kept for this user; resolves to the spelling stored. */
export async function addSkill(type: SkillType, skill: string): Promise<string> {
  const answer = rec(await api.post('/api/skills', { type, skill }));
  return str(answer.skill) || skill;
}

const BULLETS_PATHS = ['/api/resumes/bullets', '/api/ai/resume-bullets'] as const;
let bulletsPath: string | null = null;

function isMissingRoute(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'not_found';
}

/**
 * Write with AI (202 { taskId }). The work package names POST /api/resumes/bullets and the shared contract
 * /api/ai/resume-bullets; whichever the API mounts answers, and is remembered.
 */
export async function requestBullets(body: BulletsRequest): Promise<string> {
  const paths = bulletsPath ? [bulletsPath] : BULLETS_PATHS;
  let lastError: unknown = null;
  for (const path of paths) {
    try {
      const taskId = readTaskId(await api.post(path, body), path);
      bulletsPath = path;
      return taskId;
    } catch (error) {
      lastError = error;
      if (!isMissingRoute(error) || bulletsPath) throw error;
      noteMismatch(`POST ${path}`, 'no such route');
    }
  }
  throw lastError;
}

/** A finished `entry_bullets` task's `{ bullets }`. */
export function readBulletsResult(result: unknown): string[] {
  return strings(rec(result).bullets);
}

// -------------------------------------------------------------------------------------------------- addresses

/** A template's sample page (text/html, same origin: it is framed by `src`). */
export function templatePreviewSrc(templateId: string, layout: TechnicalSkillsLayout = 'categorized'): string {
  return `/api/resume-templates/${enc(templateId)}/preview?layout=${layout}`;
}

/** An uploaded resume's own file; `inline` shows a PDF in the browser instead of downloading it. */
export function resumeFileHref(id: string, inline = false): string {
  return `/api/resumes/${enc(id)}/file${inline ? '?inline=1' : ''}`;
}

export function resumeExportHref(id: string, format: 'pdf' | 'docx' | 'json'): string {
  return `/api/resumes/${enc(id)}/export?format=${format}`;
}

export function resumeEditorHref(id: string): string {
  return `/resumes/${enc(id)}`;
}

export const NEW_RESUME_HREF = '/resumes/new';
export const RESUMES_TAB_HREF = '/documents?tab=resumes';
