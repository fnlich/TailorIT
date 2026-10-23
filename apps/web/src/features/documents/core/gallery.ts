import type { DocumentKind, Noun } from './types';

/*
 * The documents views' decisions, free of React (unit-testable): search matching, status lines, wording.
 */

function tidy(text: unknown): string {
  return typeof text === 'string' ? text.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
}

/** Trimmed, case-insensitive substring of any field; an empty query keeps everything. */
export function matchesQuery(query: string, fields: ReadonlyArray<string | null | undefined>): boolean {
  const needle = tidy(query).toLowerCase();
  if (!needle) return true;
  return fields.some((field) => typeof field === 'string' && tidy(field).toLowerCase().includes(needle));
}

/** "1 of 3 resumes match." (the total decides the noun's number). */
export function describeMatches(shown: number, total: number, noun: Noun): string {
  return `${shown} of ${total} ${total === 1 ? noun.one : noun.many} match.`;
}

/** Simplify: "Oops! No matching cover letters found." */
export function noMatchTitle(noun: Noun): string {
  return `Oops! No matching ${noun.many} found.`;
}

/** Simplify: "Are you sure you want to delete these 3 resumes? You won't be able to undo this action." */
export function bulkDeleteSentence(count: number, noun: Noun): string {
  const what = count === 1 ? `this ${noun.one}` : `these ${count} ${noun.many}`;
  return `Are you sure you want to delete ${what}? You won't be able to undo this action.`;
}

/** "cover letters" → "Cover Letters" (dialog titles: "Delete Cover Letters"). */
export function titleCase(text: string): string {
  return text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

/** A thumbnail's cache key: a new `updatedAt` is a new page. */
export function thumbKey(kind: DocumentKind, id: string, updatedAt: string | number | null | undefined): string {
  return `${kind}:${id}:${updatedAt ?? ''}`;
}

/** Newest first by `updatedAt`, ties by id, so the order never depends on how the server answered. */
export function newestFirst<T extends { id: string; updatedAt: string }>(items: readonly T[], pinnedId?: string | null): T[] {
  const time = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };
  return [...items].sort((a, b) => {
    if (pinnedId) {
      if (a.id === pinnedId && b.id !== pinnedId) return -1;
      if (b.id === pinnedId && a.id !== pinnedId) return 1;
    }
    const byTime = time(b.updatedAt) - time(a.updatedAt);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
