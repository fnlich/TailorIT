import { EXTRA_SECTION_KINDS, SECTION_KIND_BY_ID, isCustomSectionKey, type ExtraSectionKind } from '@tailorit/shared/resume';
import { templateNamesField } from '../locator/markup';
import { EXTRA_SECTIONS_MACRO_SOURCE, generatedBlockMarkers, hasExtraSectionsMacro, withoutExtraSectionsMacro } from '../locator/sections';

// The extra-sections macro. A built-in template carries ONE line where the sections beyond the classic six print:
//
//   {{> extra-sections sectionClass="section" headingClass="section-title" headingTextClass="section-title-text"
//       contentClass="section-content" entryClass="education-item" titleClass="degree" subClass="institution"
//       datesClass="edu-date" bulletsClass="achievements"}}
//
// It looks like a Handlebars partial and is not one: it is expanded here, before Handlebars sees the markup, into
// one plain block per kind (and one per custom section), each marked like a built-in's own section and delimited
// by comments, so each can be guarded and moved on its own. The hash parameters name the template's own classes,
// so the blocks take its look; the neutral `xs-*` classes carry a small baseline for whatever it leaves unstyled.
// The block markup is part of the template contract: it must stay exactly as templates were written against.

/** The class names a macro call may name ('' when it names none). */
export interface MacroParams {
  sectionClass: string;
  headingClass: string;
  headingTextClass: string;
  contentClass: string;
  entryClass: string;
  titleClass: string;
  subClass: string;
  datesClass: string;
  bulletsClass: string;
}

const PARAM_NAMES = [
  'sectionClass',
  'headingClass',
  'headingTextClass',
  'contentClass',
  'entryClass',
  'titleClass',
  'subClass',
  'datesClass',
  'bulletsClass',
] as const satisfies ReadonlyArray<keyof MacroParams>;

export function readMacroParams(hash: string): MacroParams {
  const params = Object.fromEntries(PARAM_NAMES.map((name) => [name, ''])) as unknown as MacroParams;
  const pairs = /(\w+)="([A-Za-z0-9_ -]*)"/g;
  for (let pair = pairs.exec(hash); pair; pair = pairs.exec(hash)) {
    const name = pair[1] as keyof MacroParams;
    if ((PARAM_NAMES as readonly string[]).includes(name)) params[name] = pair[2]!.trim();
  }
  return params;
}

/** A class attribute's value from the names that are set. */
const cls = (...names: string[]) => names.filter(Boolean).join(' ');

/** The building blocks of the generated markup, in the template's own classes. */
function blocks(p: MacroParams) {
  const div = (classNames: string, inner: string) => `<div class="${classNames}">${inner}</div>`;
  const ifField = (field: string, inner: string) => `{{#if ${field}}}${inner}{{/if}}`;
  const datesClass = cls('xs-dates', p.datesClass);
  return {
    heading: (text: string) =>
      div(cls('xs-heading', p.headingClass), p.headingTextClass ? `<span class="${p.headingTextClass}">${text}</span>` : text),
    content: (inner: string) => div(cls('xs-content', p.contentClass), inner),
    entry: (inner: string) => div(cls('xs-entry', p.entryClass), inner),
    title: (inner: string) => div(cls('xs-title', p.titleClass), inner),
    sub: (field: string) => ifField(field, div(cls('xs-sub', p.subClass), `{{${field}}}`)),
    note: (field: string) => ifField(field, div(cls('xs-note', p.datesClass), `{{${field}}}`)),
    dates:
      `{{#if dates}}${div(datesClass, '{{dates}}{{#if location}} | {{location}}{{/if}}')}` +
      `{{else}}${ifField('location', div(datesClass, '{{location}}'))}{{/if}}`,
    description: ifField('description', div('xs-desc', '{{description}}')),
    bullets: ifField(
      'achievements.length',
      `<ul class="${cls('xs-bullets', p.bulletsClass)}">{{#each achievements}}<li>{{this}}</li>{{/each}}</ul>`,
    ),
    link: ifField('linkHref', ' <a class="xs-link" href="{{linkHref}}">{{linkText}}</a>'),
    inlineItem: (inner: string) => div(cls('xs-inline-item', p.subClass), inner),
    inline: (inner: string) => div(cls('xs-inline', p.subClass), inner),
  };
}

/** One kind's entries, inside its content element. */
function entriesOf(kind: ExtraSectionKind, p: MacroParams): string {
  const b = blocks(p);
  const each = (list: string, inner: string) => `{{#each ${list}}}${inner}{{/each}}`;
  switch (kind) {
    case 'certifications':
      return each(kind, b.entry(b.title('{{name}}') + b.sub('issuer') + b.note('dates') + b.note('note')));
    case 'projects':
      return each(kind, b.entry(b.title(`{{name}}${b.link}`) + b.sub('role') + b.dates + b.description + b.bullets));
    case 'volunteering':
      return each(kind, b.entry(b.title('{{role}}') + b.sub('organization') + b.dates + b.description + b.bullets));
    case 'awards':
      return each(kind, b.entry(b.title('{{title}}') + b.sub('issuer') + b.note('dates') + b.description));
    case 'publications':
      return each(kind, b.entry(b.title(`{{title}}${b.link}`) + b.sub('publisher') + b.note('dates') + b.description));
    case 'courses':
      return each(kind, b.entry(b.title('{{name}}') + b.sub('institution') + b.note('dates')));
    case 'languages':
      return each(
        kind,
        b.inlineItem('<span class="xs-strong">{{language}}</span>{{#if proficiency}} - {{proficiency}}{{/if}}'),
      );
    case 'interests':
      return b.inline('{{join interests ", "}}');
    case 'references':
      return each(kind, b.entry(b.title('{{name}}') + b.sub('subline') + b.note('contactLine')));
  }
}

