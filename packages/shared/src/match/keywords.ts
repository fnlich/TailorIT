import type { JobKeywords, KeywordGroup, MatchResult, MatchedKeyword } from './schemas';
import {
  alnumRuns,
  containsTerm,
  firstRun,
  maskFalseFriends,
  matchKey,
  synonymKey,
  synonymsOf,
  termPattern,
} from './terms';

// ------------------------------------------------------------------------------------------------- the match

/** The match's numbers, without the state and resume id the API adds. */
export type KeywordMatch = Omit<MatchResult, 'state' | 'resumeId'>;

/** Every spelling a keyword group may be found by: its own term and synonyms, each with its built-in synonyms. */
export function spellingsOf(group: KeywordGroup): string[] {
  const out: string[] = [];
  const add = (spelling: string) => {
    const text = spelling.replace(/\s+/g, ' ').trim();
    if (text && !out.includes(text)) out.push(text);
  };
  add(group.term);
  for (const spelling of group.synonyms) add(spelling);
  for (const spelling of [group.term, ...group.synonyms]) synonymsOf(spelling).forEach(add);
  return out;
}

/**
 * Scores a resume's own words against a posting's keywords (Simplify's job analysis card). A group is matched when
 * any of its spellings is in `evidenceText` as a whole word (`containsTerm`). Groups are taken high first, then low,
 * and a group repeating an earlier one (same synonym key) is skipped, so a keyword is never counted twice.
 */
export function matchKeywords(evidenceText: string, keywords: JobKeywords): KeywordMatch {
  const text = maskFalseFriends(evidenceText);
  const seen = new Set<string>();
  const matched: MatchedKeyword[] = [];
  const missing: MatchedKeyword[] = [];
  for (const priority of ['high', 'low'] as const) {
    for (const group of keywords[priority]) {
      const term = group.term.replace(/\s+/g, ' ').trim();
      if (!term) continue;
      const spellings = spellingsOf(group);
      const keys = spellings.map(synonymKey);
      if (keys.some((key) => seen.has(key))) continue;
      keys.forEach((key) => seen.add(key));
      const found = spellings.some((spelling) => containsTerm(text, spelling));
      (found ? matched : missing).push({ term, priority });
    }
  }
  const total = matched.length + missing.length;
  return {
    matched,
    missing,
    matchedCount: matched.length,
    total,
    percentage: total > 0 ? Math.round((matched.length / total) * 100) : 0,
  };
}

/** The full API answer for a user with a resume. */
export function matchResult(evidenceText: string, keywords: JobKeywords, resumeId?: string): MatchResult {
  return { state: 'ok', ...(resumeId ? { resumeId } : {}), ...matchKeywords(evidenceText, keywords) };
}

/** The API answer for a user with no default resume: the card asks them to add one. */
export function noResumeMatch(keywords: JobKeywords = { high: [], low: [] }): MatchResult {
  const { missing, total } = matchKeywords('', keywords);
  return { state: 'no_resume', matched: [], missing, matchedCount: 0, total, percentage: 0 };
}

// --------------------------------------------------------------------------------------------- the extractor

/** A vocabulary entry: a skill name, or a name with spellings that count as it. */
export type VocabularyEntry = string | { term: string; aliases?: readonly string[] };

interface CompiledSpelling {
  spelling: string;
  group: number;
  /** Global; shared safely because it is only used through `matchAll`, which copies it. */
  pattern: RegExp;
  /** An everyday word refused at a sentence start unless it reads as a list item or requirement. */
  ambiguous: boolean;
}

interface CompiledGroup {
  canonical: string;
  spellings: string[];
}

/** A vocabulary ready to scan text with; build it once (`compileVocabulary`) and reuse it for every posting. */
export interface CompiledVocabulary {
  readonly groups: readonly CompiledGroup[];
  readonly byRun: ReadonlyMap<string, readonly CompiledSpelling[]>;
}

