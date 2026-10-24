import { escapeRegExp } from '../format/text';
import { prepareEvidence, type PreparedEvidence } from './evidence';
import { synonymKey, synonymsOf } from './terms';

// Soft skills: the traits a posting asks for and a resume shows ("Communication", "Stakeholder Management"), read
// over the soft list the caller loads (skills.json's soft skills; nothing is imported here). Unlike the keyword
// extractor, the reading ignores case ("communication" counts as much as "Communication"), and spaces and hyphens
// between words are interchangeable ("decision-making" is "Decision Making"). Each hit is reported by its canonical
// entry: the longest shorter entry that the listed one ends with, split on spaces only and never past a negation
// ("Strong communication skills" is "Communication"; "Non-technical communication" stays itself). Entries that are
// also hard skills stay hard, everyday words count only as whole list items, and a few technical phrases are never
// read as soft ("inter-service communication").

/** How two spellings of one soft skill compare: lower case, "-", "_" and "/" read as spaces, whitespace collapsed. */
export function softKey(term: string): string {
  return term
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[-_/\u2010\u2011–]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Entries that are everyday or technical words in prose ("our organization", "visa sponsorship", "load balancing",
 * "data persistence", "due diligence", "content negotiation", "speech recognition"). They count only as a whole item
 * of a list: a bullet, an item between commas or bars, a line of its own, or a "Skills:" / "Strengths:" line.
 */
export const EVERYDAY_SOFT_SKILLS: readonly string[] = [
  'Abstraction', 'Accuracy', 'Agility', 'Analytical', 'Balancing', 'Belonging', 'Commitment', 'Compromise',
  'Concentration', 'Confidence', 'Confidentiality', 'Consistency', 'Copywriting', 'cost-effective', 'Credibility',
  'Customer Success', 'Delegation', 'Determination', 'Diligence', 'Discretion', 'Documentation', 'Editing',
  'Efficiency', 'Energy', 'Execution', 'Experimentation', 'Fairness', 'Flexibility', 'Focus', 'Forecasting', 'Humor',
  'Inclusiveness', 'Inclusivity', 'Influence', 'Information Processing', 'Initiative', 'Innovation', 'Inspiration',
  'Integrity', 'Judgment', 'Listening', 'Maturity', 'Mediation', 'Moderation', 'Motivation', 'Multitasking',
  'Negotiation', 'Networking', 'Objectivity', 'Onboarding', 'Openness', 'Optimism', 'Organization', 'Outreach',
  'Ownership', 'Passion', 'Pattern recognition', 'Persistence', 'Planning', 'Precision', 'Presentation',
  'Productivity', 'Recognition', 'Reliability', 'Resilience', 'Respect', 'respectful', 'Responsibility',
  'Responsiveness', 'Scheduling', 'Simplification', 'Sponsorship', 'Summarization', 'Synthesis', 'Training',
  'Transparency', 'Troubleshooting', 'Warmth',
];
const EVERYDAY_KEYS: ReadonlySet<string> = new Set(EVERYDAY_SOFT_SKILLS.map(softKey));

/** Technical phrases a soft entry can be read inside; their words are never a soft skill. */
const TECHNICAL_PHRASES = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:` +
    [
      String.raw`inter[\s-]?(?:service|process|node|pod|cluster|module|component|system|thread|chip|device|region|container)s?[\s-]+communications?`,
      String.raw`(?:service|machine|device|process|node|server|peer|system|component|module)[\s-]+to[\s-]+(?:service|machine|device|process|node|server|peer|system|component|module)[\s-]+communications?`,
      String.raw`(?:network|serial|wireless|radio|satellite|optical|rf|ipc|rpc|grpc|data|mobile|bus|uart|spi|i2c|mqtt|socket|tcp|udp)[\s-]+communications?`,
      String.raw`application\s+performance\s+management`,
      String.raw`enterprise\s+resource\s+planning`,
    ].join('|') +
    String.raw`)(?![\p{L}\p{N}])`,
  'giu',
);

/** A word that negates what follows it ("non-technical"): a canonical suffix never reaches past it. */
const NEGATION_WORD = /^(?:non|not|no|never|without|anti)$|^(?:non|anti)[-\u2010\u2011]/i;
/** A hit right after a negation ("non technical communication") is not that skill. */
const NEGATED_BEFORE = /(?<![\p{L}\p{N}])(?:non|not|no|never|without|anti)[\s\-\u2010\u2011]+$/iu;

interface SoftProbe {
  /** The listed entry's canonical key and display name. */
  readonly canonicalKey: string;
  readonly canonical: string;
  /** Counts only as a whole list item. */
  readonly everyday: boolean;
  /** False for an entry that stays hard, and for a hard phrase: the hit claims its span and reports nothing. */
  readonly reported: boolean;
  /** Sticky when `run` is set (tested where that run starts), global otherwise (a full scan). */
  readonly pattern: RegExp;
  readonly run: string;
}

/** A soft list compiled for scanning (`compileSoftSkills`); build it once and reuse it. */
export interface SoftSkillScanner {
  /** Every listed entry's key -> its canonical name. */
  readonly canonicalByKey: ReadonlyMap<string, string>;
  /** Keys of listed entries that stay hard skills (they, or their canonical, are on the hard list). */
  readonly hardOverlapKeys: ReadonlySet<string>;
  /** Keys (softKey and synonymKey) of the hard list. */
  readonly hardKeys: ReadonlySet<string>;
  readonly byRun: ReadonlyMap<string, readonly SoftProbe[]>;
  readonly scanned: readonly SoftProbe[];
}

/** A case-insensitive whole-phrase pattern; spaces and hyphens between words are interchangeable. */
function phraseProbe(phrase: string, fields: Omit<SoftProbe, 'pattern' | 'run'>): SoftProbe | null {
  const normalized = phrase.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  const body = normalized
    .split(/[ \-\u2010\u2011]+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join('[\\s\\-\u2010\u2011]+');
  if (!body) return null;
  const trail = /[\p{L}\p{N}]$/u.test(normalized) ? '(?![\\p{L}\\p{N}+#])' : '';
  const first = /^[A-Za-z0-9]+/.exec(normalized);
  const indexed = first !== null && !/[\u212a\u017f]/.test(normalized);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${body}${trail}`, indexed ? 'iuy' : 'giu');
  return { ...fields, pattern, run: indexed && first ? first[0].toLowerCase() : '' };
}

