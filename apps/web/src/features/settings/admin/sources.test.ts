import { describe, expect, it } from 'vitest';
import { runNowHint, runTriggerLabel, sheetOf, sourceDetail } from './sources';

// Work package WP12: how Admin > Sources and Runs describe a Google Sheet import (a csv source with config.sheet).

const SHEET = {
  spreadsheetId: '1FtSheetAbCdEfGhIjKlMnOpQrStUvWxYz0123456',
  gid: 101,
  tabTitle: '10/22/2026',
  spreadsheetTitle: 'Job sheet',
  url: 'https://docs.google.com/spreadsheets/d/1FtSheetAbCdEfGhIjKlMnOpQrStUvWxYz0123456/edit#gid=101',
  headerRow: 1,
  postedAt: '2026-10-22',
  readAt: '2026-10-22T12:00:00.000Z',
};

describe('sheet sources', () => {
  it('reads config.sheet of a csv source only, and only when it is complete', () => {
    expect(sheetOf({ kind: 'csv', config: { fileName: 'Job sheet (10/22/2026).csv', sheet: SHEET } })).toEqual(SHEET);
    expect(sheetOf({ kind: 'json', config: { sheet: SHEET } })).toBeNull();
    expect(sheetOf({ kind: 'csv', config: { sheet: { ...SHEET, gid: 'x' } } })).toBeNull();
    expect(sheetOf({ kind: 'csv', config: { fileName: 'jobs.csv' } })).toBeNull();
  });

  it('describes every kind of source in a few words', () => {
    expect(sourceDetail({ kind: 'csv', config: { fileName: 'Job sheet (10/22/2026).csv', sheet: SHEET } })).toBe('Job sheet, tab 10/22/2026');
    expect(sourceDetail({ kind: 'csv', config: { fileName: 'jobs.csv' } })).toBe('jobs.csv');
    expect(sourceDetail({ kind: 'json', config: {} })).toBe('Uploaded file');
    expect(sourceDetail({ kind: 'greenhouse', config: { token: 'gitlab' } })).toBe('Board gitlab');
    expect(sourceDetail({ kind: 'lever', config: { site: 'palantir', region: 'eu' } })).toBe('Site palantir (EU)');
    expect(sourceDetail({ kind: 'ashby', config: { board: 'linear' } })).toBe('Board linear');
    expect(sourceDetail({ kind: 'ft_lake', config: {} })).toBe('Default database path');
    expect(sourceDetail({ kind: 'seed', config: { anchor: '2026-10-22T12:00:00.000Z' } })).toBe('Dated from Oct 22, 2026');
  });

  it('says that Run now imports the stored copy, not the sheet', () => {
    expect(runNowHint({ kind: 'csv', config: { sheet: SHEET } })).toBe(
      'Imports the copy read Oct 22, 2026 again. To read the sheet again, use Import the sheet again.',
    );
    expect(runNowHint({ kind: 'csv', config: {} })).toBeNull();
  });

  it('calls a sheet run an Import and a file run an Upload', () => {
    expect(runTriggerLabel({ trigger: 'upload', sourceKindLabel: 'Google Sheet' })).toBe('Import');
    expect(runTriggerLabel({ trigger: 'upload', sourceKindLabel: 'CSV import' })).toBe('Upload');
    expect(runTriggerLabel({ trigger: 'manual', sourceKindLabel: 'Google Sheet' })).toBe('Run now');
    expect(runTriggerLabel({ trigger: 'schedule', sourceKindLabel: 'Greenhouse' })).toBe('Schedule');
  });
});
