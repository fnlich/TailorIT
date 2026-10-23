import type { RequestHandler, Response } from 'express';
import type { z } from 'zod';
import type { AppDeps } from '../../core/context';
import { contentDisposition, getFileStore } from '../../core/files/index';
import { validationFailed } from '../../core/http/errors';

// Small request/response helpers shared by the cover-letter and template routers.

/**
 * Parses a request body with a shared schema. On failure the sentence is the first field's own message
 * ("Template name must be at least 3 characters long"), with every field's message in `fields`, so the editor can
 * show the exact words the contract defines.
 */
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  explain: (issue: z.core.$ZodIssue, key: string) => string | undefined = () => undefined,
): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_';
    fields[key] ??= explain(issue, key) ?? issue.message;
  }
  const [firstKey, firstMessage] = Object.entries(fields)[0] ?? ['_', 'The request is not valid.'];
  const sentence = firstKey === '_' ? 'The request is not valid.' : firstMessage;
  throw validationFailed(sentence, fields);
}

/** A title as a file name: characters Windows refuses become "-" ("Cover Letter 10/22/2026" -> "Cover Letter 10-22-2026"). */
export function downloadName(title: string, extension: string, fallback: string): string {
  const base =
    title
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\p{Cc}+/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s-]+|[.\s]+$/g, '') || fallback;
  return `${base.slice(0, 150)}.${extension}`;
}

export function sendFile(res: Response, buffer: Buffer, fileName: string, mime: string): void {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', contentDisposition(fileName));
  res.end(buffer);
}

/** multer for one `file` field, built on first use (the file store is a service registered at startup). */
export function uploadFile(deps: AppDeps): RequestHandler {
  let handler: RequestHandler | null = null;
  return (req, res, next) => {
    handler ??= getFileStore(deps).uploadSingle('file');
    handler(req, res, next);
  };
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const CONTENT_TOO_LONG = 'This document is too long to save. Shorten it, then try again.';

/** Sentences for letter fields that zod would otherwise describe in its own words. */
export function explainLetterIssue(issue: z.core.$ZodIssue, key: string): string | undefined {
  if (key === 'contentHtml' && issue.code === 'too_big') return CONTENT_TOO_LONG;
  if (key === 'jobDescription' && issue.code === 'too_big') return 'The job description is too long. Keep the most relevant part of it.';
  if (key === 'customPrompt' && issue.code === 'too_big') return 'The custom prompt is too long. Shorten it, then try again.';
  return undefined;
}
