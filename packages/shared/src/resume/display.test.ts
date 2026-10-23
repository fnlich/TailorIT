import { describe, expect, it } from 'vitest';
import {
  achievementsFromText,
  bulletCountNote,
  bulletsBlocker,
  bulletsTask,
  duplicateTitle,
  keptNote,
  readBullets,
  resumeEvidenceText,
  resumeLabel,
  sampledNotice,
  templateFeatures,
} from './display';
import {
  BulletsRequestSchema,
  BulletsResultSchema,
  CreateResumeBodySchema,
  PatchResumeBodySchema,
  ResumeListQuerySchema,
  ResumeThumbnailSchema,
} from './dto';
import { normalizeResumeDocument } from './normalize';
import { readResumeImport, resumeExportFile, resumeExportFileName } from './transfer';

describe('resumeLabel', () => {
  it.each([
    [{ title: 'Senior Engineer', name: 'Jordan' }, null, 'Senior Engineer'],
    [{ title: 'Professional', name: 'Jordan  Chen' }, null, 'Jordan Chen'],
    [{ title: '', name: '' }, null, 'Untitled resume'],
    [{ title: 'Senior Engineer', name: 'Jordan' }, '  Google version ', 'Google version'],
    [null, null, 'Untitled resume'],
    [null, 'Uploaded CV', 'Uploaded CV'],
  ])('%o / %s', (document, title, expected) => {
    expect(resumeLabel(document, title)).toBe(expected);
  });

  it('names a duplicate', () => {
    expect(duplicateTitle('Senior Engineer')).toBe('Senior Engineer (Copy)');
  });
});

describe('resumeEvidenceText', () => {
  it('collects the resume\'s own words and never company names', () => {
    const document = normalizeResumeDocument({
      title: 'Platform Engineer',
      summary: 'Builds   things.',
      skills: [{ category: 'Cloud', skills: ['AWS'] }],
      softSkills: ['Mentoring'],
      strengths: [{ title: 'Calm', description: 'Under pressure' }],
      experience: [{ title: 'SRE', company: 'Stripe', description: 'Ran Kubernetes', achievements: ['Cut costs'], skills: ['Go'] }],
      certifications: [{ name: 'CKA', issuer: 'CNCF' }],
      projects: [{ name: 'Lake', role: 'Lead', description: 'Spark jobs' }],
      volunteering: [{ role: 'Mentor', organization: 'Code Club' }],
      courses: [{ name: 'ML', institution: 'Coursera' }],
      awards: [{ title: 'Best Paper' }],
      publications: [{ title: 'On Lakes' }],
    });
    const text = resumeEvidenceText(document);
    expect(text.split('\n')).toEqual([
      'Platform Engineer',
      'Builds things.',
      'AWS',
      'Cloud',
      'AWS',
      'Mentoring',
      'Calm',
      'Under pressure',
      'SRE',
      'Ran Kubernetes',
      'Cut costs',
      'Go',
      'CKA',
      'CNCF',
      'Lake',
      'Lead',
      'Spark jobs',
      'Mentor',
      'ML',
      'Best Paper',
      'On Lakes',
    ]);
    expect(text).not.toContain('Stripe');
    expect(text).not.toContain('Code Club');
    expect(resumeEvidenceText(null)).toBe('');
  });
});

describe('notices and features', () => {
  it('names the sampled fields', () => {
    expect(sampledNotice(['name', 'experience', 'phone', 'fooBar'])).toBe(
      'Sample text shown for: name, phone, experience, foo bar. It fills what is empty, in the preview only: it is never saved or printed.',
    );
    expect(sampledNotice([])).toBeNull();
    expect(sampledNotice(undefined)).toBeNull();
  });

  it('lists template features by capability', () => {
    expect(templateFeatures({ supportsSoftSkills: true, supportsStrengths: false, printsSections: ['summary'] })).toEqual([
      'A4 page, print-ready PDF',
      'Technical skills grouped under headings, or as one list',
      'A soft skills section',
      'Sections in the order you arrange them',
      'Switch to another template any time',
    ]);
    expect(
      templateFeatures({ supportsSoftSkills: true, supportsStrengths: true, printsSections: ['projects'] }),
    ).toContain('Projects, languages, awards and sections of your own');
  });

  it('notes kept entries of a switched-off section', () => {
    expect(keptNote(1, 'softSkills')).toBe('1 soft skill kept with the resume. Turn the switch on to print and edit it.');
    expect(keptNote(3, 'strengths')).toBe('3 strengths kept with the resume. Turn the switch on to print and edit them.');
    expect(keptNote(0, 'strengths')).toBeNull();
  });
});

