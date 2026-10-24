import type { ResumeSummary } from '@tailorit/shared/resume';
import { describe, expect, it } from 'vitest';
import {
  bulkDeleteNote,
  bulkDeleteResult,
  cardMeta,
  editedText,
  fileBadge,
  filterBySource,
  menuKeysFor,
  notUploadedText,
  profileLine,
  readingsPending,
  readSource,
  searchFieldsOf,
  skillsSummary,
  sortResumes,
  templateNameOf,
  uploadedTitle,
  uploadTitle,
  withKnownReading,
  yearsLabel,
} from './list';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');

function resume(patch: Partial<ResumeSummary>): ResumeSummary {
  return {
    id: 'r',
    kind: 'built',
    label: 'Resume',
    title: null,
    templateId: null,
    templateName: null,
    isDefault: false,
    fileKind: null,
    nameOnResume: '',
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
    lastEditedAt: null,
    ...patch,
  };
}

const built = resume({ id: 'a', updatedAt: '2026-10-22T06:00:00.000Z', nameOnResume: 'Ann Lee', templateId: 'navy-rule' });
const upload = resume({ id: 'b', kind: 'uploaded', fileKind: 'pdf', updatedAt: '2026-10-21T12:00:00.000Z' });
const defaultOne = resume({ id: 'c', isDefault: true, updatedAt: '2026-10-01T12:00:00.000Z' });

