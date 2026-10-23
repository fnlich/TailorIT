import {
  effectiveSectionOrder,
  parseSectionRef,
  presenceOf,
  SECTION_KIND_BY_ID,
  type ResumeDocument,
  type SectionKind,
} from '@tailorit/shared/resume';
import { prepareRenderData, type RenderData } from '../gate/renderData';
import type { SkillIndex } from '../skills/library';
import type { ResumeTemplate } from '../templates/store';
import { fitToTemplate } from './render';

// "Word (simple layout)": one plain look whatever the template (a centred header, ruled section headings), built
// from the same render data as the PDF, so the sections a resume switched off, or its template has no room for,
// are left out here too. Sections follow the order the editor shows. The HTML is for html-to-docx.

const ACCENT = '#1F4E79';

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const list = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];

const paragraph = (inner: string, style = '') =>
  `<p style="margin: 0 0 3pt 0; font-size: 10pt; line-height: 1.3;${style}">${inner}</p>`;
const heading = (text: string) =>
  `<p style="margin: 10pt 0 4pt 0; font-size: 11pt; font-weight: bold; color: ${ACCENT}; ` +
  `border-bottom: 1px solid ${ACCENT};">${esc(text.toUpperCase())}</p>`;
const bullets = (items: string[]) =>
  items.length ? `<ul style="margin: 0 0 4pt 0;">${items.map((item) => `<li style="font-size: 10pt;">${esc(item)}</li>`).join('')}</ul>` : '';
const joinedLine = (...parts: string[]) => parts.filter(Boolean).map(esc).join(' | ');

/** One entry: a bold first line, a second line of where and when, then its description and bullets. */
function entry(title: string, meta: string, description: string, achievements: string[]): string {
  return [
    title ? paragraph(`<b>${esc(title)}</b>`) : '',
    meta ? paragraph(esc(meta), ' color: #555555;') : '',
    description ? paragraph(esc(description)) : '',
    bullets(achievements),
  ].join('');
}

const dates = (item: Record<string, unknown>) => [str(item.startDate), str(item.endDate)].filter(Boolean).join(' - ');

function kindBlock(kind: SectionKind, data: RenderData): string {
  const title = SECTION_KIND_BY_ID[kind].heading;
  const block = (body: string) => (body ? `${heading(title)}${body}` : '');
  switch (kind) {
    case 'summary':
      return block(str(data.summary) ? paragraph(esc(data.summary)) : '');
    case 'strengths':
      return block(
        data.strengths.map((item) => paragraph(`<b>${esc(item.title)}</b>${item.description ? `: ${esc(item.description)}` : ''}`)).join(''),
      );
    case 'skills':
      return block(
        data.skillCategories
          .map((group) => paragraph(`${group.category ? `<b>${esc(group.category)}:</b> ` : ''}${esc(group.skills.join(', '))}`))
          .join(''),
      );
    case 'softSkills':
      return block(data.softSkills.length ? paragraph(esc(data.softSkills.join(', '))) : '');
    case 'experience':
      return block(
        list(data.experience)
          .map((role) =>
            entry(
              [str(role.title), str(role.company)].filter(Boolean).join(', '),
              joinedLine(dates(role), str(role.location)),
              str(role.description),
              strings(role.achievements),
            ),
          )
          .join(''),
      );
    case 'education':
      return block(
        list(data.education)
          .map((item) =>
            entry(
              str(item.degree) || str(item.institution),
              joinedLine(str(item.degree) ? str(item.institution) : '', dates(item), str(item.location)),
              str(item.gpa) ? `GPA ${str(item.gpa)}` : '',
              strings(item.achievements),
            ),
          )
          .join(''),
      );
    case 'certifications':
      return block(list(data.certifications).map((item) => entry(str(item.name), joinedLine(str(item.issuer), str(item.dates)), str(item.note), [])).join(''));
    case 'projects':
      return block(
        list(data.projects)
          .map((item) =>
            entry(
              str(item.name),
              joinedLine(str(item.role), str(item.dates), str(item.linkText)),
              str(item.description),
              strings(item.achievements),
            ),
          )
          .join(''),
      );
    case 'volunteering':
      return block(
        list(data.volunteering)
          .map((item) =>
            entry(
              [str(item.role), str(item.organization)].filter(Boolean).join(', '),
              joinedLine(str(item.dates), str(item.location)),
              str(item.description),
              strings(item.achievements),
            ),
          )
          .join(''),
      );
    case 'awards':
      return block(list(data.awards).map((item) => entry(str(item.title), joinedLine(str(item.issuer), str(item.dates)), str(item.description), [])).join(''));
    case 'publications':
      return block(
        list(data.publications)
          .map((item) => entry(str(item.title), joinedLine(str(item.publisher), str(item.dates), str(item.linkText)), str(item.description), []))
          .join(''),
      );
    case 'courses':
      return block(list(data.courses).map((item) => entry(str(item.name), joinedLine(str(item.institution), str(item.dates)), '', [])).join(''));
    case 'languages': {
      const spoken = list(data.languages).map(
        (item) => `${esc(item.language)}${str(item.proficiency) ? ` (${esc(item.proficiency)})` : ''}`,
      );
      return block(spoken.length ? paragraph(spoken.join(', ')) : '');
    }
    case 'interests':
      return block(strings(data.interests).length ? paragraph(esc(strings(data.interests).join(', '))) : '');
    case 'references':
      return block(
        list(data.references).map((item) => entry(str(item.name), str(item.subline), str(item.contactLine), [])).join(''),
      );
  }
}

