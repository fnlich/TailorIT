import { containsTerm, maskFalseFriends, termPattern } from './terms';

// A resume's words read once, so that many keywords can be looked up in them quickly: the Jobs card, Resume Score and
// the resume picker all score through it (`matchPreparedKeywords`), so they always agree. `evidenceHas(prepared, term)`
// answers exactly what `containsTerm(maskFalseFriends(text), term)` answers, without scanning the whole text per term.
//
// Why the shortcut is exact. `termPattern` puts a non-letter/digit (any script) before a term and after a term that
// ends in a letter or digit. So where a term matches, the text under its first ASCII letter-or-digit run is itself a
// whole run of the text: the character before it is the boundary or the term's own leading punctuation, and the one
// after it is the boundary, a space or the term's own punctuation. Indexing every run of the text by where it starts
// therefore finds every place the term can match, and a sticky test there decides. Two characters break the reasoning
// because a /iu pattern reads them as ASCII letters: KELVIN SIGN (U+212A) is "k" and LONG S (U+017F) is "s". The index
// reads them so in the text. The start is found by stepping back over the term's leading punctuation, so a term whose
// first run follows a space (which matches any run of spaces) or, to be safe, any non-ASCII character, a term with no
// ASCII run, and a term that contains U+212A or U+017F are looked up with `containsTerm` instead.

const KELVIN_SIGN = 0x212a;
const LONG_S = 0x017f;

export interface PreparedEvidence {
  /** The text with false friends blanked out (`maskFalseFriends`): what every term is tested against. */
  readonly masked: string;
  /** Each maximal run of ASCII letters and digits (lower-cased; U+212A read as "k", U+017F as "s") -> its starts. */
  readonly runs: ReadonlyMap<string, readonly number[]>;
  /** About how much memory this holds, for caches sized in bytes. */
  readonly bytes: number;
}

function isRunChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === KELVIN_SIGN ||
    code === LONG_S
  );
}

/** The text ready for many lookups: false friends masked once, and its letter-and-digit runs indexed. */
export function prepareEvidence(text: string): PreparedEvidence {
  const masked = maskFalseFriends(typeof text === 'string' ? text : '');
  const runs = new Map<string, number[]>();
  let bytes = 64 + masked.length * 2;
  const length = masked.length;
  let at = 0;
  while (at < length) {
    if (!isRunChar(masked.charCodeAt(at))) {
      at += 1;
      continue;
    }
    const start = at;
    let folds = false;
    while (at < length) {
      const code = masked.charCodeAt(at);
      if (!isRunChar(code)) break;
      if (code === KELVIN_SIGN || code === LONG_S) folds = true;
      at += 1;
    }
    let run = masked.slice(start, at).toLowerCase();
    if (folds) run = run.replace(/\u212a/g, 'k').replace(/\u017f/g, 's');
    let starts = runs.get(run);
    if (!starts) {
      starts = [];
      runs.set(run, starts);
      bytes += 48 + run.length * 2;
    }
    starts.push(start);
    bytes += 8;
  }
  return { masked, runs, bytes };
}

/**
 * How a term is looked up: its sticky pattern, tested where its first run starts less `lead` (the length of its
 * leading punctuation). `pattern` is null when the shortcut cannot be exact: a full scan decides.
 */
interface Probe {
  readonly blank: boolean;
  readonly pattern: RegExp | null;
  readonly run: string;
  readonly lead: number;
}

const PROBES = new Map<string, Probe>();
const PROBES_MAX = 8000;

function probeOf(term: string): Probe {
  let probe = PROBES.get(term);
  if (probe) return probe;
  // termPattern's own normalisation, so `lead` counts characters its pattern matches one for one.
  const normalized = term.trim().replace(/\s+/g, ' ');
  const first = /[A-Za-z0-9]+/.exec(normalized);
  const prefix = first ? normalized.slice(0, first.index) : '';
  const exact = first !== null && /^[\x21-\x7e]*$/.test(prefix) && !/[\u212a\u017f]/.test(normalized);
  probe = exact
    ? {
        blank: false,
        pattern: termPattern(normalized, { sticky: true }),
        run: first[0].toLowerCase(),
        lead: prefix.length,
      }
    : { blank: normalized === '', pattern: null, run: '', lead: 0 };
  if (PROBES.size >= PROBES_MAX) PROBES.clear();
  PROBES.set(term, probe);
  return probe;
}

/** Whether the text carries `term` as a whole word or phrase: exactly `containsTerm(masked text, term)`. */
export function evidenceHas(evidence: PreparedEvidence, term: string): boolean {
  const probe = probeOf(term);
  if (probe.blank) return false;
  const pattern = probe.pattern;
  if (!pattern) return containsTerm(evidence.masked, term);
  const starts = evidence.runs.get(probe.run);
  if (!starts) return false;
  for (const runStart of starts) {
    const start = runStart - probe.lead;
    if (start < 0) continue;
    pattern.lastIndex = start;
    if (pattern.test(evidence.masked)) return true;
  }
  return false;
}
