import { describe, expect, it } from 'vitest';
import { capUtf16, safePathSegment } from '../src/core/files/names';
import {
  COMPANY_MAX,
  needsSkippedFile,
  personFileStem,
  planFolders,
  resumeFileName,
  ROLE_MAX,
  skippedText,
} from '../src/features/resume-zip/zipNames';

// The paths inside a resume ZIP (work package WP11): Windows-safe segments, the person's file name, "(2)" folders and
// SKIPPED.txt.

describe('safePathSegment', () => {
  const segment = (raw: string | null | undefined, max = 60) => safePathSegment(raw, 'Fallback', max);

  it('prefixes the device names Windows reserves, whatever follows the first dot', () => {
    expect(segment('CON')).toBe('_CON');
    expect(segment('con.txt')).toBe('_con.txt');
    expect(segment('nul.tar.gz')).toBe('_nul.tar.gz');
    expect(segment('CON .txt')).toBe('_CON .txt');
    expect(segment('COM1')).toBe('_COM1');
    expect(segment('lpt9')).toBe('_lpt9');
    expect(segment('COM¹')).toBe('_COM¹');
    expect(segment('CONIN$')).toBe('_CONIN$');
    expect(segment('Aux')).toBe('_Aux');
    // Names that only start like one are kept.
    expect(segment('Console')).toBe('Console');
    expect(segment('Company')).toBe('Company');
    expect(segment('COM10')).toBe('COM10');
    expect(segment('Nul Labs')).toBe('Nul Labs');
  });

  it('adds the prefix before cutting, and never cuts a name into a device name', () => {
    expect(segment('CON', 3)).toBe('_CO');
    expect(segment('COM1x', 4)).toBe('_COM');
    expect(segment('Aux', 4)).toBe('_Aux');
  });

  it('replaces the characters Windows refuses', () => {
    expect(segment('R&D: Lead/Manager?')).toBe('R&D Lead-Manager');
    expect(segment('A\\B|C')).toBe('A-B-C');
    expect(segment('<Senior> "Staff" *Engineer*')).toBe('Senior Staff Engineer');
  });

  it('strips trailing dots and spaces, keeps a leading dot, and never yields "." or ".."', () => {
    expect(segment('Acme Inc.')).toBe('Acme Inc');
    expect(segment('Acme...   ')).toBe('Acme');
    expect(segment('.NET Developer')).toBe('.NET Developer');
    expect(segment('.')).toBe('Fallback');
    expect(segment('..')).toBe('Fallback');
    expect(segment('. . .')).toBe('Fallback');
    expect(segment('   ')).toBe('Fallback');
    expect(segment('')).toBe('Fallback');
    expect(segment(null)).toBe('Fallback');
    expect(segment(undefined)).toBe('Fallback');
  });

  it('removes controls, bidi and zero-width characters, and lone surrogates', () => {
    expect(segment('cv‮fdp.exe')).toBe('cvfdp.exe');
    expect(segment('Ac​me\u0000\u0007 Corp﻿')).toBe('Acme Corp');
    expect(segment('Tab\tand\nnewline')).toBe('Tab and newline');
    expect(segment('Broken \uD800 pair')).toBe('Broken pair');
  });

  it('normalises to NFC and caps by UTF-16 units without splitting a pair, leaving no trailing dot', () => {
    expect(segment('Café')).toBe('Café');
    expect(segment('Café'.normalize('NFD')).length).toBe(4);
    expect(segment('a'.repeat(80))).toHaveLength(60);
    expect(segment('Acme. Holdings', 5)).toBe('Acme');
    // 😀 is two UTF-16 units: a cap between them drops it whole.
    expect(segment('ab😀', 3)).toBe('ab');
    expect(segment('ab😀', 4)).toBe('ab😀');
    expect(capUtf16('ab😀cd', 3)).toBe('ab');
    expect(segment('山田商事株式会社')).toBe('山田商事株式会社');
  });
});

describe('personFileStem', () => {
  it('joins the first and the last name, dropping accents from Latin letters only', () => {
    expect(personFileStem('Ada Lovelace')).toBe('Ada_Lovelace');
    expect(personFileStem('José María López')).toBe('Jose_Lopez');
    expect(personFileStem('Nguyễn Văn An')).toBe('Nguyen_An');
    expect(personFileStem('Søren Kierkegaard')).toBe('Søren_Kierkegaard');
    expect(personFileStem('Йосиф Бродский')).toBe('Йосиф_Бродский');
    expect(personFileStem('Γιώργος Παπαδόπουλος')).toBe('Γιώργος_Παπαδόπουλος');
    expect(personFileStem('प्रिया शर्मा')).toBe('प्रिया_शर्मा');
    expect(personFileStem('山田 太郎')).toBe('山田_太郎');
    expect(personFileStem('Cher')).toBe('Cher');
  });

  it('keeps hyphens and apostrophes inside names, and sets titles and suffixes aside', () => {
    expect(personFileStem("Mary-Kate O'Neil Jr.")).toBe("Mary-Kate_O'Neil");
    expect(personFileStem('Mary-Kate O’Neil')).toBe("Mary-Kate_O'Neil");
    expect(personFileStem('Dr. Jane Smith, PhD')).toBe('Jane_Smith');
    expect(personFileStem('Martin Luther King III')).toBe('Martin_King');
    // With two words left, a title-like word is the name.
    expect(personFileStem('Jane Jr')).toBe('Jane_Jr');
  });

  it('is null when there is no name to go by, and caps a long one', () => {
    expect(personFileStem('')).toBeNull();
    expect(personFileStem('   ')).toBeNull();
    expect(personFileStem(null)).toBeNull();
    expect(personFileStem('--- // ***')).toBeNull();
    expect(personFileStem(`${'A'.repeat(30)} ${'B'.repeat(30)}`)!.length).toBe(40);
  });

  it('names the file after the stem, or plainly "resume"', () => {
    expect(resumeFileName('Nadia_Ali', 'pdf')).toBe('Nadia_Ali_resume.pdf');
    expect(resumeFileName(null, 'docx')).toBe('resume.docx');
    // A one-word name can be a device name; the file never is ("CON_resume.pdf").
    expect(resumeFileName(personFileStem('Con'), 'pdf')).toBe('Con_resume.pdf');
  });
});