function hardKeysOf(hard: readonly string[]): { soft: Set<string>; synonym: Set<string> } {
  const soft = new Set<string>();
  const synonym = new Set<string>();
  for (const term of hard) {
    if (typeof term !== 'string' || !term.trim()) continue;
    for (const spelling of synonymsOf(term)) {
      soft.add(softKey(spelling));
      synonym.add(synonymKey(spelling));
    }
  }
  return { soft, synonym };
}

/** Each listed key -> the key of its canonical entry. */
function canonicalKeys(spellingByKey: ReadonlyMap<string, string>): Map<string, string> {
  const memo = new Map<string, string>();
  const resolve = (key: string, depth: number): string => {
    const known = memo.get(key);
    if (known !== undefined) return known;
    const words = (spellingByKey.get(key) ?? key).split(' ').filter(Boolean);
    const options: string[][] = [];
    const suffixes = (list: string[]) => {
      for (let at = 1; at < list.length; at += 1) {
        if (NEGATION_WORD.test(list[at - 1]!)) break;
        options.push(list.slice(at));
      }
    };
    suffixes(words);
    const last = words[words.length - 1] ?? '';
    if (words.length > 1 && /^skills?$/i.test(last)) {
      const stem = words.slice(0, -1);
      options.push(stem);
      suffixes(stem);
    }
    options.sort((a, b) => b.length - a.length);
    let found = key;
    for (const option of options) {
      const optionKey = softKey(option.join(' '));
      if (optionKey !== key && spellingByKey.has(optionKey) && depth < 12) {
        found = resolve(optionKey, depth + 1);
        break;
      }
    }
    memo.set(key, found);
    return found;
  };
  for (const key of spellingByKey.keys()) resolve(key, 0);
  return memo;
}

