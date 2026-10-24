import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative } from 'node:path';
import { SheetSourceConfigSchema, type SheetSourceConfig } from '@tailorit/shared';
import type { AppDeps } from '../../../core/context';
import { cleanMapping, readTable, rowToPosting, type CsvTableOptions, type ImportMapping, type Table } from '../tabular';
import { IngestError, type FetchFailure, type RawPosting, type SourceAdapter, type SourceRecord } from '../types';
import { str } from './common';

// CSV and JSON imports: the uploaded file is kept under <DATA_DIR>/ingest/imports, with the column mapping the admin
// confirmed in the source's config, so "Run now" reads it again. A Google Sheet import is a csv source too: its file is
// the copy of the tab read at import time, and `config.sheet` says how to read it (header row, posted date). "Run now"
// imports that copy again; it never reads the sheet.

export const IMPORTS_DIR = ['ingest', 'imports'] as const;

export function importsRoot(deps: Pick<AppDeps, 'config'>): string {
  return join(deps.config.dataDir, ...IMPORTS_DIR);
}

/** The stored file of an import source; refuses a config path that leaves the imports folder. */
export function importFilePath(deps: Pick<AppDeps, 'config'>, source: SourceRecord): string {
  const file = str(source.config.file);
  if (!file) throw new IngestError('This import has no stored file. Upload the file again.');
  const root = importsRoot(deps);
  const path = normalize(join(root, file));
  const inside = relative(root, path);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new IngestError('This import names a file outside its folder.');
  return path;
}

/** How a stored import is read: CSV options, and a posted date every row gets (a sheet tab named for its day). */
export interface TabularOptions extends CsvTableOptions {
  postedAt?: string | null;
}

/** The reading options of a Google Sheet copy: always comma-separated, numbered from the sheet's header row. */
export function sheetTabularOptions(sheet: Pick<SheetSourceConfig, 'headerRow' | 'postedAt'>): TabularOptions {
  return { delimiter: ',', firstRow: sheet.headerRow, postedAt: sheet.postedAt ? `${sheet.postedAt}T00:00:00.000Z` : null };
}

/** The `config.sheet` of a source imported from a Google Sheet, or null (a file import, or a config that is not one). */
export function sheetOfConfig(config: Record<string, unknown>): SheetSourceConfig | null {
  const parsed = SheetSourceConfigSchema.safeParse(config.sheet);
  return parsed.success ? parsed.data : null;
}

/** The reading options a stored import's config asks for (none for a file import). */
export function importOptionsOf(config: Record<string, unknown>): TabularOptions {
  const sheet = sheetOfConfig(config);
  return sheet ? sheetTabularOptions(sheet) : {};
}

/** A table's rows as postings: the rows that are not jobs are failures naming their row. */
export function postingsFromTable(
  table: Table,
  mapping: Partial<ImportMapping>,
  options: Pick<TabularOptions, 'postedAt'> = {},
): { postings: RawPosting[]; failures: FetchFailure[]; rows: number } {
  const clean = cleanMapping(mapping, table.columns);
  const postings: RawPosting[] = [];
  const failures: FetchFailure[] = [];
  const seen = new Set<string>();
  table.rows.forEach((row, index) => {
    const rowNumber = table.rowNumbers[index] ?? index + 1;
    const result = rowToPosting(row, clean, rowNumber, { postedAt: options.postedAt });
    if ('error' in result) {
      failures.push({ message: result.error });
      return;
    }
    if (seen.has(result.posting.sourceJobId)) {
      failures.push({ sourceJobId: result.posting.sourceJobId, message: `Row ${rowNumber} repeats an earlier row; it was skipped.` });
      return;
    }
    seen.add(result.posting.sourceJobId);
    postings.push(result.posting);
  });
  return { postings, failures, rows: table.rows.length };
}

/** A file's rows as postings (rows that are not jobs are failures naming the row). */
export function tablePostings(
  fileName: string,
  text: string,
  mapping: Partial<ImportMapping>,
  options: TabularOptions = {},
): { postings: RawPosting[]; failures: FetchFailure[]; rows: number } {
  return postingsFromTable(readTable(fileName, text, options), mapping, options);
}

function tabularAdapter(kind: 'csv' | 'json'): SourceAdapter {
  return {
    kind,
    async fetch(source, ctx) {
      const path = importFilePath(ctx.deps, source);
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        throw new IngestError('The uploaded file of this import is gone. Upload it again.');
      }
      const fileName = str(source.config.fileName) ?? `import.${kind}`;
      const mapping = (source.config.mapping ?? {}) as Partial<ImportMapping>;
      const sheet = sheetOfConfig(source.config);
      const { postings, failures, rows } = tablePostings(fileName, text, mapping, sheet ? sheetTabularOptions(sheet) : {});
      ctx.log(
        sheet
          ? `Google Sheet "${sheet.spreadsheetTitle}", tab "${sheet.tabTitle}" (copy read ${sheet.readAt}): ${rows} rows, ${postings.length} jobs.`
          : `${fileName}: ${rows} rows, ${postings.length} jobs.`,
      );
      return { postings, complete: true, failures };
    },
  };
}

export const csvAdapter = tabularAdapter('csv');
export const jsonAdapter = tabularAdapter('json');
