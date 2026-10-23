import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readBulkDelete,
  readBulletsResult,
  readCreatedId,
  readImportResult,
  readPreview,
  readResumeList,
  readResumeView,
  readTemplateList,
  readThumbnail,
  requestBullets,
  templatePreviewSrc,
} from './api';

const summary = {
  id: 'r1',
  kind: 'built',
  label: 'Staff Engineer',
  title: null,
  templateId: 'navy-rule',
  templateName: 'Navy Rule',
  isDefault: true,
  fileKind: null,
  nameOnResume: 'Ann Lee',
  createdAt: '2026-10-22T12:00:00.000Z',
  updatedAt: '2026-10-22T13:00:00.000Z',
  lastEditedAt: null,
};

describe('lenient reading', () => {
  it('reads a list that follows the contract as it is', () => {
    expect(readResumeList({ items: [summary] })).toEqual([summary]);
  });

  it('reads an answer that differs from the contract by hand, and skips what cannot be a resume', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const items = readResumeList({
      items: [{ id: 'r2', kind: 'uploaded', fileKind: 'pdf', createdAt: '2026-10-20T00:00:00Z', title: 'CV' }, { nope: true }],
    });
    expect(items).toEqual([
      expect.objectContaining({ id: 'r2', kind: 'uploaded', fileKind: 'pdf', label: 'CV', updatedAt: '2026-10-20T00:00:00Z', isDefault: false }),
    ]);
    expect(warn).toHaveBeenCalled();
  });

  it('reads a resume with a normalised document (every list present)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = readResumeView({ ...summary, document: { name: 'Ann', title: 'Eng' }, file: null, hasExtractedText: false });
    expect(view?.document?.experience).toEqual([]);
    expect(view?.document?.name).toBe('Ann');
  });

  it('reads templates, filing an unknown category under none', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readTemplateList({ items: [{ id: 'x', name: 'X', category: 'fancy', printsSections: ['summary'] }] })).toEqual([
      {
        id: 'x',
        name: 'X',
        description: '',
        category: null,
        supportsSoftSkills: false,
        supportsStrengths: false,
        printsSections: ['summary'],
        nativeSectionOrder: [],
      },
    ]);
  });

  it('reads a preview, defaulting the page box to A4', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readPreview({ html: '<p>x</p>' })).toEqual({
      html: '<p>x</p>',
      templateId: '',
      page: { widthPx: 794, heightPx: 1123, contentHeightPx: 1123 },
      sampled: [],
    });
    expect(() => readPreview({})).toThrow();
  });

  it('reads both thumbnail shapes', () => {
    expect(readThumbnail({ kind: 'html', html: '<p/>', page: { widthPx: 794, heightPx: 1123, contentHeightPx: 1000 } })).toEqual({
      kind: 'html',
      html: '<p/>',
      page: { widthPx: 794, heightPx: 1123, contentHeightPx: 1000 },
    });
    expect(readThumbnail({ html: '<p/>' })).toEqual({ kind: 'html', html: '<p/>', page: null });
    expect(readThumbnail({ kind: 'image', url: '/api/files/f/thumbnail' })).toEqual({ kind: 'image', url: '/api/files/f/thumbnail' });
    expect(readThumbnail({})).toBeNull();
  });

  it('reads a bulk delete in either shape', () => {
    expect(readBulkDelete({ deleted: 2, skippedIds: ['d'] }, 3)).toEqual({ deleted: 2, skipped: 1, skippedIds: ['d'] });
    expect(readBulkDelete({ deleted: 2, skipped: ['d'] }, 3)).toEqual({ deleted: 2, skipped: 1, skippedIds: ['d'] });
    expect(readBulkDelete({ deleted: 2, skipped: 1 }, 3)).toEqual({ deleted: 2, skipped: 1, skippedIds: [] });
    expect(readBulkDelete({}, 3)).toEqual({ deleted: 3, skipped: 0, skippedIds: [] });
  });

  it('finds created ids and task results', () => {
    expect(readCreatedId({ id: 'a' })).toBe('a');
    expect(readCreatedId({ resume: { id: 'b' } })).toBe('b');
    expect(readImportResult({ resumeId: 'c' })).toBe('c');
    expect(readImportResult(null)).toBeNull();
    expect(readBulletsResult({ bullets: ['x', 3, 'y'] })).toEqual(['x', 'y']);
  });

  it('builds the template preview address', () => {
    expect(templatePreviewSrc('navy rule', 'flat')).toBe('/api/resume-templates/navy%20rule/preview?layout=flat');
  });
});

describe('requestBullets', () => {
  afterEach(() => vi.unstubAllGlobals());

  const body = { kind: 'experience' as const, entry: { title: 'Eng' }, task: 'write' as const };
  const json = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

  it('falls back to the other route when the first is not mounted, and remembers it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(404, { error: { code: 'not_found', message: 'There is no such API endpoint.' } }))
      .mockResolvedValueOnce(json(202, { taskId: 't1' }))
      .mockResolvedValueOnce(json(202, { taskId: 't2' }));
    vi.stubGlobal('fetch', fetch);
    await expect(requestBullets(body)).resolves.toBe('t1');
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/resumes/bullets');
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/ai/resume-bullets');
    await expect(requestBullets(body)).resolves.toBe('t2');
    expect(fetch.mock.calls[2]?.[0]).toBe('/api/ai/resume-bullets');
  });
});