/** Contiguous word runs of a phrase's key (its sub-phrases), the phrase itself excluded. */
function subPhrases(key: string): string[] {
  const words = key.split(' ');
  const out: string[] = [];
  for (let size = words.length - 1; size >= 1; size -= 1) {
    for (let at = 0; at + size <= words.length; at += 1) out.push(words.slice(at, at + size).join(' '));
  }
  return out;
}

/** Builds the scanner. `hard` is the hard list: its terms never read as soft, and its phrases shadow soft words. */
export function compileSoftSkills(soft: readonly string[], hard: readonly string[] = []): SoftSkillScanner {
  const spellingByKey = new Map<string, string>();
  const spellings = new Set<string>();
  for (const entry of soft) {
    if (typeof entry !== 'string') continue;
    const spelling = entry.trim().replace(/\s+/g, ' ');
    const key = softKey(spelling);
    if (!key) continue;
    if (!spellingByKey.has(key)) spellingByKey.set(key, spelling);
    spellings.add(spelling);
  }
  const canonicalKeyOf = canonicalKeys(spellingByKey);
  const canonicalByKey = new Map<string, string>();
  for (const [key, canonicalKey] of canonicalKeyOf) canonicalByKey.set(key, spellingByKey.get(canonicalKey) ?? key);

  const hardKeys = hardKeysOf(hard);
  const isHard = (spelling: string) =>
    hardKeys.soft.has(softKey(spelling)) || hardKeys.synonym.has(synonymKey(spelling));
  const hardOverlapKeys = new Set<string>();
  for (const [key, spelling] of spellingByKey) {
    const canonical = canonicalByKey.get(key) ?? spelling;
    if (isHard(spelling) || isHard(canonical)) hardOverlapKeys.add(key);
  }

  const probes: SoftProbe[] = [];
  for (const spelling of spellings) {
    const key = softKey(spelling);
    const canonicalKey = canonicalKeyOf.get(key) ?? key;
    const probe = phraseProbe(spelling, {
      canonicalKey,
      canonical: spellingByKey.get(canonicalKey) ?? spelling,
      everyday: EVERYDAY_KEYS.has(key),
      reported: !hardOverlapKeys.has(key),
    });
    if (probe) probes.push(probe);
  }
  // Hard phrases that hold a soft entry ("Merge Conflict Resolution", "Sprint Planning") claim their span first.
  const shadowed = new Set<string>();
  for (const term of hard) {
    if (typeof term !== 'string') continue;
    for (const spelling of synonymsOf(term)) {
      const key = softKey(spelling);
      if (!key.includes(' ') || shadowed.has(key) || spellingByKey.has(key)) continue;
      if (!subPhrases(key).some((part) => spellingByKey.has(part))) continue;
      shadowed.add(key);
      const probe = phraseProbe(spelling, { canonicalKey: key, canonical: spelling, everyday: false, reported: false });
      if (probe) probes.push(probe);
    }
  }

  const byRun = new Map<string, SoftProbe[]>();
  const scanned: SoftProbe[] = [];
  for (const probe of probes) {
    if (!probe.run) {
      scanned.push(probe);
      continue;
    }
    const list = byRun.get(probe.run) ?? [];
    list.push(probe);
    byRun.set(probe.run, list);
  }
  return {
    canonicalByKey,
    hardOverlapKeys,
    hardKeys: new Set([...hardKeys.soft, ...hardKeys.synonym]),
    byRun,
    scanned,
  };
}

const COMPILED = new WeakMap<readonly string[], WeakMap<readonly string[], SoftSkillScanner>>();
const NO_HARD: readonly string[] = [];

/** `compileSoftSkills`, cached per pair of list arrays (pass the same arrays every call). */
export function softSkillScanner(soft: readonly string[], hard: readonly string[] = NO_HARD): SoftSkillScanner {
  let byHard = COMPILED.get(soft);
  if (!byHard) {
    byHard = new WeakMap();
    COMPILED.set(soft, byHard);
  }
  let scanner = byHard.get(hard);
  if (!scanner) {
    scanner = compileSoftSkills(soft, hard);
    byHard.set(hard, scanner);
  }
  return scanner;
}