function customBlock(key: string, data: RenderData): string {
  const section = (data.customSectionsByKey as Record<string, { title: string; entries: Array<Record<string, unknown>> }>)[key];
  if (!section || section.entries.length === 0) return '';
  const body = section.entries
    .map((item) =>
      entry(
        str(item.heading),
        joinedLine(str(item.subheading), str(item.dates), str(item.location)),
        str(item.description),
        strings(item.achievements),
      ),
    )
    .join('');
  return `${section.title ? heading(section.title) : ''}${body}`;
}

/** The DOCX's HTML for a resume drawn with `template` (which decides only which optional sections exist). */
export function renderResumeDocxHtml(document: ResumeDocument, template: ResumeTemplate, skills: SkillIndex): string {
  const data = prepareRenderData(fitToTemplate(document, template), skills);
  const contact = data.contact as Record<string, string>;
  const contactLine = [
    esc(contact.location),
    esc(contact.phone),
    esc(contact.email),
    contact.linkedinHref ? `<a href="${esc(contact.linkedinHref)}">${esc(contact.linkedinDisplay || contact.linkedinHref)}</a>` : '',
    contact.github ? esc(contact.github) : '',
    contact.portfolio ? esc(contact.portfolio) : '',
  ]
    .filter(Boolean)
    .join('  |  ');
  const order = effectiveSectionOrder(data.sectionOrder, template.nativeSectionOrder, presenceOf(data));
  const printed = new Set<string>(template.printsSections);
  const body = order
    .map((ref) => {
      const parsed = parseSectionRef(ref);
      if (!parsed) return '';
      if (parsed.kind === 'custom') return printed.has('custom') ? customBlock(parsed.key, data) : '';
      return printed.has(parsed.kind) ? kindBlock(parsed.kind, data) : '';
    })
    .filter(Boolean)
    .join('\n');
  return [
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>',
    '<body style="font-family: Arial, sans-serif; font-size: 10pt; color: #1A1A1A;">',
    `<p style="margin: 0 0 2pt 0; font-size: 20pt; font-weight: bold; text-align: center;">${esc(data.name)}</p>`,
    `<p style="margin: 0 0 2pt 0; font-size: 12pt; color: ${ACCENT}; text-align: center;">${esc(data.title)}</p>`,
    `<p style="margin: 0 0 8pt 0; font-size: 9pt; color: #555555; text-align: center;">${contactLine}</p>`,
    body,
    '</body></html>',
  ].join('\n');
}
