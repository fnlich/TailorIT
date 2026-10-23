// What makes two postings, or two company names, the same. Used by ingestion's dedupe and by the tracker when a job is
// saved. Pure string work; the API hashes `normalizeJobText` with SHA-256 for `jobs.content_hash`.

interface UrlLike {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  searchParams: Iterable<[string, string]>;
}

interface SearchParamsLike {
  toString(): string;
}

// URL and URLSearchParams exist in every browser and in Node; this package's lib types (ES only) do not declare them.
const runtime = globalThis as unknown as {
  URL?: new (input: string) => UrlLike;
  URLSearchParams?: new (init: Array<[string, string]>) => SearchParamsLike;
};

/** Query parameters that say how someone arrived at a posting, not which posting it is (compared lower-case). */
const TRACKING_PARAMETERS = new Set([
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'ref',
  'ref_src',
  'refid',
  'referrer',
  'trk',
  'trackingid',
  'gh_src',
  'lever-source',
  'lever-origin',
]);

function isTrackingParameter(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMETERS.has(lower);
}

/**
 * A job link as an identity (free_tailor's `linkKey`): http and https folded together, the host lower-case, a default
 * port and the #fragment dropped, tracking parameters (`utm_*`, `gclid`, `ref`, ...) removed and the rest sorted, one
 * trailing slash folded. The path keeps its case (boards put case-sensitive ids there). Null for anything that is not
 * an http(s) URL.
 */
export function linkKey(link: unknown): string | null {
  if (typeof link !== 'string' || !runtime.URL) return null;
  const trimmed = link.trim();
  if (!trimmed) return null;
  let url: UrlLike;
  try {
    url = new runtime.URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  const kept = [...url.searchParams]
    .filter(([name]) => !isTrackingParameter(name))
    .sort(([a, aValue], [b, bValue]) => (a === b ? aValue.localeCompare(bValue) : a.localeCompare(b)));
  const encoded = runtime.URLSearchParams
    ? new runtime.URLSearchParams(kept).toString()
    : kept.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&');
  const search = kept.length > 0 ? `?${encoded}` : '';

  let pathname = url.pathname || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  const port = url.port && url.port !== '80' && url.port !== '443' ? `:${url.port}` : '';
  return `https://${url.hostname}${port}${pathname}${search}`;
}

/** Legal suffixes dropped from the end of a company name, longest first so "pty ltd" goes before "ltd". */
const LEGAL_SUFFIXES = [
  'incorporated',
  'inc',
  'llc',
  'l l c',
  'llp',
  'lllp',
  'pllc',
  'lp',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'pc',
  'plc',
  'gmbh',
  'gmbh co kg',
  'co kg',
  'kg',
  'ag',
  'se',
  'sa',
  'sas',
  'sarl',
  'srl',
  'spa',
  'sl',
  'bv',
  'nv',
  'oy',
  'oyj',
  'ab',
  'as',
  'asa',
  'aps',
  'kk',
  'pty',
  'pty ltd',
  'pte',
  'pte ltd',
  'sdn bhd',
  'bhd',
  'ulc',
  'co ltd',
].sort((a, b) => b.length - a.length);

/**
 * A company name as a key (`companies.name_key`): symbols (TM, (R)) dropped, Unicode NFKC, lower case, full stops and
 * apostrophes removed ("S.A." -> "sa", "Macy's" -> "macys"), other punctuation as spaces ("AT&T" -> "at t"), trailing
 * legal suffixes dropped repeatedly but never down to nothing ("Acme, Inc." -> "acme"), then every space removed
 * ("Open AI" -> "openai"). '' for a name with nothing left.
 */
export function normalizeCompanyName(name: unknown): string {
  if (typeof name !== 'string') return '';
  const words = name
    .replace(/\p{S}/gu, ' ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.'‘’]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return '';
  let rest = words;
  for (let stripped = true; stripped; ) {
    stripped = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (rest.endsWith(` ${suffix}`)) {
        rest = rest.slice(0, rest.length - suffix.length - 1).trimEnd();
        stripped = true;
        break;
      }
    }
  }
  return rest.replace(/\s+/g, '');
}

/** A title for the cross-source dedupe: lower case, punctuation as spaces, whitespace collapsed. */
export function normalizeJobTitle(title: unknown): string {
  if (typeof title !== 'string') return '';
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A description's text as hashed for `content_hash`: whitespace runs as one space, ends trimmed, nothing else. */
export function normalizeJobText(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}
