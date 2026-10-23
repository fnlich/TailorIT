import type { SalaryPeriod } from './enums';

/** A pay range as a posting states it. Either end may be missing ("$120k+", "up to $150k"), never both. */
export interface ParsedSalary {
  min: number | null;
  max: number | null;
  /** ISO 4217, or null when the text names none (the caller may default it from the location). */
  currency: string | null;
  period: SalaryPeriod | null;
}

/** Periods the tracker's pay-period select also offers ("Bi-Weekly"); jobs store only `SalaryPeriod`. */
export type PayPeriod = SalaryPeriod | 'biweek';

/** Pay periods per year. */
export const PERIODS_PER_YEAR: Record<PayPeriod, number> = {
  hour: 2080,
  day: 260,
  week: 52,
  biweek: 26,
  month: 12,
  year: 1,
};

/** An amount paid per `period` as the same pay per year (40-hour weeks, 260 working days); unknown periods are yearly. */
export function annualize(amount: number, period: PayPeriod | null | undefined): number {
  return amount * (period && Object.hasOwn(PERIODS_PER_YEAR, period) ? PERIODS_PER_YEAR[period] : 1);
}

/**
 * US dollars per unit of each currency: a static table, good enough to sort and filter salaries by one scale (the
 * Minimum salary slider), never for showing a converted amount.
 */
export const FX_USD_PER_UNIT: Readonly<Record<string, number>> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  AUD: 0.66,
  NZD: 0.6,
  CHF: 1.12,
  JPY: 0.0067,
  CNY: 0.14,
  HKD: 0.128,
  SGD: 0.74,
  TWD: 0.031,
  KRW: 0.00074,
  INR: 0.012,
  PKR: 0.0036,
  BDT: 0.0085,
  PHP: 0.018,
  IDR: 0.000063,
  MYR: 0.22,
  THB: 0.028,
  VND: 0.00004,
  SEK: 0.095,
  NOK: 0.093,
  DKK: 0.145,
  PLN: 0.25,
  CZK: 0.043,
  HUF: 0.0028,
  RON: 0.22,
  UAH: 0.024,
  TRY: 0.03,
  ILS: 0.27,
  AED: 0.27,
  SAR: 0.27,
  EGP: 0.02,
  ZAR: 0.055,
  NGN: 0.00065,
  KES: 0.0077,
  BRL: 0.18,
  MXN: 0.055,
  ARS: 0.0011,
  CLP: 0.0011,
  COP: 0.00025,
};

function fxRate(currency: string): number | undefined {
  const code = currency.toUpperCase();
  return Object.hasOwn(FX_USD_PER_UNIT, code) ? FX_USD_PER_UNIT[code] : undefined;
}

/**
 * A range as yearly US dollars (`salary_annual_usd_*`), rounded; a missing end stays null. Null when there is no
 * amount or the currency is not in the table. A null currency is read as USD.
 */
export function toAnnualUsd(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
  period: PayPeriod | null | undefined,
): { min: number | null; max: number | null } | null {
  const rate = fxRate(currency ?? 'USD');
  const valid = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (rate === undefined || (!valid(min) && !valid(max))) return null;
  const convert = (value: number | null | undefined) => (valid(value) ? Math.round(annualize(value, period) * rate) : null);
  return { min: convert(min), max: convert(max) };
}

/** Marks written before an amount, longest first ("CA$" before "$"). */
const PREFIX_MARKS: ReadonlyArray<readonly [string, string]> = [
  ['US$', 'USD'],
  ['CA$', 'CAD'],
  ['AU$', 'AUD'],
  ['NZ$', 'NZD'],
  ['HK$', 'HKD'],
  ['MX$', 'MXN'],
  ['C$', 'CAD'],
  ['A$', 'AUD'],
  ['S$', 'SGD'],
  ['R$', 'BRL'],
  ['$', 'USD'],
  ['£', 'GBP'],
  ['€', 'EUR'],
  ['¥', 'JPY'],
  ['₹', 'INR'],
  ['₩', 'KRW'],
  ['₪', 'ILS'],
  ['₱', 'PHP'],
  ['Rs.', 'INR'],
  ['Rs', 'INR'],
];

