import { AppError } from '../http/errors';
import { zipEntries } from './detect';

// A DOCX is a ZIP, and a ZIP can unpack to far more than it weighs: a 70 KB upload holding a 20 MB document.xml cost
// mammoth 3 seconds and a gigabyte, and 1 MB holding 320 MB ended the process. These limits are checked against the
// central directory before anything is unpacked (here, in the API process), and again inside the parse worker against
// what JSZip, mammoth's own unzipper, will actually read, unpacking every part with a hard cap at its declared size
// (parse-worker.mjs mirrors `docxUnpackProblem`; change the two together).

const MB = 1024 * 1024;

export interface DocxLimits {
  /** All parts together, unpacked. */
  maxUnpackedBytes: number;
  /** Any one part (document.xml or whatever the package names its main part), unpacked. */
  maxPartBytes: number;
  /** Unpacked size over packed size, checked for parts of at least `ratioFloorBytes` unpacked. */
  maxRatio: number;
  /** Small parts compress well and are harmless whatever their ratio. */
  ratioFloorBytes: number;
}

export const DOCX_LIMITS: DocxLimits = {
  maxUnpackedBytes: 25 * MB,
  maxPartBytes: 15 * MB,
  maxRatio: 100,
  ratioFloorBytes: 1 * MB,
};

export const TOO_LARGE_UNPACKED =
  'This document is too large to read once unpacked. Save a smaller copy and upload it again.';

export interface PackedPart {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

const megabytes = (bytes: number) => `${Math.round((bytes / MB) * 10) / 10} MB`;

/** Why a package is too big to unpack (for the log), or null when it is within the limits. */
export function docxUnpackProblem(parts: readonly PackedPart[], limits: DocxLimits = DOCX_LIMITS): string | null {
  let total = 0;
  for (const part of parts) {
    total += part.uncompressedSize;
    if (total > limits.maxUnpackedBytes) return `the parts unpack to more than ${megabytes(limits.maxUnpackedBytes)}`;
    if (part.uncompressedSize > limits.maxPartBytes) {
      return `${part.name} unpacks to ${megabytes(part.uncompressedSize)} (limit ${megabytes(limits.maxPartBytes)})`;
    }
    const ratio = part.uncompressedSize / Math.max(1, part.compressedSize);
    if (part.uncompressedSize >= limits.ratioFloorBytes && ratio > limits.maxRatio) {
      return `${part.name} unpacks ${Math.round(ratio)}:1 (limit ${limits.maxRatio}:1)`;
    }
  }
  return null;
}

/**
 * Refuses (413 `file_too_large`) a Word package whose central directory declares more than the limits allow. Cheap: no
 * part is unpacked. A buffer that is not a readable ZIP passes; the parser reports that itself.
 */
export function assertDocxUnpackable(buffer: Buffer): void {
  const entries = zipEntries(buffer);
  if (!entries) return;
  const problem = docxUnpackProblem(entries);
  if (problem) throw new AppError('file_too_large', TOO_LARGE_UNPACKED, { cause: new Error(problem) });
}
