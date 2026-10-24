import { categorizeTitle } from '../jobs/infer';
import { OTHER_CATEGORY_ID } from '../jobs/taxonomy';
import { canonicalCertification, certificationKey, domainOf, findCertifications } from './catalogue';
import { evidenceHas, prepareEvidence, type PreparedEvidence } from './evidence';
import { matchPreparedKeywords, planKeywords, type KeywordMatch, type KeywordPlan } from './keywords';
import type { JobKeywords, JobTerms } from './schemas';
import { softKey } from './soft';
import { synonymKey } from './terms';

// How well each of a person's resumes fits one job, to pick the one to send. Pure: the caller loads the job's
// analysis and the resumes' readings. The fit only ORDERS resumes; the numbers people see are the Jobs card's
// ("{matched} of {total} keywords · {percentage}%"), and the hard part IS that match (one code path), so the picker,
// the Jobs card and Resume Score always agree.
//
// fit = 100 x sum(weight x part) / sum(weight), over the parts the JOB makes applicable (so every resume compared for
// one job shares one denominator):
//   hard      0.50  the job names keywords         matchedCount / total of the card's match
//   title     0.20  its title has role words       role affinity of the resume's roles (headline first)
//   years     0.15  it states required years      years / required, capped at 1
//   soft      0.10  it names soft skills           share the resume lists or its text carries
//   keywords  0.05  it names certifications or     share the resume holds (certifications by key or in its text;
//                   industries                     industries by id)
// Missing data never outweighs a real difference: a resume whose years are unknown is scored with the person's best
// known years, and one with no roles reads role words from its first lines (never below 0.25).

export const RESUME_FIT_WEIGHTS = { hard: 0.5, title: 0.2, years: 0.15, soft: 0.1, keywords: 0.05 } as const;
export type FitPart = keyof typeof RESUME_FIT_WEIGHTS;
export const FIT_PARTS: readonly FitPart[] = ['hard', 'title', 'years', 'soft', 'keywords'];

/** The job, as the scorer reads it (its analysis view, plus the title and the company's industry). */
export interface FitJob {
  title: string;
  keywords: JobKeywords;
  /** Canonical soft-skill names (`JobAnalysisView.softSkills`). */
  softSkills?: readonly string[] | null;
  /** Certifications and industry ids it names (`JobAnalysisView.terms`). */
  terms?: JobTerms | null;
  /** The company's industry (an id or a label); counted as one of its industries when specific. */
  industry?: string | null;
  /** The years of experience its requirements ask for (`JobAnalysisView.requiredYears`). */
  requiredYears?: number | null;
  /** The analysis's category; the title's when absent. */
  categoryId?: string | null;
  subcategoryIds?: readonly string[] | null;
}

/** Where a resume's years come from (`yearsOf` in resume/years.ts). */
export type FitYearsBasis = 'dates' | 'field' | 'stated';

/** One resume, as the scorer reads it (its row, its evidence text and its reading). */
export interface FitResumeInput {
  id: string;
  isDefault: boolean;
  /** COALESCE(last_edited_at, created_at): the newer wins a tie (a rename changes neither). */
  editedAt: string | null;
  /** The text the Jobs card matches (`getResumeEvidence`'s rule). */
  evidenceText: string;
  /** False for an upload whose text could not be read: it ranks last. */
  readable: boolean;
  hardSkills: readonly string[];
  softSkills: readonly string[];
  /** Roles held, the headline first. */
  roles: readonly string[];
  certifications: readonly string[];
  /** INDUSTRIES ids. */
  domains: readonly string[];
  /** Years of experience, worked out today; null when unknown. */
  years: number | null;
  yearsBasis: FitYearsBasis | null;
}

// --------------------------------------------------------------------------------------------- role words

/** A word of a job title that the title part looks for in a resume's roles, with how much it counts. */
export interface RoleWord {
  readonly word: string;
  readonly weight: number;
}