/** Title-case names that are not everyday words, found in any case ("kubernetes", "Docker"). Lower-case keys. */
const SAFE_ANY_CASE: ReadonlySet<string> = new Set([
  'kubernetes',
  'docker',
  'terraform',
  'python',
  'postgres',
  'kafka',
  'ansible',
  'jenkins',
  'golang',
  'redis',
  'linux',
  'grafana',
  'prometheus',
  'django',
  'nginx',
  'kotlin',
]);

/**
 * Technology names that are also everyday English words (or names), refused where a sentence or bullet starts unless
 * they read as a list item ("- Go", "Go, Rust"), a skills line ("Go: 3 years") or a requirement ("Swift required").
 * So "Go above and beyond" and "Spring is our busiest season" add no keyword. Lower-case keys.
 */
const SENTENCE_START_AMBIGUOUS: ReadonlySet<string> = new Set([
  'go', 'swift', 'express', 'spring', 'rust', 'kind', 'chef', 'puppet', 'vault', 'echo', 'flux', 'ember', 'julia',
  'less', 'gin', 'lit', 'remix', 'render', 'relay', 'sentry', 'split', 'phoenix', 'falcon', 'beam', 'hive', 'apex',
  'assembly', 'bamboo', 'crystal', 'consul', 'envoy', 'nomad', 'packer', 'parcel', 'presto', 'realm', 'temporal',
  'vapor', 'warp', 'zig', 'ada', 'hack', 'scheme', 'elm', 'dart', 'jest', 'mocha', 'chai', 'karma', 'cypress',
  'ant', 'make', 'helm', 'pulse', 'storm', 'flask', 'bottle', 'pyramid', 'spark', 'airflow', 'snowflake',
  'testing', 'automation', 'analysis', 'security', 'design', 'architecture', 'networking', 'monitoring',
]);

function isTitleCase(word: string): boolean {
  return /^\p{Lu}\p{Ll}+$/u.test(word);
}

/** How the extractor reads one spelling: never (one character), case-sensitive, or any case. */
function spellingCase(spelling: string): 'never' | 'sensitive' | 'insensitive' {
  if (spelling.length <= 1) return 'never';
  if (spelling.length === 2) return 'sensitive';
  if (!/^\p{L}+$/u.test(spelling)) return 'insensitive';
  if (isTitleCase(spelling)) return SAFE_ANY_CASE.has(spelling.toLowerCase()) ? 'insensitive' : 'sensitive';
  if (spelling === spelling.toUpperCase() || spelling === spelling.toLowerCase()) return 'sensitive';
  return 'insensitive';
}

/** Builds the scanner for a vocabulary. Entries that are spellings of one thing (synonym groups) merge into one. */
export function compileVocabulary(entries: readonly VocabularyEntry[]): CompiledVocabulary {
  const groups: CompiledGroup[] = [];
  const groupByKey = new Map<string, number>();
  const byRun = new Map<string, CompiledSpelling[]>();
  const compiled = new Set<string>();

  for (const entry of entries) {
    const term = typeof entry === 'string' ? entry : entry?.term;
    if (typeof term !== 'string' || !term.trim()) continue;
    const aliases = typeof entry === 'string' ? [] : (entry.aliases ?? []).filter((alias) => typeof alias === 'string');
    const spellings = [...synonymsOf(term), ...aliases.flatMap(synonymsOf)];
    const keys = spellings.map(synonymKey);
    let index = keys.map((key) => groupByKey.get(key)).find((found) => found !== undefined);
    if (index === undefined) {
      index = groups.length;
      groups.push({ canonical: term.replace(/\s+/g, ' ').trim(), spellings: [] });
    }
    const group = groups[index]!;
    keys.forEach((key) => groupByKey.set(key, index));

    for (const spelling of spellings) {
      if (!group.spellings.includes(spelling)) group.spellings.push(spelling);
      if (compiled.has(spelling)) continue;
      compiled.add(spelling);
      const reading = spellingCase(spelling);
      if (reading === 'never') continue;
      const pattern = termPattern(spelling, { global: true, caseSensitive: reading === 'sensitive' });
      const run = firstRun(spelling);
      if (!pattern || !run) continue;
      const ambiguous = reading === 'sensitive' && SENTENCE_START_AMBIGUOUS.has(spelling.toLowerCase());
      const list = byRun.get(run) ?? [];
      list.push({ spelling, group: index, pattern, ambiguous });
      byRun.set(run, list);
    }
  }
  return { groups, byRun };
}

