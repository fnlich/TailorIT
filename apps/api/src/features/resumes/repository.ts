import { randomUUID } from 'node:crypto';
import {
  MAX_RESUMES_PER_ACCOUNT,
  normalizeResumeDocument,
  resumeLabel,
  type ResumeAnalysisBrief,
  type ResumeDetail,
  type ResumeDocument,
  type ResumeFileKind,
  type ResumeSource,
  type ResumeSummary,
} from '@tailorit/shared';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { kindOfMime } from '../../core/files/index';
import { conflict, notFound } from '../../core/http/errors';
import { analyzeAfterWrite } from './analysis/store';
import { getResumeEngine } from './engine';
import { storedDocumentOf } from './evidence';

// The resumes table, always scoped by owner: another account's resume is "not found", never "forbidden". Every write
// that changes what a resume says also stores what TailorIT read from it (analysis/store.ts), best effort: the
// reading never fails the write. An uploaded resume is never changed after it is stored (only Rename touches its row).

export interface ResumeRow {
  id: string;
  user_id: string;
  kind: 'built' | 'uploaded';
  title: string | null;
  template_id: string | null;
  data: string | null;
  file_id: string | null;
  extracted_text: string | null;
  source_resume_id: string | null;
  created_at: string;
  updated_at: string;
  last_edited_at: string | null;
}

/** A resume row with its stored file's details (uploads). */
export interface ResumeWithFile extends ResumeRow {
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  file_pages: number | null;
  file_thumb: string | null;
}

/** A list row: everything but an upload's extracted text, which the list never reads (up to 60k characters each). */
export type ResumeListRow = Omit<ResumeWithFile, 'extracted_text'>;

const FILE_COLUMNS = `f.original_name AS file_name, f.mime AS file_mime, f.size_bytes AS file_size,
         f.page_count AS file_pages, f.thumb_path AS file_thumb`;
const FROM_WITH_FILE = `FROM resumes r
    LEFT JOIN stored_files f ON f.id = r.file_id AND f.user_id = r.user_id`;
const SELECT_WITH_FILE = `
  SELECT r.*, ${FILE_COLUMNS}
    ${FROM_WITH_FILE}`;
const SELECT_LIST_ROW = `
  SELECT r.id, r.user_id, r.kind, r.title, r.template_id, r.data, r.file_id, r.source_resume_id, r.created_at,
         r.updated_at, r.last_edited_at, ${FILE_COLUMNS}
    ${FROM_WITH_FILE}`;

/** Adding past this many resumes (MAX_RESUMES_PER_ACCOUNT, built and uploaded together) is refused with 409. */
function noRoomMessage(adding: number): string {
  const limit = `You can keep up to ${MAX_RESUMES_PER_ACCOUNT} resumes`;
  return adding > 1
    ? `${limit}, and these ${adding} would take you past that. Delete resumes you no longer need, then try again.`
    : `${limit}. Delete resumes you no longer need, then try again.`;
}

/** 409 `conflict` when the account has no room for `adding` more resumes. */
export function assertRoomForResumes(deps: Pick<AppDeps, 'db'>, userId: string, adding = 1): void {
  const { n } = deps.db.prepare('SELECT count(*) AS n FROM resumes WHERE user_id = ?').get(userId) as { n: number };
  if (n + adding > MAX_RESUMES_PER_ACCOUNT) throw conflict(noRoomMessage(adding));
}

export const RESUME_NOT_FOUND = 'That resume';

export function findResume(deps: Pick<AppDeps, 'db'>, userId: string, id: string): ResumeWithFile | null {
  return (
    (deps.db.prepare(`${SELECT_WITH_FILE} WHERE r.id = ? AND r.user_id = ?`).get(id, userId) as ResumeWithFile | undefined) ??
    null
  );
}