/** Marks written after an amount ("65.000 €", "5 000 zł", "150,000 dollars"). */
const SUFFIX_MARKS: ReadonlyArray<readonly [string, string]> = [
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['zł', 'PLN'],
  ['₹', 'INR'],
  ['¥', 'JPY'],
  ['₩', 'KRW'],
  ['₪', 'ILS'],
  ['₱', 'PHP'],
  ['dollars', 'USD'],
  ['euros', 'EUR'],
];

const CURRENCY_CODES = Object.keys(FX_USD_PER_UNIT);
const PREFIX_BY_TEXT = new Map(PREFIX_MARKS);
const SUFFIX_BY_TEXT = new Map(SUFFIX_MARKS);
/** Dollars a bare "$" may stand for when the text names the code elsewhere ("Salary (CAD): $90,000"). */
const DOLLAR_CODES = ['CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN'];
/** Codes that are also common words or technologies ("PHP 7"): they need a pay-sized amount to count. */
const AMBIGUOUS_CODES = new Set(['PHP', 'TRY', 'COP', 'ARS', 'SAR']);

/** How each currency prints before an amount ("$120k", "£325k", "CA$90k"); unknown codes print as "XYZ ". */
export const CURRENCY_SYMBOL: Readonly<Record<string, string>> = {
  USD: '$',
  GBP: '£',
  EUR: '€',
  JPY: '¥',
  INR: '₹',
  KRW: '₩',
  ILS: '₪',
  PHP: '₱',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  SGD: 'S$',
  HKD: 'HK$',
  MXN: 'MX$',
  BRL: 'R$',
  CNY: 'CN¥',
};

const NBSP = String.fromCharCode(0xa0);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Word marks ("Rs", "dollars") must stand alone, not end or begin a longer word.
const markSource = (mark: string) => (/^[A-Za-z]/.test(mark) ? `(?<![A-Za-z])${escape(mark)}(?![A-Za-z])` : escape(mark));
const PREFIX_SOURCE = PREFIX_MARKS.map(([mark]) => markSource(mark)).join('|');
const SUFFIX_SOURCE = SUFFIX_MARKS.map(([mark]) => markSource(mark)).join('|');
// Case-sensitive on purpose: a currency code counts only in capitals ("try 100" is not Turkish lira).
const CODE_SOURCE = `(?<![A-Za-z])(?:${CURRENCY_CODES.join('|')})(?![A-Za-z])`;
const GAP = `[ ${NBSP}]?`;
const NUMBER_SOURCE = [
  // 120,000 / 1,234,567 / Indian 10,00,000: the last group always has three digits.
  '\\d{1,3}(?:,\\d{2})*(?:,\\d{3})+(?:\\.\\d{1,2})?',
  // 50.000 / 1.250.000,00
  '\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?',
  // Swiss 120'000
  "\\d{1,3}(?:['’]\\d{3})+(?:\\.\\d{1,2})?",
  // 45 000 €: space-grouped thousands only before a mark or code that is written that way.
  `\\d{1,3}(?:[ ${NBSP}]\\d{3})+(?:,\\d{1,2})?(?=${GAP}(?:${SUFFIX_SOURCE}|(?:EUR|PLN|SEK|NOK|DKK|CZK|HUF|RON|CHF)(?![A-Za-z])))`,
  '\\d+(?:[.,]\\d+)?',
].join('|');
const AMOUNT = new RegExp(
  `(?<code1>${CODE_SOURCE})?${GAP}(?<pre>${PREFIX_SOURCE})?${GAP}` +
    `(?<num>${NUMBER_SOURCE})` +
    `(?:${GAP}(?<mult>[kK]|[mM]{1,2}|[tT]housand|[mM]illion|LPA|lpa|[lL]akhs?|[lL]acs?|[cC]rores?|[cC]r)(?![A-Za-z]))?` +
    `(?:${GAP}(?<suffix>${SUFFIX_SOURCE}))?` +
    `(?:${GAP}(?<code2>${CODE_SOURCE}))?`,
  'g',
);