const COMPILED = new WeakMap<object, CompiledVocabulary>();

function compiledOf(vocabulary: readonly VocabularyEntry[] | CompiledVocabulary): CompiledVocabulary {
  if (!Array.isArray(vocabulary)) return vocabulary as CompiledVocabulary;
  let compiled = COMPILED.get(vocabulary);
  if (!compiled) {
    compiled = compileVocabulary(vocabulary as readonly VocabularyEntry[]);
    COMPILED.set(vocabulary, compiled);
  }
  return compiled;
}

function isBlank(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\u00a0';
}

/** How far back the sentence-start check looks; a longer run of blanks counts as a start. */
const LOOKBACK = 64;

/** Whether a match at `index` begins a sentence, a line or a bullet. */
function atSentenceStart(text: string, index: number): boolean {
  let at = index - 1;
  const floor = Math.max(0, index - LOOKBACK);
  while (at >= floor && isBlank(text[at])) at -= 1;
  if (at < floor) return true;
  const char = text[at];
  if (char === '\n' || char === '\r') return true;
  if (char === '-' || char === '*' || char === '•' || char === '·') {
    let before = at - 1;
    const bulletFloor = Math.max(0, at - LOOKBACK);
    while (before >= bulletFloor && isBlank(text[before])) before -= 1;
    return before < 0 || text[before] === '\n' || text[before] === '\r';
  }
  return (char === '.' || char === '!' || char === '?') && at < index - 1;
}

