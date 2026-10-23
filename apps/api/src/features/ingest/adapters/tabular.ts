import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative } from 'node:path';
import type { AppDeps } from '../../../core/context';
import { cleanMapping, readTable, rowToPosting, type ImportMapping } from '../tabular';
import { IngestError, type FetchFailure, type RawPosting, type SourceAdapter, type SourceRecord } from '../types';
import { str } from './common';

// CSV and JSON imports: the uploaded file is kept under <DATA_DIR>/ingest/imports, with the column mapping the admin
// confirmed in the source's config, so "Run now" reads it again.

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

/** Rows as postings: the rows that are not jobs are failures naming the row. */
export function tablePostings(fileName: string, text: string, mapping: Partial<ImportMapping>): { postings: RawPosting[]; failures: FetchFailure[]; rows: number } {
  const table = readTable(fileName, text);
  const clean = cleanMapping(mapping, table.columns);
  const postings: RawPosting[] = [];
  const failures: FetchFailure[] = [];
  const seen = new Set<string>();
  table.rows.forEach((row, index) => {
    // CSV row numbers count the header, as a spreadsheet shows them; JSON items count from 1.
    const rowNumber = table.format === 'csv' ? index + 2 : index + 1;
    const result = rowToPosting(row, clean, rowNumber);
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
      const { postings, failures, rows } = tablePostings(fileName, text, mapping);
      ctx.log(`${fileName}: ${rows} rows, ${postings.length} jobs.`);
      return { postings, complete: true, failures };
    },
  };
}

export const csvAdapter = tabularAdapter('csv');
export const jsonAdapter = tabularAdapter('json');
