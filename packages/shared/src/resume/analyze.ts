import { tidyText } from '../format/text';
import { inferStatedYears } from '../jobs/infer';
import { canonicalCertification, certificationKey, findCertifications, findDomains } from '../match/catalogue';
import { prepareEvidence, type PreparedEvidence } from '../match/evidence';
import type { SkillLists } from '../match/facets';
import type { FitResumeInput } from '../match/fit';
import { extractKeywords } from '../match/keywords';
import type { KeywordGroup } from '../match/schemas';
import { canonicalSoftSkill, findSoftSkills, softKey, softSkillScanner } from '../match/soft';
import { synonymKey, synonymsOf } from '../match/terms';
import type { ResumeAnalysisData } from './analysis';
import { resumeEvidenceText } from './display';
import type { ResumeDocument } from './document';
import {
  experienceSections,
  findDateRanges,
  isRoleNoun,
  rangesOfEntries,
  rangesOfText,
  resumeHeadingOf,
  yearsOf,
} from './years';

// The quick, rule-based reading of a resume (resume_analyses 'deterministic'): main (hard) skills, soft skills,
// keywords (roles held, the headline first; certifications; industries), the roles' dates and a stated total of
// years, and the person's name. It only reads: an upload's text is never changed. Claude's reading of an upload
// (merged over this one by `mergeResumeAnalyses`) is grounded in the same text by the API.

export const MAX_ANALYSIS_HARD_SKILLS = 60;
export const MAX_ANALYSIS_SOFT_SKILLS = 40;
export const MAX_ANALYSIS_ROLES = 8;
export const MAX_ANALYSIS_CERTIFICATIONS = 10;
export const MAX_ANALYSIS_DOMAINS = 5;
/** An upload whose text is shorter than this could not be read (`readableForImport`'s rule): it ranks last. */
export const MIN_READABLE_RESUME_TEXT = 50;

const MAX_SKILL_LENGTH = 100;
const MAX_TERM_LENGTH = 120;
/** How much of an upload's opening the stated total of years is read from. */
const OPENING_TEXT = 2000;

/** Adds strings in order, once each by `key`, up to `max`. */
function collector(key: (value: string) => string, max: number, maxLength: number) {
  const values: string[] = [];
  const seen = new Set<string>();
  return {
    values,
    add(raw: string | null | undefined) {
      const value = tidyText(raw);
      if (!value || value.length > maxLength || values.length >= max) return;
      const k = key(value);
      if (!k || seen.has(k)) return;
      seen.add(k);
      values.push(value);
    },
    has(raw: string) {
      return seen.has(key(tidyText(raw)));
    },
  };
}

// ------------------------------------------------------------------------------------------------ hard skills

const LIBRARY = new WeakMap<readonly string[], Map<string, string>>();

/**
 * Synonym key -> the skill library's own spelling: the synonym group's canonical spelling when the library lists it
 * ("PostgreSQL" over "Postgres"), else the first entry with that key.
 */
function libraryOf(hard: readonly string[]): Map<string, string> {
  let library = LIBRARY.get(hard);
  if (!library) {
    library = new Map();
    const canonical = new Set<string>();
    for (const raw of hard) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const term = raw.trim().replace(/\s+/g, ' ');
      const key = synonymKey(term);
      const isCanonical = synonymsOf(term)[0] === term;
      if (!library.has(key) || (isCanonical && !canonical.has(key))) library.set(key, term);
      if (isCanonical) canonical.add(key);
    }
    LIBRARY.set(hard, library);
  }
  return library;
}

/** A found keyword group in the library's spelling ("Postgres" in the text is the library's "PostgreSQL"). */
function libraryLabel(group: KeywordGroup, library: ReadonlyMap<string, string>): string {
  for (const spelling of [group.term, ...group.synonyms]) {
    const label = library.get(synonymKey(spelling));
    if (label) return label;
  }
  return group.term;
}

/** Vocabulary hits over a text, most relevant first (named twice or more, then in order), in library spelling. */
function vocabularySkills(text: string, lists: SkillLists): string[] {
  const library = libraryOf(lists.hard);
  const found = extractKeywords(text, lists.hard, {
    maxHigh: MAX_ANALYSIS_HARD_SKILLS,
    maxLow: MAX_ANALYSIS_HARD_SKILLS,
  });
  return [...found.high, ...found.low].map((group) => libraryLabel(group, library));
}

// ------------------------------------------------------------------------------------------------ roles

