import { monthNumber, parseFlexibleDate } from '../format/dates';
import type { ResumeAnalysisData, YearsBasis } from './analysis';

// Years of experience from a resume's dates. Ranges are stored as the resume writes them ([start, end] month indexes,
// end null for "Present"); only `monthsOf(ranges, now)` reads them against today, so a stored reading never goes
// stale: a future start is skipped, an end after this month is clamped, and a "Present" role keeps counting.
//
// Dates read: MM/YYYY, M/YYYY, MM-YYYY, MM.YYYY, YYYY-MM, YYYY/MM, "Month YYYY", "Mon YYYY", "Mon. YYYY", "Sept YYYY",
// "Mon 'YY", seasons ("Summer 2021"), MM/YY in a range, full dates ("03/15/2019", "Jan 15, 2019") and a bare YYYY,
// which starts in July and ends in June (the middle of the year). Present, Current, Now, Today, Ongoing and "to date"
// end a range. A date token has digit boundaries ("2019-2021" is a range, not YYYY-MM), and the separator may have
// line breaks around it ("Jan 2020 -\nPresent").

/** [start, end] month indexes (year * 12 + month - 1) as written; end null for Present. */
export type MonthRange = readonly [start: number, end: number | null];

/** Years a date is read in at all: anything else is a typo or not a date. Today's limits apply in `monthsOf`. */
const FIRST_YEAR = 1950;
const LAST_YEAR = 2099;

export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

const MONTH_WORDS = String.raw`jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter`;
const SEASON_MONTH: Readonly<Record<string, number>> = { spring: 4, summer: 7, fall: 10, autumn: 10, winter: 1 };
const MONTH_WORD = String.raw`(?:${MONTH_WORDS})\.?(?![\p{L}])`;
const YEAR = String.raw`(?:19[5-9]\d|20\d\d)`;
const MONTH_NUMBER = String.raw`(?:0?[1-9]|1[0-2])`;
const DATE = [
  String.raw`\d{1,2}[/.\-]\d{1,2}[/.\-]${YEAR}`,
  String.raw`${YEAR}-\d{1,2}-\d{1,2}`,
  String.raw`${MONTH_WORD}\s*\d{1,2}(?:st|nd|rd|th)?,?\s+${YEAR}`,
  String.raw`${MONTH_WORD},?\s*(?:${YEAR}|['’‘]\d{2})`,
  String.raw`${MONTH_NUMBER}\s*[/.\-]\s*${YEAR}`,
  String.raw`${YEAR}\s*[/\-]\s*${MONTH_NUMBER}`,
  String.raw`${MONTH_NUMBER}/\d{2}`,
  YEAR,
].join('|');
const DATE_TOKEN = String.raw`(?<![\p{L}\p{N}])(?:${DATE})(?![\p{N}])`;
const END_WORDS = String.raw`present|current(?:ly)?|now|today|ongoing|to\s+date|till\s+date|till\s+now|date`;
const SEPARATOR = String.raw`\s*(?:[-–—\u2212\u2012~]+|(?<=\s)(?:to|until|till|through|thru)(?=\s))\s*`;
const RANGE = new RegExp(String.raw`(${DATE_TOKEN})${SEPARATOR}(${DATE_TOKEN}|(?:${END_WORDS})(?![\p{L}]))`, 'giu');
const ANY_DATE = new RegExp(DATE_TOKEN, 'iu');
const END_ONLY = new RegExp(String.raw`^(?:${END_WORDS})$`, 'i');
const END_ANYWHERE = new RegExp(String.raw`(?<![\p{L}])(?:present|current(?:ly)?|now|today|ongoing)(?![\p{L}])`, 'iu');

/** A date as the resume writes it: a year, and its month when it says. */
export interface ResumeDate {
  year: number;
  month: number | null;
}

function fullYear(text: string): number {
  const digits = text.replace(/\D/g, '');
  const year = Number(digits);
  return digits.length <= 2 ? (year < 70 ? 2000 + year : 1900 + year) : year;
}

