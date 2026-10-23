import { describe, expect, it } from 'vitest';
import {
  EXPORT_CSV_COLUMNS,
  buildExportCsv,
  csvCell,
  exportCsvFileName,
  exportCsvRow,
  guessImportMapping,
  guessJobType,
  mapJobTypeText,
  mapStatusText,
  readImportRow,
  unmappedStatusTexts,
  type ExportApplication,
} from './csv';

describe('guessJobType', () => {
  it.each([
    ['Software Engineering Intern', 'internship'],
    ['Summer Internship - Data', 'internship'],
    ['Co-op Student', 'internship'],
    ['Part-Time Tutor', 'part_time'],
    ['Contract Designer', 'part_time'],
    ['Temp Data Entry', 'part_time'],
    ['Freelance Writer', 'part_time'],
    ['Senior Engineer', 'full_time'],
    ['International Sales', 'full_time'],
  ])('%s -> %s', (title, expected) => {
    expect(guessJobType(title)).toBe(expected);
  });
});

describe('mapStatusText', () => {
  it.each([
    ['Saved', 1],
    ['wishlist', 1],
    ['Applied', 2],
    ['Submitted', 2],
    ['Phone screen', 11],
    ['OA', 11],
    ['Interviewing', 12],
    ['On-site', 12],
    ['Offer', 13],
    ['Withdrew', 21],
    ['No response', 22],
    ['Ghosted', 22],
    ['Rejected', 23],
    ['not selected', 23],
    ['Accepted', 24],
    ['Hired', 24],
    ['12', 12],
    ['interviewing', 12],
  ])('%s -> %i', (text, expected) => {
    expect(mapStatusText(text)).toBe(expected);
  });

  it.each(['', 'maybe later', '3'])('cannot place %s', (text) => {
    expect(mapStatusText(text)).toBeNull();
  });

  it('maps job type text', () => {
    expect(mapJobTypeText('Full-Time')).toBe('full_time');
    expect(mapJobTypeText('part time')).toBe('part_time');
    expect(mapJobTypeText('Internship')).toBe('internship');
    expect(mapJobTypeText('Contractor')).toBe('contract');
    expect(mapJobTypeText('Seasonal')).toBeNull();
  });
});

describe('export', () => {
  const application: ExportApplication = {
    companyName: 'Acme, Inc.',
    title: 'Platform Engineer',
    location: 'Austin, TX',
    employmentType: 'full_time',
    currentStatus: 12,
    appliedOn: '2026-10-05',
    trackedOn: '2026-10-01',
    postingUrl: 'https://acme.com/jobs/1',
    salaryMin: 150000,
    salaryMax: 180000,
    salaryCurrency: 'USD',
    salaryPeriod: 'year',
    favorite: true,
    archivedAt: null,
    notesHtml: '<p>Call "Sam"</p><p>=SUM(A1)</p>',
  };

  it('writes one row per application in column order', () => {
    expect(EXPORT_CSV_COLUMNS).toHaveLength(15);
    expect(exportCsvRow(application)).toEqual([
      'Acme, Inc.',
      'Platform Engineer',
      'Austin, TX',
      'Full-Time',
      'Interviewing',
      '2026-10-05',
      '2026-10-01',
      'https://acme.com/jobs/1',
      '150000',
      '180000',
      'USD',
      'Yearly',
      'Yes',
      'No',
      'Call "Sam"\n=SUM(A1)',
    ]);
  });

  it('quotes and guards cells', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('- follow up')).toBe("'- follow up");
    expect(csvCell('-2+3+cmd|calc')).toBe("'-2+3+cmd|calc");
    expect(csvCell('+1 555 0100')).toBe("'+1 555 0100");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('+1.5')).toBe('+1.5');
    expect(csvCell('120000')).toBe('120000');
  });

  it('builds the file with a header and CRLF line ends', () => {
    const csv = buildExportCsv([application]);
    expect(csv.split('\r\n')[0]).toBe(EXPORT_CSV_COLUMNS.join(','));
    expect(csv.startsWith('Company,Position Title,')).toBe(true);
    expect(exportCsvFileName('2026-10-22')).toBe('TailorIT_Tracked_Jobs_2026-10-22.csv');
  });
});

describe('import', () => {
  it('guesses the column mapping from headers', () => {
    expect(guessImportMapping(['Company name', 'Position Title', 'Location', 'Status', 'Date Applied', 'Link'])).toEqual({
      companyName: 0,
      title: 1,
      location: 2,
      status: 3,
      appliedOn: 4,
      postingUrl: 5,
    });
    expect(guessImportMapping(['Job Title', 'Employer', 'Notes'])).toEqual({ title: 0, companyName: 1, notes: 2 });
  });

  it('reads a row with the status map, guesses and dates', () => {
    expect(
      readImportRow(
        { title: 'Data Intern', companyName: 'Acme', status: 'Waiting on HR', appliedOn: '10/05/2026' },
        { 'waiting on hr': 11 },
      ),
    ).toEqual({
      ok: true,
      title: 'Data Intern',
      companyName: 'Acme',
      location: '',
      employmentType: 'internship',
      status: 11,
      notes: '',
      postingUrl: '',
      appliedOn: '2026-10-05',
    });
    expect(readImportRow({ title: 'Engineer', companyName: 'Acme', status: '' })).toMatchObject({ status: 2 });
  });

  it('skips rows without a title or company', () => {
    expect(readImportRow({ companyName: 'Acme' })).toEqual({ ok: false, message: 'Position Title is required.' });
    expect(readImportRow({ title: 'Engineer' })).toEqual({ ok: false, message: 'Company is required.' });
  });

  it('lists the status texts that need mapping', () => {
    expect(unmappedStatusTexts([{ status: 'Applied' }, { status: 'Waiting' }, { status: 'waiting' }, {}])).toEqual([
      'Waiting',
    ]);
  });
});
