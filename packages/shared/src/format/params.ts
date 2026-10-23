import { z } from 'zod';

// Readers for URL query values, shared by the API (Express `req.query`) and the web app (URLSearchParams). A query value
// arrives as a string, a repeated key as an array, and an absent key as undefined; these turn that into typed values
// leniently: a value that cannot be read is dropped rather than failing the whole request.

/** Anything with URLSearchParams' `getAll` (URLSearchParams itself, Next's ReadonlyURLSearchParams). */
export interface SearchParamsReader {
  getAll(name: string): string[];
}

/** Express-style parsed query, or a plain record built by hand. */
export type QueryRecord = Record<string, unknown>;

/** Every raw value of `name`, from either source, as strings. */
export function paramValues(source: SearchParamsReader | QueryRecord, name: string): string[] {
  if (typeof (source as SearchParamsReader).getAll === 'function') return (source as SearchParamsReader).getAll(name);
  const value = (source as QueryRecord)[name];
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is string | number | boolean =>
    ['string', 'number', 'boolean'].includes(typeof item),
  ).map(String);
}

/** The first value of a query key, trimmed; undefined when absent or blank. */
export function firstParam(value: unknown): string | undefined {
  const list = Array.isArray(value) ? value : [value];
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (typeof item === 'number' && Number.isFinite(item)) return String(item);
  }
  return undefined;
}

/**
 * A list value: repeated keys and, unless `split` is false, comma-separated values, each trimmed, blanks and repeats
 * dropped. Turn `split` off for values that may hold commas themselves ("San Francisco, CA").
 */
export function listParam(value: unknown, split = true): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const parts = split ? String(item).split(',') : [String(item)];
    for (const part of parts) {
      const text = part.trim();
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

const TRUE_WORDS = new Set(['1', 'true', 'yes', 'on']);
const FALSE_WORDS = new Set(['0', 'false', 'no', 'off']);

/** "1" | "true" | "yes" | "on" -> true; "0" | "false" | "no" | "off" -> false; anything else undefined. */
export function booleanParam(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const text = firstParam(value)?.toLowerCase();
  if (text === undefined) return undefined;
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  return undefined;
}

/** A finite number, or undefined. */
export function numberParam(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const text = firstParam(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A zod field for a query flag: absent or unreadable is `undefined`, never an error. */
export const queryBoolean = z.preprocess(booleanParam, z.boolean().optional());

/** A zod field for one trimmed query string. */
export const queryText = z.preprocess(firstParam, z.string().optional());

/** A zod field for a list whose items must pass `item`; items that do not are dropped. */
export function queryList<T extends z.ZodType>(item: T, split = true) {
  return z.preprocess(
    (value) =>
      listParam(value, split)
        .map((entry) => item.safeParse(entry))
        .filter((result) => result.success)
        .map((result) => result.data),
    z.array(item),
  );
}

/** A zod field for one enum value; an unknown value reads as absent. */
export function queryEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((value) => {
    const text = firstParam(value);
    return text !== undefined && (values as readonly string[]).includes(text) ? text : undefined;
  }, z.enum(values).optional());
}

/** A zod field for one number within [min, max]; anything else reads as absent. */
export function queryNumber(min = -Infinity, max = Infinity) {
  return z.preprocess((value) => {
    const parsed = numberParam(value);
    return parsed !== undefined && parsed >= min && parsed <= max ? parsed : undefined;
  }, z.number().optional());
}