function dateOf(year: number, month: number | null): ResumeDate | null {
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) return null;
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return null;
  return { year, month };
}

/** One date token ("03/2019", "Jan 2019", "2019", "Present"), or null when it is not one. */
export function parseResumeDate(token: string): ResumeDate | 'present' | null {
  if (typeof token !== 'string') return null;
  const text = token.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (END_ONLY.test(text)) return 'present';
  let match = /^(\d{4})$/.exec(text);
  if (match) return dateOf(Number(match[1]), null);
  match = /^(\d{1,2}) ?[/.-] ?(\d{4})$/.exec(text);
  if (match) return dateOf(Number(match[2]), Number(match[1]));
  match = /^(\d{4}) ?[/-] ?(\d{1,2})$/.exec(text);
  if (match) return dateOf(Number(match[1]), Number(match[2]));
  match = /^(\d{1,2})\/(\d{2})$/.exec(text);
  if (match) return dateOf(fullYear(match[2]!), Number(match[1]));
  match = /^([a-z]+)\.?,? ?(\d{4}|['’‘]\d{2})$/i.exec(text);
  if (match) {
    const word = match[1]!.toLowerCase();
    const month = SEASON_MONTH[word] ?? monthNumber(word);
    return month ? dateOf(fullYear(match[2]!), month) : null;
  }
  // Full dates: the day says nothing about experience, so only the month is kept.
  const iso = parseFlexibleDate(text.replace(/^([a-z]+)\.? ?(\d)/i, '$1 $2'));
  if (iso) return dateOf(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
  // A numeric date that is not a real day ("03.15.2019" read day first) still says its year.
  const year = /^[\d\s/.-]+$/.test(text) ? /(?<!\d)((?:19|20)\d{2})(?!\d)/.exec(text) : null;
  return year ? dateOf(Number(year[1]), null) : null;
}

/** The first date in a free-text field ("Feb 2021 (contract)"), or Present, or null. */
function readField(text: string | null | undefined, allowPresent: boolean): ResumeDate | 'present' | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const whole = parseResumeDate(text);
  if (whole === 'present') return allowPresent ? 'present' : null;
  if (whole) return whole;
  const found = ANY_DATE.exec(text);
  const date = found ? parseResumeDate(found[0]) : null;
  if (date && date !== 'present') return date;
  return allowPresent && END_ANYWHERE.test(text) ? 'present' : null;
}

/**
 * The months a range covers, by the parse convention for bare years: a bare start is July and a bare end June (both
 * bare in one year: April to September, six months); a bare year next to a dated month of the same year spans that
 * year (January as a start, December as an end). Null for an end before the start.
 */
export function rangeOf(start: ResumeDate, end: ResumeDate | 'present'): MonthRange | null {
  if (end === 'present') return [monthIndex(start.year, start.month ?? 7), null];
  let from: number;
  let to: number;
  if (start.month === null && end.month === null) {
    if (start.year === end.year) return [monthIndex(start.year, 4), monthIndex(start.year, 9)];
    from = monthIndex(start.year, 7);
    to = monthIndex(end.year, 6);
  } else if (start.month === null) {
    from = monthIndex(start.year, start.year === end.year ? 1 : 7);
    to = monthIndex(end.year, end.month!);
  } else if (end.month === null) {
    from = monthIndex(start.year, start.month);
    to = monthIndex(end.year, end.year === start.year ? 12 : 6);
  } else {
    from = monthIndex(start.year, start.month);
    to = monthIndex(end.year, end.month);
  }
  return to < from ? null : [from, to];
}

/**
 * A built resume's experience entries as ranges, as written. An empty end on the most recent role (the latest start)
 * is Present; any other entry without a readable end counts its start month only. Entries without a start are left out.
 */
export function rangesOfEntries(
  entries: ReadonlyArray<{ startDate?: string | null; endDate?: string | null }>,
): MonthRange[] {
  const read = entries.map((entry) => {
    const start = readField(entry.startDate, false);
    const endText = typeof entry.endDate === 'string' ? entry.endDate.trim() : '';
    return { start: start === 'present' ? null : start, end: readField(endText, true), emptyEnd: endText === '' };
  });
  const startIndex = (date: ResumeDate) => monthIndex(date.year, date.month ?? 7);
  let latest = -1;
  read.forEach((entry, index) => {
    if (!entry.start) return;
    if (latest < 0 || startIndex(entry.start) > startIndex(read[latest]!.start!)) latest = index;
  });
  const ranges: MonthRange[] = [];
  read.forEach((entry, index) => {
    if (!entry.start) return;
    if (entry.end) {
      const range = rangeOf(entry.start, entry.end);
      if (range) ranges.push(range);
      return;
    }
    const from = startIndex(entry.start);
    ranges.push(entry.emptyEnd && index === latest ? [from, null] : [from, from]);
  });
  return ranges.slice(0, 50);
}

// ------------------------------------------------------------------------------------------ upload text

/** Headings that open the work-experience section of a resume (lower case, "&" read as "and"). */
const EXPERIENCE_HEADINGS: ReadonlySet<string> = new Set([
  'experience', 'work experience', 'professional experience', 'relevant experience', 'employment', 'employment history',
  'work history', 'career history', 'professional background', 'career experience', 'industry experience',
  'additional experience', 'other experience', 'previous experience', 'experience history', 'professional history',
]);

/** Headings that end it: every other section a resume has. */
const OTHER_HEADINGS: ReadonlySet<string> = new Set([
  'education', 'education and training', 'academic background', 'certifications', 'certificates', 'certification',
  'licenses', 'licences', 'licenses and certifications', 'certifications and licenses', 'projects', 'personal projects',
  'side projects', 'key projects', 'volunteering', 'volunteer experience', 'volunteer work', 'leadership experience',
  'research experience', 'teaching experience', 'skills', 'technical skills', 'core skills', 'key skills',
  'soft skills', 'skills and abilities', 'core competencies', 'competencies', 'areas of expertise', 'expertise',
  'publications', 'awards', 'honors', 'honours', 'awards and honors', 'honors and awards', 'languages', 'interests',
  'hobbies', 'references', 'courses', 'coursework', 'relevant coursework', 'training', 'activities',
  'extracurricular activities',
  'summary', 'professional summary', 'career summary', 'summary of qualifications', 'qualifications', 'profile',
  'professional profile', 'objective', 'career objective', 'about me', 'key strengths', 'strengths', 'achievements',
  'accomplishments', 'additional information', 'contact', 'contact information', 'affiliations', 'memberships',
  'professional affiliations', 'patents', 'tools', 'technologies',
]);

/** Whether a line is a section heading, and which kind: 'experience', 'other' or null. */
export function resumeHeadingOf(line: string): 'experience' | 'other' | null {
  let text = line.trim();
  if (!text || text.length > 60) return null;
  // "E X P E R I E N C E": letter-spaced headings some templates print.
  if (/^(?:\p{L} )+\p{L}$/u.test(text)) text = text.replace(/ /g, '');
  text = text
    .replace(/^[^\p{L}]+|[^\p{L})]+$/gu, '')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!text || text.split(' ').length > 5) return null;
  if (EXPERIENCE_HEADINGS.has(text)) return 'experience';
  if (OTHER_HEADINGS.has(text)) return 'other';
  const parts = text.split(/\s*(?:,|\/|\band\b)\s*/).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => EXPERIENCE_HEADINGS.has(part) || OTHER_HEADINGS.has(part))) {
    return parts.every((part) => EXPERIENCE_HEADINGS.has(part)) ? 'experience' : 'other';
  }
  return null;
}

