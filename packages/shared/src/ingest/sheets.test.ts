import { describe, expect, it } from 'vitest';
import { IMPORT_FIELDS, ImportMappingSchema, emptyImportMapping, importFieldInfo } from './imports';
import {
  SHEET_LINK_MESSAGES,
  SheetImportBodySchema,
  SheetPreviewBodySchema,
  SheetSourceConfigSchema,
  defaultSheetSourceName,
  isDayTabTitle,
  parseSpreadsheetRef,
  sheetTabDate,
  spreadsheetUrl,
} from './sheets';

// Work package WP12: the Google Sheet import's pure rules (links, names, tab dates, request contracts).

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc';

describe('parseSpreadsheetRef', () => {
  it('reads the id and the tab of every link form Google shows', () => {
    expect(parseSpreadsheetRef(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1234`)).toEqual({ ok: true, spreadsheetId: ID, gid: 1234 });
    expect(parseSpreadsheetRef(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=55#gid=55`)).toEqual({ ok: true, spreadsheetId: ID, gid: 55 });
    expect(parseSpreadsheetRef(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing&gid=7`)).toEqual({ ok: true, spreadsheetId: ID, gid: 7 });
    expect(parseSpreadsheetRef(`https://docs.google.com/spreadsheets/u/1/d/${ID}/edit#gid=0`)).toEqual({ ok: true, spreadsheetId: ID, gid: 0 });
    expect(parseSpreadsheetRef(`docs.google.com/spreadsheets/d/${ID}`)).toEqual({ ok: true, spreadsheetId: ID, gid: null });
    expect(parseSpreadsheetRef(`  HTTPS://DOCS.GOOGLE.COM/spreadsheets/d/${ID}/edit  `)).toEqual({ ok: true, spreadsheetId: ID, gid: null });
    expect(parseSpreadsheetRef(`https://docs.google.com/a/example.com/spreadsheets/d/${ID}/edit#gid=9&range=A1`)).toEqual({ ok: true, spreadsheetId: ID, gid: 9 });
    expect(parseSpreadsheetRef(ID)).toEqual({ ok: true, spreadsheetId: ID, gid: null });
  });

  it('prefers the #gid of the address over the ?gid of its query', () => {
    expect(parseSpreadsheetRef(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=1#gid=2`)).toMatchObject({ gid: 2 });
  });

  it('ignores a tab id that is not a 32-bit number', () => {
    expect(parseSpreadsheetRef(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=99999999999`)).toMatchObject({ ok: true, gid: null });
  });

  it('refuses a "Publish to the web" link before the generic rule', () => {
    expect(parseSpreadsheetRef('https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz0123/pubhtml')).toEqual({
      ok: false,
      message: SHEET_LINK_MESSAGES.published,
    });
    expect(parseSpreadsheetRef('https://docs.google.com/spreadsheets/u/0/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz0123/pub?output=csv')).toMatchObject({
      ok: false,
      message: SHEET_LINK_MESSAGES.published,
    });
  });

  it('refuses other hosts, Drive links, documents and empty input', () => {
    for (const bad of [
      `https://drive.google.com/file/d/${ID}/view`,
      `https://docs.google.com/document/d/${ID}/edit`,
      `https://evil.example/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com.evil.example/spreadsheets/d/${ID}/edit`,
      'https://docs.google.com/spreadsheets/d/short/edit',
      'not a link at all',
      'ftp://docs.google.com/spreadsheets/d/x',
    ]) {
      expect([bad, parseSpreadsheetRef(bad)]).toEqual([bad, { ok: false, message: SHEET_LINK_MESSAGES.notSheets }]);
    }
    expect(parseSpreadsheetRef('   ')).toEqual({ ok: false, message: SHEET_LINK_MESSAGES.empty });
  });
});

describe('names and dates', () => {
  it('builds the address of a tab', () => {
    expect(spreadsheetUrl(ID, 12)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=12`);
    expect(spreadsheetUrl(ID, 0)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`);
    expect(spreadsheetUrl(ID)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit`);
  });

  it('names a source after the spreadsheet and the tab, at most 100 characters', () => {
    expect(defaultSheetSourceName('Job sheet', '10/22/2026')).toBe('Job sheet (10/22/2026)');
    expect(defaultSheetSourceName('  Job   sheet ', ' ')).toBe('Job sheet (Sheet)');
    const long = defaultSheetSourceName('x'.repeat(150), '10/22/2026');
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith(' (10/22/2026)')).toBe(true);
    const bothLong = defaultSheetSourceName('a'.repeat(120), 'b'.repeat(120));
    expect(bothLong.length).toBeLessThanOrEqual(100);
    expect(bothLong).toMatch(/^a+ \(b+…\)$/);
  });

  it("knows free_tailor's day tabs and reads their date, never a future one", () => {
    expect(isDayTabTitle('10/22/2026')).toBe(true);
    expect(isDayTabTitle('1/2/2026')).toBe(true);
    expect(isDayTabTitle('2026-10-22')).toBe(true);
    expect(isDayTabTitle('Oct 22, 2026')).toBe(false);
    expect(isDayTabTitle('Jobs')).toBe(false);
    expect(sheetTabDate('10/22/2026', '2026-10-22')).toBe('2026-10-22');
    expect(sheetTabDate('10/23/2026', '2026-10-22')).toBe('2026-10-23');
    expect(sheetTabDate('10/24/2026', '2026-10-22')).toBeNull();
    expect(sheetTabDate('Jobs', '2026-10-22')).toBeNull();
    expect(sheetTabDate('Oct 2026', '2026-10-22')).toBe('2026-10-01');
  });
});

describe('contracts', () => {
  it('checks the header row and the source name with sentences a person can act on', () => {
    expect(SheetPreviewBodySchema.safeParse({ url: ID, headerRow: 21 }).error?.issues[0]?.message).toBe('Choose a header row from 1 to 20.');
    expect(SheetPreviewBodySchema.safeParse({ url: ID, headerRow: 0 }).error?.issues[0]?.message).toBe('Choose a header row from 1 to 20.');
    expect(SheetPreviewBodySchema.safeParse({ url: ID, headerRow: 2.5 }).error?.issues[0]?.message).toBe('Choose a header row from 1 to 20.');
    expect(SheetPreviewBodySchema.safeParse({ url: '  ' }).error?.issues[0]?.message).toBe('Paste the link of the Google Sheet.');
    expect(SheetImportBodySchema.safeParse({ url: ID, name: 'x'.repeat(101) }).error?.issues[0]?.message).toBe('Keep the name under 100 characters.');
    expect(SheetImportBodySchema.parse({ url: ` ${ID} `, gid: 0, mapping: { title: 'Job Title', postedAt: null } })).toEqual({
      url: ID,
      gid: 0,
      mapping: { title: 'Job Title', postedAt: null },
    });
    expect(SheetImportBodySchema.safeParse({ url: ID, gid: -1 }).success).toBe(false);
  });

  it('describes a stored sheet source', () => {
    const sheet = {
      spreadsheetId: ID,
      gid: 0,
      tabTitle: '10/22/2026',
      spreadsheetTitle: 'Job sheet',
      url: spreadsheetUrl(ID, 0),
      headerRow: 1,
      postedAt: '2026-10-22',
      readAt: '2026-10-22T12:00:00.000Z',
    };
    expect(SheetSourceConfigSchema.parse(sheet)).toEqual(sheet);
    expect(SheetSourceConfigSchema.safeParse({ ...sheet, spreadsheetId: 'x' }).success).toBe(false);
  });

  it('lists every import field once, three of them required', () => {
    expect(importFieldInfo().map((info) => info.field)).toEqual([...IMPORT_FIELDS]);
    expect(importFieldInfo().filter((info) => info.required).map((info) => info.field)).toEqual(['title', 'company', 'url']);
    expect(ImportMappingSchema.parse(emptyImportMapping())).toEqual(emptyImportMapping());
  });
});