const ROLE_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bfront[\s-]*end\b/g, 'frontend'],
  [/\bback[\s-]*end\b/g, 'backend'],
  [/\bfull[\s-]*stack\b/g, 'fullstack'],
  [/\bdev[\s-]*ops\b/g, 'devops'],
  [/\bmachine[\s-]+learning\b/g, 'ml'],
  [/\bartificial[\s-]+intelligence\b/g, 'ai'],
  [/\bquality[\s-]+assurance\b/g, 'qa'],
  [/\bsite[\s-]+reliability\b/g, 'sre'],
  [/\buser[\s-]+experience\b/g, 'ux'],
  [/\buser[\s-]+interface\b/g, 'ui'],
];
/** Heads that name one kind of role. */
const HEAD_ALIASES: ReadonlyMap<string, string> = new Map([
  ['developer', 'engineer'],
  ['developers', 'engineer'],
  ['programmer', 'engineer'],
  ['dev', 'engineer'],
  ['swe', 'engineer'],
  ['sde', 'engineer'],
  ['coder', 'engineer'],
]);
/** Level words: the title part is about the kind of role, the years part about seniority. */
const LEVEL_WORDS: ReadonlySet<string> = new Set([
  'senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'intern', 'internship', 'associate', 'mid', 'entry',
  'level', 'i', 'ii', 'iii', 'iv', 'v', '1', '2', '3', '4', '5', 'new', 'grad', 'graduate', 'head', 'chief', 'vp',
  'svp', 'evp', 'avp', 'apprentice', 'trainee',
]);
/** Words that say how or where, not what. */
const NOISE_WORDS: ReadonlySet<string> = new Set([
  'and', 'the', 'of', 'for', 'with', 'to', 'a', 'an', 'in', 'at', 'on', 'our', 'remote', 'hybrid', 'onsite', 'contract',
  'contractor', 'temporary', 'temp', 'part', 'full', 'time', 'fulltime', 'parttime', 'permanent', 'us', 'usa',
  'position', 'role', 'opening', 'hiring', 'urgent',
]);
/** Words after a title's comma, dash or bracket that still say what the role is ("Software Engineer, Backend"). */
const ROLE_QUALIFIERS: ReadonlySet<string> = new Set([
  'frontend', 'backend', 'fullstack', 'mobile', 'ios', 'android', 'web', 'platform', 'infrastructure', 'cloud', 'data',
  'ml', 'ai', 'security', 'devops', 'sre', 'embedded', 'firmware', 'systems', 'network', 'database', 'api', 'payments',
  'growth', 'product', 'design', 'ux', 'ui', 'qa', 'test', 'automation', 'analytics', 'research', 'applied',
  'distributed', 'integration', 'solutions', 'support', 'search', 'identity', 'observability', 'billing', 'game',
  'graphics', 'compiler', 'kernel', 'robotics', 'blockchain',
]);
const ROLE_CUT = /,|\(|\||:|\s[-–—]\s|\s+at\s+|\s+@\s+/;
const ROLE_TOKEN = /[a-z0-9][a-z0-9+#]*(?:\.[a-z0-9+#]+)*|\.[a-z][a-z0-9]*/g;

function roleTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(ROLE_TOKEN) ?? []) {
    const word = HEAD_ALIASES.get(raw) ?? raw;
    if (LEVEL_WORDS.has(word) || NOISE_WORDS.has(word) || /^l\d$/.test(word) || out.includes(word)) continue;
    out.push(word);
  }
  return out;
}

/**
 * The words of a title the title part looks for: lower case, spellings folded ("Front End" -> frontend, "Machine
 * Learning" -> ml), developer/programmer -> engineer, level and noise words dropped. The text up to the first comma,
 * bracket, bar, colon, spaced dash or " at " is the kind of role: its last word (the head) weighs 2 ("engineer" 1),
 * every other word 2 ("software" 1). After that point only qualifiers count, at 2 ("Software Engineer, Backend").
 */
