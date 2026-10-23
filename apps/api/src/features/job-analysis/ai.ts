import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  SALARY_PERIODS,
  WORK_ARRANGEMENTS,
  containsTerm,
  isJobCategoryId,
  maskFalseFriends,
  isJobSubcategoryId,
  spellingsOf,
  subcategoryParent,
  synonymKey,
  toAnnualUsd,
  type EmploymentType,
  type ExperienceLevel,
  type KeywordGroup,
  type Leadership,
  type SalaryPeriod,
  type WorkArrangement,
} from '@tailorit/shared';
import { MAX_HIGH_KEYWORDS, MAX_LOW_KEYWORDS, type AnalysisDraft } from './deterministic';
import type { JobAnalysisOutput } from './prompt';
import { cleanItem, MAX_SECTION_ITEMS } from './sections';

// What the model answered, made safe to show: keywords the posting does not carry are dropped (a term counts when
// it or one of its synonyms is in the posting), bullets with little of the posting's wording in them are dropped
// (the deterministic section stands in when a whole section goes), and every fact is checked against its vocabulary.

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
 * Whether a bullet is the posting's own (most of its content words are in the posting). Short bullets pass: they
 * are usually a skill name the keyword check already covers.
 */
export function grounded(bullet: string, postingWords: ReadonlySet<string>): boolean {
  const words = contentWords(bullet);
  if (words.length < 3) return true;
  const found = words.filter((word) => postingWords.has(word) || postingWords.has(word.replace(/s$/, ''))).length;
  return found / words.length >= 0.4;
}

function bullets(list: readonly string[], postingWords: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const raw of list) {
    if (out.length >= MAX_SECTION_ITEMS) break;
    if (typeof raw !== 'string') continue;
    const item = cleanItem(raw);
    if (item.length < 3 || !grounded(item, postingWords)) continue;
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
    const term = String(raw.term ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!term) continue;
    const synonyms = [
      ...new Set(
        (raw.synonyms ?? [])
          .map((synonym) => String(synonym ?? '').replace(/\s+/g, ' ').trim().slice(0, 120))
          .filter((synonym) => synonym && synonym.toLowerCase() !== term.toLowerCase()),
      ),
    ].slice(0, 20);
    const group: KeywordGroup = { term, synonyms };
    const spellings = spellingsOf(group);
    const keys = spellings.map(synonymKey);
    if (keys.some((key) => seen.has(key))) continue;
    if (!spellings.some((spelling) => containsTerm(postingText, spelling))) continue;
    keys.forEach((key) => seen.add(key));
    out.push(group);
  }
  return out;
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

/**
 * The model's answer as the analysis TailorIT stores. `posting` is the text the model read (title, then the
 * description); `fallback` supplies a section the model's answer leaves empty after grounding.
 */
export function finishAiAnalysis(
  output: JobAnalysisOutput,
  posting: { title: string; text: string },
  fallback: Pick<AnalysisDraft, 'requirements' | 'responsibilities' | 'desired'>,
): FinishedAiAnalysis {
  const postingText = `${posting.title}\n${posting.text}`;
  const postingWords = new Set(contentWords(postingText).flatMap((item) => [item, item.replace(/s$/, '')]));
  const seen = new Set<string>();
  // "Express" in "American Express" is not the framework: the matcher masks such phrases, and so does grounding.
  const groundText = maskFalseFriends(postingText);
  const high = groundedKeywords(output.keywords.high, groundText, seen, MAX_HIGH_KEYWORDS);
  const low = groundedKeywords(output.keywords.low, groundText, seen, MAX_LOW_KEYWORDS);

  const requirements = bullets(output.summary.requirements, postingWords);
  const responsibilities = bullets(output.summary.responsibilities, postingWords);
  const desired = bullets(output.summary.desiredQualifications, postingWords);

  const categoryId = output.category?.id && isJobCategoryId(output.category.id) ? output.category.id : null;
  const subcategoryIds = categoryId
    ? [...new Set(output.category?.subcategoryIds ?? [])].filter((id) => isJobSubcategoryId(id) && subcategoryParent(id) === categoryId)
    : [];
  const leadershipWord = word(output.leadership);
  const leadership: Leadership | null = leadershipWord === 'manager' ? 'manager' : leadershipWord === 'ic' ? 'ic' : null;
  const years = typeof output.minYears === 'number' ? output.minYears : typeof output.minYears === 'string' ? Number(output.minYears) : NaN;
  const minYears = Number.isFinite(years) && years >= 0 && years <= 30 ? Math.round(years) : null;
  const arrangement = ARRANGEMENT_WORDS[word(output.workArrangement)] ?? null;
  const employment = EMPLOYMENT_WORDS[word(output.employmentType)] ?? null;
  const degree = typeof output.degree === 'string' && output.degree.trim() ? output.degree.trim().slice(0, 60) : null;

  const facts: AiFacts = {
    workArrangement: (WORK_ARRANGEMENTS as readonly string[]).includes(arrangement ?? '') ? arrangement : null,
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
    keywords: { high, low },
    experienceLevels: levelsOf(output.experienceLevels),
    leadership,
    minYears,
    categoryId,
    subcategoryIds,
    extras: { ...facts },
    facts,
  };
}
