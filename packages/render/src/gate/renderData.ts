import {
  cleanSectionOrder,
  presenceOf,
  TECHNICAL_SKILLS_LAYOUTS,
  type ResumeDocument,
  type TechnicalSkillsLayout,
} from '@tailorit/shared/resume';
import type { CompileChoices } from '../markup/normalize';
import type { SkillIndex } from '../skills/library';
import { prepareExtraSectionData } from './extraSectionData';
import { externalUrl, externalUrlDisplay, safeContactLink } from './links';
import { dedupeSkills, skillGroupsFor, skillLines, type SkillGroup } from './skills';

// The data a template is rendered against: the resume as written (the untailored render), with the derived
// fields templates read. Every output (preview, thumbnail, PDF, DOCX) prepares its data here, so a section a resume
// switched off is empty everywhere, decided once.

/** A role's description prints at most this long, cut at a sentence, a comma or a word near the end. */
const MAX_ROLE_DESCRIPTION = 1200;

function trimDanglingEnd(value: string): string {
  return value
    .trim()
    .replace(/,+\s*$/, '')
    .replace(/\s+(and|or)\s*$/i, '')
    .trim();
}

export function clampRoleDescription(description: string): string {
  const clean = description.trim().replace(/\s+/g, ' ');
  if (clean.length <= MAX_ROLE_DESCRIPTION) return trimDanglingEnd(clean);
  const cut = clean.slice(0, MAX_ROLE_DESCRIPTION);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentenceEnd >= MAX_ROLE_DESCRIPTION - 80) return trimDanglingEnd(cut.slice(0, sentenceEnd + 1).trim());
  const comma = cut.lastIndexOf(', ');
  if (comma >= MAX_ROLE_DESCRIPTION - 50) return trimDanglingEnd(cut.slice(0, comma).trim());
  const space = cut.trimEnd().lastIndexOf(' ');
  return trimDanglingEnd(space > 0 && space >= MAX_ROLE_DESCRIPTION - 40 ? cut.slice(0, space).trim() : cut.trimEnd());
}

/**
 * The headline as an ATS reads it: letters, digits, spaces and the punctuation titles are written with
 * (`| ( ) / , . & + # · -`); any other symbol (quotes, colons, brackets, @, %, arrows, emoji) becomes a space.
 */
export function sanitizeTitleForAts(title: string): string {
  return title
    .replace(/[^\p{L}\p{M}\p{N}\s|()/,.&+#·-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The printed headline: the resume's own, else its latest role's title, else "Professional". */
function headline(document: ResumeDocument): string {
  const own = document.title?.trim();
  if (own) return own;
  const latestRole = document.experience?.[0]?.title?.trim();
  return latestRole || 'Professional';
}

function strengthsToShow(strengths: unknown): Array<{ title: string; description: string }> {
  if (!Array.isArray(strengths)) return [];
  return strengths
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title.trim() : '',
      description: typeof item.description === 'string' ? item.description.trim() : '',
    }))
    .filter((item) => item.title || item.description);
}

function layoutOf(settings: unknown): TechnicalSkillsLayout {
  const value = (settings as { technicalSkillsLayout?: unknown } | undefined)?.technicalSkillsLayout;
  return (TECHNICAL_SKILLS_LAYOUTS as readonly unknown[]).includes(value) ? (value as TechnicalSkillsLayout) : 'categorized';
}

export type RenderData = Record<string, unknown> & {
  hardSkills: string[];
  skills: string[];
  softSkills: string[];
  strengths: Array<{ title: string; description: string }>;
  skillCategories: SkillGroup[];
  experience: Array<Record<string, unknown>>;
};

/** The render data of one resume (already read through its template: see `documentForTemplate`). */
export function prepareRenderData(document: ResumeDocument, library: SkillIndex): RenderData {
  const contact = (document.contact ?? {}) as Record<string, unknown>;
  const linkedinHref = externalUrl(contact.linkedin);
  const linkedinDisplay = externalUrlDisplay(contact.linkedin);
  const portfolio = typeof contact.portfolio === 'string' ? safeContactLink(contact.portfolio) : undefined;
  const base: Record<string, unknown> = {
    ...document,
    ...prepareExtraSectionData(document as unknown as Record<string, unknown>, {
      href: externalUrl,
      display: externalUrlDisplay,
    }),
    contact: {
      ...contact,
      ...(typeof contact.github === 'string' ? { github: safeContactLink(contact.github) } : {}),
      ...(portfolio !== undefined ? { portfolio } : {}),
      linkedin: linkedinHref,
      linkedinHref,
      linkedinDisplay,
      // TailorIT's addition: the ATS templates print `contact.website`, which is the portfolio link.
      website: portfolio ?? '',
    },
    companyName: '',
    role: '',
    title: sanitizeTitleForAts(headline(document)),
    softSkills: document.softSkills ?? [],
    strengths: document.strengths ?? [],
  };

  const settings = document.resumeSettings;
  const groups = skillGroupsFor(document, layoutOf(settings), library);
  const lines = skillLines(groups);
  const experience = Array.isArray(base.experience)
    ? (base.experience as Array<Record<string, unknown>>).map((role) => ({
        ...role,
        description: clampRoleDescription(typeof role.description === 'string' ? role.description : ''),
      }))
    : [];
  return {
    ...base,
    hardSkills: lines,
    softSkills: settings?.includeSoftSkills === true ? dedupeSkills(base.softSkills) : [],
    skills: lines,
    strengths: settings?.includeStrengths === true ? strengthsToShow(base.strengths) : [],
    skillCategories: groups,
    experience,
  };
}

/** The compile choices, read from the render data itself (so the markup kept and the data given always agree). */
export function compileChoicesOf(data: Record<string, unknown>): CompileChoices {
  const settings = data.resumeSettings as Record<string, unknown> | undefined;
  const { customKeys } = presenceOf(data);
  const order = cleanSectionOrder(data.sectionOrder, customKeys);
  return {
    layout: layoutOf(settings),
    softSkills: settings?.includeSoftSkills === true,
    strengths: settings?.includeStrengths === true,
    sectionOrder: order.length > 0 ? order : null,
    customKeys,
  };
}
