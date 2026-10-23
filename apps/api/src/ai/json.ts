// Finds the JSON value in a model's reply. The CLI has no JSON mode, so the system prompt asks for the answer between
// two sentinels; everything after that is recovery for replies that did not quite obey.

export const JSON_BEGIN = '@@BEGIN_JSON@@';
export const JSON_END = '@@END_JSON@@';

export class JsonExtractError extends Error {
  constructor(message = `The reply contained no JSON value between ${JSON_BEGIN} and ${JSON_END}.`) {
    super(message);
    this.name = 'JsonExtractError';
  }
}

type Parsed = { ok: true; value: unknown } | { ok: false };

function parse(text: string): Parsed {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

/** Text after the LAST begin marker (a model that quotes the instruction first emits it twice), up to the end marker
 *  or, for a reply cut off before it, the end of the text. */
function betweenSentinels(text: string): string | null {
  const begin = text.lastIndexOf(JSON_BEGIN);
  if (begin < 0) return null;
  const from = begin + JSON_BEGIN.length;
  const end = text.indexOf(JSON_END, from);
  return (end < 0 ? text.slice(from) : text.slice(from, end)).trim() || null;
}

/** The first ```json fence, else the first plain ``` fence. */
function fenced(text: string): string | null {
  const tagged = /```json[^\S\n]*\n?([\s\S]*?)```/i.exec(text);
  const plain = tagged ? null : /```[^\S\n]*\n([\s\S]*?)```/.exec(text);
  return (tagged ?? plain)?.[1]?.trim() || null;
}

const MAX_BALANCED_STARTS = 200;

/** The first `{...}` or `[...]` that is balanced (strings respected) and parses. */
function firstBalanced(text: string): Parsed {
  let starts = 0;
  for (let start = 0; start < text.length; start += 1) {
    const open = text[start];
    if (open !== '{' && open !== '[') continue;
    if (++starts > MAX_BALANCED_STARTS) break;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') {
        if (stack.pop() !== ch) break;
        if (stack.length === 0) {
          const result = parse(text.slice(start, i + 1));
          if (result.ok) return result;
          break;
        }
      }
    }
  }
  return { ok: false };
}

const CURLY_QUOTES = new Set(['“', '”']);

/** Index of the next character that is neither whitespace nor inside a comment. */
function nextSignificant(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    if (/\s/.test(text[i]!)) {
      i += 1;
    } else if (text.startsWith('//', i)) {
      const newline = text.indexOf('\n', i);
      i = newline < 0 ? text.length : newline;
    } else if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 2;
    } else {
      return i;
    }
  }
  return i;
}

/**
 * Undoes the unambiguous mistakes models make: curly quotes used as string delimiters, `//` and `/* *\/` comments,
 * and trailing commas. Applied only after an honest parse failed, outside strings only, and only from the first
 * `{`/`[` on, so prose before the JSON (which may hold a stray curly quote) is never reinterpreted.
 */
export function repairJson(text: string): string {
  const first = text.search(/[{[]/);
  if (first < 0) return text;
  let out = text.slice(0, first);
  let inString = false;
  let curly = false;
  for (let i = first; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (ch === '\\') {
        out += ch + (text[i + 1] ?? '');
        i += 1;
      } else if (curly ? CURLY_QUOTES.has(ch) : ch === '"') {
        inString = false;
        out += '"';
      } else {
        out += curly && ch === '"' ? '\\"' : ch;
      }
      continue;
    }
    if (ch === '"' || CURLY_QUOTES.has(ch)) {
      inString = true;
      curly = ch !== '"';
      out += '"';
    } else if (text.startsWith('//', i)) {
      const newline = text.indexOf('\n', i);
      i = (newline < 0 ? text.length : newline) - 1;
    } else if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      i = (close < 0 ? text.length : close + 2) - 1;
    } else if (ch === ',') {
      const next = text[nextSignificant(text, i + 1)];
      if (next !== '}' && next !== ']') out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * The JSON value in a model reply, by how much each source proves: the sentinels (what the model was told to emit),
 * then a ```json fence, then the whole reply, then the first balanced object or array, and only then the same
 * candidates after `repairJson`. A valid document is never rewritten. Throws JsonExtractError when nothing parses.
 */
export function extractJSON(text: string): unknown {
  const candidates: string[] = [];
  for (const candidate of [betweenSentinels(text), fenced(text), text.trim()]) {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }
  for (const candidate of candidates) {
    const result = parse(candidate);
    if (result.ok) return result.value;
  }
  for (const candidate of candidates) {
    const result = firstBalanced(candidate);
    if (result.ok) return result.value;
  }
  for (const candidate of candidates) {
    const repaired = repairJson(candidate);
    if (repaired === candidate) continue;
    const result = parse(repaired);
    if (result.ok) return result.value;
    const balanced = firstBalanced(repaired);
    if (balanced.ok) return balanced.value;
  }
  throw new JsonExtractError();
}
