import { CA_PROVINCES, COUNTRIES, KNOWN_CITIES, US_STATES, countryDisplayName } from './geo';

/** One place a posting names. `region` is a US state or Canadian province code when known, else the text given. */
export interface ParsedLocation {
  raw: string;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  isRemote: boolean;
}

/** Lower case, accents and dots dropped, punctuation as spaces: "U.S." -> "us", "Québec" -> "quebec". */
function foldPlace(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([code, name]) => [foldPlace(name), code]));
const PROVINCE_BY_NAME = new Map(Object.entries(CA_PROVINCES).map(([code, name]) => [foldPlace(name), code]));
const COUNTRY_BY_NAME = new Map<string, string>();
for (const [code, { name, aliases }] of Object.entries(COUNTRIES)) {
  COUNTRY_BY_NAME.set(foldPlace(name), code);
  for (const alias of aliases) COUNTRY_BY_NAME.set(alias, code);
}

/** Broad areas a remote posting is often limited to; they name no single country. */
const AREAS = new Set([
  'emea',
  'apac',
  'latam',
  'europe',
  'eu',
  'americas',
  'north america',
  'south america',
  'latin america',
  'asia',
  'asia pacific',
  'africa',
  'middle east',
  'worldwide',
  'global',
  'international',
  'world',
  'anywhere',
]);

/** Text that says "no particular place". */
const NON_PLACES = new Set(['multiple locations', 'various', 'various locations', 'tbd', 'flexible', 'n a', 'na']);
const COUNTED_LOCATIONS = /^\d+ locations?$/;

function isNonPlace(folded: string): boolean {
  return NON_PLACES.has(folded) || COUNTED_LOCATIONS.test(folded);
}

/** Time zones and working-hours notes, which are not places ("Remote (EST)", "US, Pacific Time"). */
const TIME_ZONE =
  /^(?:[ECMP][SD]T|GMT|UTC|CET|CEST|BST|AEST|AEDT|JST|SGT|HKT|NZST|NZDT|WET|EET)(?:\s*[+-]\s*\d{1,2}(?::?\d{2})?)?$|time\s*zones?|^(?:eastern|central|mountain|pacific|atlantic)(?:\s+(?:standard\s+)?time)?$/i;

type Token =
  | { kind: 'region'; code: string; country: 'US' | 'CA'; byName: boolean }
  | { kind: 'country'; code: string }
  | { kind: 'text' };

function twoLetterCode(token: string): string | null {
  const letters = token.replace(/\./g, '').trim();
  return /^[A-Za-z]{2}$/.test(letters) ? letters.toUpperCase() : null;
}

function classify(token: string): Token {
  const code = twoLetterCode(token);
  if (code) {
    if (code === 'US' || code === 'UK' || code === 'GB') return { kind: 'country', code: code === 'UK' ? 'GB' : code };
    if (US_STATES[code]) return { kind: 'region', code, country: 'US', byName: false };
    if (CA_PROVINCES[code]) return { kind: 'region', code, country: 'CA', byName: false };
    if (Object.hasOwn(COUNTRIES, code)) return { kind: 'country', code };
    return { kind: 'text' };
  }
  const folded = foldPlace(token);
  const country = COUNTRY_BY_NAME.get(folded);
  if (country && folded.length <= 3) return { kind: 'country', code: country };
  const state = STATE_BY_NAME.get(folded);
  if (state) return { kind: 'region', code: state, country: 'US', byName: true };
  const province = PROVINCE_BY_NAME.get(folded);
  if (province) return { kind: 'region', code: province, country: 'CA', byName: true };
  if (country) return { kind: 'country', code: country };
  return { kind: 'text' };
}

interface Group {
  parts: string[];
  city: string | null;
  region: string | null;
  country: string | null;
  regionInferred: boolean;
  countryInferred: boolean;
}

const blankGroup = (): Group => ({
  parts: [],
  city: null,
  region: null,
  country: null,
  regionInferred: false,
  countryInferred: false,
});

/** A well-known city's facts, looked up safely (a city named "constructor" is not Object). */
function knownCity(text: string) {
  const key = foldPlace(text);
  return Object.hasOwn(KNOWN_CITIES, key) ? KNOWN_CITIES[key] : undefined;
}

/**
 * Comma-separated tokens as places. A region or country closes the place before it, so
 * "San Francisco, CA, New York, NY" is two places and "Toronto, ON, Canada" one.
 */
