import { htmlToText } from '@tailorit/shared/format';

/*
 * The Generate dialog's template preview reads the template as text, at a size people can read, instead of a page
 * thumbnail: one line per paragraph, heading or list item, in the template's alignment, with each {{VARIABLE}} kept
 * apart so it can be drawn as the editor's chip. Pure: the stored HTML in, plain data out (nothing is injected).
 */

export type PreviewAlign = 'left' | 'center' | 'right' | 'justify';

export type PreviewPart = { text: string } | { variable: string };

export interface PreviewBlock {
  kind: 'heading' | 'text' | 'item';
  align: PreviewAlign;
  /** Text runs and variables in reading order; [] for an empty line. */
  parts: PreviewPart[];
}

const BLOCK = /<(h[1-6]|p|li|blockquote)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const ALIGN = /text-align\s*:\s*(left|center|right|justify)/i;
/** Split with a capture group: odd entries are variable names. */
const VARIABLE_SPLIT = /\{\{([A-Z][A-Z0-9_]*)\}\}/;

/** "Dear {{COMPANY_NAME}} team," → [text "Dear ", variable COMPANY_NAME, text " team,"]. */
export function previewParts(text: string): PreviewPart[] {
  return text
    .split(VARIABLE_SPLIT)
    .map((piece, index): PreviewPart | null => (index % 2 === 1 ? { variable: piece } : piece ? { text: piece } : null))
    .filter((part): part is PreviewPart => part !== null);
}

function kindOf(tag: string): PreviewBlock['kind'] {
  const lower = tag.toLowerCase();
  if (lower.startsWith('h')) return 'heading';
  return lower === 'li' ? 'item' : 'text';
}

/**
 * The blocks of a stored letter or template. Runs of empty lines become one, and the edges are trimmed. HTML with no
 * block tags (plain text) still reads, line by line.
 */
export function templatePreviewBlocks(html: string): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const push = (kind: PreviewBlock['kind'], align: PreviewAlign, text: string) => {
    for (const line of text.split('\n')) {
      const parts = previewParts(line);
      const previous = blocks.at(-1);
      if (parts.length === 0 && (!previous || previous.parts.length === 0)) continue;
      blocks.push({ kind, align, parts });
    }
  };

  let matched = false;
  for (const match of html.matchAll(BLOCK)) {
    matched = true;
    const [, tag = 'p', attributes = '', inner = ''] = match;
    const align = (ALIGN.exec(attributes)?.[1]?.toLowerCase() as PreviewAlign | undefined) ?? 'left';
    push(kindOf(tag), align, htmlToText(inner));
  }
  if (!matched) push('text', 'left', htmlToText(html));

  while (blocks.length > 0 && blocks.at(-1)!.parts.length === 0) blocks.pop();
  return blocks;
}
