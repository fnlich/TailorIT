import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { escapeHtml, LETTER_FONT_NAMES } from '@tailorit/shared';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { staticDir } from '../../core/paths';
import { letterText } from '../cover-letters/sanitize';
import { setSystemOrder } from './repository';

// TailorIT's starter templates (static/letter-templates/*.json, our own text), upserted by system_key at every start:
// a new file is added, a changed one updated, an unchanged one left alone (its times stay).

const BlockSchema = z.union([
  z.string(),
  z.object({
    tag: z.enum(['p', 'h1', 'h2', 'h3']).default('p'),
    align: z.enum(['left', 'center', 'right', 'justify']).optional(),
    text: z.string(),
  }),
]);

const StarterSchema = z.object({
  systemKey: z.string().regex(/^[a-z0-9-]+$/),
  position: z.number().int(),
  name: z.string().min(3).max(200),
  fontFamily: z.enum(LETTER_FONT_NAMES),
  aiPrompt: z.string().max(1000),
  blocks: z.array(BlockSchema).min(1),
});
export type StarterTemplate = z.infer<typeof StarterSchema>;

let starters: StarterTemplate[] | null = null;

/** The starter templates, in position order (read once). */
export function starterTemplates(): StarterTemplate[] {
  if (starters) return starters;
  const dir = staticDir('letter-templates');
  starters = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const parsed = StarterSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      if (!parsed.success) throw new Error(`static/letter-templates/${file} is not a valid starter template: ${parsed.error.message}`);
      return parsed.data;
    })
    .sort((a, b) => a.position - b.position);
  return starters;
}

/** A starter's blocks as editor HTML; `{{NAME}}` survives escaping untouched. */
export function starterHtml(template: StarterTemplate): string {
  return template.blocks
    .map((block) => {
      const { tag, align, text } = typeof block === 'string' ? { tag: 'p' as const, align: undefined, text: block } : block;
      const style = align ? ` style="text-align: ${align}"` : '';
      return `<${tag}${style}>${escapeHtml(text)}</${tag}>`;
    })
    .join('');
}

interface ExistingRow {
  id: string;
  name: string;
  content_html: string;
  font_family: string;
  ai_prompt: string;
}

/** Inserts or refreshes every starter as a system template. Returns how many rows it wrote. */
export function seedSystemTemplates(deps: Pick<AppDeps, 'db' | 'now'>): number {
  const list = starterTemplates();
  setSystemOrder(list.map((template) => template.systemKey));
  const now = nowIso(deps);
  return transaction(deps.db, () => {
    let written = 0;
    for (const template of list) {
      const html = starterHtml(template);
      const existing = deps.db
        .prepare('SELECT id, name, content_html, font_family, ai_prompt FROM cover_letter_templates WHERE system_key = ?')
        .get(template.systemKey) as ExistingRow | undefined;
      if (!existing) {
        deps.db
          .prepare(
            `INSERT INTO cover_letter_templates(id, user_id, is_system, system_key, name, content_html, content_text,
               font_family, ai_prompt, origin, created_at, updated_at, last_edited_at)
             VALUES (?, NULL, 1, ?, ?, ?, ?, ?, ?, 'system', ?, ?, NULL)`,
          )
          .run(randomUUID(), template.systemKey, template.name, html, letterText(html), template.fontFamily, template.aiPrompt, now, now);
        written += 1;
        continue;
      }
      const changed =
        existing.name !== template.name ||
        existing.content_html !== html ||
        existing.font_family !== template.fontFamily ||
        existing.ai_prompt !== template.aiPrompt;
      if (!changed) continue;
      deps.db
        .prepare(
          `UPDATE cover_letter_templates SET name = ?, content_html = ?, content_text = ?, font_family = ?, ai_prompt = ?,
             updated_at = ? WHERE id = ?`,
        )
        .run(template.name, html, letterText(html), template.fontFamily, template.aiPrompt, now, existing.id);
      written += 1;
    }
    return written;
  });
}