export function roleWords(title: string): RoleWord[] {
  let folded = (typeof title === 'string' ? title : '')
    .toLowerCase()
    .replace(/[\u2010\u2011–—_]/g, (dash) => (dash === '_' ? ' ' : '-'));
  for (const [pattern, to] of ROLE_FOLDS) folded = folded.replace(pattern, to);
  let rest = folded;
  let kind: string[] = [];
  let tail = '';
  while (rest) {
    const cut = ROLE_CUT.exec(rest);
    const segment = cut ? rest.slice(0, cut.index) : rest;
    rest = cut ? rest.slice(cut.index + cut[0].length) : '';
    kind = roleTokens(segment);
    if (kind.length > 0) {
      tail = rest;
      break;
    }
  }
  const words: RoleWord[] = kind.map((word, index) => {
    const head = index === kind.length - 1;
    return { word, weight: head ? (word === 'engineer' ? 1 : 2) : word === 'software' ? 1 : 2 };
  });
  for (const word of roleTokens(tail)) {
    if (ROLE_QUALIFIERS.has(word) && !words.some((entry) => entry.word === word)) words.push({ word, weight: 2 });
  }
  return words;
}

// --------------------------------------------------------------------------------------------- preparation

interface RoleReading {
  readonly words: ReadonlySet<string>;
  readonly categoryId: string;
  readonly subcategoryIds: readonly string[];
}

/** A resume read once per pass (or kept in a cache): its prepared evidence and the sets the parts compare. */
export interface FitResume {
  readonly input: FitResumeInput;
  readonly evidence: PreparedEvidence;
  /** About how much memory this holds, for caches sized in bytes. */
  readonly bytes: number;
  /** Its roles, or (none listed) the role words of its first lines. */
  readonly roles: readonly RoleReading[];
  readonly derivedRoles: boolean;
  readonly softKeys: ReadonlySet<string>;
  readonly certificationKeys: ReadonlySet<string>;
  readonly domains: ReadonlySet<string>;
  /** Its hard skills' synonym keys, once each (for precision). */
  readonly hardKeys: readonly string[];
}

function roleReading(text: string): RoleReading {
  const category = categorizeTitle(text);
  return {
    words: new Set(roleWords(text).map((entry) => entry.word)),
    categoryId: category.categoryId,
    subcategoryIds: category.subcategoryIds,
  };
}

/** How many of a text's first non-empty lines stand in for roles when a resume lists none, and how long they may be. */
const DERIVED_ROLE_LINES = 6;
const DERIVED_ROLE_WORDS = 8;

function strings(list: readonly string[] | null | undefined): string[] {
  return (list ?? []).filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

/** Reads a resume for scoring. Pass `evidence` when it is already prepared (a cache keyed by content). */
export function prepareFitResume(input: FitResumeInput, evidence?: PreparedEvidence): FitResume {
  const prepared = evidence ?? prepareEvidence(input.evidenceText);
  const listed = strings(input.roles);
  let roles: RoleReading[];
  let derivedRoles = false;
  if (listed.length > 0) {
    roles = listed.map(roleReading);
  } else {
    derivedRoles = true;
    roles = input.evidenceText
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, DERIVED_ROLE_LINES)
      .filter((line) => line.split(' ').length <= DERIVED_ROLE_WORDS)
      .map(roleReading);
  }
  const certificationKeys = new Set<string>();
  for (const name of strings(input.certifications)) {
    certificationKeys.add(certificationKey(canonicalCertification(name) ?? name));
  }
  for (const name of findCertifications(prepared, { max: 50 })) certificationKeys.add(certificationKey(name));
  const hardKeys = [...new Set(strings(input.hardSkills).map(synonymKey))];
  const softKeys = new Set(strings(input.softSkills).map(softKey));
  return {
    input,
    evidence: prepared,
    bytes: prepared.bytes + 512 + 64 * (roles.length + hardKeys.length + softKeys.size + certificationKeys.size),
    roles,
    derivedRoles,
    softKeys,
    certificationKeys,
    domains: new Set(strings(input.domains)),
    hardKeys,
  };
}

