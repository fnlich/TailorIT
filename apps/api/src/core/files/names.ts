import { EXTENSION_BY_KIND, type FileKind } from './detect';

const MAX_NAME_LENGTH = 200;

/** Bidirectional overrides and marks, which can make "cv‮fdp.exe" display as "cvexe.pdf". */
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

/**
 * A file name safe to store and show: the last path segment only, no control or bidi-override characters, NFC, at
 * most 200 characters (keeping a short extension). `fallback` when nothing usable is left.
 */
export function cleanFileName(raw: string | undefined, fallback = 'file'): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(/\p{Cc}+/gu, '')
    .replace(BIDI_CONTROLS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^\.+$/.test(cleaned)) return fallback;
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_NAME_LENGTH - extension.length).trimEnd() + extension;
}

/** The name with its real kind's extension, so a PDF stored as "resume" downloads as "resume.pdf". */
export function withExtension(name: string, kind: FileKind | null): string {
  if (!kind) return name;
  const extension = EXTENSION_BY_KIND[kind];
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
}

/**
 * A Content-Disposition header (RFC 6266): a quoted ASCII fallback for old clients plus the exact UTF-8 name in
 * `filename*` (RFC 5987), which every current browser prefers.
 */
export function contentDisposition(fileName: string, disposition: 'attachment' | 'inline' = 'attachment'): string {
  const name = cleanFileName(fileName);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
