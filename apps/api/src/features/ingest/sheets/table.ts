import { REQUIRED_IMPORT_FIELDS, SHEET_MAX_HEADER_ROW, SHEET_MAX_MB, SHEET_MAX_ROWS, defaultSheetSourceName, tidyText } from '@tailorit/shared';
import { validationFailed } from '../../../core/http/errors';
import { sheetTabularOptions } from '../adapters/tabular';
import { guessMapping, tableFromCsv, type Table } from '../tabular';
import type { SheetValues } from './client';

// A tab's cells as the CSV copy an import stores (pure). The copy keeps the sheet's row numbers: its first record is
// the header row, a blank row is an empty line, so record N is sheet row headerRow + N - 1, and the preview, the
// import and every later "Run now" read the same rows from the same text.

/** A tab title in A1 notation: quoted, its own quotes doubled ("It's" is 'It''s'). */
export function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** A column's letters: 0 is A, 25 is Z, 26 is AA, 701 is ZZ. */
export function columnLetter(index: number): string {
  let rest = Math.max(0, Math.trunc(index)) + 1;
  let letters = '';
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/**
 * One line of the copy, written for TailorIT's own reader only: a cell is quoted when it holds a quote, a comma or a
 * line break, and its quotes are doubled. Nothing else changes. Never use the tracker's export writer (csvCell) here:
 * it puts an apostrophe before "=", "+", "-" and "@" for spreadsheet apps, which would turn "- 5+ years" into
 * "'- 5+ years" and change every such row's change hash.
 */
export function csvLine(cells: readonly string[]): string {
  return cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',');
}

/** What Google Sheets shows (FORMATTED_VALUE) for a formula that failed: read as a blank cell, never as data. */
export const SHEET_ERROR_VALUES: ReadonlySet<string> = new Set(['#REF!', '#N/A', '#NAME?', '#VALUE!', '#DIV/0!', '#ERROR!', '#NUM!', '#NULL!']);

export interface SheetSnapshot {
  /** The copy: the header row then one line per row below it (blank rows as empty lines), CRLF line ends. */
  text: string;
  headerRow: number;
  /** A row of the first 20 that names at least two of job title, company and job link when the header row does not. */
  suggestedHeaderRow: number | null;
  notes: string[];
  /** Rows below the header up to the last one with a value (blank ones included). */
  dataRows: number;
}

export interface SnapshotOptions {
  headerRow: number;
  tabTitle: string;
  /** The tab's row count (its grid), and the last row that was read. */
  gridRowCount: number;
  lastRowRead: number;
}

const isBlank = (row: readonly string[] | undefined) => !row || row.every((cell) => cell.trim() === '');

/** The cells up to the last one with a value. */
function filledLength(row: readonly string[]): number {
  let length = row.length;
  while (length > 0 && row[length - 1]!.trim() === '') length -= 1;
  return length;
}

/** How many of job title, company and job link a row's cells name, read as column names. */
function requiredHits(row: readonly string[] | undefined): number {
  if (!row || isBlank(row)) return 0;
  const mapping = guessMapping(row.map((cell) => tidyText(cell)));
  return REQUIRED_IMPORT_FIELDS.filter((field) => mapping[field]).length;
}

/**
 * The CSV copy of a tab read from `values`. Throws 400 for an empty tab, a blank header row, more than SHEET_MAX_ROWS
 * rows below the header, or more than SHEET_MAX_MB of text. Column names: the header's text, "Column F" for a blank
 * header cell and for data past the header's last cell. Formula errors (#REF!, #N/A...) become blank, with one note.
 */