const MULTIPLIER: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  lpa: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  cr: 1e7,
  crore: 1e7,
  crores: 1e7,
};

interface AmountToken {
  start: number;
  end: number;
  value: number;
  multiplied: boolean;
  multiplier: number;
  /** A currency code written with the amount ("USD 100k", "$90k CAD"). */
  code: string | null;
  /** The currency of a mark ("$", "£", "65.000 €"). */
  symbol: string | null;
  /** The mark was a bare "$" (it may be another dollar). */
  bareDollar: boolean;
  /** Carries a mark, a multiplier or an unambiguous code: pay on its own. */
  strong: boolean;
  lakhsPerAnnum: boolean;
}

function readNumber(text: string): number {
  if (/^\d{1,3}(?:,\d{2})*(?:,\d{3})+(?:\.\d+)?$/.test(text)) return Number(text.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) return Number(text.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(?:['’]\d{3})+(?:\.\d+)?$/.test(text)) return Number(text.replace(/['’]/g, ''));
  if (/\s/.test(text)) return Number(text.replace(/\s/g, '').replace(',', '.'));
  if (/^\d+,\d{1,2}$/.test(text)) return Number(text.replace(',', '.'));
  return Number(text.replace(/,/g, ''));
}

function tokensOf(text: string): AmountToken[] {
  const tokens: AmountToken[] = [];
  for (const match of text.matchAll(AMOUNT)) {
    const groups = match.groups ?? {};
    const num = groups.num;
    if (!num) continue;
    const at = match.index ?? 0;
    const end = at + match[0].length;
    const multText = groups.mult?.toLowerCase();
    const code = groups.code1 ?? groups.code2 ?? null;
    const symbol =
      (groups.pre ? PREFIX_BY_TEXT.get(groups.pre) : undefined) ??
      (groups.suffix ? SUFFIX_BY_TEXT.get(groups.suffix) : undefined) ??
      null;
    // "401k", "403(b)": retirement plans; "20%": a share, not pay.
    if (!code && !symbol && /^40[13]$/.test(num) && (multText === 'k' || /^\s?\(?[kb]\)?/i.test(text.slice(end)))) {
      continue;
    }
    if (text.charAt(end) === '%') continue;
    // A bare "m" after a number with no currency is too often minutes or metres.
    const multiplier = multText && !(multText === 'm' && !code && !symbol) ? (MULTIPLIER[multText] ?? 1) : 1;
    const value = readNumber(num) * multiplier;
    if (!Number.isFinite(value)) continue;
    const multiplied = multiplier !== 1;
    const codeCounts = code !== null && (multiplied || value >= 100) && !(AMBIGUOUS_CODES.has(code) && value < 1000);
    tokens.push({
      start: at + (match[0].length - match[0].trimStart().length),
      end,
      value,
      multiplied,
      multiplier,
      code,
      symbol,
      bareDollar: groups.pre === '$',
      strong: multiplied || symbol !== null || codeCounts,
      lakhsPerAnnum: multText === 'lpa',
    });
  }
  return tokens;
}

/** A pay period written right after an amount: "/hr", " per year", " an hour", " annually". */
const PERIOD_RIGHT_AFTER: ReadonlyArray<readonly [PayPeriod, RegExp]> = [
  ['biweek', /^\s*(?:bi-?weekly\b|every (?:two|2) weeks\b)/i],
  ['hour', /^\s*(?:(?:\/|per\s+|an?\s+)(?:hr|hour)s?\b|\/h\b|hourly\b)/i],
  ['day', /^\s*(?:(?:\/|per\s+|a\s+)day\b|daily\b|per diem\b)/i],
  ['week', /^\s*(?:(?:\/|per\s+|a\s+)(?:wk|week)\b|weekly\b)/i],
  ['month', /^\s*(?:(?:\/|per\s+|a\s+)(?:mo|mon|month)\b|monthly\b|pcm\b)/i],
  ['year', /^\s*(?:(?:\/|per\s+|an?\s+)(?:yr|year|annum)\b|annual(?:ly)?\b|yearly\b|p\.a\.?(?![a-z])|lpa\b)/i],
];

