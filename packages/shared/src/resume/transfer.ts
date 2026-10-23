import { resumeLabel } from './display';
import type { ResumeDocument } from './document';
import { normalizeResumeDocument } from './normalize';

// Download JSON / Import JSON. TailorIT writes an envelope; it reads its own files, bare documents (free_tailor's
// exported resumes, whose profile and tailoring fields the normaliser drops) and lists of either.

export const RESUME_EXPORT_FORMAT = 'tailorit-resume';
export const RESUME_EXPORT_VERSION = 1;
/** Resumes one import file may hold. */
export const MAX_RESUMES_PER_IMPORT = 50;

export interface ResumeExportFile {
  format: typeof RESUME_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  title: string | null;
  templateId: string | null;
  document: ResumeDocument;
}

/** The Download JSON file's content. */
export function resumeExportFile(
  resume: { title: string | null; templateId: string | null; document: ResumeDocument },
  exportedAt: string,
): ResumeExportFile {
  return {
    format: RESUME_EXPORT_FORMAT,
    version: RESUME_EXPORT_VERSION,
    exportedAt,
    title: resume.title,
    templateId: resume.templateId,
    document: resume.document,
  };
}

/** "Senior_Platform_Engineer.json": the label with anything unsafe in a file name replaced. */
export function resumeExportFileName(label: string, extension = 'json'): string {
  const base = label
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${base || 'resume'}.${extension}`;
}

/** Fields at least one of which a document must carry to read as a resume (with a name or headline). */
const RESUME_FIELDS = ['summary', 'experience', 'education', 'skills', 'skillCategories', 'contact', 'projects', 'certifications'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeResume(value: Record<string, unknown>): boolean {
  const named = typeof value.name === 'string' || typeof value.title === 'string';
  return named && RESUME_FIELDS.some((key) => value[key] !== undefined);
}

export interface ImportedResume {
  title: string | null;
  templateId: string | null;
  document: ResumeDocument;
}

export type ResumeImportResult = { ok: true; resumes: ImportedResume[] } | { ok: false; message: string };

/**
 * The resumes in an imported JSON file: a TailorIT envelope, a bare resume document, a list of either, or
 * `{ resumes: [...] }`. Every document goes through the normaliser. Refused as a whole when anything in it is not a
 * resume (a package.json has a name and nothing else) or when it holds more than 50.
 */
export function readResumeImport(data: unknown): ResumeImportResult {
  const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.resumes) ? data.resumes : [data];
  if (list.length === 0) return { ok: false, message: 'The file holds no resume.' };
  if (list.length > MAX_RESUMES_PER_IMPORT) {
    return { ok: false, message: `A file can hold at most ${MAX_RESUMES_PER_IMPORT} resumes.` };
  }
  const resumes: ImportedResume[] = [];
  for (const [index, item] of list.entries()) {
    const where = list.length > 1 ? `Item ${index + 1}` : 'The file';
    if (!isRecord(item)) return { ok: false, message: `${where} is not a resume.` };
    const envelope = item.format === RESUME_EXPORT_FORMAT && isRecord(item.document);
    const source = envelope ? (item.document as Record<string, unknown>) : item;
    if (!looksLikeResume(source)) {
      return { ok: false, message: `${where} is not a resume: it needs a name or headline and some resume content.` };
    }
    const document = normalizeResumeDocument(source);
    const title = envelope && typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null;
    const templateId =
      envelope && typeof item.templateId === 'string' && item.templateId
        ? item.templateId
        : document.preferredTemplate || null;
    resumes.push({ title, templateId, document });
  }
  return { ok: true, resumes };
}

/** The label an imported resume will show with. */
export function importedResumeLabel(resume: ImportedResume): string {
  return resumeLabel(resume.document, resume.title);
}