/** A job read once for scoring many resumes. */
export interface PreparedFitJob {
  readonly job: FitJob;
  readonly plan: KeywordPlan;
  /** Synonym keys of every spelling of every keyword the match counts (for precision). */
  readonly keywordKeys: ReadonlySet<string>;
  readonly roleWords: readonly RoleWord[];
  readonly roleWeight: number;
  readonly categoryId: string;
  readonly subcategoryIds: readonly string[];
  readonly softSkills: ReadonlyArray<{ readonly name: string; readonly key: string }>;
  readonly certifications: ReadonlyArray<{ readonly name: string; readonly key: string }>;
  readonly domains: readonly string[];
  readonly requiredYears: number | null;
}

function isPrepared(job: FitJob | PreparedFitJob): job is PreparedFitJob {
  return Array.isArray((job as PreparedFitJob).roleWords) && (job as PreparedFitJob).plan !== undefined;
}

/** Synonym keys of every spelling of a plan's keywords. */
export function keywordKeysOf(plan: KeywordPlan): Set<string> {
  const keys = new Set<string>();
  for (const group of plan.groups) for (const spelling of group.spellings) keys.add(synonymKey(spelling));
  return keys;
}

export function prepareFitJob(job: FitJob): PreparedFitJob {
  const plan = planKeywords(job.keywords);
  const words = roleWords(job.title);
  const given = typeof job.categoryId === 'string' && job.categoryId !== '' ? job.categoryId : null;
  const category = given
    ? { categoryId: given, subcategoryIds: strings(job.subcategoryIds) }
    : categorizeTitle(job.title);
  const softSkills: Array<{ name: string; key: string }> = [];
  for (const name of strings(job.softSkills)) {
    const key = softKey(name);
    if (!softSkills.some((entry) => entry.key === key)) softSkills.push({ name: name.trim(), key });
  }
  const certifications: Array<{ name: string; key: string }> = [];
  for (const name of strings(job.terms?.certifications)) {
    const key = certificationKey(canonicalCertification(name) ?? name);
    if (!certifications.some((entry) => entry.key === key)) certifications.push({ name: name.trim(), key });
  }
  const domains = [...new Set(strings(job.terms?.domains))];
  const industry = typeof job.industry === 'string' ? domainOf(job.industry) : null;
  if (industry && !domains.includes(industry)) domains.push(industry);
  const required =
    typeof job.requiredYears === 'number' && Number.isFinite(job.requiredYears) ? job.requiredYears : null;
  return {
    job,
    plan,
    keywordKeys: keywordKeysOf(plan),
    roleWords: words,
    roleWeight: words.reduce((sum, entry) => sum + entry.weight, 0),
    categoryId: category.categoryId,
    subcategoryIds: category.subcategoryIds,
    softSkills,
    certifications,
    domains,
    requiredYears: required,
  };
}

// --------------------------------------------------------------------------------------------- the parts

/** A role that shares a subcategory with the job reads at least this close; one in its category at least 0.5. */
const SUBCATEGORY_FLOOR = 0.8;
const CATEGORY_FLOOR = 0.5;
/** A resume whose roles are unknown: below any resume in the job's field, above one in another field. */
const UNKNOWN_ROLES_FLOOR = 0.25;
const HEADLINE_SHARE = 0.6;

function affinity(job: PreparedFitJob, role: RoleReading): number {
  let matched = 0;
  for (const { word, weight } of job.roleWords) if (role.words.has(word)) matched += weight;
  return job.roleWeight > 0 ? matched / job.roleWeight : 0;
}

