import { describe, expect, it } from 'vitest';
import { AppError } from '../src/core/http/errors';
import { importOptionsOf, postingsFromTable, sheetTabularOptions, tablePostings } from '../src/features/ingest/adapters/tabular';
import { SHEET_ERROR_VALUES, columnLetter, csvLine, quoteSheetTitle, sheetFileName, sheetSnapshot } from '../src/features/ingest/sheets/table';
import { guessMapping, isWebAddress, parseCsvRecords, rowToPosting, tableFromCsv } from '../src/features/ingest/tabular';

// Work package WP12: the tabular reader's row numbers, forced delimiter, posted-date override and web-address check,
// and the CSV copy a Google Sheet tab is stored as (pure; no database, no network).

const snapshotOf = (rows: string[][], options: Partial<Parameters<typeof sheetSnapshot>[1]> = {}, firstRow = 1) =>
  sheetSnapshot({ range: "'Tab'!A1:Z100", firstRow, rows }, { headerRow: 1, tabTitle: 'Tab', gridRowCount: 1000, lastRowRead: 1000, ...options });

function thrown(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected an error');
}

describe('CSV records', () => {
  it('numbers records as a spreadsheet numbers rows: blank lines count, line breaks inside quotes do not', () => {
    expect(parseCsvRecords('a,b\r\n\r\n"multi\nline",2\n\n3,4\n')).toEqual([
      { cells: ['a', 'b'], record: 1 },
      { cells: ['multi\nline', '2'], record: 3 },
      { cells: ['3', '4'], record: 5 },
    ]);
  });

  it('numbers table rows from the first row the text starts at', () => {
    const table = tableFromCsv('Company,Job Title,Job Link\r\nAcme,Engineer,https://acme.example/1\r\n\r\nGlobex,Designer,https://globex.example/2', { firstRow: 3 });
    expect(table.rowNumbers).toEqual([4, 6]);
    expect(tableFromCsv('Company,Job Title\n\nAcme,Engineer').rowNumbers).toEqual([3]);
  });

  it('reads a forced comma delimiter when the header holds semicolons in quotes', () => {
    const text = '"Pay; USD; yearly",Company\r\n"100; 200",Acme';
    expect(tableFromCsv(text).columns).not.toEqual(['Pay; USD; yearly', 'Company']);
    const table = tableFromCsv(text, { delimiter: ',' });
    expect(table.columns).toEqual(['Pay; USD; yearly', 'Company']);
    expect(table.rows).toEqual([{ 'Pay; USD; yearly': '100; 200', Company: 'Acme' }]);
  });
});

describe('rows as postings', () => {
  const mapping = guessMapping(['Company', 'Job Title', 'Job Link', 'Date']);

  it("gives every row the tab's date when asked, whatever the date column says", () => {
    const row = { Company: 'Acme', 'Job Title': 'Engineer', 'Job Link': 'https://acme.example/1', Date: '10/01/2026' };
    const own = rowToPosting(row, mapping, 2);
    expect('posting' in own && own.posting.postedAt).toBe('2026-10-01T00:00:00.000Z');
    const fromTab = rowToPosting(row, mapping, 2, { postedAt: '2026-10-22T00:00:00.000Z' });
    expect('posting' in fromTab && fromTab.posting.postedAt).toBe('2026-10-22T00:00:00.000Z');
  });

  it('knows a web address from a link label', () => {
    for (const text of ['acme.example/jobs/1', 'https://acme.example', 'http://10.0.0.5/jobs', 'https://[::1]:8443/x', 'HTTPS://Boards.Example.com/a?b=c']) {
      expect([text, isWebAddress(text)]).toEqual([text, true]);
    }
    for (const text of ['Apply', 'N/A', 'see website', 'localhost:3000/jobs', 'javascript:alert(1)', 'mailto:jobs@acme.example', 'Apply here', '']) {
      expect([text, isWebAddress(text)]).toEqual([text, false]);
    }
  });

  it('refuses a link label after the title, company and link checks, quoting at most 60 characters', () => {
    const label = { Company: 'Acme', 'Job Title': 'Engineer', 'Job Link': 'Apply', Date: '' };
    expect(rowToPosting(label, mapping, 7)).toEqual({
      error: 'Row 7 ("Engineer") has a job link that is not a web address ("Apply"). Put the address itself in the column.',
    });
    expect(rowToPosting({ ...label, 'Job Title': '' }, mapping, 8)).toEqual({ error: 'Row 8 has no job title.' });
    expect(rowToPosting({ ...label, Company: '' }, mapping, 9)).toEqual({ error: 'Row 9 ("Engineer") has no company.' });
    const long = rowToPosting({ ...label, 'Job Link': `Click ${'here '.repeat(30)}` }, mapping, 10);
    const quoted = /web address \("(.*)"\)\. Put/.exec('error' in long ? long.error : '')?.[1] ?? '';
    expect(quoted.length).toBeLessThanOrEqual(60);
    expect(quoted.endsWith('…')).toBe(true);
  });

  it('names the rows of a table by its row numbers, and skips a repeated row', () => {
    const table = tableFromCsv('Company,Job Title,Job Link\r\nAcme,A,https://a.example/1\r\n\r\nAcme,A,https://a.example/1\r\nGlobex,,https://g.example/2', { firstRow: 5 });
    const { postings, failures } = postingsFromTable(table, guessMapping(table.columns));
    expect(postings).toHaveLength(1);
    expect(failures.map((failure) => failure.message)).toEqual(['Row 8 repeats an earlier row; it was skipped.', 'Row 9 has no job title.']);
  });
});