describe('Resumes tab', () => {
  it('reads the source filter, defaulting to All', () => {
    expect(readSource('uploaded')).toBe('uploaded');
    expect(readSource('created')).toBe('all');
    expect(readSource(null)).toBe('all');
  });

  it('filters by source', () => {
    expect(filterBySource([built, upload], 'built')).toEqual([built]);
    expect(filterBySource([built, upload], 'uploaded')).toEqual([upload]);
    expect(filterBySource([built, upload], 'all')).toEqual([built, upload]);
  });

  it('puts the default first, then the newest', () => {
    expect(sortResumes([upload, defaultOne, built]).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('says when it was edited, from the last content edit when there is one', () => {
    expect(editedText(built, NOW)).toBe('Edited 6 hours ago');
    expect(editedText({ ...built, lastEditedAt: '2026-10-22T11:59:30.000Z' }, NOW)).toBe('Edited just now');
    expect(editedText(resume({ updatedAt: '2026-10-01T12:00:00.000Z' }), NOW)).toBe('Edited 10/1/2026');
  });

  it('names the template from the API, else the list, else the default; none for an upload', () => {
    const templates = [
      { id: 'default', name: 'Professional Two-Column' },
      { id: 'navy-rule', name: 'Navy Rule' },
    ];
    expect(templateNameOf(built, templates)).toBe('Navy Rule');
    expect(templateNameOf({ ...built, templateName: 'From API' }, templates)).toBe('From API');
    expect(templateNameOf({ ...built, templateId: null }, templates)).toBe('Professional Two-Column');
    expect(templateNameOf({ ...built, templateId: 'gone' }, templates)).toBe('Professional Two-Column');
    expect(templateNameOf(upload, templates)).toBe('');
  });

  it('writes the card line and the badges', () => {
    expect(cardMeta('Edited 6 hours ago', 'Navy Rule')).toBe('Edited 6 hours ago · Navy Rule');
    expect(cardMeta('Edited 6 hours ago', '')).toBe('Edited 6 hours ago');
    expect(fileBadge(upload)).toBe('PDF');
    expect(fileBadge(built)).toBeNull();
  });

  it('searches the label, the name on the resume and the template, and the main skills when given', () => {
    expect(searchFieldsOf(built, 'Navy Rule')).toEqual(['Resume', 'Ann Lee', 'Navy Rule']);
    expect(searchFieldsOf(upload, '', ['React', 'GraphQL'])).toEqual(['Resume', 'React', 'GraphQL']);
  });

  it('notes the default resume a bulk delete skips, and reports the result', () => {
    expect(bulkDeleteNote([built])).toBeNull();
    expect(bulkDeleteNote([built, defaultOne])).toBe('1 default resume will be skipped');
    expect(bulkDeleteResult({ deleted: 2, skipped: 0 })).toBe('Deleted 2 resumes.');
    expect(bulkDeleteResult({ deleted: 1, skipped: 1 })).toBe('Deleted 1 resume. 1 default resume was skipped.');
  });

  it('offers Edit and the exports for a built resume; View, its skills and an editable copy for an upload', () => {
    expect(menuKeysFor(built)).toEqual(['edit', 'rename', 'duplicate', 'default', 'pdf', 'docx', 'json', 'delete']);
    expect(menuKeysFor(upload)).toEqual(['view', 'details', 'rename', 'duplicate', 'default', 'file', 'copy', 'delete']);
  });

  it('names an upload after the file unless a name is typed', () => {
    expect(uploadTitle('', 'John_Doe_Finance.pdf')).toBe('John_Doe_Finance');
    expect(uploadTitle('  Mine ', 'x.pdf')).toBe('Mine');
  });

  it('sums up several uploads', () => {
    expect(uploadedTitle(7)).toBe('7 resumes uploaded');
    expect(uploadedTitle(1)).toBe('1 resume uploaded');
    expect(notUploadedText(2)).toBe('2 files were not uploaded.');
    expect(notUploadedText(1)).toBe('1 file was not uploaded.');
  });
});

describe('what TailorIT read from a resume', () => {
  const brief = (patch: Partial<NonNullable<ResumeSummary['analysis']>> = {}) => ({
    yearsExperience: 8.2,
    hardSkills: ['React', 'TypeScript', 'Node.js', 'GraphQL', 'AWS', 'Docker', 'Jest', 'Redux', 'CSS', 'HTML', 'Git', 'SQL'],
    softSkillCount: 3,
    refining: false,
    aiWaiting: false,
    ...patch,
  });

  it('says the years short', () => {
    expect(yearsLabel(null)).toBeNull();
    expect(yearsLabel(0)).toBe('Under 1 yr');
    expect(yearsLabel(0.9)).toBe('Under 1 yr');
    expect(yearsLabel(1.4)).toBe('1 yr');
    expect(yearsLabel(1.5)).toBe('2 yrs');
    expect(yearsLabel(8.2)).toBe('8 yrs');
  });

  it('shows the first three main skills and how many more', () => {
    expect(skillsSummary(['React', 'TypeScript', 'Node.js', 'GraphQL'])).toBe('React, TypeScript, Node.js +1');
    expect(skillsSummary(['Go'])).toBe('Go');
    expect(skillsSummary([])).toBe('');
  });

  it('writes the card line, with a spinner while the AI reads it', () => {
    expect(profileLine(brief())).toEqual({ text: '8 yrs · React, TypeScript, Node.js +9', refining: false, hasReading: true });
    expect(profileLine(brief({ refining: true })).refining).toBe(true);
    expect(profileLine(brief({ yearsExperience: null, hardSkills: ['Go', 'Kubernetes'] })).text).toBe('Go, Kubernetes');
    expect(profileLine(brief({ hardSkills: [] })).text).toBe('8 yrs');
  });

  it('says when nothing is found yet, is on its way, or is not there', () => {
    expect(profileLine(null)).toEqual({ text: 'Finding skills...', refining: false, hasReading: false });
    expect(profileLine(brief({ yearsExperience: null, hardSkills: [], refining: true }))).toEqual({
      text: 'Finding skills...',
      refining: true,
      hasReading: true,
    });
    expect(profileLine(brief({ yearsExperience: null, hardSkills: [], aiWaiting: true })).text).toBe('Waiting for the AI reading');
    expect(profileLine(brief({ yearsExperience: null, hardSkills: [] })).text).toBe('No skills found');
    // A change's own answer carries no reading: the line keeps its place, empty.
    expect(profileLine(undefined)).toEqual({ text: '', refining: false, hasReading: false });
  });

  it('reads the list again while a reading is still to come', () => {
    expect(readingsPending([built, upload])).toBe(false);
    expect(readingsPending([{ ...upload, analysis: brief() }])).toBe(false);
    expect(readingsPending([{ ...upload, analysis: null }])).toBe(true);
    expect(readingsPending([{ ...upload, analysis: brief({ refining: true }) }])).toBe(true);
    expect(readingsPending([{ ...upload, analysis: brief({ aiWaiting: true }) }])).toBe(true);
    expect(readingsPending(undefined)).toBe(false);
  });

  it('keeps the reading the list holds when a change answers without one', () => {
    const known = { ...upload, analysis: brief() };
    const renamed = { ...upload, label: 'Renamed' };
    expect(withKnownReading(renamed, [known])).toEqual({ ...renamed, analysis: known.analysis });
    expect(withKnownReading({ ...renamed, analysis: null }, [known])?.analysis).toBeNull();
    expect(withKnownReading(renamed, [])).toBe(renamed);
    expect(withKnownReading(null, [known])).toBeNull();
  });
});