/** Hour and year wording anywhere in the text: the only periods read away from the amount. */
const PERIOD_ANYWHERE: ReadonlyArray<readonly [PayPeriod, RegExp]> = [
  ['hour', /(?:\/|\bper\s+|\ban?\s+)(?:hr|hour)\b|\bhourly\b/i],
  ['year', /(?:\/|\bper\s+|\ban?\s+)(?:yr|year|annum)\b|\bannual(?:ly)?\b|\byearly\b/i],
];

/** The period written right after `end` (a "+" may come first), or null. */
function periodRightAfter(source: string, end: number): PayPeriod | null {
  const after = source.slice(end, end + 30).replace(/^\+/, '');
  for (const [period, pattern] of PERIOD_RIGHT_AFTER) if (pattern.test(after)) return period;
  return null;
}

function periodAnywhere(source: string): PayPeriod | null {
  let best: { period: PayPeriod; at: number } | null = null;
  for (const [period, pattern] of PERIOD_ANYWHERE) {
    const match = pattern.exec(source);
    if (match && (!best || match.index < best.at)) best = { period, at: match.index };
  }
  return best?.period ?? null;
}

/** Currencies whose pay is low in dollar terms: a yearly salary there can look like a monthly one in dollars. */
const LOWER_PAY_CURRENCIES = new Set([
  'INR', 'PKR', 'BDT', 'PHP', 'IDR', 'VND', 'EGP', 'NGN', 'KES', 'UAH', 'ARS', 'CLP', 'COP', 'BRL', 'MXN', 'TRY',
]);

/**
 * A period from the size of the pay in US dollars: under $300 an hour, under $1,000 a day, under $20k a month, else a
 * year; for lower-pay currencies under $15 an hour, under $5k a month, else a year ("10,00,000 INR" is yearly).
 */
function periodBySize(value: number, currency: string | null): SalaryPeriod {
  const usd = value * (fxRate(currency ?? 'USD') ?? 1);
  if (currency && LOWER_PAY_CURRENCIES.has(currency)) return usd < 15 ? 'hour' : usd < 5000 ? 'month' : 'year';
  if (usd < 300) return 'hour';
  if (usd < 1000) return 'day';
  if (usd < 20000) return 'month';
  return 'year';
}

/** What may stand between the two ends of a range: a dash or word, after an optional period ("$120k/yr - $150k/yr"). */
const RANGE_GAP = /^\s*(?:\/\s*(?:yr|year|hr|hour|mo|month|wk|week))?\s*(?:-|–|—|−|~|to|and)\s*$/i;
const NUMERIC_ONLY = /^[\s\d,.\-–—−~+]*$/;
const SALARY_WORDS =
  /\b(?:salary|salaries|pay|paid|compensation|base|range|wage|wages|rate|ote|earn(?:ings)?|stipend|remuneration|ctc)\b/i;
const OPEN_ABOVE_BEFORE = /(?:\bfrom|\bstarting(?:\s+at)?|\bat least|\bminimum(?:\s+of)?|\bmin\.?)\s*$/i;
const OPEN_BELOW_BEFORE = /(?:\bup to|\bmaximum(?:\s+of)?|\bmax\.?|\bas much as)\s*$/i;

/**
 * The pay range in a salary text or a sentence: "$120,000 - $150,000", "$60/hr", "£325k–£390k", "120K – 150K",
 * "USD 100k", "€50.000 - €60.000", "65.000 € - 75.000 €", "₹12-15 LPA", "$100,000 - $120,000 CAD", "$120k+",
 * "up to $150k". An amount counts when it carries a currency mark, a multiplier (k, M, LPA) or a currency code, when
 * a pay period follows it straight away ("25-30/hr"), or when the text is nothing but numbers; a bare range of five
 * figures counts in a text that talks about pay. So "5+ years", "401k", "20% bonus" and "2-3 days a week" are not
 * salaries. A currency code beats a symbol ("$90k CAD" is Canadian). The period is the one written right after the
 * amount, else hour or year wording anywhere, else inferred from the size. Null when there is no salary.
 */