describe('the CSV copy of a sheet tab', () => {
  it('quotes only quotes, commas and line breaks, so every cell reads back exactly (no formula escaping)', () => {
    const header = ['Company', 'Job Title', 'Job Link', 'Notes'];
    const rows = [
      header,
      ['- 5+ years', '=SUM(A1:A2)', '"Quoted"', 'line one\r\nline two'],
      ['a;b', '+1 555', '@handle', 'tab\there'],
      [],
      ['Plain', 'x,y', '', 'end\n'],
    ];
    const snapshot = snapshotOf(rows);
    expect(snapshot.text.split('\r\n')[0]).toBe('Company,Job Title,Job Link,Notes');
    expect(snapshot.text).not.toContain("'- 5+ years");
    expect(parseCsvRecords(snapshot.text, ',')).toEqual([
      { cells: header, record: 1 },
      { cells: rows[1], record: 2 },
      { cells: rows[2], record: 3 },
      { cells: rows[4], record: 5 },
    ]);
    const table = tableFromCsv(snapshot.text, sheetTabularOptions({ headerRow: 1, postedAt: null }));
    expect(table.rowNumbers).toEqual([2, 3, 5]);
    expect(table.rows[0]).toEqual({ Company: '- 5+ years', 'Job Title': '=SUM(A1:A2)', 'Job Link': '"Quoted"', Notes: 'line one\r\nline two' });
    expect(csvLine(['a', 'b,c', 'd"e', ''])).toBe('a,"b,c","d""e",');
  });

  it('names blank header cells and cells past the header by their column letter', () => {
    const snapshot = snapshotOf([
      ['Company', '', 'Job Link'],
      ['Acme', 'Engineer', 'https://acme.example/1', '', '', 'extra'],
    ]);
    expect(snapshot.text.split('\r\n')[0]).toBe('Company,Column B,Job Link,Column D,Column E,Column F');
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(701)).toBe('ZZ');
    expect(columnLetter(702)).toBe('AAA');
    expect(quoteSheetTitle("It's")).toBe("'It''s'");
    expect(sheetFileName('Job sheet', '10/22/2026')).toBe('Job sheet (10/22/2026).csv');
  });

  it('reads formula errors as blank, with one note that counts the cells below the header', () => {
    expect([...SHEET_ERROR_VALUES]).toEqual(expect.arrayContaining(['#REF!', '#N/A', '#NAME?', '#VALUE!', '#DIV/0!', '#ERROR!']));
    const snapshot = snapshotOf(
      [
        ['#REF! banner'],
        ['#N/A'],
        ['Company', 'Job Title', 'Job Link'],
        ['#REF!', 'Engineer', 'https://acme.example/1'],
        ['Globex', ' #DIV/0! ', '#NAME?'],
      ],
      { headerRow: 3 },
    );
    expect(snapshot.text.split('\r\n')).toEqual(['Company,Job Title,Job Link', ',Engineer,https://acme.example/1', 'Globex,,']);
    expect(snapshot.notes).toEqual(['3 cells hold a formula error (such as #REF! or #N/A); they were read as blank.']);
  });

  it('suggests a header row, and says when a tab has more rows than were read', () => {
    const snapshot = snapshotOf(
      [
        ['Jobs for the week'],
        ['Company', 'Job Title', 'Job Link'],
        ['Acme', 'Engineer', 'https://acme.example/1'],
      ],
      { gridRowCount: 20_000, lastRowRead: 10_021 },
    );
    expect(snapshot.suggestedHeaderRow).toBe(2);
    expect(snapshot.notes).toEqual(['Only rows 1 to 10,021 were read; this tab has 20,000 rows.']);
    expect(snapshotOf([['Company', 'Job Title', 'Job Link']]).suggestedHeaderRow).toBeNull();
  });

  it('keeps sheet row numbers when Google answers from a later row', () => {
    const snapshot = snapshotOf(
      [
        ['Company', 'Job Title', 'Job Link'],
        ['Acme', 'Engineer', 'https://acme.example/1'],
      ],
      { headerRow: 3 },
      3,
    );
    const table = tableFromCsv(snapshot.text, sheetTabularOptions({ headerRow: 3, postedAt: null }));
    expect(table.rowNumbers).toEqual([4]);
    expect(thrown(() => snapshotOf([['Company']], { headerRow: 1 }, 3)).fields).toEqual({
      headerRow: 'Row 1 of "Tab" is empty. Enter the row that holds the column names.',
    });
  });

  it('refuses an empty tab, a blank header row, too many rows and too much text', () => {
    expect(thrown(() => snapshotOf([[], ['  ']])).fields).toEqual({ gid: 'The tab "Tab" is empty.' });
    expect(thrown(() => snapshotOf([['Banner'], [], ['Company']], { headerRow: 2 })).fields).toEqual({
      headerRow: 'Row 2 of "Tab" is empty. Enter the row that holds the column names.',
    });
    const header = ['Company', 'Job Title', 'Job Link'];
    const many = [header, ...Array.from({ length: 10_001 }, (_, i) => ['Co', `Role ${i}`, `https://x.example/${i}`])];
    expect(thrown(() => snapshotOf(many)).message).toMatch(/^This tab has more than 10,000 rows below the header row\./);
    // 10,000 rows, then blank rows, is fine.
    expect(snapshotOf([...many.slice(0, 10_001), [], []]).dataRows).toBe(10_000);
    const wide = [header, ...Array.from({ length: 2_000 }, (_, i) => ['Co', `Role ${i}`, 'x'.repeat(11_000)])];
    expect(thrown(() => snapshotOf(wide)).message).toBe('This tab holds more than 20 MB of text. Split it into smaller tabs and import each one.');
  });
});

