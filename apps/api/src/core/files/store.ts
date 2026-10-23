import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RequestHandler } from 'express';
import { nowIso, type AppDeps } from '../context';
import { AppError, notFound } from '../http/errors';
import { detectFileKind, isPasswordProtectedOffice, kindOfMime, MIME_BY_KIND, type FileKind } from './detect';
import { cleanFileName } from './names';
import { assertDocxUnpackable } from './unpack';
import { createUploadSingle, fileTooLarge, type UploadSingleOptions } from './upload';

// Uploaded files live under <DATA_DIR>/files/<userId>/<fileId> (thumbnails beside them as <fileId>.thumb.png), with
// one stored_files row each. Every read is by owner: someone else's file is "not found", never "forbidden".

export const FILE_PURPOSES = ['resume', 'letter_import', 'template_import', 'job_import'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export interface StoredFile {
  id: string;
  userId: string;
  purpose: FilePurpose;
  /** The uploader's file name, cleaned (see cleanFileName). */
  originalName: string;
  /** Decided from the bytes, never from the browser's claim. */
  mime: string;
  kind: FileKind | null;
  sizeBytes: number;
  sha256: string;
  /** Relative to the files root, '/'-separated: `<userId>/<fileId>`. */
  storagePath: string;
  thumbPath: string | null;
  pageCount: number | null;
  createdAt: string;
}

export interface SaveFileInput {
  userId: string;
  purpose: FilePurpose;
  buffer: Buffer;
  originalName: string;
  /** What this upload may be. Default: PDF or DOCX. */
  accept?: readonly FileKind[];
}

export interface FileStore {
  /** <DATA_DIR>/files */
  readonly root: string;
  /** UPLOAD_MAX_MB in bytes. */
  readonly maxBytes: number;
  /**
   * Checks size and magic bytes (and, for a Word file, what it unpacks to), then stores. Throws 413 `file_too_large`
   * or 415 `unsupported_file`.
   */
  save(input: SaveFileInput): StoredFile;
  /** One of the user's files, or null (including when it is someone else's). */
  get(fileId: string, userId: string): StoredFile | null;
  /** A file and its bytes; 404 when it is not the user's or the bytes are gone. */
  read(fileId: string, userId: string): { file: StoredFile; buffer: Buffer };
  /** Deletes the row, the bytes and the thumbnail. False when it is not the user's. */
  remove(fileId: string, userId: string): boolean;
  /** Absolute path of a file's bytes (by row, or by id without an owner check: callers checked ownership). */
  pathOf(file: StoredFile | string): string;
  /** Stores (or replaces) a file's PNG thumbnail. */
  saveThumbnail(fileId: string, png: Buffer): void;
  /** The thumbnail of one of the user's files, or null. */
  readThumbnail(fileId: string, userId: string): Buffer | null;
  setPageCount(fileId: string, pageCount: number | null): void;
  /** multer middleware for one file in `fieldName` (memory storage, capped at UPLOAD_MAX_MB): sets req.file. */
  uploadSingle(fieldName: string, options?: UploadSingleOptions): RequestHandler;
}

declare module '../context' {
  interface AppServices {
    /** Uploaded file storage (core/files, registered by features/files). */
    files?: FileStore;
  }
}

/** The file store, for features that need it (registered by the files feature at startup). */
export function getFileStore(deps: Pick<AppDeps, 'services'>): FileStore {
  const store = deps.services.files;
  if (!store) throw new AppError('internal', 'File storage is not set up on this server.');
  return store;
}

interface FileRow {
  id: string;
  user_id: string;
  purpose: FilePurpose;
  original_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  thumb_path: string | null;
  page_count: number | null;
  created_at: string;
}

function toStoredFile(row: FileRow): StoredFile {
  return {
    id: row.id,
    userId: row.user_id,
    purpose: row.purpose,
    originalName: row.original_name,
    mime: row.mime,
    kind: kindOfMime(row.mime),
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    storagePath: row.storage_path,
    thumbPath: row.thumb_path,
    pageCount: row.page_count,
    createdAt: row.created_at,
  };
}

const KIND_LABEL: Record<FileKind, string> = { pdf: 'PDF', docx: 'DOCX', doc: 'DOC' };
const DEFAULT_ACCEPT: readonly FileKind[] = ['pdf', 'docx'];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** "Please upload a PDF or DOCX file." for the default; the list follows `accept`. */
function unsupportedFile(accept: readonly FileKind[], buffer: Buffer, detected: FileKind | null): AppError {
  if (isPasswordProtectedOffice(buffer)) {
    return new AppError(
      'unsupported_file',
      'That document is password-protected. Remove the password, save it, and upload it again.',
    );
  }
  const labels = accept.map((kind) => KIND_LABEL[kind]);
  const last = labels.pop() ?? 'supported';
  const message = `Please upload a ${labels.length ? `${labels.join(', ')} or ${last}` : last} file.`;
  if (detected === 'doc') {
    return new AppError('unsupported_file', `${message} Save Word 97-2003 documents as .docx first.`);
  }
  return new AppError('unsupported_file', message);
}

/** Ids become path segments, so only plain ones are allowed (ours are UUIDs). */
function assertPlainId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error(`Refusing to use "${id}" in a file path.`);
}