/** The `[from, to)` line spans under an Experience heading, or null when the resume has none. */
export function experienceSections(lines: readonly string[]): Array<[number, number]> | null {
  const spans: Array<[number, number]> = [];
  let open = -1;
  lines.forEach((line, index) => {
    const heading = resumeHeadingOf(line);
    if (!heading) return;
    if (open >= 0) spans.push([open, index]);
    open = heading === 'experience' ? index + 1 : -1;
  });
  if (open >= 0) spans.push([open, lines.length]);
  return spans.length > 0 ? spans : null;
}

/** The nouns a job title ends in (lower case): roles, so an institution on the same line is an employer. */
export const ROLE_NOUNS: ReadonlySet<string> = new Set([
  'engineer', 'developer', 'manager', 'designer', 'analyst', 'scientist', 'architect', 'consultant', 'specialist',
  'administrator', 'lead', 'director', 'intern', 'officer', 'coordinator', 'associate', 'recruiter', 'accountant',
  'researcher', 'technician', 'strategist', 'programmer', 'tester', 'writer', 'producer', 'owner', 'founder',
  'co-founder', 'cofounder', 'president', 'partner', 'head', 'principal', 'editor', 'executive', 'representative',
  'advisor', 'adviser', 'assistant', 'teacher', 'professor', 'lecturer', 'instructor', 'tutor', 'fellow', 'postdoc',
  'counselor', 'librarian', 'nurse', 'physician', 'attorney', 'counsel', 'paralegal', 'auditor', 'controller',
  'bookkeeper', 'marketer', 'agent', 'ceo', 'cto', 'cfo', 'coo', 'cio', 'ciso', 'cmo', 'cpo', 'vp', 'sre',
]);