function groupTokens(tokens: readonly string[]): Group[] {
  const groups: Group[] = [];
  let current = blankGroup();
  let previousCountry: string | null = null;
  const flush = () => {
    if (current.parts.length > 0) groups.push(current);
    current = blankGroup();
  };

  /** Opens a place at a city, with the region and country a well-known city implies. */
  const startCity = (token: string) => {
    const known = knownCity(token);
    if (known) {
      Object.assign(current, {
        city: known.city,
        region: known.region,
        country: known.country,
        regionInferred: true,
        countryInferred: true,
      });
    } else {
      current.city = token;
    }
    current.parts.push(token);
  };

  const places = tokens.filter((token) => !TIME_ZONE.test(token.trim()));
  places.forEach((token, index) => {
    const next = index + 1 < places.length ? classify(places[index + 1]!) : null;
    let kind = classify(token);
    const afterCountry = previousCountry;
    previousCountry = null;

    // A well-known city opening a place is that city ("New York" is New York City, "Singapore" the city).
    if (current.parts.length === 0 && knownCity(token)) {
      startCity(token);
      return;
    }

    if (kind.kind === 'region') {
      const code = twoLetterCode(token);
      const cityCountry = current.city ? knownCity(current.city)?.country : undefined;
      if (kind.byName && next?.kind === 'region') {
        // "Washington, DC", "New York, NY": a state's name followed by a region is a city.
        kind = { kind: 'text' };
      } else if (
        code &&
        Object.hasOwn(COUNTRIES, code) &&
        ((current.region && !current.regionInferred) || (cityCountry === code && cityCountry !== kind.country))
      ) {
        // "Toronto, ON, CA" and "Bangalore, IN": a code after a region, or naming the city's own country.
        kind = { kind: 'country', code };
      }
    }

    if (kind.kind === 'region') {
      const clashes =
        (current.region && !current.regionInferred && current.region !== kind.code) ||
        (current.country && !current.countryInferred && current.country !== kind.country);
      if (clashes) flush();
      current.region = kind.code;
      current.regionInferred = false;
      if (current.countryInferred || !current.country) {
        current.country = kind.country;
        current.countryInferred = true;
      }
      current.parts.push(token);
      return;
    }

    if (kind.kind === 'country') {
      // "London, England, United Kingdom": a second name of the country just read belongs to that place.
      const last = groups[groups.length - 1];
      if (current.parts.length === 0 && afterCountry === kind.code && last) {
        last.parts.push(token);
        previousCountry = kind.code;
        return;
      }
      if (current.country && !current.countryInferred) flush();
      if (current.regionInferred && current.country !== kind.code) current.region = null;
      current.country = kind.code;
      current.countryInferred = false;
      current.parts.push(token);
      flush();
      previousCountry = kind.code;
      return;
    }

    // Text after a city with no region yet is that city's region when a country follows or nothing does and it is
    // not a city itself: "Bengaluru, Karnataka, India", "Sydney, NSW", "Munich, Bavaria".
    const regionOpen = !current.region || current.regionInferred;
    const countryOpen = !current.country || current.countryInferred;
    if (current.city && regionOpen && countryOpen && (next?.kind === 'country' || (next === null && !knownCity(token)))) {
      current.region = token;
      current.regionInferred = false;
      current.parts.push(token);
      return;
    }
    flush();
    startCity(token);
  });
  flush();
  return groups;
}

const REMOTE_PHRASE =
  /\b(?:fully\s+|100%\s+)?(?:remote(?:[\s-]+(?:first|friendly|only|eligible|ok|possible|optional|option))?|work\s+from\s+(?:home|anywhere)|wfh|telecommute|virtual|anywhere(?:\s+in\s+the\s+world)?)\b/gi;
const ARRANGEMENT_PHRASE = /\b(?:hybrid|on[\s-]?site|in[\s-]office|in[\s-]person|office|hq|headquarters)\b/gi;
// Words in lower or title case only: "Remote - IN" keeps Indiana's code.
const EDGE_JUNK =
  /^(?:[\s,:;()[\]/–—-]|[Ii]n\b|[Tt]he\b|[Bb]ased\b|[Ww]ithin\b|[Oo]nly\b|[Ff]rom\b|[Aa]cross\b)+|(?:[\s,:;()[\]/–—-]|[Oo]nly\b|[Bb]ased\b)+$/g;
/** Separators of a list of countries or regions ("US/Canada", "US & Canada", "US and Canada"). */
const PLACE_LIST = /\s*(?:\/|&|\band\b)\s*/;

