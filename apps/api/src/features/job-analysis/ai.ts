import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  MAX_JOB_CERTIFICATIONS,
  MAX_JOB_DOMAINS,
  MAX_JOB_SOFT_SKILLS,
  SALARY_PERIODS,
  WORK_ARRANGEMENTS,
  canonicalCertification,
  canonicalSoftSkill,
  containsTerm,
  domainOf,
  extractKeywords,
  facetText,
  findCertifications,
  findDomains,
  findSoftSkills,
  inferWorkArrangement,
  isJobCategoryId,
  maskFalseFriends,
  isJobSubcategoryId,
  softKey,
  softSkillScanner,
  spellingsOf,
  subcategoryParent,
  synonymKey,
  toAnnualUsd,
  yearsMentioned,
  type EmploymentType,
  type ExperienceLevel,
  type JobKeywords,
  type JobTerms,
  type KeywordGroup,
  type Leadership,
  type SalaryPeriod,
  type WorkArrangement,
} from '@tailorit/shared';
import { getSkillLibrary } from '../../core/skills-vocabulary';
import { inPostingCase, jobSkillLists, MAX_HIGH_KEYWORDS, MAX_LOW_KEYWORDS, type AnalysisDraft } from './deterministic';
import type { JobAnalysisOutput } from './prompt';
import { cleanItem, MAX_SECTION_ITEMS } from './sections';

// What the model answered, made safe to show: keywords the posting does not carry are dropped (a term counts when
// it or one of its synonyms is in the posting) and the rest are labelled as the posting writes them; a list left
// empty or short is made up from the deterministic keywords. A bullet is dropped when little of the posting's wording
// is in it, or it states a number or names a skill the posting does not (the deterministic section stands in when a
// whole section goes). Soft skills, certifications and industries count only by their canonical names and only when
// the rule-based reading finds them in the posting too (soft skills in its sections, when it has any). Every fact is
// checked against its vocabulary; years count only when the posting writes them as years ("5 days PTO" is not 5
// years), and the work arrangement only when the posting's own words, read loosely, say the same (else it is empty).

export interface AiFacts {
  workArrangement: WorkArrangement | null;
  employmentType: EmploymentType | null;
  salary: { min: number | null; max: number | null; currency: string; period: SalaryPeriod } | null;
  sponsorsH1b: boolean | null;
  requiresClearance: boolean | null;
  degree: string | null;
}

export interface FinishedAiAnalysis extends AnalysisDraft {
  facts: AiFacts;
}

const STOPWORDS = new Set(
  'a an and are as at be been being but by can for from has have in into is it its of on or our that the their this to we will with you your who what when where which while within across able ability strong excellent good great new other such using use work working experience experienced including include etc'.split(
    ' ',
  ),
);

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? [])
    .map((word) => word.replace(/[.-]+$/, ''))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/**
 * Numbers written one way: dashes as "-", "1 to 2" as "1-2", "5 or more" and "at least 5" as "5+", "40 percent" as
 * "40%", thousands without separators.
 */
function numberText(text: string): string {
  return text
    .toLowerCase()
    // Every hyphen and dash (Unicode "Pd": "–", "—", ...).
    .replace(/\p{Pd}/gu, '-')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/\b(?:at least|a minimum of|minimum of|minimum|min\.)\s+(\d+(?:\.\d+)?)(?![\d.]*\s*(?:-|to)\s*\d)/g, '$1+')
    .replace(/(\d)\s*(?:-|to)\s*(?=\d)/g, '$1-')
    .replace(/(\d)\s*(?:\+|or more\b|or above\b)/g, '$1+')
    .replace(/(\d)\s*(?:%|percent\b)/g, '$1%');
}

/** A number as `numberText` writes it: "5", "3.5", "1-2", "5+", "40%". */
const NUMBER = /(?<![\p{L}\p{N}])\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?[+%]?/gu;

export interface PostingNumbers {
  /** Every number as written ("5+", "1-2", "40%", "120000"). */
  written: ReadonlySet<string>;
  /** Every plain value in them ("5", "1", "2", "40", "120000"). */
  values: ReadonlySet<string>;
}

export function numbersOf(text: string): PostingNumbers {
  const written = new Set<string>();
  const values = new Set<string>();
  for (const [token] of numberText(text).matchAll(NUMBER)) {
    written.add(token);
    for (const value of token.replace(/[+%]$/, '').split('-')) values.add(value);
  }
  return { written, values };
}

/**
 * Whether every number in a bullet is the posting's: "5+", "1-2" and "40%" as the posting writes them, a plain number
 * anywhere in it. So "5+ years" never stands for a posting's "8+ years".
 */