/** One kind's block: guarded on its list (outside the element), marked like a built-in's section, delimited. */
export function kindBlock(kind: ExtraSectionKind, p: MacroParams): string {
  const b = blocks(p);
  const { open, close } = generatedBlockMarkers(kind);
  const wrapper = `<div class="${cls(p.sectionClass, `section-${kind}`)}" data-section="${kind}">`;
  const body = `${wrapper}${b.heading(SECTION_KIND_BY_ID[kind].heading)}${b.content(entriesOf(kind, p))}</div>`;
  return `${open}{{#if ${kind}.length}}${body}{{/if}}${close}`;
}

/**
 * One custom section's block, bound to its key through `lookup` on the render data's `customSectionsByKey`, so
 * each custom section is its own movable element. The key is `[a-z0-9-]{1,40}`: safe in a class, an attribute and
 * a Handlebars string literal.
 */
export function customBlock(key: string, p: MacroParams): string {
  const b = blocks(p);
  const ref = `custom:${key}`;
  const { open, close } = generatedBlockMarkers(ref);
  const wrapper = `<div class="${cls(p.sectionClass, 'section-custom')}" data-section="${ref}">`;
  const entries = `{{#each entries}}${b.entry(
    b.title('{{heading}}') + b.sub('subheading') + b.dates + b.description + b.bullets,
  )}{{/each}}`;
  return (
    `${open}{{#with (lookup @root.customSectionsByKey "${key}")}}{{#if hasEntries}}${wrapper}` +
    `{{#if title}}${b.heading('{{title}}')}{{/if}}${b.content(entries)}</div>{{/if}}{{/with}}${close}`
  );
}

/**
 * The markup with every macro replaced by its blocks: one per extra kind the template does not print itself (the
 * markup without the macro decides that; the macro's own text names them all), canonical order, then one per
 * custom section.
 */
export function expandExtraSectionsMacro(html: string, customKeys: readonly string[]): string {
  if (!hasExtraSectionsMacro(html)) return html;
  const own = withoutExtraSectionsMacro(html);
  const kinds = EXTRA_SECTION_KINDS.filter((kind) => !templateNamesField(own, kind));
  const keys = customKeys.filter(isCustomSectionKey);
  return html.replace(new RegExp(EXTRA_SECTIONS_MACRO_SOURCE, 'g'), (_macro, hash: string) => {
    const params = readMacroParams(hash);
    return [...kinds.map((kind) => kindBlock(kind, params)), ...keys.map((key) => customBlock(key, params))].join('');
  });
}

/**
 * A stylesheet the compile step generates, placed once (by id): before `</head>` when there is one, else at
 * `fallbackAt`.
 */
export function insertStyleOnce(html: string, id: string, styleTag: string, fallbackAt: number): string {
  if (html.includes(`id="${id}"`)) return html;
  const head = /<\/head\s*>/i.exec(html);
  const at = head ? head.index : Math.min(Math.max(fallbackAt, 0), html.length);
  return `${html.slice(0, at)}${styleTag}${html.slice(at)}`;
}

export const EXTRA_SECTIONS_STYLE_ID = 'xs-style';

/** The light baseline for the generated blocks; the template's own rules win wherever they reach. */
const EXTRA_SECTIONS_BASELINE = [
  '.xs-entry{margin-bottom:6px;break-inside:avoid}',
  '.xs-title{font-weight:600}',
  '.xs-sub{font-style:italic}',
  '.xs-dates,.xs-note{font-size:.9em;opacity:.8}',
  '.xs-desc{margin-top:1px}',
  '.xs-bullets{margin:2px 0 0;padding-left:16px}',
  '.xs-inline{margin:0}',
  '.xs-inline-item{margin:0 0 2px}',
  '.xs-strong{font-weight:600}',
  '.xs-link{margin-left:4px;font-size:.9em;font-weight:normal;color:inherit;text-decoration:none}',
].join('');

/** The baseline, into markup holding a generated block: in the head, else before the first block. */
export function injectExtraSectionsStyle(html: string): string {
  const first = html.indexOf('<!--xs:');
  if (first === -1) return html;
  return insertStyleOnce(
    html,
    EXTRA_SECTIONS_STYLE_ID,
    `<style id="${EXTRA_SECTIONS_STYLE_ID}">${EXTRA_SECTIONS_BASELINE}</style>`,
    first,
  );
}