export function sheetSnapshot(values: SheetValues, options: SnapshotOptions): SheetSnapshot {
  const { headerRow, tabTitle } = options;
  const firstRow = Math.max(1, values.firstRow);
  let errorCells = 0;
  const rows = values.rows.map((row, index) => {
    const below = firstRow + index >= headerRow;
    return row.map((value) => {
      if (!SHEET_ERROR_VALUES.has(value.trim())) return value;
      if (below) errorCells += 1;
      return '';
    });
  });
  const rowAt = (sheetRow: number): string[] | undefined => (sheetRow >= firstRow ? rows[sheetRow - firstRow] : undefined);

  if (rows.every((row) => isBlank(row))) {
    const message = `The tab "${tabTitle}" is empty.`;
    throw validationFailed(message, { gid: message });
  }
  const header = rowAt(headerRow);
  if (!header || isBlank(header)) {
    const message = `Row ${headerRow} of "${tabTitle}" is empty. Enter the row that holds the column names.`;
    throw validationFailed(message, { headerRow: message });
  }

  // The rows below the header, as many as reach the last one with a value.
  const body: string[][] = [];
  let lastFilled = -1;
  for (let sheetRow = headerRow + 1; sheetRow < firstRow + rows.length; sheetRow += 1) {
    const row = rowAt(sheetRow) ?? [];
    body.push(row);
    if (!isBlank(row)) lastFilled = body.length - 1;
  }
  body.length = lastFilled + 1;
  if (body.length > SHEET_MAX_ROWS) {
    const message = `This tab has more than ${SHEET_MAX_ROWS.toLocaleString('en-US')} rows below the header row. Split it into tabs of up to ${SHEET_MAX_ROWS.toLocaleString('en-US')} rows and import each one.`;
    throw validationFailed(message, { gid: message });
  }

  let width = filledLength(header);
  for (const row of body) width = Math.max(width, filledLength(row));
  const names = Array.from({ length: width }, (_, index) => tidyText(header[index] ?? '') || `Column ${columnLetter(index)}`);

  const maxBytes = SHEET_MAX_MB * 1024 * 1024;
  const lines = [csvLine(names)];
  let bytes = Buffer.byteLength(lines[0]!);
  for (const row of body) {
    const line = isBlank(row) ? '' : csvLine(row.slice(0, width));
    bytes += Buffer.byteLength(line) + 2;
    if (bytes > maxBytes) {
      const message = `This tab holds more than ${SHEET_MAX_MB} MB of text. Split it into smaller tabs and import each one.`;
      throw validationFailed(message, { gid: message });
    }
    lines.push(line);
  }

  let suggestedHeaderRow: number | null = null;
  if (requiredHits(header) < 2) {
    const last = Math.min(SHEET_MAX_HEADER_ROW, firstRow + rows.length - 1);
    for (let sheetRow = firstRow; sheetRow <= last; sheetRow += 1) {
      if (sheetRow !== headerRow && requiredHits(rowAt(sheetRow)) >= 2) {
        suggestedHeaderRow = sheetRow;
        break;
      }
    }
  }

  const notes: string[] = [];
  if (errorCells > 0) {
    notes.push(
      errorCells === 1
        ? 'One cell holds a formula error (such as #REF! or #N/A); it was read as blank.'
        : `${errorCells} cells hold a formula error (such as #REF! or #N/A); they were read as blank.`,
    );
  }
  if (options.gridRowCount > options.lastRowRead) {
    notes.push(
      `Only rows 1 to ${options.lastRowRead.toLocaleString('en-US')} were read; this tab has ${options.gridRowCount.toLocaleString('en-US')} rows.`,
    );
  }
  return { text: lines.join('\r\n'), headerRow, suggestedHeaderRow, notes, dataRows: body.length };
}

/** The display name of a tab's stored copy: "Job sheet (10/22/2026).csv". */
export function sheetFileName(spreadsheetTitle: string, tabTitle: string): string {
  return `${defaultSheetSourceName(spreadsheetTitle, tabTitle)}.csv`;
}

/** A tab's copy and the table it reads as (the comma delimiter forced, rows numbered from the header row). */
export interface ParsedSheetTab {
  snapshot: SheetSnapshot;
  table: Table;
}

export function parseSheetTab(values: SheetValues, options: SnapshotOptions): ParsedSheetTab {
  const snapshot = sheetSnapshot(values, options);
  const table = tableFromCsv(snapshot.text, sheetTabularOptions({ headerRow: snapshot.headerRow, postedAt: null }));
  return { snapshot, table };
}