function categoryFloor(job: PreparedFitJob, roles: readonly RoleReading[]): number {
  if (job.categoryId === OTHER_CATEGORY_ID) return 0;
  if (roles.some((role) => role.subcategoryIds.some((id) => job.subcategoryIds.includes(id)))) return SUBCATEGORY_FLOOR;
  if (roles.some((role) => role.categoryId === job.categoryId)) return CATEGORY_FLOOR;
  return 0;
}

function titlePart(job: PreparedFitJob, resume: FitResume): number | null {
  if (job.roleWeight <= 0) return null;
  const roles = resume.roles;
  if (roles.length === 0) return UNKNOWN_ROLES_FLOOR;
  const values = roles.map((role) => affinity(job, role));
  const best = Math.max(...values);
  const floor = categoryFloor(job, roles);
  if (resume.derivedRoles) return Math.max(best, floor, UNKNOWN_ROLES_FLOOR);
  return Math.max(HEADLINE_SHARE * values[0]! + (1 - HEADLINE_SHARE) * best, floor);
}

function yearsPart(required: number | null, years: number | null): number | null {
  if (required === null) return null;
  if (years === null) return 0.5;
  if (required <= 0) return 1;
  return Math.min(1, Math.max(0, years) / required);
}

// --------------------------------------------------------------------------------------------- scoring

export interface ResumeFit {
  readonly resumeId: string;
  /** The weighted fit, unrounded 0-100: it orders resumes and is never shown. */
  readonly fit: number;
  /** Each part 0-1; null when the job gives it nothing to compare. */
  readonly parts: Readonly<Record<FitPart, number | null>>;
  /** Exactly the Jobs card's match: `matchedCount`, `total`, `percentage`. */
  readonly keywordMatch: KeywordMatch;
  readonly softMatched: readonly string[];
  readonly softMissing: readonly string[];
  /** Share of the resume's hard skills (by synonym key) the job's keywords name; breaks ties after the default. */
  readonly precision: number;
  /** The resume's own years (null when unknown, even when the best known years were used). */
  readonly years: number | null;
  readonly readable: boolean;
  readonly isDefault: boolean;
  readonly editedAt: string | null;
}

export interface FitOptions {
  /**
   * The person's best known years (`bestKnownYears` over ALL their resumes), used for a resume whose years are
   * unknown. Omitted: worked out from the resumes being ranked.
   */
  bestKnownYears?: number | null;
}

/**
 * The highest years of any readable resume whose years come from its dates or the editor's field (a total a resume
 * only states does not count), or null.
 */
export function bestKnownYears(
  resumes: Iterable<Pick<FitResumeInput, 'readable' | 'years' | 'yearsBasis'>>,
): number | null {
  let best: number | null = null;
  for (const resume of resumes) {
    if (!resume.readable || resume.years === null || !Number.isFinite(resume.years)) continue;
    if (resume.yearsBasis !== 'dates' && resume.yearsBasis !== 'field') continue;
    best = best === null ? resume.years : Math.max(best, resume.years);
  }
  return best;
}

/** The share of `hardKeys` the job's keyword keys name; 0 for a resume with no hard skills. */
export function precisionOf(hardKeys: readonly string[], keywordKeys: ReadonlySet<string>): number {
  if (hardKeys.length === 0) return 0;
  let named = 0;
  for (const key of hardKeys) if (keywordKeys.has(key)) named += 1;
  return named / hardKeys.length;
}