/** Words a bullet or a sentence starts with, never a job title ("Led ...", "Responsible for ..."). */
const VERBS: ReadonlySet<string> = new Set([
  'achieved', 'analyzed', 'architected', 'assisted', 'automated', 'built', 'collaborated', 'conducted', 'consulted',
  'contributed', 'coordinated', 'created', 'defined', 'delivered', 'deployed', 'designed', 'developed', 'directed',
  'drove', 'engineered', 'established', 'executed', 'facilitated', 'generated', 'grew', 'guided', 'handled', 'headed',
  'helped', 'hired', 'identified', 'implemented', 'improved', 'increased', 'initiated', 'integrated', 'introduced',
  'invented', 'launched', 'led', 'maintained', 'managed', 'mentored', 'migrated', 'modernized', 'monitored',
  'negotiated', 'optimized', 'organized', 'oversaw', 'owned', 'partnered', 'performed', 'pioneered', 'planned',
  'prepared', 'presented', 'produced', 'prototyped', 'provided', 'ran', 'rebuilt', 'redesigned', 'reduced',
  'refactored', 'researched', 'resolved', 'responsible', 'reviewed', 'rolled', 'saved', 'scaled', 'secured', 'served',
  'set', 'shipped', 'simplified', 'spearheaded', 'standardized', 'streamlined', 'supported', 'taught', 'tested',
  'trained', 'transformed', 'translated', 'unified', 'upgraded', 'used', 'utilized', 'won', 'worked', 'wrote',
  'building', 'leading', 'managing', 'developing', 'designing', 'working', 'creating', 'driving', 'helping',
]);
const BULLET_LINE = /^\s*(?:[•▪●◦‣·*>–—-]|\d{1,2}[.)]\s)/;
const TRAILING_LEVEL = /^(?:I{1,3}|IV|V|[1-5]|Sr\.?|Jr\.?)$/;
const HEAD_OF = /^(?:head|director|vp|vice\s+president|chief\s+\p{L}+\s+officer)\s+of\b/iu;
const SEGMENT_SPLIT = /\s+(?:at|@)\s+|\s*[|•·,(]\s*|\s+[-–—]\s+|\t|\s{2,}/i;

/** A title segment ("Senior Software Engineer", "Head of Product"), or null. */
function roleSegment(segment: string): string | null {
  const text = segment.replace(/\s+/g, ' ').replace(/^[^\p{L}]+|[^\p{L}.)]+$/gu, '').replace(/\)$/, '').trim();
  if (!text) return null;
  const words = text.split(' ');
  if (words.length > 8) return null;
  if (VERBS.has(words[0]!.toLowerCase().replace(/[^a-z]/g, ''))) return null;
  if (/\d/.test(text.replace(/\s(?:[1-5])$/, ''))) return null;
  if (resumeHeadingOf(text)) return null;
  let head = words.length - 1;
  while (head > 0 && TRAILING_LEVEL.test(words[head]!)) head -= 1;
  if (!isRoleNoun(words[head]!.replace(/[^\p{L}'’-]/gu, '')) && !HEAD_OF.test(text)) return null;
  return text.slice(0, MAX_TERM_LENGTH).trim();
}

/** The role a line names: its first title segment, dates and separators cut out; null for bullets and prose. */
function roleOfLine(raw: string): string | null {
  if (!raw.trim() || raw.length > 200 || BULLET_LINE.test(raw)) return null;
  if (/@|https?:|www\.|\.com\b/i.test(raw)) return null;
  let line = raw;
  for (const found of findDateRanges(raw).reverse()) line = `${line.slice(0, found.start)} | ${line.slice(found.end)}`;
  for (const segment of line.split(SEGMENT_SPLIT)) {
    const role = roleSegment(segment);
    if (role) return role;
  }
  return null;
}

function addRole(roles: string[], role: string | null) {
  if (!role || roles.length >= MAX_ANALYSIS_ROLES) return;
  if (!roles.some((known) => known.toLowerCase() === role.toLowerCase())) roles.push(role);
}

/**
 * An upload's roles: the headline (a title among the first six non-empty lines, before any heading), then the title
 * next to each date range of the experience section: on the range's own line, else one or two lines before it, else
 * the line after it.
 */
function uploadRoles(lines: readonly string[], personName: string | null): string[] {
  const roles: string[] = [];
  let looked = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (resumeHeadingOf(line) || looked >= 6) break;
    looked += 1;
    if (personName && tidyText(line) === personName) continue;
    const role = roleOfLine(line);
    if (role) {
      addRole(roles, role);
      break;
    }
  }
  const spans = experienceSections(lines) ?? [[0, lines.length] as [number, number]];
  for (const [from, to] of spans) {
    const block = lines.slice(from, to);
    for (const found of findDateRanges(block.join('\n'))) {
      if (roles.length >= MAX_ANALYSIS_ROLES) return roles;
      const at = found.startLine;
      // Title and dates on one line; or title, company, dates on three ("Software Engineer / Acme / 2016 - 2019").
      const role = [at, at - 1, at - 2, at + 1]
        .filter((index) => index >= 0 && index < block.length)
        .map((index) => roleOfLine(block[index]!))
        .find((candidate) => candidate !== null);
      addRole(roles, role ?? null);
    }
  }
  return roles;
}

// ------------------------------------------------------------------------------------------------ the name

const BANNER = /^(?:resume|résumé|curriculum\s+vitae|cv)$/i;
const NAME_WORD = /^(?:\p{Lu}[\p{L}\p{M}]*(?:['’-][\p{L}\p{M}]+)*\.?|\p{Lu}\.)$/u;
const NAME_PARTICLES: ReadonlySet<string> = new Set([
  'van', 'von', 'de', 'der', 'den', 'da', 'di', 'del', 'della', 'la', 'le', 'du', 'dos', 'das', 'bin', 'al', 'el', 'y',
]);
const TRAILING_CREDENTIALS = /(?:,\s*(?:[A-Z]{2,6}|Ph\.?\s?D\.?|M\.?D\.?|Jr\.?|Sr\.?|II|III|IV))+\.?$/;

function titleCase(word: string): string {
  return word
    .toLowerCase()
    .replace(/(^|['’-])(\p{Ll})/gu, (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`);
}

/**
 * The person's name an upload opens with, or null when unsure: its first non-empty line (a "Resume" or "CV" banner
 * skipped), up to a separator, credentials (", PMP") dropped, read as two to four capitalised words with no digits,
 * no role and no heading. A name in capitals is written in title case ("JANE DOE" -> "Jane Doe").
 */
function uploadPersonName(lines: readonly string[]): string | null {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (BANNER.test(line)) continue;
    const first = (line.split(/\s*[|•·]\s*|\t|\s{3,}/)[0] ?? '').replace(TRAILING_CREDENTIALS, '').trim();
    return personNameOf(first);
  }
  return null;
}

function personNameOf(text: string): string | null {
  if (!text || text.length > 60 || /[\d@:/\\]|https?|www\./i.test(text) || resumeHeadingOf(text)) return null;
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 6) return null;
  let named = 0;
  for (const word of words) {
    if (NAME_PARTICLES.has(word) && word === word.toLowerCase()) continue;
    if (!NAME_WORD.test(word) || isRoleNoun(word.replace(/\.$/, ''))) return null;
    named += 1;
  }
  // Two to four names; particles ("van der") do not count.
  if (named < 2 || named > 4) return null;
  const capitals = text === text.toUpperCase();
  const written = words.map((word) => (capitals && !/^\p{Lu}\.$/u.test(word) ? titleCase(word) : word));
  return written.join(' ').slice(0, MAX_TERM_LENGTH).trim();
}

// ------------------------------------------------------------------------------------------------ readings

function roundYears(value: number): number {
  return Math.round(Math.min(80, Math.max(0, value)) * 10) / 10;
}

function strings(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * A built resume's reading. Hard skills: the declared ones in document order (Technical Skills, then each role's
 * skills used), in the library's spelling when it has them, then the library's skills its text names; a skill the
 * person filed as soft shows only as soft. Soft skills: the declared ones (canonical names when listed), then those its
 * text names, never one the person filed as hard. Roles: the headline, then each role's title. Years: the editor's
 * field when filled, else the roles' dates (an empty end on the most recent role is Present).
 */
export function analyzeBuiltResume(document: ResumeDocument, lists: SkillLists): ResumeAnalysisData {
  const evidenceText = resumeEvidenceText(document);
  const evidence = prepareEvidence(evidenceText);
  const experience = Array.isArray(document.experience) ? document.experience : [];
  const library = libraryOf(lists.hard);
  const scanner = softSkillScanner(lists.soft, lists.hard);

  const declaredHard = [...strings(document.skills), ...experience.flatMap((entry) => strings(entry?.skills))];
  const declaredSoft = strings(document.softSkills);
  const declaredSoftKeys = new Set(declaredSoft.map((skill) => softKey(skill)));

  const hard = collector(synonymKey, MAX_ANALYSIS_HARD_SKILLS, MAX_SKILL_LENGTH);
  for (const skill of declaredHard) hard.add(library.get(synonymKey(tidyText(skill))) ?? skill);
  for (const skill of vocabularySkills(evidenceText, lists)) {
    if (!declaredSoftKeys.has(softKey(skill))) hard.add(skill);
  }

  const soft = collector(softKey, MAX_ANALYSIS_SOFT_SKILLS, MAX_SKILL_LENGTH);
  for (const skill of declaredSoft) soft.add(canonicalSoftSkill(skill, scanner) ?? skill);
  for (const skill of findSoftSkills(evidence, scanner, { max: MAX_ANALYSIS_SOFT_SKILLS, exclude: declaredHard })) {
    soft.add(skill);
  }

  const roles: string[] = [];
  const headline = tidyText(document.title);
  if (headline && headline !== 'Professional') addRole(roles, headline.slice(0, MAX_TERM_LENGTH).trim());
  for (const entry of experience) addRole(roles, tidyText(entry?.title).slice(0, MAX_TERM_LENGTH).trim() || null);

  const certifications = collector(certificationKey, MAX_ANALYSIS_CERTIFICATIONS, MAX_TERM_LENGTH);
  for (const entry of Array.isArray(document.certifications) ? document.certifications : []) {
    const name = tidyText(entry?.name);
    if (name) certifications.add(canonicalCertification(name) ?? name);
  }
  for (const name of findCertifications(evidence, { max: MAX_ANALYSIS_CERTIFICATIONS })) certifications.add(name);

  const companies = experience.map((entry) => tidyText(entry?.company)).filter(Boolean);
  const domains = findDomains([evidenceText, ...companies].join('\n'), MAX_ANALYSIS_DOMAINS);

  const typed = document.totalYearsExperience;
  const field = typeof typed === 'number' && Number.isFinite(typed) && typed >= 0 ? roundYears(typed) : null;
  const opening = [document.title, document.summary].filter(Boolean).join('\n');
  const stated = field === null ? inferStatedYears(opening) : null;

  return {
    hardSkills: hard.values,
    softSkills: soft.values,
    keywords: { roles, certifications: certifications.values, domains },
    experience: rangesOfEntries(experience).map(([start, end]) => [start, end] as [number, number | null]),
    yearsStated: field ?? (stated !== null ? roundYears(stated) : null),
    yearsStatedBasis: field !== null ? 'field' : stated !== null ? 'stated' : null,
    personName: tidyText(document.name).slice(0, MAX_TERM_LENGTH).trim() || null,
  };
}

/** The text an upload's opening runs to: everything before its first Experience heading, at most 2,000 characters. */
function openingOf(lines: readonly string[]): string {
  const first = experienceSections(lines)?.[0]?.[0];
  const opening = first !== undefined ? lines.slice(0, Math.max(0, first - 1)).join('\n') : lines.join('\n');
  return opening.slice(0, OPENING_TEXT);
}

/**
 * An uploaded resume's reading, from its extracted text only (the file is never changed). Hard skills: the library's
 * skills it names; soft skills: those it names; roles: the headline and the title by each date range of its
 * Experience section; years: the work ranges (education left out), and the largest total its opening states.
 */
export function analyzeResumeText(text: string, lists: SkillLists): ResumeAnalysisData {
  const source = typeof text === 'string' ? text : '';
  const lines = source.split(/\r?\n/);
  const evidence: PreparedEvidence = prepareEvidence(source);
  const scanner = softSkillScanner(lists.soft, lists.hard);

  const hard = collector(synonymKey, MAX_ANALYSIS_HARD_SKILLS, MAX_SKILL_LENGTH);
  for (const skill of vocabularySkills(source, lists)) hard.add(skill);
  const soft = collector(softKey, MAX_ANALYSIS_SOFT_SKILLS, MAX_SKILL_LENGTH);
  for (const skill of findSoftSkills(evidence, scanner, { max: MAX_ANALYSIS_SOFT_SKILLS })) soft.add(skill);
  const certifications = collector(certificationKey, MAX_ANALYSIS_CERTIFICATIONS, MAX_TERM_LENGTH);
  for (const name of findCertifications(evidence, { max: MAX_ANALYSIS_CERTIFICATIONS })) certifications.add(name);

  const personName = uploadPersonName(lines);
  const stated = inferStatedYears(openingOf(lines));
  return {
    hardSkills: hard.values,
    softSkills: soft.values,
    keywords: {
      roles: uploadRoles(lines, personName),
      certifications: certifications.values,
      domains: findDomains(source, MAX_ANALYSIS_DOMAINS),
    },
    experience: rangesOfText(source).map(([start, end]) => [start, end] as [number, number | null]),
    yearsStated: stated !== null ? roundYears(stated) : null,
    yearsStatedBasis: stated !== null ? 'stated' : null,
    personName,
  };
}

/** What a reading is worked out from: built resumes their document, uploads their extracted text. */
export type ResumeAnalysisSubject =
  | { kind: 'built'; document: ResumeDocument }
  | { kind: 'uploaded'; text: string | null | undefined };

/**
 * The input a reading's content hash is taken of: everything the reading uses and nothing else, so a rename (the
 * custom title, which is not part of a resume's content) changes nothing. Built: the evidence text, the name, each
 * role's company and dates, and the years field. Uploads: the extracted text.
 */
export function resumeAnalysisInput(subject: ResumeAnalysisSubject): string {
  if (subject.kind === 'uploaded') return typeof subject.text === 'string' ? subject.text : '';
  const document = subject.document;
  const experience = Array.isArray(document.experience) ? document.experience : [];
  return JSON.stringify([
    'built',
    resumeEvidenceText(document),
    tidyText(document.name),
    experience.map((entry) => [tidyText(entry?.company), tidyText(entry?.startDate), tidyText(entry?.endDate)]),
    typeof document.totalYearsExperience === 'number' ? document.totalYearsExperience : null,
  ]);
}

function union(
  first: readonly string[],
  second: readonly string[],
  key: (value: string) => string,
  max: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...first, ...second]) {
    const k = key(value);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Claude's reading of an upload over the rules' one: skills, certifications and industries joined (Claude's first),
 * Claude's roles and dates when it found any, the larger stated total (the editor's field always wins), and its name
 * when it gave one. Without an AI reading, the rules' reading as it is.
 */
export function mergeResumeAnalyses(
  deterministic: ResumeAnalysisData,
  ai: ResumeAnalysisData | null | undefined,
): ResumeAnalysisData {
  if (!ai) return deterministic;
  const rules = deterministic.keywords;
  let yearsStated = deterministic.yearsStated;
  let yearsStatedBasis = deterministic.yearsStatedBasis;
  const aiLarger = ai.yearsStated !== null && (yearsStated === null || ai.yearsStated > yearsStated);
  if (deterministic.yearsStatedBasis !== 'field' && aiLarger) {
    yearsStated = ai.yearsStated;
    yearsStatedBasis = 'stated';
  }
  return {
    hardSkills: union(ai.hardSkills, deterministic.hardSkills, synonymKey, MAX_ANALYSIS_HARD_SKILLS),
    softSkills: union(ai.softSkills, deterministic.softSkills, softKey, MAX_ANALYSIS_SOFT_SKILLS),
    keywords: {
      roles: ai.keywords.roles.length > 0 ? ai.keywords.roles.slice(0, MAX_ANALYSIS_ROLES) : rules.roles,
      certifications: union(
        ai.keywords.certifications,
        rules.certifications,
        certificationKey,
        MAX_ANALYSIS_CERTIFICATIONS,
      ),
      domains: union(ai.keywords.domains, rules.domains, (id) => id, MAX_ANALYSIS_DOMAINS),
    },
    experience: ai.experience.length > 0 ? ai.experience : deterministic.experience,
    yearsStated,
    yearsStatedBasis,
    personName: ai.personName ?? deterministic.personName,
  };
}

/** A resume as the fit scorer reads it: its row, the Jobs card's evidence text, and its (merged) reading today. */
export function fitResumeInput(
  resume: { id: string; isDefault: boolean; editedAt: string | null; evidenceText: string },
  analysis: ResumeAnalysisData,
  now: Date,
): FitResumeInput {
  const { years, basis } = yearsOf(analysis, now);
  const evidenceText = typeof resume.evidenceText === 'string' ? resume.evidenceText : '';
  return {
    id: resume.id,
    isDefault: resume.isDefault,
    editedAt: resume.editedAt,
    evidenceText,
    readable: evidenceText.trim().length >= MIN_READABLE_RESUME_TEXT,
    hardSkills: analysis.hardSkills,
    softSkills: analysis.softSkills,
    roles: analysis.keywords.roles,
    certifications: analysis.keywords.certifications,
    domains: analysis.keywords.domains,
    years,
    yearsBasis: basis,
  };
}
