import { sectionLoops } from '../locator/loops';
import { escapeRegExp } from '../locator/markup';
import { insertStyleOnce } from './extraSections';

// The Plain layout's safety net for templates drawn as a grid of category cards. Plain reaches a
// `{{#each skillCategories}}` design as ONE headless group, which would otherwise sit in one cell of the grid (one
// column of a multi-column list, a float a third wide). The element holding the loop, and nothing else, is marked
// `data-plain-skills`, and one small stylesheet makes each of its children take the whole row. Grouped is the
// design as written; the stored template is never touched (this runs on the markup at compile time).

export const PLAIN_SKILLS_ATTRIBUTE = 'data-plain-skills';
export const PLAIN_SKILLS_STYLE_ID = 'plain-skills-style';

const PLAIN_SKILLS_RULE =
  `[${PLAIN_SKILLS_ATTRIBUTE}]>*{grid-column:1/-1!important;column-span:all!important;float:none!important;` +
  'width:auto!important;max-width:none!important;height:auto!important;min-height:0!important}';

/** An opening tag right before a category loop, with only whitespace and `{{#if ...}}` openers between them. */
const LOOP_HOLDER =
  /<([a-zA-Z][\w-]*)\b(?![^>]*\sdata-plain-skills\b)([^>]*)>(\s*(?:\{\{#if\s[^}]*\}\}\s*)*\{\{#each\s+skillCategories\b)/g;

/** Never a holder: elements with no children, and the document's own. */
const NOT_HOLDERS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
  'html',
  'head',
  'body',
]);

/** Whether the holder closes right after its loop: past `{{/each}}`, only the guards' `{{/if}}`s and its closing tag. */
function closesRightAfter(html: string, loopEnd: number, tag: string, opening: string): boolean {
  const guards = (opening.match(/\{\{#if\s/g) ?? []).length;
  return new RegExp(`^(?:\\s*\\{\\{\\/if\\s*\\}\\}){${guards}}\\s*<\\/${escapeRegExp(tag)}\\s*>`, 'i').test(html.slice(loopEnd));
}

/** Marks every element that holds a category loop and nothing else, and adds the stylesheet once. Idempotent. */
export function fitPlainSkillGroups(html: string): string {
  const loopEnds = new Map<number, number>();
  for (const span of sectionLoops(html, 'skillCategories')) {
    if (html.startsWith('{{#each', span.start)) loopEnds.set(span.start, span.end);
  }
  let marked = false;
  const output = html.replace(
    LOOP_HOLDER,
    (match: string, tag: string, attributes: string, opening: string, offset: number) => {
      if (NOT_HOLDERS.has(tag.toLowerCase()) || attributes.trimEnd().endsWith('/')) return match;
      const loopEnd = loopEnds.get(offset + match.lastIndexOf('{{#each'));
      if (loopEnd === undefined || !closesRightAfter(html, loopEnd, tag, opening)) return match;
      marked = true;
      return `<${tag}${attributes} ${PLAIN_SKILLS_ATTRIBUTE}>${opening}`;
    },
  );
  if (!marked) return html;
  const doctype = /^\s*<!DOCTYPE[^>]*>/i.exec(output);
  return insertStyleOnce(
    output,
    PLAIN_SKILLS_STYLE_ID,
    `<style id="${PLAIN_SKILLS_STYLE_ID}">${PLAIN_SKILLS_RULE}</style>`,
    doctype ? doctype[0].length : 0,
  );
}
