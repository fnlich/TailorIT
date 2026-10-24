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

/**
 * The MS-DOS device names Windows still reserves in every folder, whatever follows the first dot: "CON", "nul.txt",
 * "COM1.tar.gz", and the superscript ports "COM¹". Windows ignores spaces before the dot, so "CON .txt" is one too.
 */
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** Controls, format characters (bidi overrides, zero-width marks, BOM) and lone surrogates: never in a path. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}]/gu;

function isReservedName(segment: string): boolean {
  const stem = segment.split('.')[0] ?? '';
  return RESERVED_DEVICE_NAME.test(stem.trim());
}

/** Windows drops trailing dots and spaces from a name, so two names differing only in them would collide. */
function stripTrailingDotsAndSpaces(text: string): string {
  return text.replace(/[. ]+$/, '');
}

/** At most `max` UTF-16 code units (how Windows counts a path), never splitting a surrogate pair. */
export function capUtf16(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/**
 * One segment of a path inside a ZIP that unpacks safely on Windows (and everywhere else): NFC; no controls, bidi or
 * zero-width characters; `\ / |` become "-" and `< > : " ? *` a space; whitespace collapsed; no trailing dots or
 * spaces; a reserved device name ("CON", "nul.txt") gets a leading "_"; at most `maxLength` UTF-16 units. A segment
 * left empty or made only of dots ("." and ".." included) becomes `fallback`, so a path can never climb out of the
 * folder it is unpacked into.
 */
export function safePathSegment(raw: string | null | undefined, fallback: string, maxLength = 60): string {
  let segment = stripTrailingDotsAndSpaces(
    (raw ?? '')
      .normalize('NFC')
      // Tabs and line breaks separate words like spaces; the other controls simply go.
      .replace(/\s+/g, ' ')
      .replace(UNPRINTABLE, '')
      .replace(/[\\/|]/g, '-')
      .replace(/[<>:"?*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (isReservedName(segment)) segment = `_${segment}`;
  segment = stripTrailingDotsAndSpaces(capUtf16(segment, maxLength));
  // Cutting can leave a device name ("COM1x" at 4 is "COM1").
  if (isReservedName(segment)) segment = stripTrailingDotsAndSpaces(capUtf16(`_${segment}`, maxLength));
  if (!segment || /^\.+$/.test(segment)) return fallback;
  return segment;
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
