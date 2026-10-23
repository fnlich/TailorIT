import { describe, expect, it } from 'vitest';
import { neighbourOf } from './focusAfterRemoval';
import { bulkDeleteSentence, describeMatches, matchesQuery, newestFirst, noMatchTitle, thumbKey, titleCase } from './gallery';

const resumes = { one: 'resume', many: 'resumes' };

describe('search', () => {
  it('matches a trimmed, case-insensitive substring of any field', () => {
    expect(matchesQuery('', ['anything'])).toBe(true);
    expect(matchesQuery('  dav  ', ['David_Jack_resume'])).toBe(true);
    expect(matchesQuery('JACK resume', ['David  Jack   Resume'])).toBe(true);
    expect(matchesQuery('tesla', [undefined, null, 'Cover Letter', 'Tesla'])).toBe(true);
    expect(matchesQuery('visa', ['Cover Letter'])).toBe(false);
  });

  it('describes the matches with the total deciding the noun', () => {
    expect(describeMatches(1, 3, resumes)).toBe('1 of 3 resumes match.');
    expect(describeMatches(0, 1, resumes)).toBe('0 of 1 resume match.');
    expect(noMatchTitle({ one: 'cover letter', many: 'cover letters' })).toBe('Oops! No matching cover letters found.');
  });
});

describe('wording', () => {
  it('title-cases nouns for dialog titles', () => {
    expect(titleCase('cover letters')).toBe('Cover Letters');
  });

  it('builds Simplify\'s bulk delete sentence', () => {
    expect(bulkDeleteSentence(3, resumes)).toBe(
      "Are you sure you want to delete these 3 resumes? You won't be able to undo this action.",
    );
    expect(bulkDeleteSentence(1, resumes)).toBe("Are you sure you want to delete this resume? You won't be able to undo this action.");
  });
});

describe('ordering and keys', () => {
  it('sorts newest first, ties by id, with an optional pinned id first', () => {
    const items = [
      { id: 'b', updatedAt: '2026-10-20T00:00:00Z' },
      { id: 'a', updatedAt: '2026-10-20T00:00:00Z' },
      { id: 'c', updatedAt: '2026-10-22T00:00:00Z' },
      { id: 'd', updatedAt: 'garbage' },
    ];
    expect(newestFirst(items).map((item) => item.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(newestFirst(items, 'b').map((item) => item.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('keys thumbnails by kind, id and version', () => {
    expect(thumbKey('resume', 'r1', '2026-10-22T00:00:00Z')).toBe('resume:r1:2026-10-22T00:00:00Z');
  });
});

describe('neighbourOf (focus after removal)', () => {
  it('picks the next remaining id, else the previous one', () => {
    expect(neighbourOf(['a', 'b', 'c'], ['b'])).toBe('c');
    expect(neighbourOf(['a', 'b', 'c'], ['c'])).toBe('b');
    expect(neighbourOf(['a', 'b', 'c', 'd'], ['b', 'c'])).toBe('d');
    expect(neighbourOf(['a', 'b'], ['a', 'b'])).toBeNull();
    expect(neighbourOf(['a'], ['z'])).toBeNull();
  });
});