function cleanPart(text: string): { place: string; remote: boolean } {
  let remote = false;
  let place = text.replace(REMOTE_PHRASE, () => {
    remote = true;
    return ' ';
  });
  place = place.replace(ARRANGEMENT_PHRASE, ' ');
  // Brackets keep a place ("Toronto (Canada)", "Hybrid (Seattle, WA)") and drop a note ("(EST)", "(Travel Required)").
  place = place
    .replace(/\(([^()]*)\)/g, (_whole, inner: string) => (looksLikePlace(inner) ? `, ${inner},` : ' '))
    .replace(/[()]/g, ' ');
  for (let previous = ''; previous !== place; ) {
    previous = place;
    place = place.replace(EDGE_JUNK, '').trim();
  }
  place = place.replace(/\s+/g, ' ').trim();
  // Workday's "US-CA-San Francisco": country, region, city.
  const workday = /^([A-Z]{2,3})-([A-Z]{2})-(.+)$/.exec(place);
  if (workday && classify(workday[1]!).kind === 'country') place = `${workday[3]}, ${workday[2]}, ${workday[1]}`;
  // A list of places ("US/Canada", "US & Canada", "NY/SF") becomes comma-separated; anything else keeps its "/" or "&".
  const listed = place.split(PLACE_LIST).map((part) => part.trim());
  if (listed.length > 1 && listed.every((part) => part && isPlaceName(part))) place = listed.join(', ');
  return { place, remote };
}

// " or " in lower case, or " OR " not after a comma: "Portland, OR" is Oregon.
const SEPARATORS = /\s*(?:;|\||\n|\r|•|·|\s\/\s|\s+or\s+|(?<!,)\s+OR\s+)\s*/;

/** A region, a country or a well-known city. */
function isPlaceName(text: string): boolean {
  return classify(text).kind !== 'text' || knownCity(text) !== undefined;
}

/** Whether bracketed text names a place (any of its comma- or slash-separated parts does). */
function looksLikePlace(text: string): boolean {
  return text
    .split(/,|\/|&|\band\b/)
    .map((part) => part.replace(/\b(?:only|based)\b/gi, '').trim())
    .some((part) => part !== '' && !TIME_ZONE.test(part) && isPlaceName(part));
}

function locationKey(location: ParsedLocation): string {
  return [location.city ?? '', location.region ?? '', location.countryCode ?? '', location.isRemote ? 'r' : '']
    .join('|')
    .toLowerCase();
}

/**
 * The places a posting's location text names. Several places split on `;`, `|`, new lines, " or " and " / ", and
 * on commas between complete places ("San Francisco, CA, New York, NY"). Remote phrasing ("Remote", "Remote - US",
 * "Remote in USA", "US Remote", "Work from home") sets `isRemote` and keeps any country it names; "Hybrid" and
 * "On-site" are dropped from the place. Known cities fill in their region and country ("London" -> GB).
 */
export function parseLocations(input: string | readonly string[] | null | undefined): ParsedLocation[] {
  const texts = typeof input === 'string' ? [input] : Array.isArray(input) ? input : [];
  const out: ParsedLocation[] = [];
  const seen = new Set<string>();
  const add = (location: ParsedLocation) => {
    const key = locationKey(location);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(location);
  };

  for (const text of texts) {
    if (typeof text !== 'string') continue;
    let previousRemote = false;
    for (const rawPart of text.split(SEPARATORS)) {
      const raw = rawPart.replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const { place, remote: saysRemote } = cleanPart(raw);
      const folded = foldPlace(place);

      if (!place || AREAS.has(folded) || isNonPlace(folded) || TIME_ZONE.test(place)) {
        if (saysRemote || folded === 'anywhere') {
          add({ raw, city: null, region: null, countryCode: null, isRemote: true });
          previousRemote = true;
        } else if (place && !TIME_ZONE.test(place)) {
          // "Multiple Locations", "EMEA": kept as written. A part that was only "Hybrid" adds nothing.
          add({ raw, city: null, region: null, countryCode: null, isRemote: false });
          previousRemote = false;
        }
        continue;
      }

      const groups = groupTokens(place.split(',').map((token) => token.trim()).filter(Boolean));
      // "Remote, US or Canada": a country-only place after a remote one is remote too.
      const countryOnly = groups.every((group) => !group.city && !group.region && group.country);
      const isRemote: boolean = saysRemote || (previousRemote && countryOnly);
      for (const group of groups) {
        add({
          raw: groups.length > 1 ? group.parts.join(', ') : raw,
          city: group.city,
          region: group.region,
          countryCode: group.country,
          isRemote,
        });
      }
      previousRemote = isRemote;
    }
  }
  return out;
}

/** How a place prints: "Fremont, CA, USA", "London, UK", "Remote in USA", "Remote". */
export function formatLocation(location: Pick<ParsedLocation, 'raw' | 'city' | 'region' | 'countryCode' | 'isRemote'>): string {
  if (location.isRemote) return location.countryCode ? `Remote in ${countryDisplayName(location.countryCode)}` : 'Remote';
  const country = countryDisplayName(location.countryCode);
  const parts = [location.city, location.region, country].filter(
    (part, index, list): part is string => Boolean(part) && list.indexOf(part) === index,
  );
  return parts.length > 0 ? parts.join(', ') : location.raw;
}

/** Whether any of the places is remote. */
export function hasRemoteLocation(locations: readonly ParsedLocation[]): boolean {
  return locations.some((location) => location.isRemote);
}
