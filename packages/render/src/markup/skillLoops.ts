// Grouped layout: the skills markup the templates write, rewritten so each group prints as its heading and its
// joined skills. Plain hands these shapes one entry per skill, which is what they were written to draw, so this
// runs for Grouped only.
//
// - The box per skill (default, azure-stack): a category cell per group.
// - The list item per skill: an item per group, its heading in bold over its skills.
// - A joined line (`<p><strong>Technical Skills:</strong> {{join hardSkills ", "}}</p>`, the ATS templates): a
//   p, div or li repeated per group; a span or td kept as the one element it is, its groups on lines of their own.
//   The group's heading takes the static label's place; a headless group prints no ": ".
// A span loop over hardSkills is left as written: its "Heading: a, b" lines become heading blocks after the render.

const BOX_PER_SKILL =
  /\{\{#if hardSkills\.length\}\}\s*\{\{#each hardSkills\}\}\s*<div class="skill-box">\{\{this\}\}<\/div>\s*\{\{\/each\}\}\s*\{\{else\}\}\s*\{\{#each skills\}\}\s*<div class="skill-box">\{\{this\}\}<\/div>\s*\{\{\/each\}\}\s*\{\{\/if\}\}/g;

const ITEM_PER_SKILL = /\{\{#each hardSkills\}\}\s*<li[^>]*>\{\{this\}\}<\/li>\s*\{\{\/each\}\}/g;

const JOINED_SKILLS_LINE =
  /<(p|div|li|span|td)\b([^>]*)>\s*(?:<(strong|b)\b[^>]*>[^<{}]*<\/\3>\s*)?\{\{\s*join\s+hardSkills\s+("[^"]*"|'[^']*')\s*\}\}\s*<\/\1>/g;

/** Elements that are a line of their own, so one per group reads as a line per heading. */
const LINE_ELEMENTS: ReadonlySet<string> = new Set(['p', 'div', 'li']);

const CATEGORY_CELLS =
  '{{#each skillCategories}}<div class="skill-category"><div class="skill-category-title">{{category}}</div>' +
  '<div class="skill-category-skills">{{join skills ", "}}</div></div>{{/each}}';

const CATEGORY_ITEMS = '{{#each skillCategories}}<li><strong>{{category}}</strong><br>{{join skills ", "}}</li>{{/each}}';

export function rewritePerItemSkillLoops(html: string): string {
  return html
    .replace(BOX_PER_SKILL, CATEGORY_CELLS)
    .replace(ITEM_PER_SKILL, CATEGORY_ITEMS)
    .replace(JOINED_SKILLS_LINE, (_match, tag: string, attributes: string, _label: string | undefined, separator: string) => {
      const line = `{{#if category}}<strong>{{category}}:</strong> {{/if}}{{join skills ${separator}}}`;
      if (LINE_ELEMENTS.has(tag)) return `{{#each skillCategories}}<${tag}${attributes}>${line}</${tag}>{{/each}}`;
      return `<${tag}${attributes}>{{#each skillCategories}}${line}{{#unless @last}}<br>{{/unless}}{{/each}}</${tag}>`;
    });
}