export function numbersStated(bullet: string, posting: PostingNumbers): boolean {
  for (const [token] of numberText(bullet).matchAll(NUMBER)) {
    const plain = /^\d+(?:\.\d+)?$/.test(token);
    if (plain ? !posting.values.has(token) : !posting.written.has(token)) return false;
  }
  return true;
}

/** The skill library's terms a text names (as the deterministic keyword reading finds them). */
function namedTerms(text: string): KeywordGroup[] {
  const found = extractKeywords(text, getSkillLibrary().vocabulary, { maxHigh: 100, maxLow: 100 });
  return [...found.high, ...found.low];
}

/** What a bullet is checked against: the posting's words, numbers and text, and the terms the model made up. */
export interface PostingEvidence {
  /** The posting's content words, each also without a plural "s". */
  words: ReadonlySet<string>;
  numbers: PostingNumbers;
  /** The posting's title and text, false friends masked ("American Express" names no framework). */
  text: string;
  /** Keyword groups the model named that the posting does not carry. */
  invented: readonly KeywordGroup[];
}

export function postingEvidence(postingText: string, invented: readonly KeywordGroup[] = []): PostingEvidence {
  return {
    words: new Set(contentWords(postingText).flatMap((item) => [item, item.replace(/s$/, '')])),
    numbers: numbersOf(postingText),
    text: maskFalseFriends(postingText),
    invented,
  };
}

/**
 * Whether a bullet is the posting's own: most of its content words are in the posting (short bullets, usually a
 * skill name, pass this test), and, given the full evidence, every number it states and every skill it names (a
 * skill library term, or a keyword the model made up) is the posting's too. Given only the posting's words, the
 * word test alone.
 */
export function grounded(bullet: string, posting: PostingEvidence | ReadonlySet<string>): boolean {
  const evidence = 'words' in posting ? posting : null;
  const postingWords = evidence ? evidence.words : (posting as ReadonlySet<string>);
  const words = contentWords(bullet);
  if (words.length >= 3) {
    const found = words.filter((word) => postingWords.has(word) || postingWords.has(word.replace(/s$/, ''))).length;
    if (found / words.length < 0.4) return false;
  }
  if (!evidence) return true;
  if (!numbersStated(bullet, evidence.numbers)) return false;
  const masked = maskFalseFriends(bullet);
  if (evidence.invented.some((group) => spellingsOf(group).some((spelling) => containsTerm(masked, spelling)))) return false;
  return namedTerms(bullet).every((group) => spellingsOf(group).some((spelling) => containsTerm(evidence.text, spelling)));
}

function bullets(list: readonly string[], evidence: PostingEvidence): string[] {
  const out: string[] = [];
  for (const raw of list) {
    if (out.length >= MAX_SECTION_ITEMS) break;
    if (typeof raw !== 'string') continue;
    const item = cleanItem(raw);
    if (item.length < 3 || !grounded(item, evidence)) continue;
    if (!out.some((existing) => existing.toLowerCase() === item.toLowerCase())) out.push(item);
  }
  return out;
}

/** The model's keyword groups, tidied, kept only when the posting carries them, each once, capped. */
export function groundedKeywords(
  groups: ReadonlyArray<{ term: string; synonyms?: readonly string[] }>,
  postingText: string,
  seen: Set<string>,
  max: number,
): KeywordGroup[] {
  const out: KeywordGroup[] = [];
  for (const raw of groups) {
    if (out.length >= max) break;
    const group = tidyGroup(raw);
    if (!group) continue;
    const spellings = spellingsOf(group);
    const keys = spellings.map(synonymKey);
    if (keys.some((key) => seen.has(key))) continue;
    if (!spellings.some((spelling) => containsTerm(postingText, spelling))) continue;
    keys.forEach((key) => seen.add(key));
    out.push(group);
  }
  return out;
}

/** A keyword group with its term and synonyms trimmed and capped, synonyms once each; null without a term. */
function tidyGroup(raw: { term: string; synonyms?: readonly string[] }): KeywordGroup | null {
  const term = String(raw.term ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!term) return null;
  const synonyms = [
    ...new Set(
      (raw.synonyms ?? [])
        .map((synonym) => String(synonym ?? '').replace(/\s+/g, ' ').trim().slice(0, 120))
        .filter((synonym) => synonym && synonym.toLowerCase() !== term.toLowerCase()),
    ),
  ].slice(0, 20);
  return { term, synonyms };
}

