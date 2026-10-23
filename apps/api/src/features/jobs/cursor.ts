// Keyset pagination for GET /api/jobs. A cursor is the sort key and id of the last job of a page, so the next page
// starts right after it even when jobs are added, hidden or applied to in between (an offset would skip or repeat).
// It is opaque to the browser: base64url JSON.

/** How a page is ordered once "Most relevant" is resolved: by bm25 rank with a search, by posting date without. */
export type OrderMode = 'rank' | 'posted' | 'updated' | 'salary';

export interface JobsCursor {
  mode: OrderMode;
  /** The last job's sort key: bm25 rank (number), an ISO time (string) or yearly USD (number). */
  key: string | number;
  id: number;
}

const VERSION = 1;
const MODES: readonly OrderMode[] = ['rank', 'posted', 'updated', 'salary'];

export function encodeCursor(cursor: JobsCursor): string {
  return Buffer.from(JSON.stringify([VERSION, cursor.mode, cursor.key, cursor.id]), 'utf8').toString('base64url');
}

/**
 * The cursor, or null when it is unreadable, from another version, or for a different ordering than `mode` (the sort
 * changed: the list starts again from the top instead of failing).
 */
export function decodeCursor(text: string | null | undefined, mode: OrderMode): JobsCursor | null {
  if (typeof text !== 'string' || !text || text.length > 500) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [version, cursorMode, key, id] = value as unknown[];
  if (version !== VERSION || cursorMode !== mode || !MODES.includes(cursorMode as OrderMode)) return null;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return null;
  const numeric = mode === 'rank' || mode === 'salary';
  if (numeric ? typeof key !== 'number' || !Number.isFinite(key) : typeof key !== 'string' || key.length > 64) return null;
  return { mode, key: key as string | number, id };
}