describe('planFolders', () => {
  it('gives a company and role seen again "(2)", "(3)", comparing without case', () => {
    const folders = planFolders([
      { id: 'a', companyName: 'Acme', title: 'Engineer' },
      { id: 'b', companyName: 'ACME', title: 'engineer' },
      { id: 'c', companyName: 'acme', title: 'Engineer' },
      { id: 'd', companyName: 'Acme', title: 'Designer' },
      { id: 'e', companyName: 'Globex', title: 'Engineer' },
    ]);
    expect(Object.fromEntries(folders)).toEqual({
      a: 'Acme/Engineer',
      b: 'Acme/engineer (2)',
      c: 'Acme/Engineer (3)',
      d: 'Acme/Designer',
      e: 'Globex/Engineer',
    });
  });

  it('skips a suffix that is taken, and cuts the role so the suffix fits', () => {
    const folders = planFolders([
      { id: 'a', companyName: 'Acme', title: 'Engineer (2)' },
      { id: 'b', companyName: 'Acme', title: 'Engineer' },
      { id: 'c', companyName: 'Acme', title: 'Engineer' },
      { id: 'd', companyName: 'Acme', title: 'R'.repeat(90) },
      { id: 'e', companyName: 'Acme', title: 'R'.repeat(90) },
    ]);
    expect(folders.get('c')).toBe('Acme/Engineer (3)');
    expect(folders.get('d')).toBe(`Acme/${'R'.repeat(ROLE_MAX)}`);
    expect(folders.get('e')).toBe(`Acme/${'R'.repeat(ROLE_MAX - 4)} (2)`);
  });

  it('makes every segment safe, and keeps the root SKIPPED.txt free', () => {
    const folders = planFolders([
      { id: 'a', companyName: 'SKIPPED.txt', title: 'Analyst' },
      { id: 'b', companyName: '..', title: '.' },
      { id: 'c', companyName: null, title: null },
      { id: 'd', companyName: 'CON', title: 'Lead/Manager' },
      { id: 'e', companyName: 'C'.repeat(80), title: 'Analyst' },
    ]);
    expect(folders.get('a')).toBe('_SKIPPED.txt/Analyst');
    expect(folders.get('b')).toBe('Unknown company/Untitled role');
    expect(folders.get('c')).toBe('Unknown company/Untitled role (2)');
    expect(folders.get('d')).toBe('_CON/Lead-Manager');
    expect(folders.get('e')).toBe(`${'C'.repeat(COMPANY_MAX)}/Analyst`);
  });
});

describe('SKIPPED.txt', () => {
  const report = {
    skipped: [
      {
        company: 'Stripe',
        role: 'Senior Backend Engineer',
        status: 'Saved',
        reason: 'the uploaded file of "Nadia CV" is missing. Upload it again in Documents.',
      },
    ],
    usedDefault: {
      label: 'Nadia CV',
      isDefault: true,
      applications: [
        { company: 'Initech', role: 'Data Engineer', status: 'Saved' },
        { company: 'Globex\r\nCorp', role: '', status: 'Applied' },
      ],
    },
    leftOut: 312,
    maxApplications: 500,
  };

  it('says what was skipped, what got the default resume and what was left out, with CRLF line ends', () => {
    const text = skippedText(report);
    expect(text).toBe(
      [
        'TailorIT could not add a resume for 1 application:',
        '',
        '- Stripe / Senior Backend Engineer (Saved): the uploaded file of "Nadia CV" is missing. Upload it again in Documents.',
        '',
        `2 applications have no resume linked, so they got your default resume, "Nadia CV". Link the resume you want in each application's Documents tab to change it:`,
        '',
        '- Initech / Data Engineer (Saved)',
        '- Globex Corp / Untitled role (Applied)',
        '',
        '312 more Saved applications were left out, because one zip holds up to 500. Select them in Manage jobs and build again.',
        '',
      ].join('\r\n'),
    );
    expect(text).not.toMatch(/[–—]/);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('is written only when something needs saying', () => {
    expect(needsSkippedFile(report)).toBe(true);
    expect(needsSkippedFile({ skipped: [], usedDefault: null, leftOut: 0, maxApplications: 500 })).toBe(false);
    expect(needsSkippedFile({ skipped: [], usedDefault: null, leftOut: 1, maxApplications: 500 })).toBe(true);
    const one = skippedText({
      skipped: [],
      usedDefault: { label: 'Backend', isDefault: false, applications: [{ company: 'Acme', role: 'Dev', status: 'Saved' }] },
      leftOut: 1,
      maxApplications: 500,
    });
    expect(one).toContain('1 application has no resume linked, so it got your newest resume, "Backend".');
    expect(one).toContain('1 more Saved application was left out');
  });
});
