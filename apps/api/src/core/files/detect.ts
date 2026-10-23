// What an uploaded file really is, read from its bytes. The browser's Content-Type and the file name are the
// uploader's claims; these checks are what decide.

export const FILE_KINDS = ['pdf', 'docx', 'doc'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const MIME_BY_KIND: Record<FileKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

export const EXTENSION_BY_KIND: Record<FileKind, string> = { pdf: '.pdf', docx: '.docx', doc: '.doc' };

export function kindOfMime(mime: string): FileKind | null {
  return FILE_KINDS.find((kind) => MIME_BY_KIND[kind] === mime) ?? null;
}

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** Compound File Binary: Word 97-2003 (and other legacy Office files, and password-protected OOXML). */
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** Stream names are UTF-16LE in a CFB directory. */
const CFB_WORD_STREAM = Buffer.from('WordDocument', 'utf16le');
const CFB_ENCRYPTED_PACKAGE = Buffer.from('EncryptedPackage', 'utf16le');

const startsWith = (buffer: Buffer, magic: Buffer) =>
  buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);

export function detectFileKind(buffer: Buffer): FileKind | null {
  if (startsWith(buffer, PDF_MAGIC)) return 'pdf';
  if (startsWith(buffer, ZIP_LOCAL_HEADER)) return isWordPackage(buffer) ? 'docx' : null;
  if (startsWith(buffer, CFB_MAGIC)) return buffer.includes(CFB_WORD_STREAM) ? 'doc' : null;
  return null;
}

/** A password-protected Word/Excel/PowerPoint file: OOXML wrapped in an encrypted CFB container. */
export function isPasswordProtectedOffice(buffer: Buffer): boolean {
  return startsWith(buffer, CFB_MAGIC) && buffer.includes(CFB_ENCRYPTED_PACKAGE);
}

/**
 * A DOCX is a ZIP holding `[Content_Types].xml` and the main document part. OPC part names are case-insensitive, and
 * Word for the web sometimes names the main part word/document2.xml, so both are accepted. An .xlsx, .pptx or .odt is
 * a ZIP too, but has neither.
 */
function isWordPackage(buffer: Buffer): boolean {
  const names = zipEntryNames(buffer);
  if (!names) return false;
  const lower = names.map((name) => name.toLowerCase());
  return lower.includes('[content_types].xml') && lower.some((name) => /^word\/document\d*\.xml$/.test(name));
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_LENGTH = 22;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_LENGTH = 46;
const MAX_ENTRIES = 20_000;
const SATURATED_32 = 0xffffffff;
/** The ZIP64 extended-information extra field: the 64-bit values of the saturated 32-bit fields. */
const ZIP64_EXTRA_ID = 0x0001;

/** One central-directory entry. The sizes are what the archive declares; nothing is unpacked to read them. */
export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated (the two a DOCX uses). */
  method: number;
  /** General purpose flags: bit 0 encrypted, bit 3 sizes in a data descriptor, bit 11 UTF-8 name. */
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** The entry names in a ZIP's central directory, or null when the archive's structure does not hold together. */
export function zipEntryNames(buffer: Buffer): string[] | null {
  return zipEntries(buffer)?.map((entry) => entry.name) ?? null;
}

/**
 * The entries of a ZIP's central directory, or null when the archive's structure does not hold together. A minimal
 * reader (no decompression): find the end-of-central-directory record (the last 64 KiB may hold a comment), follow a
 * ZIP64 locator if the classic fields are saturated, then walk the central headers (ZIP64 extra fields included).
 */
export function zipEntries(buffer: Buffer): ZipEntry[] | null {
  if (buffer.length < EOCD_MIN_LENGTH) return null;
  let eocd = -1;
  const lowest = Math.max(0, buffer.length - EOCD_MIN_LENGTH - 0xffff);
  for (let at = buffer.length - EOCD_MIN_LENGTH; at >= lowest; at -= 1) {
    if (buffer.readUInt32LE(at) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(at + 20);
    if (at + EOCD_MIN_LENGTH + commentLength <= buffer.length) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return null;

  let entries = buffer.readUInt16LE(eocd + 10);
  let directorySize = buffer.readUInt32LE(eocd + 12);
  let directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || buffer.readUInt32LE(locator) !== ZIP64_LOCATOR_SIGNATURE) return null;
    const record = Number(buffer.readBigUInt64LE(locator + 8));
    if (record + 56 > buffer.length || buffer.readUInt32LE(record) !== ZIP64_EOCD_SIGNATURE) return null;
    entries = Number(buffer.readBigUInt64LE(record + 32));
    directorySize = Number(buffer.readBigUInt64LE(record + 40));
    directoryOffset = Number(buffer.readBigUInt64LE(record + 48));
  }
  if (entries > MAX_ENTRIES || directoryOffset + directorySize > buffer.length) return null;

  const found: ZipEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (at + CENTRAL_HEADER_LENGTH > buffer.length) return null;
    if (buffer.readUInt32LE(at) !== CENTRAL_HEADER_SIGNATURE) return null;
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const nameEnd = at + CENTRAL_HEADER_LENGTH + nameLength;
    const extraEnd = nameEnd + extraLength;
    if (extraEnd > buffer.length) return null;
    let uncompressedSize = buffer.readUInt32LE(at + 24);
    let compressedSize = buffer.readUInt32LE(at + 20);
    let localHeaderOffset = buffer.readUInt32LE(at + 42);
    if (uncompressedSize === SATURATED_32 || compressedSize === SATURATED_32 || localHeaderOffset === SATURATED_32) {
      // The extra field holds only the saturated values, always in this order.
      const wide = zip64Values(buffer, nameEnd, extraEnd);
      if (!wide) return null;
      let next = 0;
      if (uncompressedSize === SATURATED_32) uncompressedSize = wide[next++] ?? Number.NaN;
      if (compressedSize === SATURATED_32) compressedSize = wide[next++] ?? Number.NaN;
      if (localHeaderOffset === SATURATED_32) localHeaderOffset = wide[next++] ?? Number.NaN;
      if (![uncompressedSize, compressedSize, localHeaderOffset].every(Number.isSafeInteger)) return null;
    }
    found.push({
      // UTF-8 (general purpose flag bit 11) or CP437; the names that matter here are ASCII either way.
      name: buffer.toString('utf8', at + CENTRAL_HEADER_LENGTH, nameEnd),
      method: buffer.readUInt16LE(at + 10),
      flags: buffer.readUInt16LE(at + 8),
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    at = extraEnd + commentLength;
  }
  return found;
}

/** The 64-bit values of an entry's ZIP64 extra field (between `start` and `end`), or null when it has none. */
function zip64Values(buffer: Buffer, start: number, end: number): number[] | null {
  let at = start;
  while (at + 4 <= end) {
    const id = buffer.readUInt16LE(at);
    const dataEnd = at + 4 + buffer.readUInt16LE(at + 2);
    if (dataEnd > end) return null;
    if (id === ZIP64_EXTRA_ID) {
      const values: number[] = [];
      for (let value = at + 4; value + 8 <= dataEnd; value += 8) values.push(Number(buffer.readBigUInt64LE(value)));
      return values;
    }
    at = dataEnd;
  }
  return null;
}