export function parseSalary(text: unknown): ParsedSalary | null {
  if (typeof text !== 'string') return null;
  const source = text.replace(/\s+/g, ' ').trim();
  if (!source) return null;
  const tokens = tokensOf(source);
  const numericOnly = NUMERIC_ONLY.test(source);
  const salaryContext = SALARY_WORDS.test(source);
  // A bare number with a period after it counts in a salary field or a sentence about pay, not in any prose.
  const periodCounts = (end: number) => (salaryContext || source.length <= 40) && periodRightAfter(source, end) !== null;
  // A bare 1900-2100 is a year ("2020 - 2024"), not pay.
  const yearLike = (token: AmountToken) =>
    !token.strong && Number.isInteger(token.value) && token.value >= 1900 && token.value <= 2100;

  for (let index = 0; index < tokens.length; index += 1) {
    const first = tokens[index]!;
    const second = tokens[index + 1];
    if (second && RANGE_GAP.test(source.slice(first.end, second.start))) {
      const bareRange =
        !(yearLike(first) && yearLike(second)) &&
        (numericOnly || (salaryContext && first.value >= 10000 && second.value >= 10000));
      if (first.strong || second.strong || periodCounts(second.end) || bareRange) {
        return finish(source, first, second, second.end);
      }
    }
    if (first.strong || periodCounts(first.end) || (numericOnly && !yearLike(first))) {
      const before = source.slice(Math.max(0, first.start - 20), first.start);
      const plus = source.charAt(first.end) === '+';
      if (OPEN_BELOW_BEFORE.test(before)) return finish(source, null, first, first.end);
      if (plus || OPEN_ABOVE_BEFORE.test(before)) return finish(source, first, null, first.end + (plus ? 1 : 0));
      return finish(source, first, first, first.end);
    }
  }
  return null;
}

/** A range's currency: a code beats a symbol; a bare "$" is the dollar the text names elsewhere, else USD. */
function currencyOf(source: string, tokens: ReadonlyArray<AmountToken | null>): string | null {
  const held = tokens.filter((token): token is AmountToken => token !== null);
  const code = held.find((token) => token.code)?.code;
  if (code) return code;
  const marked = held.find((token) => token.symbol);
  if (!marked) return null;
  if (marked.bareDollar) {
    const named = DOLLAR_CODES.filter((dollar) => new RegExp(`(?<![A-Za-z])${dollar}(?![A-Za-z])`).test(source));
    if (named.length === 1) return named[0]!;
  }
  return marked.symbol;
}

function finish(source: string, low: AmountToken | null, high: AmountToken | null, end: number): ParsedSalary | null {
  let min = low?.value ?? null;
  let max = high?.value ?? null;
  // "120-150k": a bare number before (or after) a multiplied one takes its multiplier.
  if (low && high && low !== high) {
    if (!low.multiplied && high.multiplied && low.value * high.multiplier <= high.value * 1.5) {
      min = low.value * high.multiplier;
    }
    if (!high.multiplied && low.multiplied && high.value < low.value) max = high.value * low.multiplier;
  }
  if ((min !== null && min <= 0) || (max !== null && max <= 0)) return null;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const currency = currencyOf(source, [low, high]);
  const lakhs = Boolean(low?.lakhsPerAnnum || high?.lakhsPerAnnum);
  let period: PayPeriod | null = lakhs ? 'year' : (periodRightAfter(source, end) ?? periodAnywhere(source));
  if (period === 'biweek') {
    // Jobs store weekly pay; a bi-weekly amount is two weeks of it.
    min = min === null ? null : min / 2;
    max = max === null ? null : max / 2;
    period = 'week';
  }
  return { min, max, currency, period: period ?? periodBySize(max ?? min ?? 0, currency) };
}