export function requireResume(deps: Pick<AppDeps, 'db'>, userId: string, id: string): ResumeWithFile {
  const row = findResume(deps, userId, id);
  if (!row) throw notFound(RESUME_NOT_FOUND);
  return row;
}

/** The Resumes list's rows, most recently updated first. Uploads' extracted text is not read. */
export function listResumeRows(deps: Pick<AppDeps, 'db'>, userId: string, source: ResumeSource): ResumeListRow[] {
  const kind = source === 'all' ? '' : ' AND r.kind = ?';
  const params: unknown[] = source === 'all' ? [userId] : [userId, source];
  return deps.db
    .prepare(`${SELECT_LIST_ROW} WHERE r.user_id = ?${kind} ORDER BY r.updated_at DESC, r.created_at DESC, r.id ASC`)
    .all(...params) as ResumeListRow[];
}

export function defaultResumeId(deps: Pick<AppDeps, 'db'>, userId: string): string | null {
  const row = deps.db.prepare('SELECT default_resume_id FROM users WHERE id = ?').get(userId) as
    | { default_resume_id: string | null }
    | undefined;
  return row?.default_resume_id ?? null;
}

/** The stored document of a built resume (normalised again, so an older stored shape reads as today's). */
export function documentOf(row: Pick<ResumeRow, 'kind' | 'data'>): ResumeDocument | null {
  return storedDocumentOf(row);
}

function fileKindOf(mime: string | null): ResumeFileKind | null {
  const kind = mime ? kindOfMime(mime) : null;
  return kind === 'pdf' || kind === 'docx' ? kind : null;
}

/** An upload's name without its extension ("Jane Doe CV.pdf" -> "Jane Doe CV"). */
function fileBaseName(name: string | null): string {
  return (name ?? '').replace(/\.(pdf|docx?)$/i, '').trim();
}

/** One row or card of the Resumes tab. `analysis` (the list only) is what TailorIT read from it, null when not yet. */
export function toSummary(
  deps: AppDeps,
  row: ResumeListRow,
  defaultId: string | null,
  analysis?: ResumeAnalysisBrief | null,
): ResumeSummary {
  const document = documentOf(row);
  const template = row.kind === 'built' ? getResumeEngine(deps).templates.resolve(null, document?.preferredTemplate) : null;
  const custom = row.title?.trim() || null;
  return {
    id: row.id,
    kind: row.kind,
    label: row.kind === 'built' ? resumeLabel(document, custom) : custom || fileBaseName(row.file_name) || 'Uploaded resume',
    title: custom,
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    isDefault: row.id === defaultId,
    fileKind: row.kind === 'uploaded' ? fileKindOf(row.file_mime) : null,
    nameOnResume: document?.name ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEditedAt: row.last_edited_at,
    ...(analysis !== undefined ? { analysis } : {}),
  };
}

export function toDetail(deps: AppDeps, row: ResumeWithFile, defaultId: string | null): ResumeDetail {
  return {
    ...toSummary(deps, row, defaultId),
    document: documentOf(row),
    file:
      row.kind === 'uploaded' && row.file_id && row.file_mime
        ? {
            id: row.file_id,
            name: row.file_name ?? 'resume',
            mime: row.file_mime,
            sizeBytes: row.file_size ?? 0,
            pageCount: row.file_pages && row.file_pages > 0 ? row.file_pages : null,
          }
        : null,
    hasExtractedText: (row.extracted_text ?? '').trim().length > 0,
  };
}

export interface NewResume {
  kind: 'built' | 'uploaded';
  title?: string | null;
  document?: ResumeDocument | null;
  fileId?: string | null;
  extractedText?: string | null;
  sourceResumeId?: string | null;
  /** False for an upload Claude is not to read (the demo seed's). Default: every upload with readable text is read. */
  aiRefine?: boolean;
}

/**
 * Stores a resume and, when the account has no default resume yet, makes it the default, then stores what TailorIT
 * read from it (best effort). Returns the new id. Joins the caller's transaction when there is one. 409 `conflict`
 * when the account already keeps MAX_RESUMES_PER_ACCOUNT resumes.
 */
