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
  readSource,
  searchFieldsOf,
  sortResumes,
  templateNameOf,
  uploadTitle,
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

  it('searches the label, the name on the resume and the template', () => {
    expect(searchFieldsOf(built, 'Navy Rule')).toEqual(['Resume', 'Ann Lee', 'Navy Rule']);
  });

  it('notes the default resume a bulk delete skips, and reports the result', () => {
    expect(bulkDeleteNote([built])).toBeNull();
    expect(bulkDeleteNote([built, defaultOne])).toBe('1 default resume will be skipped');
    expect(bulkDeleteResult({ deleted: 2, skipped: 0 })).toBe('Deleted 2 resumes.');
    expect(bulkDeleteResult({ deleted: 1, skipped: 1 })).toBe('Deleted 1 resume. 1 default resume was skipped.');
  });

  it('offers Edit and the exports for a built resume, View and an editable copy for an upload', () => {
    expect(menuKeysFor(built)).toEqual(['edit', 'rename', 'duplicate', 'default', 'pdf', 'docx', 'json', 'delete']);
    expect(menuKeysFor(upload)).toEqual(['view', 'rename', 'duplicate', 'default', 'file', 'copy', 'delete']);
  });

  it('names an upload after the file unless a name is typed', () => {
    expect(uploadTitle('', 'John_Doe_Finance.pdf')).toBe('John_Doe_Finance');
    expect(uploadTitle('  Mine ', 'x.pdf')).toBe('Mine');
  });
});