/** One resume's fit for one job. */
export function scoreResumeFit(job: FitJob | PreparedFitJob, resume: FitResume, options: FitOptions = {}): ResumeFit {
  const prepared = isPrepared(job) ? job : prepareFitJob(job);
  const keywordMatch = matchPreparedKeywords(resume.evidence, prepared.plan);
  const softMatched: string[] = [];
  const softMissing: string[] = [];
  for (const skill of prepared.softSkills) {
    const has = resume.softKeys.has(skill.key) || evidenceHas(resume.evidence, skill.name);
    (has ? softMatched : softMissing).push(skill.name);
  }
  const termsTotal = prepared.certifications.length + prepared.domains.length;
  let termsMatched = 0;
  for (const certification of prepared.certifications) {
    const held = resume.certificationKeys.has(certification.key) || evidenceHas(resume.evidence, certification.name);
    if (held) termsMatched += 1;
  }
  for (const domain of prepared.domains) if (resume.domains.has(domain)) termsMatched += 1;

  const years = resume.input.years;
  const fallbackYears = options.bestKnownYears ?? null;
  const parts: Record<FitPart, number | null> = {
    hard: keywordMatch.total > 0 ? keywordMatch.matchedCount / keywordMatch.total : null,
    title: titlePart(prepared, resume),
    years: yearsPart(prepared.requiredYears, years ?? fallbackYears),
    soft: prepared.softSkills.length > 0 ? softMatched.length / prepared.softSkills.length : null,
    keywords: termsTotal > 0 ? termsMatched / termsTotal : null,
  };
  let sum = 0;
  let weight = 0;
  for (const part of FIT_PARTS) {
    const value = parts[part];
    if (value === null) continue;
    sum += RESUME_FIT_WEIGHTS[part] * value;
    weight += RESUME_FIT_WEIGHTS[part];
  }
  return {
    resumeId: resume.input.id,
    fit: weight > 0 ? (sum / weight) * 100 : 0,
    parts,
    keywordMatch,
    softMatched,
    softMissing,
    precision: precisionOf(resume.hardKeys, prepared.keywordKeys),
    years: years ?? null,
    readable: resume.input.readable,
    isDefault: resume.input.isDefault,
    editedAt: resume.input.editedAt,
  };
}

function timeOf(value: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * The ranking's total order: readable resumes first; then the higher (unrounded) fit; then the default resume; then
 * the higher precision; then the newer COALESCE(last edited, created); then the lower id. It never depends on the
 * order resumes come in.
 */
export function compareResumeFits(a: ResumeFit, b: ResumeFit): number {
  if (a.readable !== b.readable) return a.readable ? -1 : 1;
  if (a.fit !== b.fit) return b.fit - a.fit;
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  if (a.precision !== b.precision) return b.precision - a.precision;
  const aTime = timeOf(a.editedAt);
  const bTime = timeOf(b.editedAt);
  if (aTime !== bTime) return bTime - aTime;
  return a.resumeId < b.resumeId ? -1 : a.resumeId > b.resumeId ? 1 : 0;
}

/** Every resume's fit for one job, best first (`compareResumeFits`). */
export function rankResumeFits(
  job: FitJob | PreparedFitJob,
  resumes: readonly FitResume[],
  options: FitOptions = {},
): ResumeFit[] {
  const prepared = isPrepared(job) ? job : prepareFitJob(job);
  const fallback =
    options.bestKnownYears !== undefined
      ? options.bestKnownYears
      : bestKnownYears(resumes.map((resume) => resume.input));
  return resumes
    .map((resume) => scoreResumeFit(prepared, resume, { bestKnownYears: fallback }))
    .sort(compareResumeFits);
}

export type ResumeChoiceReason = 'best' | 'tie' | 'only' | 'none';

/**
 * The resume to link from a ranking: the first. `none`: no resumes; `only`: one; `tie`: the top fit is shared (the
 * tie-break decided); `best`: otherwise.
 */
export function chooseResume(ranked: readonly ResumeFit[]): {
  resumeId: string | null;
  fit: number | null;
  reason: ResumeChoiceReason;
} {
  const top = ranked[0];
  if (!top) return { resumeId: null, fit: null, reason: 'none' };
  if (ranked.length === 1) return { resumeId: top.resumeId, fit: top.fit, reason: 'only' };
  const next = ranked[1]!;
  const tie = next.readable === top.readable && next.fit === top.fit;
  return { resumeId: top.resumeId, fit: top.fit, reason: tie ? 'tie' : 'best' };
}