/** The model's keyword groups that the posting does not carry under any of their spellings. */
export function inventedKeywords(
  groups: ReadonlyArray<{ term: string; synonyms?: readonly string[] }>,
  postingText: string,
): KeywordGroup[] {
  return groups
    .map(tidyGroup)
    .filter((group): group is KeywordGroup => group !== null)
    .filter((group) => !spellingsOf(group).some((spelling) => containsTerm(postingText, spelling)));
}

/** Fewer grounded keywords than this and the model's list is filled out with the deterministic ones. */
export const MIN_AI_KEYWORDS = 5;
/** How many keywords a short list is filled out to (Simplify's card shows a dozen or so). */
export const KEYWORD_FILL_TARGET = 12;

/**
 * The model's grounded keywords, made up from the deterministic ones when they are too few: none, and the
 * deterministic keywords stand as they are; fewer than MIN_AI_KEYWORDS, and the deterministic ones they lack (by
 * synonym key, high ones first, each keeping its priority) are added up to KEYWORD_FILL_TARGET. `seen` holds the
 * model's keys.
 */
export function withFallbackKeywords(
  model: JobKeywords,
  fallback: JobKeywords | undefined,
  postingText: string,
  seen: Set<string>,
): JobKeywords {
  const total = model.high.length + model.low.length;
  if (!fallback || total >= MIN_AI_KEYWORDS) return model;
  if (total === 0) {
    return {
      high: groundedKeywords(fallback.high, postingText, seen, MAX_HIGH_KEYWORDS),
      low: groundedKeywords(fallback.low, postingText, seen, MAX_LOW_KEYWORDS),
    };
  }
  const room = KEYWORD_FILL_TARGET - total;
  const high = groundedKeywords(fallback.high, postingText, seen, Math.min(room, MAX_HIGH_KEYWORDS - model.high.length));
  const low = groundedKeywords(fallback.low, postingText, seen, Math.min(room - high.length, MAX_LOW_KEYWORDS - model.low.length));
  return { high: [...model.high, ...high], low: [...model.low, ...low] };
}

const LEVEL_WORDS: Record<string, ExperienceLevel> = {
  entry: 'entry',
  entry_level: 'entry',
  new_grad: 'entry',
  intern: 'entry',
  internship: 'entry',
  junior: 'junior',
  mid: 'mid',
  mid_level: 'mid',
  intermediate: 'mid',
  senior: 'senior',
  expert: 'expert',
  staff: 'expert',
  principal: 'expert',
  lead: 'expert',
};

function word(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s/-]+/g, '_') : '';
}

function levelsOf(values: readonly string[]): ExperienceLevel[] {
  const found = new Set<ExperienceLevel>();
  for (const value of values) {
    const level = LEVEL_WORDS[word(value)];
    if (level) found.add(level);
  }
  return EXPERIENCE_LEVELS.filter((level) => found.has(level));
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = word(value);
  if (text === 'true' || text === 'yes') return true;
  if (text === 'false' || text === 'no') return false;
  return null;
}

function amount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^\$?\s*(\d+(?:\.\d+)?)\s*([kK])?$/.exec(value.replace(/[,\s]/g, ''));
  if (!match) return null;
  const number = Number(match[1]) * (match[2] ? 1000 : 1);
  return number > 0 ? number : null;
}

/** Whether a pay figure is written in the posting ("120000", "120,000", "120k", "$120K", "45.50"). */
export function amountStated(text: string, value: number): boolean {
  const forms = new Set<string>([String(value), value.toLocaleString('en-US')]);
  if (value >= 1000 && value % 1000 === 0) forms.add(`${value / 1000}k`);
  if (value >= 1000 && value % 100 === 0) forms.add(`${value / 1000}k`);
  if (!Number.isInteger(value)) forms.add(value.toFixed(2));
  const haystack = text.toLowerCase().replace(/\u00a0/g, ' ');
  return [...forms].some((form) => {
    const needle = form.toLowerCase();
    for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + 1)) {
      // A whole figure: "120,000" inside "1,120,000" or "120,0001" is not it.
      const before = haystack.slice(Math.max(0, index - 2), index);
      const after = haystack.slice(index + needle.length, index + needle.length + 2);
      if (/\d$|\d[,.]$/.test(before) || /^\d|^[,.]\d/.test(after)) continue;
      return true;
    }
    return false;
  });
}