describe('stored sheet copies', () => {
  it('read again with the header row and the tab date from config.sheet', () => {
    const sheet = {
      spreadsheetId: '1FtSheetAbCdEfGhIjKlMnOpQrStUvWxYz0123456',
      gid: 3,
      tabTitle: '10/22/2026',
      spreadsheetTitle: 'Job sheet',
      url: 'https://docs.google.com/spreadsheets/d/1FtSheetAbCdEfGhIjKlMnOpQrStUvWxYz0123456/edit#gid=3',
      headerRow: 2,
      postedAt: '2026-10-22',
      readAt: '2026-10-22T12:00:00.000Z',
    };
    expect(importOptionsOf({ sheet })).toEqual({ delimiter: ',', firstRow: 2, postedAt: '2026-10-22T00:00:00.000Z' });
    expect(importOptionsOf({ sheet: { ...sheet, headerRow: 99 } })).toEqual({});
    expect(importOptionsOf({})).toEqual({});

    const text = snapshotOf(
      [
        ['Banner; with; semicolons'],
        ['Company', 'Job Title', 'Job Link'],
        [],
        ['Acme', 'Engineer', 'https://acme.example/1'],
        ['Globex', 'Designer', 'Apply'],
      ],
      { headerRow: 2 },
    ).text;
    const { postings, failures } = tablePostings('Job sheet (10/22/2026).csv', text, guessMapping(['Company', 'Job Title', 'Job Link']), importOptionsOf({ sheet }));
    expect(postings.map((posting) => [posting.title, posting.postedAt])).toEqual([['Engineer', '2026-10-22T00:00:00.000Z']]);
    expect(failures.map((failure) => failure.message)).toEqual([
      'Row 5 ("Designer") has a job link that is not a web address ("Apply"). Put the address itself in the column.',
    ]);
  });
});