/** The canonical name of a listed soft skill ("strong communication skills" -> "Communication"), or null. */
export function canonicalSoftSkill(term: string, scanner: SoftSkillScanner): string | null {
  return scanner.canonicalByKey.get(softKey(term)) ?? null;
}

/** Whether a term is a hard skill as well (or a listed soft entry whose canonical one is): it stays hard. */
export function isHardSoftOverlap(term: string, scanner: SoftSkillScanner): boolean {
  const key = softKey(term);
  if (scanner.hardOverlapKeys.has(key)) return true;
  const canonical = scanner.canonicalByKey.get(key);
  return (
    scanner.hardKeys.has(key) ||
    scanner.hardKeys.has(synonymKey(term)) ||
    (canonical !== undefined &&
      (scanner.hardKeys.has(softKey(canonical)) || scanner.hardKeys.has(synonymKey(canonical))))
  );
}

// ------------------------------------------------------------------------------------------ whole list items

const BULLET_PREFIX = /^[ \t]*(?:[-*•·▪●◦‣–—>]|\d{1,3}[.)])[ \t]*/;
const LIST_LABEL =
  /^[ \t]*(?:(?:key|core|soft|personal|interpersonal|people|professional|transferable|other)[ \t]+)?(?:skills?|strengths|competenc(?:y|ies)|traits|qualities|abilities|attributes)[ \t]*[:\-–—][ \t]*/i;
const ITEM_SEPARATOR = /[,;|•·▪●◦‣/]/g;
const LABELLED_SEPARATOR = /[,;|•·▪●◦‣/]|[ \t]+(?:and|&)[ \t]+/gi;

/** A line read as a list: its items after any bullet marker or label. Read once per line and scan. */
interface ListLine {
  /** Where the items begin in the text. */
  readonly offset: number;
  readonly body: string;
  /** A bullet marker or a "Skills:" label opens the line. */
  readonly marked: boolean;
  /** `[from, to)` of each item in `body`, in order. */
  readonly items: ReadonlyArray<readonly [number, number]>;
  /** Every item has at most three words: unmarked separated text reads as a list only then. */
  readonly shortItems: boolean;
}

function listLineAt(text: string, at: number, lines: Map<number, ListLine>): ListLine {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const known = lines.get(lineStart);
  if (known) return known;
  const newline = text.indexOf('\n', lineStart);
  const line = text.slice(lineStart, newline < 0 ? text.length : newline).replace(/\r$/, '');
  let head = BULLET_PREFIX.exec(line)?.[0].length ?? 0;
  const bulleted = head > 0;
  const label = LIST_LABEL.exec(line.slice(head));
  if (label) head += label[0].length;
  const body = line.slice(head);
  const separator = label ? LABELLED_SEPARATOR : ITEM_SEPARATOR;
  const items: Array<readonly [number, number]> = [];
  let from = 0;
  separator.lastIndex = 0;
  for (let match = separator.exec(body); match; match = separator.exec(body)) {
    items.push([from, match.index]);
    from = match.index + match[0].length;
  }
  items.push([from, body.length]);
  const shortItems = items.every(([itemFrom, itemTo]) => body.slice(itemFrom, itemTo).trim().split(/\s+/).length <= 3);
  const read: ListLine = { offset: lineStart + head, body, marked: bulleted || label !== null, items, shortItems };
  lines.set(lineStart, read);
  return read;
}

/** The item holding `[from, to)`, by binary search over the line's items. */
function itemHolding(items: ListLine['items'], from: number, to: number): readonly [number, number] | null {
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (items[middle]![0] <= from) low = middle;
    else high = middle - 1;
  }
  const item = items[low];
  return item && item[0] <= from && to <= item[1] ? item : null;
}