const LINE_PREFIX_MARKER = /^[ \t\u00a0]*(?:[-*•·]|\d{1,3}[.)])?[ \t\u00a0]*$/;
const LINE_REST_ITEM = /^[ \t\u00a0]*(?:\([^)\n]{0,40}\))?[ \t\u00a0]*[,;.]?[ \t\u00a0]*(?:\r?\n|$)/;
const LIST_SEPARATOR = /^(?:[ \t]*[,;/][ \t]*|[ \t]+(?:and|or|&)[ \t]+)[A-Za-z0-9.#+]/i;
const LIST_YEARS = /^:[ \t]*\d/;
const REQUIREMENT_CUE =
  /^[ \t]+(?:(?:is|are)[ \t]+)?(?:a[ \t]+)?(?:required|requirements?|experienced?|preferred|proficiency|proficient|knowledge|expertise|skills?|plus|desired|background|fluency|fluent|familiarity)\b/i;

/** The text between the line's start and `index` when it is short enough to be a bullet marker, else null. */
function shortLinePrefix(text: string, index: number): string | null {
  const floor = Math.max(0, index - 12);
  for (let at = index - 1; at >= floor; at -= 1) {
    if (text[at] === '\n' || text[at] === '\r') return text.slice(at + 1, index);
  }
  return floor === 0 ? text.slice(0, index) : null;
}

/** An ambiguous word at a sentence start still counts when it is a list item, a skills line or a requirement. */
function readsAsListItemOrRequirement(text: string, index: number, length: number): boolean {
  const after = text.slice(index + length, index + length + 80);
  const prefix = shortLinePrefix(text, index);
  if (prefix !== null && LINE_PREFIX_MARKER.test(prefix) && LINE_REST_ITEM.test(after)) return true;
  return LIST_SEPARATOR.test(after) || LIST_YEARS.test(after) || REQUIREMENT_CUE.test(after);
}

interface Hit {
  start: number;
  end: number;
  group: number;
  spelling: string;
}

/**
 * Every vocabulary hit in `text`, longest first claiming its span, so "CI" inside "CI/CD" is not a second hit.
 * `prose` applies the sentence-start rule to everyday words; a title is a name, not prose.
 */
function scan(text: string, vocabulary: CompiledVocabulary, prose = true): Hit[] {
  if (!text) return [];
  const masked = maskFalseFriends(text);
  const candidates = new Set<CompiledSpelling>();
  for (const run of alnumRuns(masked)) for (const spelling of vocabulary.byRun.get(run) ?? []) candidates.add(spelling);

  const hits: Hit[] = [];
  for (const candidate of candidates) {
    for (const match of masked.matchAll(candidate.pattern)) {
      const start = match.index ?? 0;
      if (
        prose &&
        candidate.ambiguous &&
        atSentenceStart(masked, start) &&
        !readsAsListItemOrRequirement(masked, start, match[0].length)
      ) {
        continue;
      }
      hits.push({ start, end: start + match[0].length, group: candidate.group, spelling: candidate.spelling });
    }
  }

  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const claimed = new Uint8Array(masked.length);
  const kept: Hit[] = [];
  for (const hit of hits) {
    let free = true;
    for (let at = hit.start; at < hit.end; at += 1) {
      if (claimed[at]) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    claimed.fill(1, hit.start, hit.end);
    kept.push(hit);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export interface ExtractKeywordsOptions {
  /** The posting's title: a keyword it names is high priority. */
  title?: string;
  /** The requirements / qualifications section: a keyword it names is high priority. */
  requirementsText?: string;
  /** Caps, as the AI analysis's (15 + 15). */
  maxHigh?: number;
  maxLow?: number;
}

interface GroupStat {
  group: number;
  count: number;
  first: number;
  spelling: string;
  high: boolean;
}

/**
 * The free, deterministic keyword reading of a posting, from a vocabulary the caller loads (the API passes
 * skills.json's names; nothing is imported here). Spellings of one thing are one keyword, labelled by the vocabulary
 * spelling the posting uses first. A keyword is `high` when the requirements section or the title names it, or the text names it at least
 * twice; every other one found is `low`. High keywords are ordered by how often they appear, low ones by where they
 * first appear.
 */
export function extractKeywords(
  text: string,
  vocabulary: readonly VocabularyEntry[] | CompiledVocabulary,
  options: ExtractKeywordsOptions = {},
): JobKeywords {
  const compiled = compiledOf(vocabulary);
  const stats = new Map<number, GroupStat>();
  const note = (hit: Hit, counted: boolean, high: boolean) => {
    let stat = stats.get(hit.group);
    if (!stat) {
      stat = { group: hit.group, count: 0, first: Number.MAX_SAFE_INTEGER, spelling: hit.spelling, high: false };
      stats.set(hit.group, stat);
    }
    if (counted) {
      if (stat.count === 0) {
        stat.first = hit.start;
        stat.spelling = hit.spelling;
      }
      stat.count += 1;
    }
    if (high) stat.high = true;
  };

  for (const hit of scan(text, compiled)) note(hit, true, false);
  for (const hit of scan(options.title ?? '', compiled, false)) note(hit, false, true);
  for (const hit of scan(options.requirementsText ?? '', compiled)) note(hit, false, true);

  const toGroup = (stat: GroupStat): KeywordGroup => {
    const spellings = compiled.groups[stat.group]?.spellings ?? [];
    const display = stat.spelling;
    const displayKey = matchKey(display);
    const synonyms = spellings.filter((spelling) => matchKey(spelling) !== displayKey).slice(0, 8);
    return { term: display, synonyms };
  };

  const all = [...stats.values()];
  const high = all
    .filter((stat) => stat.high || stat.count >= 2)
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, options.maxHigh ?? 15)
    .map(toGroup);
  const low = all
    .filter((stat) => !(stat.high || stat.count >= 2))
    .sort((a, b) => a.first - b.first)
    .slice(0, options.maxLow ?? 15)
    .map(toGroup);
  return { high, low };
}
