import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateResumes } from './cache';

// A resume change (a new default above all) must reach what other areas scored against the old resume: the Jobs
// keyword card, the tracker's Resume Score and its ranked resume picker keep their answers for a while, and are not
// on screen while the person is in Documents, so they are marked stale and read again when their page opens.

describe('invalidateResumes', () => {
  it('marks the resume queries, the keyword scores and the resume rankings stale, and nothing else', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
    const keys = {
      list: ['resumes', 'list'],
      detail: ['resumes', 'detail', 'r1'],
      jobMatch: ['jobs', 'insights', 42],
      score: ['tracker', 'score', 'app-1'],
      ranking: ['tracker', 'resume-matches', 'app-1'],
      jobDetail: ['jobs', 'detail', 42],
      board: ['tracker', 'board', 'all', '{}'],
      application: ['tracker', 'app', 'app-1'],
    };
    for (const key of Object.values(keys)) client.setQueryData(key, { cached: true });

    await invalidateResumes(client);

    const invalidated = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
    expect(invalidated(keys.list)).toBe(true);
    expect(invalidated(keys.detail)).toBe(true);
    expect(invalidated(keys.jobMatch)).toBe(true);
    expect(invalidated(keys.score)).toBe(true);
    expect(invalidated(keys.ranking)).toBe(true);
    expect(invalidated(keys.jobDetail)).toBe(false);
    expect(invalidated(keys.board)).toBe(false);
    expect(invalidated(keys.application)).toBe(false);
  });
});