const DEGREE_WORDS =
  /(?<![\p{L}\p{N}])(?:bachelor(?:['’]?s)?|master(?:['’]s|s)|master\s+of|associate['’]?s?\s+degree|doctorate|doctoral|ph\.?\s?d\.?|m\.b\.a\.?|mba|b\.\s?sc?\.?|m\.\s?sc\.?|m\.\s?s\.|b\.\s?a\.|m\.\s?a\.|b\.?\s?eng\.?|m\.?\s?eng\.?|msc|bsc|degree|diploma|gpa|class\s+of|boot\s?camp|coursework|graduated|graduation)(?![\p{L}\p{N}])/iu;
const DEGREE_CODES = /(?<![\p{L}\p{N}])(?:BS|BA|BBA|BSc|MSc|BEng|MEng|PhD)(?![\p{L}\p{N}])/u;
const INSTITUTION_WORDS = /(?<![\p{L}\p{N}])(?:universit(?:y|ies)|college|school|institute|academy|polytechnic)(?![\p{L}])/iu;
const WORDS = /[\p{L}][\p{L}'’-]*/gu;

/** Whether a word is a role noun ("Engineer", "engineers"). */
export function isRoleNoun(word: string): boolean {
  const lower = word.toLowerCase().replace(/['’]s$/, '');
  return ROLE_NOUNS.has(lower) || (lower.endsWith('s') && ROLE_NOUNS.has(lower.slice(0, -1)));
}

function hasRoleNoun(line: string): boolean {
  return (line.match(WORDS) ?? []).some(isRoleNoun);
}

/**
 * Whether a line reads as education: a degree word (B.S., BA, MSc, MBA, PhD, degree, diploma, GPA, bootcamp, "Class
 * of"), or a school word (university, college, institute, academy) with no job title on the same line, so a role at a
 * university still counts as work.
 */
export function isEducationLine(line: string): boolean {
  if (!line.trim()) return false;
  if (DEGREE_WORDS.test(line) || DEGREE_CODES.test(line)) return true;
  return INSTITUTION_WORDS.test(line) && !hasRoleNoun(line);
}

/** One date range a text writes, with where it is. */
export interface FoundRange {
  /** Offsets in the text. */
  start: number;
  end: number;
  /** The lines (0-based, split at "\n") its first and last characters are on: a separator may break a line. */
  startLine: number;
  endLine: number;
  range: MonthRange;
}

/** Every date range in a text, in order (no section or education rules applied). */
export function findDateRanges(text: string): FoundRange[] {
  const found: FoundRange[] = [];
  // Matches come in order, so one pointer walks the lines once.
  let line = 0;
  let nextBreak = text.indexOf('\n');
  const lineOf = (offset: number) => {
    while (nextBreak >= 0 && nextBreak < offset) {
      line += 1;
      nextBreak = text.indexOf('\n', nextBreak + 1);
    }
    return line;
  };
  for (const match of text.matchAll(RANGE)) {
    const start = parseResumeDate(match[1]!);
    const end = parseResumeDate(match[2]!);
    if (!start || start === 'present' || !end) continue;
    const range = rangeOf(start, end);
    if (!range) continue;
    const at = match.index ?? 0;
    const until = at + match[0].length;
    found.push({ start: at, end: until, startLine: lineOf(at), endLine: lineOf(until - 1), range });
  }
  return found;
}

/**
 * The work ranges of an uploaded resume's text: those under an Experience heading (up to the next known heading), or
 * every range when it has none. Education is always left out, wherever it sits (two-column PDFs mix sidebar lines
 * into the text): a range whose line reads as education, or whose line is bare dates next to a line that does
 * ("University of Washington" / "2012 - 2016"). A line that names a role keeps its range.
 */
export function rangesOfText(text: string): MonthRange[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const spans = experienceSections(lines) ?? [[0, lines.length] as [number, number]];
  const ranges: MonthRange[] = [];
  const seen = new Set<string>();
  for (const [from, to] of spans) {
    for (const found of findDateRanges(lines.slice(from, to).join('\n'))) {
      if (ranges.length >= 50) break;
      const first = from + found.startLine;
      const last = from + found.endLine;
      const own = lines.slice(first, last + 1);
      if (own.some(isEducationLine)) continue;
      const before = first - 1 >= from ? lines[first - 1] : undefined;
      const after = last + 1 < to ? lines[last + 1] : undefined;
      const educationNearby = [before, after].some((line) => line !== undefined && isEducationLine(line));
      if (educationNearby && !own.some(hasRoleNoun)) continue;
      const key = `${found.range[0]}:${found.range[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranges.push(found.range);
    }
  }
  return ranges;
}

// ------------------------------------------------------------------------------------------ reading the years

/**
 * Months of experience the ranges cover today: a range starting in the future or before 1950 is skipped, an end after
 * this month is clamped to it (Present is this month), and overlapping or adjoining ranges count once. Inclusive.
 */
export function monthsOf(ranges: readonly MonthRange[], now: Date): number {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const earliest = FIRST_YEAR * 12;
  const spans: Array<[number, number]> = [];
  for (const range of ranges) {
    const [start, end] = range;
    if (!Number.isInteger(start) || start < earliest || start > current) continue;
    const last = end === null ? current : Math.min(end, current);
    if (!Number.isInteger(last) || last < start) continue;
    spans.push([start, last]);
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let open: [number, number] | null = null;
  for (const [start, end] of spans) {
    if (open && start <= open[1] + 1) {
      open[1] = Math.max(open[1], end);
      continue;
    }
    if (open) total += open[1] - open[0] + 1;
    open = [start, end];
  }
  if (open) total += open[1] - open[0] + 1;
  return total;
}

/** Months as years, to one decimal. */
export function yearsOfMonths(months: number): number {
  return Math.round((months / 12) * 10) / 10;
}

/**
 * A reading's years of experience today. The editor's field wins (basis 'field'); otherwise the larger of the dates'
 * total and a total the resume states, dates on a tie. Null when neither says.
 */
export function yearsOf(
  data: Pick<ResumeAnalysisData, 'experience' | 'yearsStated' | 'yearsStatedBasis'>,
  now: Date,
): { years: number | null; basis: YearsBasis | null } {
  const given = data.yearsStated;
  const stated = typeof given === 'number' && Number.isFinite(given) ? Math.min(80, Math.max(0, given)) : null;
  if (data.yearsStatedBasis === 'field' && stated !== null) return { years: stated, basis: 'field' };
  const months = monthsOf(data.experience ?? [], now);
  const fromDates = months > 0 ? Math.min(80, yearsOfMonths(months)) : null;
  if (fromDates === null && stated === null) return { years: null, basis: null };
  if (stated === null || (fromDates !== null && fromDates >= stated)) return { years: fromDates, basis: 'dates' };
  return { years: stated, basis: 'stated' };
}