function salaryOf(output: JobAnalysisOutput['salary'], postingText: string): AiFacts['salary'] {
  if (!output) return null;
  let min = amount(output.min);
  let max = amount(output.max);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  if (min === null && max === null) return null;
  // A figure the posting never wrote is a guess, and a salary is only ever what the posting states.
  if (!((min !== null && amountStated(postingText, min)) || (max !== null && amountStated(postingText, max)))) return null;
  const currency = typeof output.currency === 'string' && /^[A-Za-z]{3}$/.test(output.currency.trim()) ? output.currency.trim().toUpperCase() : 'USD';
  const periodWord = word(output.period);
  const period = (SALARY_PERIODS as readonly string[]).includes(periodWord)
    ? (periodWord as SalaryPeriod)
    : /hour/.test(periodWord)
      ? 'hour'
      : 'year';
  if (!toAnnualUsd(min, max, currency, period)) return null;
  return { min, max, currency, period };
}

const ARRANGEMENT_WORDS: Record<string, WorkArrangement> = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'onsite',
  on_site: 'onsite',
  in_person: 'onsite',
  in_office: 'onsite',
};

const EMPLOYMENT_WORDS: Record<string, EmploymentType> = {
  full_time: 'full_time',
  fulltime: 'full_time',
  part_time: 'part_time',
  parttime: 'part_time',
  contract: 'contract',
  contractor: 'contract',
  temporary: 'contract',
  internship: 'internship',
  intern: 'internship',
};

/** A posting as the work-arrangement check reads it. */
export interface ArrangementPosting {
  title: string;
  /** The job's location text ("Remote in USA; Austin, TX, USA"). */
  locations?: string | null;
  /** The description's text. */
  text: string;
}

/** How far into the description the loose reading looks: as far as ingest read it before it read descriptions strictly. */
const ARRANGEMENT_TEXT = 6000;

/**
 * The work arrangement a posting's own words give when read loosely (any "remote", "hybrid", "on-site" counts): the
 * location text first, then the title and the description.
 */
export function looseArrangement(posting: ArrangementPosting): WorkArrangement | null {
  return inferWorkArrangement(`${posting.title}\n${posting.text.slice(0, ARRANGEMENT_TEXT)}`, posting.locations ?? null);
}

/**
 * An AI work arrangement, kept only when the posting's loose reading says the same; null otherwise. The strict
 * reading leaves an arrangement empty when unsure, so the model's answer is the one that fills it: one the posting's
 * words do not back ("remote" for a posting that never says remote) is a guess, and a guess stays empty.
 */
export function checkedArrangement(value: WorkArrangement | null, posting: ArrangementPosting): WorkArrangement | null {
  return value !== null && looseArrangement(posting) === value ? value : null;
}

function strings(list: readonly unknown[]): string[] {
  return list
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, 120))
    .filter(Boolean);
}

/**
 * The model's soft skills that the posting asks for: each read as a listed soft skill (a phrase the list does not
 * have, "excellent written communication skills", is read for the ones in it), kept by its canonical name only when
 * the rule-based reading of `facetSource` (the posting's sections, else its text) finds that skill too. Skills that are
 * also hard skills stay keywords. Each once, at most MAX_JOB_SOFT_SKILLS, in the model's order.
 */
