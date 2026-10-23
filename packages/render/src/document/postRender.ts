import { escapeRegExp } from '../locator/markup';
import { escapeHtml } from './handlebars';
import { externalUrlDisplay } from '../gate/links';

// Fixes applied to the rendered HTML.

/** A LinkedIn link that prints its own URL prints it short ("linkedin.com/in/x"); one with other text is left alone. */
export function shortenLinkedInAnchors(html: string): string {
  return html.replace(
    /<a\b([^>]*)href=(["'])(https?:\/\/(?:www\.)?linkedin\.com\/[^"']+)\2([^>]*)>([^<]*)<\/a>/gi,
    (match: string, before: string, quote: string, href: string, after: string, text: string) => {
      const shown = String(text ?? '').trim();
      const display = externalUrlDisplay(href);
      const plain = new Set([href, href.replace(/^https?:\/\//i, ''), href.replace(/^https?:\/\/www\./i, ''), display]);
      if (!plain.has(shown)) return match;
      return `<a${before}href=${quote}${href}${quote}${after}>${display}</a>`;
    },
  );
}

/**
 * A "Heading: a, b, c" skills line a template printed through a loop the compile step did not rewrite (a span
 * per line) becomes a heading block over its skills. Only this render's own Technical Skills lines are touched, as
 * escaped in the page, and only under this render's own headings, so a strength reading "Languages: English" keeps
 * its markup. A separator printed after each line inside the element goes with the line.
 */
export function splitSkillCategoryLines(
  html: string,
  data: { hardSkills?: unknown; skills?: unknown; skillCategories?: unknown },
): string {
  const lines = new Set(
    [data.hardSkills, data.skills]
      .flatMap((list) => (Array.isArray(list) ? list : []))
      .filter((line): line is string => typeof line === 'string')
      .map((line) => escapeHtml(line).trim()),
  );
  const headings = [
    ...new Set(
      (Array.isArray(data.skillCategories) ? data.skillCategories : [])
        .map((group: { category?: unknown }) => (typeof group?.category === 'string' ? group.category.trim() : ''))
        .filter(Boolean)
        .map((category: string) => escapeRegExp(escapeHtml(category))),
    ),
  ];
  if (lines.size === 0 || headings.length === 0) return html;
  const line = new RegExp(`<(span|div)\\b([^>]*)>\\s*(${headings.join('|')}):\\s*([^<]*?)\\s*[•·]?\\s*<\\/\\1>`, 'g');
  return html.replace(line, (match: string, _tag: string, attributes: string, category: string, skills: string) => {
    const joined = String(skills ?? '').trim();
    if (!lines.has(`${category}: ${joined}`)) return match;
    const rest = String(attributes ?? '').replace(/\sclass=(["']).*?\1/i, '');
    return (
      `<div${rest} class="skill-category"><div class="skill-category-title">${category}</div>` +
      `<div class="skill-category-skills">${joined}</div></div>`
    );
  });
}
