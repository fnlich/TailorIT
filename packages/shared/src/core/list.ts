import { z } from 'zod';

/** Shape of every list endpoint: `{ items, total?, nextCursor? }`. `nextCursor` is opaque; absent = last page. */
export function listResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative().optional(),
    nextCursor: z.string().optional(),
  });
}

export type ListResponse<T> = { items: T[]; total?: number; nextCursor?: string };

/** ISO-8601 UTC timestamp, e.g. "2026-10-22T12:00:00.000Z". */
export const IsoDateTime = z.string().min(20).max(40);
/** Calendar date "YYYY-MM-DD" (status-event dates, applied dates). */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const IdParam = z.string().min(1).max(64);
