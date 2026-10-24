import { z } from 'zod';

// Admin > Import jobs: the fields a spreadsheet column can fill, and the preview both imports answer (a CSV or JSON
// file, and a Google Sheet tab). The API's features/ingest/tabular.ts re-exports these.

export const IMPORT_FIELDS = [
  'title',
  'company',
  'url',
  'description',
  'location',
  'postedAt',
  'salary',
  'employmentType',
  'workArrangement',
  'department',
  'id',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Which column holds each field (a column name), or null when no column does. */
export type ImportMapping = Record<ImportField, string | null>;

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  title: 'Job title',
  company: 'Company',
  url: 'Job link',
  description: 'Job description',
  location: 'Location',
  postedAt: 'Posted date',
  salary: 'Salary',
  employmentType: 'Job type',
  workArrangement: 'Work arrangement',
  department: 'Department',
  id: 'Job id',
};

/** Fields a row must have to become a job. */
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ['title', 'company', 'url'];

/** A mapping as a request sends it: any of the fields, each a column name or null. */
export const ImportMappingInputSchema = z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(300).nullable());
export type ImportMappingInput = z.infer<typeof ImportMappingInputSchema>;

/** A mapping as the API answers it: every field, each a column name or null. */
export const ImportMappingSchema = z.record(z.enum(IMPORT_FIELDS), z.string().nullable());

export const ImportFieldInfoSchema = z.object({ field: z.enum(IMPORT_FIELDS), label: z.string(), required: z.boolean() });
export type ImportFieldInfo = z.infer<typeof ImportFieldInfoSchema>;

/** POST /api/admin/import/jobs/preview: the columns, the mapping in use and the first rows. Nothing is saved. */
export const ImportPreviewSchema = z.object({
  fileName: z.string(),
  format: z.enum(['csv', 'json']),
  columns: z.array(z.string()),
  mapping: ImportMappingSchema,
  fields: z.array(ImportFieldInfoSchema),
  /** Rows below the header (blank rows not counted). */
  rowCount: z.number().int(),
  /** Rows that would become jobs. */
  jobCount: z.number().int(),
  /** The first rows, each cell cut to 300 characters. */
  sample: z.array(z.record(z.string(), z.string())),
  missingRequired: z.array(z.enum(IMPORT_FIELDS)),
  /** Why rows will be skipped, naming each row (the first 20). */
  problems: z.array(z.string()),
});
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

/** Every field, none mapped. */
export function emptyImportMapping(): ImportMapping {
  return Object.fromEntries(IMPORT_FIELDS.map((field) => [field, null])) as ImportMapping;
}

/** The fields of a preview, in order, with their labels and whether a row needs them. */
export function importFieldInfo(): ImportFieldInfo[] {
  return IMPORT_FIELDS.map((field) => ({ field, label: IMPORT_FIELD_LABEL[field], required: REQUIRED_IMPORT_FIELDS.includes(field) }));
}
