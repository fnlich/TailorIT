import { SHEET_SOURCE_LABEL, SheetSourceConfigSchema, type SheetSourceConfig } from '@tailorit/shared/ingest';
import { formatDate } from '../../../lib/format';
import type { AdminRun, AdminSource, RunTrigger } from './types';

// The words Sources and Runs show for a source (pure, so the web unit tests can import it).

/** Where a csv source's copy came from, when it is a Google Sheet import; null for every other source. */
export function sheetOf(source: Pick<AdminSource, 'kind' | 'config'>): SheetSourceConfig | null {
  if (source.kind !== 'csv') return null;
  const parsed = SheetSourceConfigSchema.safeParse(source.config.sheet);
  return parsed.success ? parsed.data : null;
}

/** What a source reads, in a few words: "Board gitlab", "Site palantir (EU)", "sheet.csv", "Job sheet, tab 10/22/2026". */
export function sourceDetail(source: Pick<AdminSource, 'kind' | 'config'>): string {
  const text = (key: string) => (typeof source.config[key] === 'string' ? (source.config[key] as string) : '');
  switch (source.kind) {
    case 'greenhouse':
      return `Board ${text('token')}`;
    case 'lever':
      return `Site ${text('site')}${text('region') === 'eu' ? ' (EU)' : ''}`;
    case 'ashby':
      return `Board ${text('board')}`;
    case 'ft_lake':
      return text('path') || 'Default database path';
    case 'csv': {
      const sheet = sheetOf(source);
      if (sheet) return `${sheet.spreadsheetTitle}, tab ${sheet.tabTitle}`;
      return text('fileName') || 'Uploaded file';
    }
    case 'json':
      return text('fileName') || 'Uploaded file';
    case 'seed':
      return text('anchor') ? `Dated from ${formatDate(text('anchor'))}` : 'Demo postings';
  }
}

/** "Run now" of a sheet source imports its stored copy again; this says so (null for other sources). */
export function runNowHint(source: Pick<AdminSource, 'kind' | 'config'>): string | null {
  const sheet = sheetOf(source);
  return sheet ? `Imports the copy read ${formatDate(sheet.readAt)} again. To read the sheet again, use Import the sheet again.` : null;
}

const TRIGGER_LABEL: Record<RunTrigger, string> = {
  schedule: 'Schedule',
  manual: 'Run now',
  upload: 'Upload',
  startup: 'Startup',
};

/** What started a run: a file is an "Upload", a Google Sheet tab an "Import". */
export function runTriggerLabel(run: Pick<AdminRun, 'trigger' | 'sourceKindLabel'>): string {
  if (run.trigger === 'upload' && run.sourceKindLabel === SHEET_SOURCE_LABEL) return 'Import';
  return TRIGGER_LABEL[run.trigger] ?? run.trigger;
}