export function insertResume(deps: AppDeps, userId: string, input: NewResume): string {
  const id = randomUUID();
  const now = nowIso(deps);
  const data = input.document ? JSON.stringify(input.document) : null;
  transaction(deps.db, () => {
    assertRoomForResumes(deps, userId, 1);
    deps.db
      .prepare(
        `INSERT INTO resumes(id, user_id, kind, title, template_id, data, file_id, extracted_text, source_resume_id,
           created_at, updated_at, last_edited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        userId,
        input.kind,
        input.title ?? null,
        input.document?.preferredTemplate || null,
        data,
        input.fileId ?? null,
        input.extractedText ?? null,
        input.sourceResumeId ?? null,
        now,
        now,
      );
    deps.db
      .prepare('UPDATE users SET default_resume_id = ?, updated_at = ? WHERE id = ? AND default_resume_id IS NULL')
      .run(id, now, userId);
    // Read from what was stored, exactly as later reads see it (the stored document is normalised again on read).
    analyzeAfterWrite(
      deps,
      {
        id,
        userId,
        subject:
          input.kind === 'uploaded'
            ? { kind: 'uploaded', text: input.extractedText ?? null }
            : { kind: 'built', document: storedDocumentOf({ kind: 'built', data }) ?? normalizeResumeDocument({}) },
      },
      { aiRefine: input.aiRefine },
    );
  });
  return id;
}

/**
 * PUT /api/resumes/:id: a built resume's new document (and title, when given), with what TailorIT reads from it. The
 * reading is stored again only when what it reads changed. Joins the caller's transaction when there is one.
 */
export function updateResumeDocument(
  deps: AppDeps,
  userId: string,
  id: string,
  document: ResumeDocument,
  title?: string | null,
): { analysisChanged: boolean } {
  const now = nowIso(deps);
  const data = JSON.stringify(document);
  return transaction(deps.db, () => {
    deps.db
      .prepare(
        `UPDATE resumes SET data = ?, template_id = ?, title = CASE WHEN ? THEN ? ELSE title END, updated_at = ?,
           last_edited_at = ? WHERE id = ? AND user_id = ? AND kind = 'built'`,
      )
      .run(data, document.preferredTemplate || null, title !== undefined ? 1 : 0, title ?? null, now, now, id, userId);
    const stored = storedDocumentOf({ kind: 'built', data }) ?? normalizeResumeDocument({});
    return { analysisChanged: analyzeAfterWrite(deps, { id, userId, subject: { kind: 'built', document: stored } }) };
  });
}

/**
 * Deletes one of the account's resumes. When it was the default, the newest remaining resume becomes the default
 * (none left: no default). Returns the stored file to remove and the default after, or null when it is not theirs.
 */
export function deleteResumeRow(
  deps: AppDeps,
  userId: string,
  id: string,
): { fileId: string | null; defaultResumeId: string | null } | null {
  return transaction(deps.db, () => {
    const row = deps.db.prepare('SELECT file_id FROM resumes WHERE id = ? AND user_id = ?').get(id, userId) as
      | { file_id: string | null }
      | undefined;
    if (!row) return null;
    const wasDefault = defaultResumeId(deps, userId) === id;
    deps.db.prepare('DELETE FROM resumes WHERE id = ? AND user_id = ?').run(id, userId);
    let next = defaultResumeId(deps, userId);
    if (wasDefault) {
      const newest = deps.db
        .prepare('SELECT id FROM resumes WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT 1')
        .get(userId) as { id: string } | undefined;
      next = newest?.id ?? null;
      deps.db.prepare('UPDATE users SET default_resume_id = ?, updated_at = ? WHERE id = ?').run(next, nowIso(deps), userId);
    }
    return { fileId: row.file_id, defaultResumeId: next };
  });
}
