import { randomUUID } from 'node:crypto';
import {
  templatePreviewText,
  type LetterTemplateDetail,
  type LetterTemplateSummary,
  type TemplateOrigin,
} from '@tailorit/shared';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { AppError, notFound } from '../../core/http/errors';
import { letterText } from '../cover-letters/sanitize';

// The cover_letter_templates table. A person sees the system templates and their own; another account's template is
// "not found", and a system template cannot be changed or deleted (403 system_template_read_only).

export interface TemplateRow {
  id: string;
  user_id: string | null;
  is_system: number;
  system_key: string | null;
  name: string;
  content_html: string;
  content_text: string;
  font_family: string;
  ai_prompt: string;
  origin: TemplateOrigin;
  created_at: string;
  updated_at: string;
  last_edited_at: string | null;
}

export const SYSTEM_READ_ONLY =
  'System templates cannot be changed. Duplicate it to make your own copy, then edit the copy.';

export function systemReadOnly(): AppError {
  return new AppError('system_template_read_only', SYSTEM_READ_ONLY);
}

export function toTemplateSummary(row: TemplateRow): LetterTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    isSystem: row.is_system === 1,
    preview: templatePreviewText(row.content_text),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEditedAt: row.last_edited_at,
  };
}

export function toTemplateDetail(row: TemplateRow): LetterTemplateDetail {
  return {
    ...toTemplateSummary(row),
    contentHtml: row.content_html,
    fontFamily: row.font_family,
    aiPrompt: row.ai_prompt,
  };
}

export interface NewTemplate {
  name: string;
  origin: Exclude<TemplateOrigin, 'system'>;
  contentHtml?: string;
  fontFamily?: string;
  aiPrompt?: string;
}

export interface TemplateChanges {
  name?: string;
  contentHtml?: string;
  fontFamily?: string;
  aiPrompt?: string;
  edited?: boolean;
}

/** System templates in their seeded order (position in static/letter-templates), set by the seed. */
let systemOrder: Map<string, number> = new Map();
export function setSystemOrder(keys: readonly string[]): void {
  systemOrder = new Map(keys.map((key, index) => [key, index]));
}

export function createTemplateRepository(deps: Pick<AppDeps, 'db' | 'now'>) {
  const { db } = deps;

  /** A template the account may see (system or its own). */
  const getVisible = (id: string, userId: string) =>
    db
      .prepare('SELECT * FROM cover_letter_templates WHERE id = ? AND (is_system = 1 OR user_id = ?)')
      .get(id, userId) as TemplateRow | undefined;

  const requireVisible = (id: string, userId: string): TemplateRow => {
    const row = getVisible(id, userId);
    if (!row) throw notFound('That template');
    return row;
  };

  return {
    requireVisible,

    /** One of the account's own templates; a system template is 403, anything else 404. */
    requireOwn(id: string, userId: string): TemplateRow {
      const row = requireVisible(id, userId);
      if (row.is_system === 1) throw systemReadOnly();
      return row;
    },

    /** System templates first (seeded order), then the account's own, newest first. */
    list(userId: string): TemplateRow[] {
      const rows = db
        .prepare('SELECT * FROM cover_letter_templates WHERE is_system = 1 OR user_id = ?')
        .all(userId) as TemplateRow[];
      const rank = (row: TemplateRow) => systemOrder.get(row.system_key ?? '') ?? Number.MAX_SAFE_INTEGER;
      return rows.sort((a, b) => {
        if (a.is_system !== b.is_system) return b.is_system - a.is_system;
        if (a.is_system === 1) return rank(a) - rank(b) || a.name.localeCompare(b.name);
        return b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
      });
    },

    create(userId: string, template: NewTemplate): TemplateRow {
      const now = nowIso(deps);
      const html = template.contentHtml ?? '';
      const row: TemplateRow = {
        id: randomUUID(),
        user_id: userId,
        is_system: 0,
        system_key: null,
        name: template.name,
        content_html: html,
        content_text: letterText(html),
        font_family: template.fontFamily ?? 'Times New Roman',
        ai_prompt: template.aiPrompt ?? '',
        origin: template.origin,
        created_at: now,
        updated_at: now,
        last_edited_at: null,
      };
      db.prepare(
        `INSERT INTO cover_letter_templates(id, user_id, is_system, system_key, name, content_html, content_text,
           font_family, ai_prompt, origin, created_at, updated_at, last_edited_at)
         VALUES (@id, @user_id, @is_system, @system_key, @name, @content_html, @content_text, @font_family, @ai_prompt,
           @origin, @created_at, @updated_at, @last_edited_at)`,
      ).run(row);
      return row;
    },

    update(id: string, userId: string, changes: TemplateChanges): TemplateRow {
      const sets: string[] = [];
      const params: Record<string, unknown> = { id, userId, now: nowIso(deps) };
      if (changes.name !== undefined) {
        sets.push('name = @name');
        params.name = changes.name;
      }
      if (changes.contentHtml !== undefined) {
        sets.push('content_html = @content_html', 'content_text = @content_text');
        params.content_html = changes.contentHtml;
        params.content_text = letterText(changes.contentHtml);
      }
      if (changes.fontFamily !== undefined) {
        sets.push('font_family = @font_family');
        params.font_family = changes.fontFamily;
      }
      if (changes.aiPrompt !== undefined) {
        sets.push('ai_prompt = @ai_prompt');
        params.ai_prompt = changes.aiPrompt;
      }
      if (changes.edited) sets.push('last_edited_at = @now');
      sets.push('updated_at = @now');
      const result = db
        .prepare(
          `UPDATE cover_letter_templates SET ${sets.join(', ')} WHERE id = @id AND user_id = @userId AND is_system = 0`,
        )
        .run(params);
      if (result.changes === 0) throw notFound('That template');
      return requireVisible(id, userId);
    },

    remove(id: string, userId: string): void {
      const row = requireVisible(id, userId);
      if (row.is_system === 1) throw systemReadOnly();
      db.prepare('DELETE FROM cover_letter_templates WHERE id = ? AND user_id = ? AND is_system = 0').run(id, userId);
    },

    /** Deletes the account's own templates among `ids`; system ones are skipped (and reported), others ignored. */
    removeMany(ids: readonly string[], userId: string): { deleted: number; skippedIds: string[] } {
      return transaction(db, () => {
        let deleted = 0;
        const skippedIds: string[] = [];
        for (const id of new Set(ids)) {
          const row = getVisible(id, userId);
          if (!row) continue;
          if (row.is_system === 1) {
            skippedIds.push(id);
            continue;
          }
          deleted += db
            .prepare('DELETE FROM cover_letter_templates WHERE id = ? AND user_id = ? AND is_system = 0')
            .run(id, userId).changes;
        }
        return { deleted, skippedIds };
      });
    },
  };
}

export type TemplateRepository = ReturnType<typeof createTemplateRepository>;