export function groundedSoftSkills(raw: readonly unknown[], facetSource: string): string[] {
  const lists = jobSkillLists();
  const scanner = softSkillScanner(lists.soft, lists.hard);
  const inPosting = new Set(findSoftSkills(facetSource, scanner, { max: 1000 }).map(softKey));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const phrase of strings(raw)) {
    const canonical = canonicalSoftSkill(phrase, scanner);
    for (const name of canonical ? [canonical] : findSoftSkills(phrase, scanner, { max: 3 })) {
      const key = softKey(name);
      if (seen.has(key) || !inPosting.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out.slice(0, MAX_JOB_SOFT_SKILLS);
}

/** The model's certifications by their canonical names, kept when the posting names them; each once, capped. */
export function groundedCertifications(raw: readonly unknown[], postingText: string): string[] {
  const inPosting = new Set(findCertifications(postingText, { max: 100 }));
  const out: string[] = [];
  for (const phrase of strings(raw)) {
    const name = canonicalCertification(phrase);
    if (name && inPosting.has(name) && !out.includes(name)) out.push(name);
  }
  return out.slice(0, MAX_JOB_CERTIFICATIONS);
}

/** The model's industries as INDUSTRIES ids, kept when the posting's words name that industry; each once, capped. */
export function groundedDomains(raw: readonly unknown[], postingText: string): string[] {
  const inPosting = new Set<string>(findDomains(postingText, 100));
  const out: string[] = [];
  for (const phrase of strings(raw)) {
    const id = domainOf(phrase);
    if (id && inPosting.has(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, MAX_JOB_DOMAINS);
}

/**
 * A number of years the model gave, kept only when the posting writes it as years ("5+ years", the 3 or the 5 of
 * "3-5 years of experience"); `written` holds those numbers (`yearsMentioned`). Null otherwise.
 */
export function writtenYears(value: unknown, written: ReadonlySet<number>): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN;
  if (!Number.isFinite(number)) return null;
  const years = Math.round(number);
  return years >= 0 && years <= 30 && written.has(years) ? years : null;
}

/** What stands in where the model's answer falls short: the deterministic analysis of the same posting. */
export interface AnalysisFallback extends Pick<AnalysisDraft, 'requirements' | 'responsibilities' | 'desired'> {
  /** Its keywords: they replace an empty keyword list and fill out a short one. */
  keywords?: JobKeywords;
  /** Its years: they stand in for years the model gave that the posting does not write (or none at all). */
  minYears?: number | null;
  requiredYears?: number | null;
}

/**
 * The model's answer as the analysis TailorIT stores. `posting` is what the model read (the title, the location text,
 * then the description); `fallback` supplies a section the model's answer leaves empty after grounding, the keywords a
 * keyword list left empty or short needs, the sections its soft skills are checked against, and the years.
 */
export function finishAiAnalysis(
  output: JobAnalysisOutput,
  posting: { title: string; text: string; locations?: string | null },
  fallback: AnalysisFallback,
): FinishedAiAnalysis {
  const postingText = `${posting.title}\n${posting.text}`;
  const seen = new Set<string>();
  // "Express" in "American Express" is not the framework: the matcher masks such phrases, and so does grounding.
  const groundText = maskFalseFriends(postingText);
  const model: JobKeywords = {
    high: groundedKeywords(output.keywords.high, groundText, seen, MAX_HIGH_KEYWORDS),
    low: groundedKeywords(output.keywords.low, groundText, seen, MAX_LOW_KEYWORDS),
  };
  const keywords = inPostingCase(withFallbackKeywords(model, fallback.keywords, groundText, seen), postingText);

  const evidence = postingEvidence(postingText, inventedKeywords([...output.keywords.high, ...output.keywords.low], groundText));
  const requirements = bullets(output.summary.requirements, evidence);
  const responsibilities = bullets(output.summary.responsibilities, evidence);
  const desired = bullets(output.summary.desiredQualifications, evidence);

  const categoryId = output.category?.id && isJobCategoryId(output.category.id) ? output.category.id : null;
  const subcategoryIds = categoryId
    ? [...new Set(output.category?.subcategoryIds ?? [])].filter((id) => isJobSubcategoryId(id) && subcategoryParent(id) === categoryId)
    : [];
  const leadershipWord = word(output.leadership);
  const leadership: Leadership | null = leadershipWord === 'manager' ? 'manager' : leadershipWord === 'ic' ? 'ic' : null;
  const written = new Set(yearsMentioned(postingText));
  const minYears = writtenYears(output.minYears, written) ?? fallback.minYears ?? null;
  const requiredYears = writtenYears(output.requiredYears, written) ?? fallback.requiredYears ?? null;
  const arrangement = ARRANGEMENT_WORDS[word(output.workArrangement)] ?? null;
  const employment = EMPLOYMENT_WORDS[word(output.employmentType)] ?? null;
  const degree = typeof output.degree === 'string' && output.degree.trim() ? output.degree.trim().slice(0, 60) : null;

  // Soft skills are read where the deterministic reading reads them: the posting's sections, when it has any.
  const softSkills = output.softSkills === undefined ? null : groundedSoftSkills(output.softSkills, facetText({ text: posting.text, sections: fallback }));
  const terms: JobTerms | null = output.terms
    ? {
        certifications: groundedCertifications(output.terms.certifications ?? [], groundText),
        domains: groundedDomains(output.terms.domains ?? [], groundText),
      }
    : null;

  const facts: AiFacts = {
    workArrangement: checkedArrangement((WORK_ARRANGEMENTS as readonly string[]).includes(arrangement ?? '') ? arrangement : null, posting),
    employmentType: (EMPLOYMENT_TYPES as readonly string[]).includes(employment ?? '') ? employment : null,
    salary: salaryOf(output.salary, posting.text),
    sponsorsH1b: bool(output.sponsorsH1b),
    requiresClearance: bool(output.requiresClearance),
    degree,
  };
  return {
    requirements: requirements.length ? requirements : fallback.requirements,
    responsibilities: responsibilities.length ? responsibilities : fallback.responsibilities,
    desired: desired.length ? desired : fallback.desired,
    keywords,
    experienceLevels: levelsOf(output.experienceLevels),
    leadership,
    minYears,
    categoryId,
    subcategoryIds,
    extras: { ...facts },
    softSkills,
    terms,
    requiredYears,
    facts,
  };
}
