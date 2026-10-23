import type { RequestHandler } from 'express';
import multer from 'multer';
import { AppError, validationFailed } from '../http/errors';
import { cleanFileName } from './names';

// multipart/form-data uploads, held in memory (they are capped at UPLOAD_MAX_MB, under the Next proxy's body limit)
// and handed to the route as req.file. What the bytes are is checked later, by FileStore.save.

export interface UploadSingleOptions {
  /** Answer 400 when the request carries no file. Default true. */
  required?: boolean;
}

/** 413 `file_too_large`, naming the file when its name is known. */
export function fileTooLarge(originalName: string | undefined, maxMb: number): AppError {
  const name = cleanFileName(originalName, '');
  return new AppError('file_too_large', `${name || 'That file'} is larger than ${maxMb} MB. Choose a smaller file.`);
}

const CHOOSE_A_FILE = 'Choose a file to upload.';

function uploadError(error: unknown, fieldName: string, maxMb: number): AppError {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return fileTooLarge((error as { filename?: string }).filename, maxMb);
    if (error.code === 'LIMIT_FILE_COUNT' || (error.code === 'LIMIT_UNEXPECTED_FILE' && error.field === fieldName)) {
      return validationFailed('Upload one file at a time.', { [fieldName]: 'Upload one file at a time.' });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') return validationFailed(`Send the file in the "${fieldName}" field.`);
  }
  return new AppError('validation_failed', 'The upload could not be read. Please try again.', { cause: error });
}

/** Builds `uploadSingle(fieldName)` for a size cap: one file in one field, the rest of the form in req.body. */
export function createUploadSingle(maxBytes: number, maxMb: number) {
  return function uploadSingle(fieldName: string, options: UploadSingleOptions = {}): RequestHandler {
    const parse = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxBytes, files: 1, fields: 50, fieldSize: 1024 * 1024, parts: 60 },
      // Browsers send the file name as raw UTF-8; busboy's default (latin1) would garble "Résumé.pdf".
      defParamCharset: 'utf8',
    }).single(fieldName);
    return (req, res, next) => {
      parse(req, res, (error?: unknown) => {
        if (error) return next(uploadError(error, fieldName, maxMb));
        if (!req.file && options.required !== false) {
          return next(validationFailed(CHOOSE_A_FILE, { [fieldName]: CHOOSE_A_FILE }));
        }
        next();
      });
    };
  };
}