/** Write to a temporary name and rename, so a crash never leaves a half-written file under the real name. */
function writeAtomically(path: string, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, data, { flag: 'wx' });
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function readIfPresent(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function createFileStore(deps: AppDeps): FileStore {
  const root = join(deps.config.dataDir, 'files');
  const maxMb = deps.config.uploadMaxMb;
  const maxBytes = maxMb * 1024 * 1024;
  const absolute = (relative: string) => join(root, ...relative.split('/'));
  const rowById = (fileId: string) =>
    deps.db.prepare('SELECT * FROM stored_files WHERE id = ?').get(fileId) as FileRow | undefined;
  const ownRow = (fileId: string, userId: string) =>
    deps.db.prepare('SELECT * FROM stored_files WHERE id = ? AND user_id = ?').get(fileId, userId) as
      | FileRow
      | undefined;

  const store: FileStore = {
    root,
    maxBytes,

    save({ userId, purpose, buffer, originalName, accept = DEFAULT_ACCEPT }) {
      if (buffer.length > maxBytes) throw fileTooLarge(originalName, maxMb);
      const kind = detectFileKind(buffer);
      if (!kind || !accept.includes(kind)) throw unsupportedFile(accept, buffer, kind);
      // A ZIP bomb is refused before it is stored (and long before anything unpacks it).
      if (kind === 'docx') assertDocxUnpackable(buffer);
      assertPlainId(userId);

      const id = randomUUID();
      const storagePath = `${userId}/${id}`;
      const path = absolute(storagePath);
      writeAtomically(path, buffer);
      const row: FileRow = {
        id,
        user_id: userId,
        purpose,
        original_name: cleanFileName(originalName),
        mime: MIME_BY_KIND[kind],
        size_bytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        storage_path: storagePath,
        thumb_path: null,
        page_count: null,
        created_at: nowIso(deps),
      };
      try {
        deps.db
          .prepare(
            `INSERT INTO stored_files(id, user_id, purpose, original_name, mime, size_bytes, sha256, storage_path,
               thumb_path, page_count, created_at)
             VALUES (@id, @user_id, @purpose, @original_name, @mime, @size_bytes, @sha256, @storage_path, @thumb_path,
               @page_count, @created_at)`,
          )
          .run(row);
      } catch (error) {
        rmSync(path, { force: true });
        throw error;
      }
      return toStoredFile(row);
    },

    get(fileId, userId) {
      const row = ownRow(fileId, userId);
      return row ? toStoredFile(row) : null;
    },

    read(fileId, userId) {
      const file = store.get(fileId, userId);
      const buffer = file ? readIfPresent(absolute(file.storagePath)) : null;
      if (!file || !buffer) throw notFound('That file');
      return { file, buffer };
    },

    remove(fileId, userId) {
      const row = ownRow(fileId, userId);
      if (!row) return false;
      deps.db.prepare('DELETE FROM stored_files WHERE id = ? AND user_id = ?').run(fileId, userId);
      for (const relative of [row.storage_path, row.thumb_path]) {
        if (!relative) continue;
        try {
          rmSync(absolute(relative), { force: true });
        } catch (error) {
          deps.log.warn(`[files] could not delete ${relative}`, error);
        }
      }
      return true;
    },

    pathOf(file) {
      if (typeof file !== 'string') return absolute(file.storagePath);
      const row = rowById(file);
      if (!row) throw notFound('That file');
      return absolute(row.storage_path);
    },

    saveThumbnail(fileId, png) {
      if (!(png.length > PNG_MAGIC.length && png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC))) {
        throw new Error('A thumbnail must be a PNG image.');
      }
      const row = rowById(fileId);
      if (!row) throw notFound('That file');
      const thumbPath = `${row.storage_path}.thumb.png`;
      writeAtomically(absolute(thumbPath), png);
      deps.db.prepare('UPDATE stored_files SET thumb_path = ? WHERE id = ?').run(thumbPath, fileId);
    },

    readThumbnail(fileId, userId) {
      const row = ownRow(fileId, userId);
      return row?.thumb_path ? readIfPresent(absolute(row.thumb_path)) : null;
    },

    setPageCount(fileId, pageCount) {
      deps.db.prepare('UPDATE stored_files SET page_count = ? WHERE id = ?').run(pageCount, fileId);
    },

    uploadSingle: createUploadSingle(maxBytes, maxMb),
  };
  return store;
}