describe('Write with AI helpers', () => {
  it('picks write or improve', () => {
    expect(bulletsTask('')).toBe('write');
    expect(bulletsTask('\n  \n')).toBe('write');
    expect(bulletsTask('Shipped it')).toBe('improve');
    expect(bulletsTask(['Shipped'])).toBe('improve');
    expect(achievementsFromText(' a \n\n b ')).toEqual(['a', 'b']);
  });

  it('blocks an entry with nothing to write from', () => {
    expect(bulletsBlocker('experience', { company: 'Acme' })).toBeNull();
    expect(bulletsBlocker('experience', { location: 'NYC' })).toBe(
      'Give the role a title or a company before asking for bullets.',
    );
    expect(bulletsBlocker('project', {})).toBe('Give the project a name before asking for bullets.');
    expect(bulletsBlocker('volunteering', { organization: 'Code Club' })).toBeNull();
  });

  it('reads an AI answer', () => {
    expect(readBullets({ bullets: ['- Shipped X', ' * Led Y', '', 3, ...Array(10).fill('More')] })).toHaveLength(8);
    expect(readBullets({ bullets: ['• Shipped X'] })).toEqual(['Shipped X']);
    expect(readBullets(null)).toEqual([]);
    expect(bulletCountNote(3)).toBe('3 bullets.');
    expect(bulletCountNote(1)).toBe('1 bullet.');
    expect(bulletCountNote(9)).toMatch(/^9 bullets\. Most roles read best with 8 or fewer/);
    expect(bulletCountNote(0)).toBeNull();
  });
});

describe('resume contracts', () => {
  it('validates the bullets request and result', () => {
    expect(
      BulletsRequestSchema.safeParse({ kind: 'project', entry: { name: 'Lake' }, task: 'write', instructions: 'x'.repeat(301) })
        .success,
    ).toBe(false);
    expect(BulletsRequestSchema.safeParse({ kind: 'experience', entry: { title: 'SRE' }, task: 'improve' }).success).toBe(true);
    expect(BulletsResultSchema.safeParse({ bullets: Array(9).fill('x') }).success).toBe(false);
  });

  it('reads titles and the source filter', () => {
    expect(PatchResumeBodySchema.parse({ title: '   ' })).toEqual({ title: null });
    expect(PatchResumeBodySchema.parse({ title: ' Mine ' })).toEqual({ title: 'Mine' });
    expect(CreateResumeBodySchema.safeParse({ document: [] }).success).toBe(false);
    expect(ResumeListQuerySchema.parse({}).source).toBe('all');
    expect(ResumeListQuerySchema.parse({ source: 'uploaded' }).source).toBe('uploaded');
    expect(ResumeThumbnailSchema.safeParse({ kind: 'image', url: '/api/files/1/thumbnail' }).success).toBe(true);
  });
});

describe('JSON transfer', () => {
  const document = normalizeResumeDocument({ name: 'Jordan', title: 'SRE', skills: ['Go'] });

  it('round-trips an export envelope', () => {
    const file = resumeExportFile({ title: 'Mine', templateId: 'navy-rule', document }, '2026-10-22T12:00:00.000Z');
    expect(readResumeImport(JSON.parse(JSON.stringify(file)))).toEqual({
      ok: true,
      resumes: [{ title: 'Mine', templateId: 'navy-rule', document }],
    });
  });

  it('reads bare documents, lists and { resumes }', () => {
    const bare = { name: 'Ann', experience: [{ title: 'Dev' }], profileId: 'p1', preferredTemplate: 'default' };
    const single = readResumeImport(bare);
    expect(single.ok && single.resumes[0]?.templateId).toBe('default');
    const list = readResumeImport({ resumes: [bare, { name: 'Bo', skills: ['Go'] }] });
    expect(list.ok && list.resumes.length).toBe(2);
  });

  it('refuses files that are not resumes', () => {
    expect(readResumeImport({ name: 'my-app', version: '1.0.0', dependencies: {} })).toEqual({
      ok: false,
      message: 'The file is not a resume: it needs a name or headline and some resume content.',
    });
    expect(readResumeImport([{ name: 'Ann', skills: [] }, 42])).toEqual({ ok: false, message: 'Item 2 is not a resume.' });
    expect(readResumeImport([])).toEqual({ ok: false, message: 'The file holds no resume.' });
    expect(readResumeImport(Array(51).fill({ name: 'A', skills: [] })).ok).toBe(false);
  });

  it('makes safe file names', () => {
    expect(resumeExportFileName('Senior Engineer (Google)')).toBe('Senior_Engineer_Google.json');
    expect(resumeExportFileName('Résumé', 'pdf')).toBe('Resume.pdf');
    expect(resumeExportFileName('***')).toBe('resume.json');
  });
});