/**
 * Whether the hit `[start, end)` is a whole item of a list line: after a bullet marker or a "Skills:" label, between
 * separators, or a line of its own (not a heading in capitals or ending in a colon). A line that is only separated
 * text, with no bullet or label, reads as a list when every item has at most three words.
 */
function isWholeListItem(text: string, start: number, end: number, lines: Map<number, ListLine>): boolean {
  const line = listLineAt(text, start, lines);
  const from = start - line.offset;
  const to = end - line.offset;
  if (from < 0) return false;
  const item = itemHolding(line.items, from, to);
  if (!item) return false;
  const before = line.body.slice(item[0], from);
  const after = line.body.slice(to, item[1]);
  if (before.trim() !== '' || !/^[\s.!:)]*$/.test(after)) return false;
  if (line.marked) return true;
  if (line.items.length === 1) {
    const hit = line.body.slice(from, to);
    const heading = /:\s*$/.test(after) || (hit === hit.toUpperCase() && /\p{Lu}.*\p{Lu}.*\p{Lu}.*\p{Lu}/u.test(hit));
    return !heading;
  }
  return line.shortItems;
}

// ----------------------------------------------------------------------------------------------- the reading

interface SoftHit {
  start: number;
  end: number;
  probe: SoftProbe;
}

export interface FindSoftSkillsOptions {
  /** At most this many, in the order the text first names them (default 40). */
  max?: number;
  /** Terms never reported as soft (a resume's declared hard skills: the person's own lists win). */
  exclude?: Iterable<string>;
}

/**
 * The soft skills a text names, by canonical name, in the order it first names them. Hits are taken longest first and
 * claim their span, so "Strong communication skills" is one hit, and a soft word inside a hard phrase ("Sprint
 * Planning", "Merge Conflict Resolution") or a technical one ("inter-service communication") is none.
 */
export function findSoftSkills(
  text: string | PreparedEvidence,
  scanner: SoftSkillScanner,
  options: FindSoftSkillsOptions = {},
): string[] {
  const evidence = typeof text === 'string' ? prepareEvidence(text) : text;
  const masked = evidence.masked;
  if (!masked) return [];
  const hits: SoftHit[] = [];
  const lines = new Map<number, ListLine>();
  const consider = (probe: SoftProbe, start: number, end: number) => {
    if (probe.reported && NEGATED_BEFORE.test(masked.slice(Math.max(0, start - 16), start))) return;
    if (probe.everyday && !isWholeListItem(masked, start, end, lines)) return;
    hits.push({ start, end, probe });
  };
  for (const [run, starts] of evidence.runs) {
    const probes = scanner.byRun.get(run);
    if (!probes) continue;
    for (const probe of probes) {
      for (const start of starts) {
        probe.pattern.lastIndex = start;
        if (probe.pattern.test(masked)) consider(probe, start, probe.pattern.lastIndex);
      }
    }
  }
  for (const probe of scanner.scanned) {
    probe.pattern.lastIndex = 0;
    for (const match of masked.matchAll(probe.pattern)) {
      const start = match.index ?? 0;
      consider(probe, start, start + match[0].length);
    }
  }

  const claimed = new Uint8Array(masked.length);
  for (const match of masked.matchAll(TECHNICAL_PHRASES)) {
    const start = match.index ?? 0;
    claimed.fill(1, start, start + match[0].length);
  }
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: SoftHit[] = [];
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
    if (hit.probe.reported) kept.push(hit);
  }

  const excluded = new Set<string>();
  for (const term of options.exclude ?? []) {
    if (typeof term !== 'string') continue;
    excluded.add(softKey(term));
    const canonical = scanner.canonicalByKey.get(softKey(term));
    if (canonical) excluded.add(softKey(canonical));
  }
  const max = options.max ?? 40;
  const seen = new Set<string>();
  const found: string[] = [];
  for (const hit of kept.sort((a, b) => a.start - b.start)) {
    const key = hit.probe.canonicalKey;
    if (seen.has(key) || excluded.has(key)) continue;
    seen.add(key);
    found.push(hit.probe.canonical);
    if (found.length >= max) break;
  }
  return found;
}
