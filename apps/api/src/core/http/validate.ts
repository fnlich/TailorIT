import type { z } from 'zod';
import { AppError } from './errors';

/**
 * Parses untrusted input with a zod schema. On failure throws `validation_failed` with one message per field path,
 * and the first message as the overall sentence.
 */
export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown, what = 'request'): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    fields[key] ??= issue.message;
  }
  const first = result.error.issues[0];
  const where = first && first.path.length ? `${first.path.join('.')}: ` : '';
  throw new AppError('validation_failed', `The ${what} is not valid. ${where}${first?.message ?? ''}`.trim(), {
    fields,
  });
}
