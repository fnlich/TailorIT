import { randomUUID } from 'node:crypto';
import type { CoverLetterDetail, CoverLetterSummary, LetterOrigin } from '@tailorit/shared';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { notFound } from '../../core/http/errors';
import { letterText } from './sanitize';

// The cover_letters table. Every query is scoped by user_id: another account's letter is "not found".

interface LetterRow {
  id: string;
  user_id: string;
  title: string;
  origin: LetterOrigin;
  content_html: string;
  content_text: string;
  font_family: string;
  application_id: string | null;
  job_id: number | null;
  company_name: string;
  job_title: string;
  job_description: string;
  template_id: string | null;
  resume_id: string | null;
  custom_prompt: string;
  file_id: string | null;
  created_at: string;
  updated_at: string;
  last_edited_at: string | null;
}

export function toSummary(row: LetterRow): CoverLetterSummary {
  return {
    id: row.id,
    title: row.title,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEditedAt: row.last_edited_at,
    companyName: row.company_name,
    jobTitle: row.job_title,
  };
}

export function toDetail(row: LetterRow): CoverLetterDetail {
  return {
    ...toSummary(row),
    contentHtml: row.content_html,
    fontFamily: row.font_family,
    applicationId: row.application_id,
    jobId: row.job_id,
    templateId: row.template_id,
    resumeId: row.resume_id,
    jobDescription: row.job_description,
    customPrompt: row.custom_prompt,
  };
}

/** `%` and `_` are LIKE wildcards; the search is for the literal text. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export interface NewLetter {
  title: string;
  origin: LetterOrigin;
  contentHtml?: string;
  fontFamily?: string;
  applicationId?: string | null;
  jobId?: number | null;
  companyName?: string;
  jobTitle?: string;
  jobDescription?: string;
  templateId?: string | null;
  fileId?: string | null;
}

/** Columns a PATCH or a generation may change (camelCase keys of the detail). */
export interface LetterChanges {
  title?: string;
  origin?: LetterOrigin;
  contentHtml?: string;
  fontFamily?: string;
  applicationId?: string | null;
  jobId?: number | null;
  companyName?: string;
  jobTitle?: string;
  jobDescription?: string;
  templateId?: string | null;
  resumeId?: string | null;
  customPrompt?: string;
  fileId?: string | null;
  /** Sets last_edited_at (a content edit by the person, not a generation). */
  edited?: boolean;
}

const COLUMN: Record<Exclude<keyof LetterChanges, 'edited' | 'contentHtml'>, keyof LetterRow> = {
  title: 'title',
  origin: 'origin',
  fontFamily: 'font_family',
  applicationId: 'application_id',
  jobId: 'job_id',
  companyName: 'company_name',
  jobTitle: 'job_title',
  jobDescription: 'job_description',
  templateId: 'template_id',
  resumeId: 'resume_id',
  customPrompt: 'custom_prompt',
  fileId: 'file_id',
};

export function createLetterRepository(deps: Pick<AppDeps, 'db' | 'now'>) {
  const { db } = deps;

  const getRow = (id: string, userId: string) =>
    db.prepare('SELECT * FROM cover_letters WHERE id = ? AND user_id = ?').get(id, userId) as LetterRow | undefined;

  return {
    getRow,

    /** The letter, or 404 "That cover letter was not found." */
    require(id: string, userId: string): LetterRow {
      const row = getRow(id, userId);
      if (!row) throw notFound('That cover letter');
      return row;
    },

    list(userId: string, query?: string): CoverLetterSummary[] {
      const q = query?.trim();
      const rows = q
        ? (db
            .prepare(
              `SELECT * FROM cover_letters WHERE user_id = ?
                 AND (title LIKE @p ESCAPE '\\' OR company_name LIKE @p ESCAPE '\\' OR job_title LIKE @p ESCAPE '\\')
               ORDER BY updated_at DESC, id`,
            )
            .all(userId, { p: likePattern(q) }) as LetterRow[])
        : (db.prepare('SELECT * FROM cover_letters WHERE user_id = ? ORDER BY updated_at DESC, id').all(userId) as LetterRow[]);
      return rows.map(toSummary);
    },

    create(userId: string, letter: NewLetter): LetterRow {
      const now = nowIso(deps);
      const html = letter.contentHtml ?? '';
      const row: LetterRow = {
        id: randomUUID(),
        user_id: userId,
        title: letter.title,
        origin: letter.origin,
        content_html: html,
        content_text: letterText(html),
        font_family: letter.fontFamily ?? 'Times New Roman',
        application_id: letter.applicationId ?? null,
        job_id: letter.jobId ?? null,
        company_name: letter.companyName ?? '',
        job_title: letter.jobTitle ?? '',
        job_description: letter.jobDescription ?? '',
        template_id: letter.templateId ?? null,
        resume_id: null,
        custom_prompt: '',
        file_id: letter.fileId ?? null,
        created_at: now,
        updated_at: now,
        last_edited_at: null,
      };
      db.prepare(
        `INSERT INTO cover_letters(id, user_id, title, origin, content_html, content_text, font_family, application_id,
           job_id, company_name, job_title, job_description, template_id, resume_id, custom_prompt, file_id, created_at,
           updated_at, last_edited_at)
         VALUES (@id, @user_id, @title, @origin, @content_html, @content_text, @font_family, @application_id, @job_id,
           @company_name, @job_title, @job_description, @template_id, @resume_id, @custom_prompt, @file_id, @created_at,
           @updated_at, @last_edited_at)`,
      ).run(row);
      return row;
    },

    /** Applies the changes (HTML must already be sanitized) and returns the updated row; 404 when it is gone. */
    update(id: string, userId: string, changes: LetterChanges): LetterRow {
      const sets: string[] = [];
      const params: Record<string, unknown> = { id, userId, now: nowIso(deps) };
      for (const [key, column] of Object.entries(COLUMN) as Array<[keyof typeof COLUMN, keyof LetterRow]>) {
        if (changes[key] === undefined) continue;
        sets.push(`${column} = @${column}`);
        params[column] = changes[key];
      }
      if (changes.contentHtml !== undefined) {
        sets.push('content_html = @content_html', 'content_text = @content_text');
        params.content_html = changes.contentHtml;
        params.content_text = letterText(changes.contentHtml);
      }
      if (changes.edited) sets.push('last_edited_at = @now');
      sets.push('updated_at = @now');
      const result = db
        .prepare(`UPDATE cover_letters SET ${sets.join(', ')} WHERE id = @id AND user_id = @userId`)
        .run(params);
      if (result.changes === 0) throw notFound('That cover letter');
      return getRow(id, userId)!;
    },

    remove(id: string, userId: string): LetterRow | null {
      const row = getRow(id, userId);
      if (!row) return null;
      db.prepare('DELETE FROM cover_letters WHERE id = ? AND user_id = ?').run(id, userId);
      return row;
    },

    /** Deletes the account's letters among `ids` (others are ignored); returns the deleted rows. */
    removeMany(ids: readonly string[], userId: string): LetterRow[] {
      return transaction(db, () => {
        const removed: LetterRow[] = [];
        for (const id of new Set(ids)) {
          const row = getRow(id, userId);
          if (!row) continue;
          db.prepare('DELETE FROM cover_letters WHERE id = ? AND user_id = ?').run(id, userId);
          removed.push(row);
        }
        return removed;
      });
    },
  };
}

export type LetterRepository = ReturnType<typeof createLetterRepository>;
export type { LetterRow };
