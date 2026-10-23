// The job search box as an FTS5 query. What a person types is never passed to MATCH as-is: every word becomes a
// quoted phrase (so FTS operators, quotes, column filters and stray punctuation mean nothing), and only the columns
// Simplify searches are matched: title, company name and locations (not the description).

/** The most words of a search that count; the rest are ignored. */
export const MAX_SEARCH_WORDS = 10;

/** FTS5 columns the search box matches (jobs_fts also indexes description_text, which it leaves out). */
export const SEARCH_COLUMNS = ['title', 'company_name', 'locations_text'] as const;

/** bm25 weights in jobs_fts column order (title, company_name, locations_text, description_text): title counts most. */
export const BM25_WEIGHTS = [10, 6, 3, 1] as const;

/** Lower case, accents removed: the same folding the index's `unicode61 remove_diacritics 2` tokenizer applies. */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** The index's tokens of one typed word: "Node.js" -> ["node", "js"], "C++" -> ["c"], "Sr." -> ["sr"]. */
function tokensOf(word: string): string[] {
  return fold(word).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The words of a search as token groups, at most MAX_SEARCH_WORDS. A word with several tokens ("node.js") stays one
 * group, matched as a phrase.
 */
export function searchWords(q: string | null | undefined): string[][] {
  if (typeof q !== 'string') return [];
  const groups: string[][] = [];
  for (const word of q.split(/\s+/)) {
    const tokens = tokensOf(word);
    if (tokens.length > 0) groups.push(tokens);
    if (groups.length >= MAX_SEARCH_WORDS) break;
  }
  return groups;
}

/** Shortest word matched as a prefix ("eng" finds "Engineer"); the last word, still being typed, from 2 letters. */
const PREFIX_MIN = 3;
const LAST_PREFIX_MIN = 2;

/**
 * The FTS5 MATCH expression for a search, or null when it has no searchable word. Every word must match (in any of
 * the searched columns). Words of 3+ characters match as prefixes (free_tailor's rule: "sen eng" finds "Senior
 * Engineer"), and so does the last word from 2 characters (search-as-you-type); shorter words must match whole, as a
 * single letter would match nearly everything.
 *
 *   "senior data en" -> {title company_name locations_text} : ("senior"* "data"* "en"*)
 */
export function buildFtsQuery(q: string | null | undefined): string | null {
  const groups = searchWords(q);
  if (groups.length === 0) return null;
  const phrases = groups.map((tokens, index) => {
    // Tokens are letters and digits only, so they need no escaping inside the quotes.
    const phrase = `"${tokens.join(' ')}"`;
    const lastToken = tokens[tokens.length - 1] ?? '';
    const min = index === groups.length - 1 ? LAST_PREFIX_MIN : PREFIX_MIN;
    return lastToken.length >= min ? `${phrase}*` : phrase;
  });
  return `{${SEARCH_COLUMNS.join(' ')}} : (${phrases.join(' ')})`;
}
